use sqlx::SqlitePool;

use crate::db::models::{Request, RequestHeader, RequestParam};

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

pub async fn list_by_collection(
    pool: &SqlitePool,
    collection_id: &str,
) -> Result<Vec<Request>, sqlx::Error> {
    sqlx::query_as::<_, Request>(
        "SELECT * FROM requests WHERE collection_id = ? ORDER BY sort_order ASC",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Request, sqlx::Error> {
    sqlx::query_as::<_, Request>("SELECT * FROM requests WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
}

pub async fn max_sort_order(
    pool: &SqlitePool,
    collection_id: &str,
) -> Result<(i32,), sqlx::Error> {
    sqlx::query_as(
        "SELECT COALESCE(MAX(sort_order), -1) FROM requests WHERE collection_id = ?",
    )
    .bind(collection_id)
    .fetch_one(pool)
    .await
}

pub async fn insert(
    pool: &SqlitePool,
    id: &str,
    collection_id: &str,
    name: &str,
    method: &str,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO requests (id, collection_id, name, method, sort_order) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(collection_id)
    .bind(name)
    .bind(method)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_full(
    pool: &SqlitePool,
    id: &str,
    collection_id: &str,
    name: &str,
    description: &str,
    method: &str,
    url: &str,
    body: &str,
    body_type: &str,
    auth_type: &str,
    auth_data: &str,
    pre_script: &str,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO requests (id, collection_id, name, description, method, url, body, body_type, auth_type, auth_data, pre_script, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(collection_id)
    .bind(name)
    .bind(description)
    .bind(method)
    .bind(url)
    .bind(body)
    .bind(body_type)
    .bind(auth_type)
    .bind(auth_data)
    .bind(pre_script)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}

/// Apply a dynamic UPDATE built from optional fields. `sets` are SQL fragments
/// like `"name = ?"`, in order, with binds in `values` matching their `?`.
/// The caller should NOT include `updated_at = datetime('now')` — this fn
/// appends it. The `id` is always bound last.
pub async fn update_dynamic(
    pool: &SqlitePool,
    sets: &[String],
    values: &[String],
    id: &str,
) -> Result<(), sqlx::Error> {
    if sets.is_empty() {
        return Ok(());
    }
    let mut sets = sets.to_vec();
    sets.push("updated_at = datetime('now')".to_string());
    let sql = format!("UPDATE requests SET {} WHERE id = ?", sets.join(", "));

    let mut query = sqlx::query(&sql);
    for v in values {
        query = query.bind(v);
    }
    query = query.bind(id);
    query.execute(pool).await?;
    Ok(())
}

pub async fn delete_by_id(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM requests WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn move_to_collection(
    pool: &SqlitePool,
    id: &str,
    target_collection_id: &str,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE requests SET collection_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(target_collection_id)
    .bind(sort_order)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// request_headers
// ---------------------------------------------------------------------------

pub async fn list_headers(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<Vec<RequestHeader>, sqlx::Error> {
    sqlx::query_as::<_, RequestHeader>(
        "SELECT * FROM request_headers WHERE request_id = ? ORDER BY sort_order ASC",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await
}

pub async fn list_headers_unsorted(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<Vec<RequestHeader>, sqlx::Error> {
    sqlx::query_as::<_, RequestHeader>("SELECT * FROM request_headers WHERE request_id = ?")
        .bind(request_id)
        .fetch_all(pool)
        .await
}

pub async fn delete_headers_for_request(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM request_headers WHERE request_id = ?")
        .bind(request_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn insert_header(
    pool: &SqlitePool,
    id: &str,
    request_id: &str,
    key: &str,
    value: &str,
    enabled: i32,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO request_headers (id, request_id, key, value, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(request_id)
    .bind(key)
    .bind(value)
    .bind(enabled)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// request_params
// ---------------------------------------------------------------------------

pub async fn list_params(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<Vec<RequestParam>, sqlx::Error> {
    sqlx::query_as::<_, RequestParam>(
        "SELECT * FROM request_params WHERE request_id = ? ORDER BY sort_order ASC",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await
}

pub async fn list_params_unsorted(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<Vec<RequestParam>, sqlx::Error> {
    sqlx::query_as::<_, RequestParam>("SELECT * FROM request_params WHERE request_id = ?")
        .bind(request_id)
        .fetch_all(pool)
        .await
}

pub async fn delete_params_for_request(
    pool: &SqlitePool,
    request_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM request_params WHERE request_id = ?")
        .bind(request_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn insert_param(
    pool: &SqlitePool,
    id: &str,
    request_id: &str,
    key: &str,
    value: &str,
    enabled: i32,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO request_params (id, request_id, key, value, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(request_id)
    .bind(key)
    .bind(value)
    .bind(enabled)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}
