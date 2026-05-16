use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::time::Instant;
use tauri::State;
use reqwest;
use uuid::Uuid;

use crate::db::models::{Request, RequestHeader, RequestParam};
use crate::shared::http::{build_rest_http_client, is_ssl_failure, max_response_bytes};

/// Cap on body size we persist into the history row. Bodies larger
/// than this are dropped and the viewer shows a `<type · size>`
/// placeholder. 5 MB is generous enough for any realistic JSON/HTML
/// payload while preventing one giant text response from dominating
/// the history table.
const MAX_PERSIST_BYTES: usize = 5 * 1024 * 1024;

/// True when the headers' `Content-Type` is something the history
/// viewer can usefully render — JSON, XML, HTML, plain text, CSS,
/// JavaScript, form-encoded. Binary types (image/audio/video/pdf/
/// octet-stream/zip) return false: storing them as `from_utf8_lossy`
/// strings would corrupt them, the viewer can't render them anyway,
/// and they bloat the DB.
///
/// Parses BOTH header serialisation shapes Clauge has used:
///   • Tuple array:  `[["Content-Type","application/pdf"], ...]`
///     — the response-headers path uses `Vec<(String, String)>`.
///   • Object array: `[{"key":"Content-Type","value":"..."}, ...]`
///     — the request-headers path stores KVInput rows this way.
/// Returning the wrong shape silently in v1 of this fn was why
/// binary responses kept landing in history with their bytes
/// corrupted by `from_utf8_lossy`: the tuple-shape parse missed
/// content-type entirely → empty fallback → treated as text → kept.
fn is_text_like_content_type(headers_json: &str) -> bool {
    let parsed: serde_json::Value = match serde_json::from_str(headers_json) {
        Ok(v) => v,
        Err(_) => return true, // unparseable → conservative keep
    };
    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return true,
    };
    let ct = arr
        .iter()
        .find_map(|h| {
            // Object shape first: {"key": "...", "value": "..."}
            if let Some(obj) = h.as_object() {
                let key = obj.get("key").and_then(|v| v.as_str())?;
                if key.eq_ignore_ascii_case("content-type") {
                    return obj.get("value").and_then(|v| v.as_str()).map(String::from);
                }
                return None;
            }
            // Tuple shape: ["Content-Type", "application/pdf"]
            if let Some(tup) = h.as_array() {
                let k = tup.get(0).and_then(|v| v.as_str())?;
                if k.eq_ignore_ascii_case("content-type") {
                    return tup.get(1).and_then(|v| v.as_str()).map(String::from);
                }
            }
            None
        })
        .unwrap_or_default();
    if ct.is_empty() {
        // No content-type header. Conservatively assume text — beats
        // silently dropping a JSON response that the server forgot
        // to label.
        return true;
    }
    let mime = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if mime.is_empty() {
        return true;
    }
    mime.starts_with("text/")
        || mime.contains("json")
        || mime.contains("xml")
        || mime.contains("javascript")
        || mime.contains("ecmascript")
        || mime == "application/x-www-form-urlencoded"
        || mime == "application/graphql"
        || mime == "application/x-yaml"
        || mime == "application/yaml"
}

/// Walk the full error chain to get the root cause
fn full_error_chain(err: &reqwest::Error) -> String {
    let mut msg = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(cause) = source {
        msg = format!("{}: {}", msg, cause);
        source = std::error::Error::source(cause);
    }
    msg
}

/// Send the request; on a connect-level failure, probe the URL with cert
/// verification OFF to confirm the failure was TLS-related. If the probe
/// succeeds, surface `ssl-error:` so the REST UI can offer the disable-
/// verification guide; otherwise return the original error verbatim.
async fn send_with_ssl_probe(
    pool: &SqlitePool,
    url: &str,
    builder: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    match builder.send().await {
        Ok(resp) => Ok(resp),
        Err(e) if e.is_connect() && is_ssl_failure(pool, url).await => {
            Err("ssl-error: certificate verification failed".to_string())
        }
        Err(e) => Err(format!("Request failed: {}", full_error_chain(&e))),
    }
}

/// Body-cap enforcement. Used after `.bytes()` to fail loud rather than
/// silently truncating. We additionally check Content-Length up-front in
/// the executors so a 10 GB declared body fails fast without buffering.
fn enforce_body_cap(actual: u64, cap: u64) -> Result<(), String> {
    if actual > cap {
        let cap_mb = cap / (1024 * 1024);
        Err(format!(
            "Response body is {} bytes, exceeds the {} MB cap from Settings → REST → Max Response Size",
            actual, cap_mb
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: u64,
}

fn resolve_variables(input: &str, vars: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{}}}}}", key); // {{key}}
        result = result.replace(&placeholder, value);
    }
    result
}

/// Prepend a scheme if the URL has none.
/// `http://` for localhost / 127.x.x.x, `https://` for everything else.
fn ensure_scheme(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    // Already has a scheme
    // Protocol-relative URL
    if let Some(rest) = trimmed.strip_prefix("//") {
        return format!("https://{}", rest);
    }
    // Already has a scheme
    if trimmed.contains("://") {
        return trimmed.to_string();
    }
    // Extract host part (before any port, path, or query)
    let host = trimmed
        .split(&[':', '/', '?'][..])
        .next()
        .unwrap_or("")
        .to_lowercase();
    if host == "localhost" || host.starts_with("127.") {
        format!("http://{}", trimmed)
    } else {
        format!("https://{}", trimmed)
    }
}

#[tauri::command]
pub async fn execute_request(
    pool: State<'_, SqlitePool>,
    request_id: String,
    environment_id: String,
) -> Result<HttpResponse, String> {
    // 1. Load request from DB
    let request = sqlx::query_as::<_, Request>("SELECT * FROM requests WHERE id = ?")
        .bind(&request_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to load request: {}", e))?;

    let headers = sqlx::query_as::<_, RequestHeader>(
        "SELECT * FROM request_headers WHERE request_id = ? AND enabled = 1 ORDER BY sort_order ASC",
    )
    .bind(&request_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to load headers: {}", e))?;

    let params = sqlx::query_as::<_, RequestParam>(
        "SELECT * FROM request_params WHERE request_id = ? AND enabled = 1 ORDER BY sort_order ASC",
    )
    .bind(&request_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to load params: {}", e))?;

    // 2. Load environment variables
    let vars = if !environment_id.is_empty() {
        crate::db::models::load_env_vars(pool.inner(), &environment_id).await
    } else {
        HashMap::new()
    };

    // 3. Resolve {{var}} placeholders
    let resolved_url = ensure_scheme(&resolve_variables(&request.url, &vars));
    let resolved_body = resolve_variables(&request.body, &vars);

    // 4. Build query string from params
    let mut url_with_params = resolved_url.clone();
    if !params.is_empty() {
        let query_parts: Vec<String> = params
            .iter()
            .map(|p| {
                let key = resolve_variables(&p.key, &vars);
                let value = resolve_variables(&p.value, &vars);
                format!("{}={}", urlencoding_simple(&key), urlencoding_simple(&value))
            })
            .collect();
        let separator = if url_with_params.contains('?') { "&" } else { "?" };
        url_with_params = format!("{}{}{}", url_with_params, separator, query_parts.join("&"));
    }

    // 5. Build reqwest request — settings come from Settings → REST + General
    let client = build_rest_http_client(pool.inner()).await?;
    let max_body = max_response_bytes(pool.inner()).await;

    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => return Err(format!("Unsupported HTTP method: {}", other)),
    };

    let mut req_builder = client.request(method.clone(), &url_with_params);

    // Build body based on body_type
    let bt = &request.body_type;
    let (body_str, auto_ct, multipart_form) = build_body(&resolved_body, bt, &vars).await?;
    let is_multipart = multipart_form.is_some();

    // Add resolved headers — skip Content-Type for multipart (reqwest sets it with boundary)
    for h in &headers {
        let key = resolve_variables(&h.key, &vars);
        if key.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if is_multipart && key.eq_ignore_ascii_case("content-type") {
            continue;
        }
        let value = resolve_variables(&h.value, &vars);
        req_builder = req_builder.header(&key, &value);
    }

    // Auto-set Content-Type if user didn't set one (and not multipart)
    if !is_multipart && !has_content_type_req(&headers) {
        if let Some(ct) = &auto_ct {
            req_builder = req_builder.header("Content-Type", ct.as_str());
        }
    }

    if let Some(form) = multipart_form {
        req_builder = req_builder.multipart(form);
    } else if bt == "binary" {
        if let Some(bytes) = read_binary_body(&resolved_body).await? {
            req_builder = req_builder.body(bytes);
        }
    } else if let Some(body_content) = body_str {
        if !body_content.is_empty() {
            req_builder = req_builder.body(body_content);
        }
    }

    // Apply auth from auth_type + auth_data
    let resolved_auth_data = resolve_variables(&request.auth_data, &vars);
    match request.auth_type.as_str() {
        "bearer" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                if let Some(token) = auth["token"].as_str() {
                    if !token.is_empty() {
                        req_builder = req_builder.header("Authorization", format!("Bearer {}", token));
                    }
                }
            }
        }
        "basic" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                let username = auth["username"].as_str().unwrap_or("");
                let password = auth["password"].as_str().unwrap_or("");
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }
        "api-key" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                let key = auth["key"].as_str().unwrap_or("");
                let value = auth["value"].as_str().unwrap_or("");
                if !key.is_empty() {
                    req_builder = req_builder.header(key, value);
                }
            }
        }
        _ => {} // "none" or unknown — no auth
    }

    // Serialize request headers for history
    let request_headers_json = serde_json::to_string(
        &headers
            .iter()
            .map(|h| {
                (
                    resolve_variables(&h.key, &vars),
                    resolve_variables(&h.value, &vars),
                )
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    // 6. Execute request and measure time
    let start = Instant::now();
    let response = send_with_ssl_probe(pool.inner(), &url_with_params, req_builder).await?;
    let duration_ms = start.elapsed().as_millis() as u64;

    // 7. Read response
    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let response_headers_json = serde_json::to_string(&response_headers).unwrap_or_default();

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let size_bytes = body_bytes.len() as u64;
    enforce_body_cap(size_bytes, max_body)?;
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    // 8. Save to history
    let history_id = Uuid::new_v4().to_string();
    let env_id_opt = if environment_id.is_empty() {
        None
    } else {
        Some(&environment_id)
    };

    // History persistence rule:
    //   • Text-like bodies (json/xml/html/css/js/text/form-urlencoded)
    //     are kept — that's the bread-and-butter of debugging an API
    //     and what the user actually wants to see in history.
    //   • Binary bodies (image/audio/video/pdf/zip/octet-stream) are
    //     dropped — they bloat the DB, `String::from_utf8_lossy` would
    //     corrupt them anyway, and the history viewer can't render them.
    //   • Anything bigger than `MAX_PERSIST_BYTES` is also dropped
    //     regardless of type — keeps a single huge text response from
    //     hijacking the storage.
    // History viewer renders `<{type} · {size}>` for dropped slots
    // using the still-stored Content-Type + response_size_bytes.
    let req_body_to_store =
        if is_text_like_content_type(&request_headers_json) && resolved_body.len() <= MAX_PERSIST_BYTES {
            resolved_body.as_str()
        } else {
            ""
        };
    let resp_body_to_store: Option<&str> =
        if is_text_like_content_type(&response_headers_json) && body.len() <= MAX_PERSIST_BYTES {
            Some(body.as_str())
        } else {
            None
        };
    sqlx::query(
        "INSERT INTO history (id, request_id, method, url, resolved_url, request_body, request_headers, response_status, response_body, response_headers, response_size_bytes, duration_ms, environment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&history_id)
    .bind(&request_id)
    .bind(&request.method)
    .bind(&request.url)
    .bind(&url_with_params)
    .bind(req_body_to_store)
    .bind(&request_headers_json)
    .bind(status as i32)
    .bind(resp_body_to_store)
    .bind(&response_headers_json)
    .bind(size_bytes as i64)
    .bind(duration_ms as i64)
    .bind(env_id_opt)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to save history: {}", e))?;

    Ok(HttpResponse {
        status,
        status_text,
        headers: response_headers,
        body,
        duration_ms,
        size_bytes,
    })
}

#[tauri::command]
pub async fn quick_execute(
    pool: State<'_, SqlitePool>,
    method: String,
    url: String,
    body: String,
    headers: Vec<(String, String)>,
    environment_id: String,
    auth_type: Option<String>,
    auth_data: Option<String>,
    body_type: Option<String>,
) -> Result<HttpResponse, String> {
    // Load environment variables if an environment is selected
    let vars = if !environment_id.is_empty() {
        crate::db::models::load_env_vars(pool.inner(), &environment_id).await
    } else {
        HashMap::new()
    };

    // Resolve {{var}} placeholders in URL, body, and headers
    let resolved_url = ensure_scheme(&resolve_variables(&url, &vars));
    let resolved_body = resolve_variables(&body, &vars);
    let resolved_headers: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (resolve_variables(k, &vars), resolve_variables(v, &vars)))
        .collect();

    let client = build_rest_http_client(pool.inner()).await?;
    let max_body = max_response_bytes(pool.inner()).await;

    let http_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => return Err(format!("Unsupported HTTP method: {}", other)),
    };

    let mut req_builder = client.request(http_method, &resolved_url);

    // Build body based on body_type
    let bt = body_type.as_deref().unwrap_or("json");
    let (body_str, auto_ct, multipart_form) = build_body(&resolved_body, bt, &vars).await?;
    let is_multipart = multipart_form.is_some();

    // Add headers — skip Content-Type for multipart (reqwest sets it with boundary)
    for (k, v) in &resolved_headers {
        if k.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if is_multipart && k.eq_ignore_ascii_case("content-type") {
            continue;
        }
        req_builder = req_builder.header(k.as_str(), v.as_str());
    }

    // Auto-set Content-Type if user didn't set one (and not multipart)
    if !is_multipart && !has_content_type(&resolved_headers) {
        if let Some(ct) = &auto_ct {
            req_builder = req_builder.header("Content-Type", ct.as_str());
        }
    }

    // Apply body
    if let Some(form) = multipart_form {
        req_builder = req_builder.multipart(form);
    } else if bt == "binary" {
        if let Some(bytes) = read_binary_body(&resolved_body).await? {
            req_builder = req_builder.body(bytes);
        }
    } else if let Some(body_content) = body_str {
        if !body_content.is_empty() {
            req_builder = req_builder.body(body_content);
        }
    }

    // Apply auth
    let auth_t = auth_type.as_deref().unwrap_or("none");
    let auth_d = auth_data.as_deref().unwrap_or("{}");
    let resolved_auth = resolve_variables(auth_d, &vars);
    match auth_t {
        "bearer" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                if let Some(token) = auth["token"].as_str() {
                    if !token.is_empty() {
                        req_builder = req_builder.header("Authorization", format!("Bearer {}", token));
                    }
                }
            }
        }
        "basic" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                let username = auth["username"].as_str().unwrap_or("");
                let password = auth["password"].as_str().unwrap_or("");
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }
        "api-key" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                let key = auth["key"].as_str().unwrap_or("");
                let value = auth["value"].as_str().unwrap_or("");
                if !key.is_empty() {
                    req_builder = req_builder.header(key, value);
                }
            }
        }
        _ => {}
    }

    let request_headers_json = serde_json::to_string(&resolved_headers).unwrap_or_default();

    let start = Instant::now();
    let response = send_with_ssl_probe(pool.inner(), &resolved_url, req_builder).await?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let response_headers_json = serde_json::to_string(&response_headers).unwrap_or_default();

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let size_bytes = body_bytes.len() as u64;
    enforce_body_cap(size_bytes, max_body)?;
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    // Save to history
    let history_id = Uuid::new_v4().to_string();
    let env_id_opt = if environment_id.is_empty() {
        None
    } else {
        Some(&environment_id)
    };
    // Same persistence rule as the saved-request path — see the long
    // comment on that INSERT. Text-like body kept, binary/oversize
    // dropped (placeholder shown in history viewer instead).
    let req_body_to_store =
        if is_text_like_content_type(&request_headers_json) && resolved_body.len() <= MAX_PERSIST_BYTES {
            resolved_body.as_str()
        } else {
            ""
        };
    let resp_body_to_store: Option<&str> =
        if is_text_like_content_type(&response_headers_json) && body_str.len() <= MAX_PERSIST_BYTES {
            Some(body_str.as_str())
        } else {
            None
        };
    sqlx::query(
        "INSERT INTO history (id, method, url, resolved_url, request_body, request_headers, response_status, response_body, response_headers, response_size_bytes, duration_ms, environment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&history_id)
    .bind(&method.to_uppercase())
    .bind(&url)
    .bind(&resolved_url)
    .bind(req_body_to_store)
    .bind(&request_headers_json)
    .bind(status as i32)
    .bind(resp_body_to_store)
    .bind(&response_headers_json)
    .bind(size_bytes as i64)
    .bind(duration_ms as i64)
    .bind(env_id_opt)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to save history: {}", e))?;

    Ok(HttpResponse {
        status,
        status_text,
        headers: response_headers,
        body: body_str,
        duration_ms,
        size_bytes,
    })
}

/// Internal version of execute_request for use by AI tools (no history saving).
pub async fn execute_request_internal(
    pool: &SqlitePool,
    request_id: &str,
    environment_id: &str,
) -> Result<HttpResponse, String> {
    let request = sqlx::query_as::<_, Request>("SELECT * FROM requests WHERE id = ?")
        .bind(request_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to load request: {}", e))?;

    let headers = sqlx::query_as::<_, RequestHeader>(
        "SELECT * FROM request_headers WHERE request_id = ? AND enabled = 1 ORDER BY sort_order ASC",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load headers: {}", e))?;

    let params = sqlx::query_as::<_, RequestParam>(
        "SELECT * FROM request_params WHERE request_id = ? AND enabled = 1 ORDER BY sort_order ASC",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load params: {}", e))?;

    let vars = if !environment_id.is_empty() {
        crate::db::models::load_env_vars(pool, environment_id).await
    } else {
        HashMap::new()
    };

    let resolved_url = ensure_scheme(&resolve_variables(&request.url, &vars));
    let resolved_body = resolve_variables(&request.body, &vars);

    let mut url_with_params = resolved_url.clone();
    if !params.is_empty() {
        let query_parts: Vec<String> = params
            .iter()
            .map(|p| {
                let key = resolve_variables(&p.key, &vars);
                let value = resolve_variables(&p.value, &vars);
                format!("{}={}", urlencoding_simple(&key), urlencoding_simple(&value))
            })
            .collect();
        let separator = if url_with_params.contains('?') { "&" } else { "?" };
        url_with_params = format!("{}{}{}", url_with_params, separator, query_parts.join("&"));
    }

    let client = build_rest_http_client(pool).await?;
    let max_body = max_response_bytes(pool).await;

    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => return Err(format!("Unsupported HTTP method: {}", other)),
    };

    let mut req_builder = client.request(method, &url_with_params);

    // Build body based on body_type
    let bt = &request.body_type;
    let (body_str_int, auto_ct_int, multipart_form_int) = build_body(&resolved_body, bt, &vars).await?;
    let is_multipart_int = multipart_form_int.is_some();

    // Add headers — skip Content-Type for multipart (reqwest sets it with boundary)
    for h in &headers {
        let key = resolve_variables(&h.key, &vars);
        if key.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if is_multipart_int && key.eq_ignore_ascii_case("content-type") {
            continue;
        }
        let value = resolve_variables(&h.value, &vars);
        req_builder = req_builder.header(&key, &value);
    }

    if !is_multipart_int && !has_content_type_req(&headers) {
        if let Some(ct) = &auto_ct_int {
            req_builder = req_builder.header("Content-Type", ct.as_str());
        }
    }

    if let Some(form) = multipart_form_int {
        req_builder = req_builder.multipart(form);
    } else if bt == "binary" {
        if let Some(bytes) = read_binary_body(&resolved_body).await? {
            req_builder = req_builder.body(bytes);
        }
    } else if let Some(body_content) = body_str_int {
        if !body_content.is_empty() {
            req_builder = req_builder.body(body_content);
        }
    }

    let resolved_auth_data = resolve_variables(&request.auth_data, &vars);
    match request.auth_type.as_str() {
        "bearer" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                if let Some(token) = auth["token"].as_str() {
                    if !token.is_empty() {
                        req_builder =
                            req_builder.header("Authorization", format!("Bearer {}", token));
                    }
                }
            }
        }
        "basic" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                let username = auth["username"].as_str().unwrap_or("");
                let password = auth["password"].as_str().unwrap_or("");
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }
        "api-key" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth_data) {
                let key = auth["key"].as_str().unwrap_or("");
                let value = auth["value"].as_str().unwrap_or("");
                if !key.is_empty() {
                    req_builder = req_builder.header(key, value);
                }
            }
        }
        _ => {}
    }

    let start = Instant::now();
    let response = send_with_ssl_probe(pool, &url_with_params, req_builder).await?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let size_bytes = body_bytes.len() as u64;
    enforce_body_cap(size_bytes, max_body)?;
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponse {
        status,
        status_text,
        headers: response_headers,
        body,
        duration_ms,
        size_bytes,
    })
}

/// Check if user manually set a Content-Type header
fn has_content_type(headers: &[(String, String)]) -> bool {
    headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type"))
}

fn has_content_type_req(headers: &[RequestHeader]) -> bool {
    headers.iter().any(|h| h.key.eq_ignore_ascii_case("content-type"))
}

/// Build the request body and optional Content-Type based on body_type.
/// Returns (Option<reqwest::Body>, Option<content_type_string>, Option<multipart::Form>)
async fn build_body(
    body: &str,
    body_type: &str,
    vars: &HashMap<String, String>,
) -> Result<(Option<String>, Option<String>, Option<reqwest::multipart::Form>), String> {
    if body.is_empty() || body_type == "none" {
        return Ok((None, None, None));
    }

    match body_type {
        "json" => {
            Ok((Some(body.to_string()), Some("application/json".to_string()), None))
        }
        "text" => {
            Ok((Some(body.to_string()), Some("text/plain".to_string()), None))
        }
        "xml" => {
            Ok((Some(body.to_string()), Some("application/xml".to_string()), None))
        }
        "urlencoded" => {
            // Body is JSON array: [{"key":"k","value":"v","enabled":true}]
            if let Ok(fields) = serde_json::from_str::<Vec<serde_json::Value>>(body) {
                let encoded: Vec<String> = fields.iter()
                    .filter(|f| f["enabled"].as_bool().unwrap_or(true))
                    .map(|f| {
                        let key = resolve_variables(f["key"].as_str().unwrap_or(""), vars);
                        let value = resolve_variables(f["value"].as_str().unwrap_or(""), vars);
                        format!("{}={}", urlencoding_simple(&key), urlencoding_simple(&value))
                    })
                    .collect();
                Ok((Some(encoded.join("&")), Some("application/x-www-form-urlencoded".to_string()), None))
            } else {
                // Fallback: body is already a raw urlencoded string (e.g., from cURL)
                Ok((Some(body.to_string()), Some("application/x-www-form-urlencoded".to_string()), None))
            }
        }
        "multipart" => {
            // Body is JSON array: [{"key":"k","value":"v","type":"text","enabled":true}]
            // or [{"key":"k","filePath":"/path","fileName":"f.png","type":"file","enabled":true}]
            let fields: Vec<serde_json::Value> = serde_json::from_str(body)
                .map_err(|e| format!("Invalid multipart body data: {}", e))?;

            let mut form = reqwest::multipart::Form::new();
            for field in &fields {
                if !field["enabled"].as_bool().unwrap_or(true) {
                    continue;
                }
                let key = resolve_variables(field["key"].as_str().unwrap_or(""), vars);
                let field_type = field["type"].as_str().unwrap_or("text");

                if field_type == "file" {
                    let file_path = field["filePath"].as_str().unwrap_or("");
                    let file_name = field["fileName"].as_str().unwrap_or("file");
                    if !file_path.is_empty() {
                        let bytes = tokio::fs::read(file_path).await
                            .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;
                        let mime = mime_guess::from_path(file_path)
                            .first_or_octet_stream()
                            .to_string();
                        let part = reqwest::multipart::Part::bytes(bytes)
                            .file_name(file_name.to_string())
                            .mime_str(&mime)
                            .map_err(|e| format!("Invalid MIME type: {}", e))?;
                        form = form.part(key, part);
                    }
                } else {
                    let value = resolve_variables(field["value"].as_str().unwrap_or(""), vars);
                    form = form.text(key, value);
                }
            }
            // Content-Type is set automatically by reqwest for multipart
            Ok((None, None, Some(form)))
        }
        "binary" => {
            // Body is JSON: {"filePath":"/path","fileName":"file.bin"}
            if let Ok(info) = serde_json::from_str::<serde_json::Value>(body) {
                let file_path = info["filePath"].as_str().unwrap_or("");
                if !file_path.is_empty() {
                    let mime = mime_guess::from_path(file_path)
                        .first_or_octet_stream()
                        .to_string();
                    // Actual bytes are read via read_binary_body() in the caller
                    return Ok((None, Some(mime), None));
                }
            }
            Ok((None, None, None))
        }
        _ => {
            // Unknown type — send as raw text
            Ok((Some(body.to_string()), None, None))
        }
    }
}

/// Read binary file for body — separate function to get the actual bytes
async fn read_binary_body(body: &str) -> Result<Option<Vec<u8>>, String> {
    if let Ok(info) = serde_json::from_str::<serde_json::Value>(body) {
        let file_path = info["filePath"].as_str().unwrap_or("");
        if !file_path.is_empty() {
            let bytes = tokio::fs::read(file_path).await
                .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;
            return Ok(Some(bytes));
        }
    }
    Ok(None)
}

/// Simple URL encoding for query param keys/values
fn urlencoding_simple(input: &str) -> String {
    let mut result = String::new();
    for ch in input.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(ch),
            ' ' => result.push_str("%20"),
            _ => {
                for byte in ch.to_string().as_bytes() {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    result
}

/// Internal version of quick_execute for AI tools — takes params directly, no history save.
pub async fn quick_execute_internal(
    pool: &SqlitePool,
    method: &str,
    url: &str,
    body: &str,
    headers: &[(String, String)],
    environment_id: &str,
    auth_type: &str,
    auth_data: &str,
) -> Result<HttpResponse, String> {
    let vars = if !environment_id.is_empty() {
        crate::db::models::load_env_vars(pool, environment_id).await
    } else {
        HashMap::new()
    };

    let resolved_url = ensure_scheme(&resolve_variables(url, &vars));
    let resolved_body = resolve_variables(body, &vars);

    let client = build_rest_http_client(pool).await?;
    let max_body = max_response_bytes(pool).await;

    let http_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => return Err(format!("Unsupported HTTP method: {}", other)),
    };

    let mut req_builder = client.request(http_method, &resolved_url);

    for (k, v) in headers {
        let rk = resolve_variables(k, &vars);
        let rv = resolve_variables(v, &vars);
        if rk.eq_ignore_ascii_case("accept-encoding") { continue; }
        req_builder = req_builder.header(rk, rv);
    }

    // AI tools always send as raw text body (json type)
    if !resolved_body.is_empty() {
        if !has_content_type(headers) {
            req_builder = req_builder.header("Content-Type", "application/json");
        }
        req_builder = req_builder.body(resolved_body);
    }

    let resolved_auth = resolve_variables(auth_data, &vars);
    match auth_type {
        "bearer" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                if let Some(token) = auth["token"].as_str() {
                    if !token.is_empty() {
                        req_builder = req_builder.header("Authorization", format!("Bearer {}", token));
                    }
                }
            }
        }
        "basic" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                let username = auth["username"].as_str().unwrap_or("");
                let password = auth["password"].as_str().unwrap_or("");
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }
        "api-key" => {
            if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&resolved_auth) {
                let key = auth["key"].as_str().unwrap_or("");
                let value = auth["value"].as_str().unwrap_or("");
                if !key.is_empty() {
                    req_builder = req_builder.header(key, value);
                }
            }
        }
        _ => {}
    }

    let start = Instant::now();
    let response = send_with_ssl_probe(pool, &resolved_url, req_builder).await?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let response_headers: Vec<(String, String)> = response.headers().iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_bytes = response.bytes().await.map_err(|e| format!("Failed to read body: {}", e))?;
    let size_bytes = body_bytes.len() as u64;
    enforce_body_cap(size_bytes, max_body)?;
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponse { status, status_text, headers: response_headers, body: body_str, duration_ms, size_bytes })
}
