// Push dispatch: turns fan-out triggers (terminal exit, "needs input")
// into FCM notifications via the Clauge Worker. The Worker's
// `/api/push/send` reuses the SAME Bearer provider-token auth as every
// other cloud endpoint (see cloud::client::post_json_auth), so push
// REQUIRES an active cloud sign-in — without a token we have nothing to
// authenticate to the Worker with, and we skip silently.
//
// Wiring (decoupled from fan-out): fanout emits `PushTrigger`s into an
// mpsc sink that this module installs on `start`. A drain task turns
// each trigger into a `notify_devices` call; a separate interval task
// sweeps the hubs for the attention heuristic. Both die when the
// companion server stops (watch channel), and the sink is cleared so
// late triggers are dropped.

use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::time::Duration;
use tauri::Manager;
use tokio::sync::watch;

use crate::cloud::auth::AuthState;
use crate::cloud::config::API_BASE_URL;
use crate::shared::http::build_app_http_client;

use crate::shared::repos::settings;

use super::fanout::{self, AttentionKind, PushTrigger};

/// How often the attention sweep runs. Independent of ATTENTION_IDLE —
/// a shorter cadence just means the notification fires nearer the idle
/// threshold.
const SWEEP_INTERVAL: Duration = Duration::from_secs(5);

/// Notification "kind" tags the mobile app deep-links on.
const KIND_EXIT: &str = "exit";
const KIND_ATTENTION: &str = "attention";
const KIND_APPROVAL: &str = "approval";
const KIND_DONE: &str = "done";

/// Default for `push_done_min_secs` — a turn must run at least this long
/// to be worth a "task complete" push. Matches the Settings UI default.
const DONE_MIN_SECS_DEFAULT: u64 = 90;

/// The Worker's `/api/push/send` accepts at most 10 tokens per call, so
/// we fan large device lists out in batches of this size.
const WORKER_TOKEN_BATCH: usize = 10;

/// Spawn the push tasks (trigger drain + attention sweep) and install
/// the fan-out sink. `shutdown` is the companion server's stop signal;
/// both tasks exit when it flips. Called from `companion_start`.
pub fn start(app: tauri::AppHandle, shutdown: watch::Receiver<bool>) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PushTrigger>();
    fanout::set_push_sink(tx);

    // Trigger drain: one Worker call per trigger.
    let app_drain = app.clone();
    let mut sd_drain = shutdown.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                trigger = rx.recv() => match trigger {
                    Some(t) => handle_trigger(&app_drain, t).await,
                    None => break,
                },
                _ = sd_drain.changed() => break,
            }
        }
    });

    // Attention sweep: periodically flag idle prompts. The sweep itself
    // is sync + pure-ish (fanout::sweep_attention); any push it produces
    // flows back through the same sink → drain task above.
    let mut sd_sweep = shutdown;
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            tokio::select! {
                _ = ticker.tick() => fanout::sweep_attention(),
                _ = sd_sweep.changed() => break,
            }
        }
    });

    log::info!("[companion] push dispatch started");
}

/// Drop the fan-out sink so triggers stop being queued. The tasks
/// themselves wind down on the server's shutdown signal. Called from
/// `companion_stop`.
pub fn stop() {
    fanout::clear_push_sink();
    log::info!("[companion] push dispatch stopped");
}

async fn handle_trigger(app: &tauri::AppHandle, trigger: PushTrigger) {
    let pool = app.state::<SqlitePool>();
    let pool = pool.inner();

    // Per-type enable toggles + task-complete tuning live in the settings
    // table (Settings → Mobile). All default on, so an unconfigured install
    // behaves exactly as before. Returning early here drops the trigger
    // before we touch the device list / Worker.
    let (title, body, kind, terminal_id) = match trigger {
        PushTrigger::Exit { terminal_id, title } => {
            if !settings::get_bool_or(pool, "push_exit_enabled", true).await {
                crate::diag!(area: "notify", "Exit dropped: session-ended notifications disabled ({terminal_id})");
                return;
            }
            ("Session ended", title, KIND_EXIT, terminal_id)
        }
        PushTrigger::Attention { terminal_id, title, kind } => {
            if !settings::get_bool_or(pool, "push_attention_enabled", true).await {
                crate::diag!(area: "notify", "Attention dropped: approval/input notifications disabled ({terminal_id})");
                return;
            }
            match kind {
                AttentionKind::Approval => ("Approval needed", title, KIND_APPROVAL, terminal_id),
                AttentionKind::Input => ("Needs your input", title, KIND_ATTENTION, terminal_id),
            }
        }
        PushTrigger::Done { terminal_id, title, busy_secs } => {
            if !settings::get_bool_or(pool, "push_done_enabled", true).await {
                crate::diag!(area: "notify", "Done dropped: task-complete notifications disabled ({terminal_id})");
                return;
            }
            let min = settings::get_u64_or(pool, "push_done_min_secs", DONE_MIN_SECS_DEFAULT).await;
            if busy_secs < min {
                crate::diag!(area: "notify", "Done dropped: ran {busy_secs}s < {min}s threshold ({terminal_id})");
                return;
            }
            // "Only when away": skip if the user is sitting at the desktop.
            let only_away = settings::get_bool_or(pool, "push_done_only_when_away", true).await;
            if only_away && desktop_focused(app) {
                crate::diag!(area: "notify", "Done dropped: desktop window is focused, 'only when away' on ({terminal_id})");
                return;
            }
            ("Task complete", title, KIND_DONE, terminal_id)
        }
    };
    crate::diag!(area: "notify", "notifying devices: kind={kind} terminal={terminal_id} title={title:?}");
    let hostname = tauri_plugin_os::hostname();
    let mut data = json!({ "kind": kind, "terminalId": terminal_id });
    if !hostname.is_empty() {
        data["serverName"] = json!(hostname);
    }
    notify_devices(app, title, &body, data).await;
}

/// Diagnostic: fire a test notification and report EXACTLY what the Worker
/// says, instead of the fire-and-forget `notify_devices` path (which
/// swallows every failure). Surfaces the HTTP status + per-token FCM error
/// codes so we can tell apart "Worker not configured", "bad key", "sender
/// mismatch", "stale token", etc. Throwaway debug tool.
#[tauri::command]
pub async fn companion_send_test_push(app: tauri::AppHandle) -> Result<String, String> {
    // Backend gate matching the UI: this debug affordance is reachable over
    // IPC regardless of whether the button is shown, so enforce the same
    // `notify` diagnostics flag here rather than relying on the hidden button.
    if !crate::shared::app_config::diagnostics_enabled("notify") {
        return Err("Test push is available only when diagnostics has \"notify\" enabled in settings.json.".into());
    }

    let pool = app.state::<SqlitePool>();
    let pool = pool.inner();

    let tokens = super::devices::fcm_tokens(pool)
        .await
        .map_err(|e| format!("Couldn't read paired devices: {e}"))?;
    if tokens.is_empty() {
        return Err(
            "No devices have an FCM token yet. Pair a phone and open the app once (with notifications allowed).".into(),
        );
    }

    let auth = app.state::<AuthState>();
    let Some((cloud_token, provider)) = auth.active_token_and_provider() else {
        return Err("Not signed in to the cloud — push needs an active sign-in.".into());
    };

    let client = build_app_http_client(pool)
        .await
        .map_err(|e| format!("HTTP client build failed: {e}"))?;

    // Worker caps each call at 10 tokens; one batch is plenty for a test.
    let fcm_tokens: Vec<&str> = tokens.iter().take(10).map(|(_, t)| t.as_str()).collect();
    let total = fcm_tokens.len();
    let req_body = json!({
        "fcmTokens": fcm_tokens,
        "title": "Clauge",
        "body": "Test notification — delivery is working.",
        "data": { "kind": "test" },
    });

    let resp = client
        .post(format!("{}{}", API_BASE_URL, "/api/push/send"))
        .header("Authorization", format!("Bearer {}", cloud_token))
        .header("X-Provider", &provider)
        .header("Content-Type", "application/json")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the Worker: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Worker rejected push: HTTP {} — {}",
            status.as_u16(),
            text.trim()
        ));
    }

    // 200: dig into the per-token results array.
    let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
    let Some(arr) = parsed.get("results").and_then(Value::as_array) else {
        return Ok(format!(
            "Worker returned 200 but no results — body: {}",
            text.trim()
        ));
    };
    let ok = arr
        .iter()
        .filter(|r| r.get("ok").and_then(Value::as_bool).unwrap_or(false))
        .count();
    let errors: Vec<String> = arr
        .iter()
        .filter_map(|r| r.get("error").and_then(Value::as_str).map(String::from))
        .collect();

    if ok == total && errors.is_empty() {
        Ok(format!(
            "FCM accepted {ok}/{total} — check your phone."
        ))
    } else if ok > 0 {
        Ok(format!(
            "FCM accepted {ok}/{total}. Failures: {}",
            errors.join(", ")
        ))
    } else {
        Err(format!(
            "FCM accepted 0/{total}. Errors: {}",
            if errors.is_empty() {
                text.trim().to_string()
            } else {
                errors.join(", ")
            }
        ))
    }
}

/// Is the desktop window focused right now (user is at the machine)? Used
/// by the "only when away" gate for the task-complete push. Unknown — no
/// window, or the query fails — is treated as focused so we err toward NOT
/// buzzing the phone.
fn desktop_focused(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(true))
        .unwrap_or(true)
}

/// Fetch every device with a stored FCM token and ask the Worker to
/// push `title`/`body`/`data` to them. No-ops (with a debug log) when
/// the user isn't signed in to cloud — push has no Worker auth then.
/// Per-token `stale:true` in the response clears that token so we stop
/// hitting a dead registration.
pub async fn notify_devices(app: &tauri::AppHandle, title: &str, body: &str, data: Value) {
    let pool = app.state::<SqlitePool>();
    let pool = pool.inner();

    let tokens = match super::devices::fcm_tokens(pool).await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("[companion] push: load fcm tokens failed: {}", e);
            return;
        }
    };
    if tokens.is_empty() {
        crate::diag!(area: "notify", "push skipped: no paired devices have an FCM token");
        return;
    }

    // Worker auth = the active cloud session's Bearer token + provider,
    // identical to cloud::client. No session → nothing to authenticate
    // with → skip (push is best-effort, not a hard dependency).
    let auth = app.state::<AuthState>();
    let Some((cloud_token, provider)) = auth.active_token_and_provider() else {
        crate::diag!(area: "notify", "push skipped: not signed in to cloud ({} device(s) pending)", tokens.len());
        return;
    };

    let client = match build_app_http_client(pool).await {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[companion] push: http client build failed: {}", e);
            return;
        }
    };

    // The Worker caps each call at 10 tokens, so send in chunks. Results
    // come back index-aligned with the chunk we sent; `stale:true` means
    // FCM rejected the registration (app uninstalled / token rotated) —
    // clear that device's token so we stop targeting it.
    for chunk in tokens.chunks(WORKER_TOKEN_BATCH) {
        let fcm_tokens: Vec<&str> = chunk.iter().map(|(_, t)| t.as_str()).collect();
        let req_body = json!({
            "fcmTokens": fcm_tokens,
            "title": title,
            "body": body,
            "data": data,
        });
        let resp = client
            .post(format!("{}{}", API_BASE_URL, "/api/push/send"))
            .header("Authorization", format!("Bearer {}", cloud_token))
            .header("X-Provider", &provider)
            .header("Content-Type", "application/json")
            .json(&req_body)
            .send()
            .await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[companion] push: send failed: {}", e);
                continue;
            }
        };
        if !resp.status().is_success() {
            log::warn!("[companion] push: worker returned {}", resp.status().as_u16());
            continue;
        }
        crate::diag!(area: "notify", "push: worker accepted {} token(s)", fcm_tokens.len());
        let parsed: Value = match resp.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(results) = parsed.get("results").and_then(Value::as_array) {
            for (i, r) in results.iter().enumerate() {
                let stale = r.get("stale").and_then(Value::as_bool).unwrap_or(false);
                if !stale {
                    continue;
                }
                let Some((device_id, _)) = chunk.get(i) else {
                    continue;
                };
                if let Err(e) = super::devices::clear_fcm_token(pool, device_id).await {
                    log::warn!("[companion] push: clear stale token failed: {}", e);
                }
            }
        }
    }
}
