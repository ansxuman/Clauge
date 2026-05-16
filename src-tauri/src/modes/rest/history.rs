use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::HistoryEntry;
use crate::shared::repos::history as history_repo;

#[tauri::command]
pub async fn list_history(
    pool: State<'_, SqlitePool>,
    limit: i32,
) -> Result<Vec<HistoryEntry>, String> {
    history_repo::list_recent(pool.inner(), limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(pool: State<'_, SqlitePool>) -> Result<(), String> {
    history_repo::clear_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_history_entry(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    history_repo::delete_by_id(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn count_history(pool: State<'_, SqlitePool>) -> Result<i64, String> {
    history_repo::count_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

/// Total byte size of the REST history table — sums LENGTH(...) over
/// the columns that actually carry data per row. Used by Settings →
/// General → Chat History → "Storage" stat so the displayed number
/// reflects on-disk REST history footprint alongside the AI chat
/// localStorage size. Bodies are intentionally NOT persisted anymore
/// (see http_executor.rs comments), so this number stays small even
/// with thousands of history rows.
#[tauri::command]
pub async fn rest_history_size_bytes(pool: State<'_, SqlitePool>) -> Result<i64, String> {
    let row: (Option<i64>,) = sqlx::query_as(
        "SELECT COALESCE(SUM(
            LENGTH(id) + LENGTH(method) + LENGTH(url) + LENGTH(resolved_url) +
            LENGTH(COALESCE(request_body, '')) +
            LENGTH(COALESCE(request_headers, '')) +
            LENGTH(COALESCE(response_body, '')) +
            LENGTH(COALESCE(response_headers, '')) +
            LENGTH(COALESCE(environment_id, '')) +
            LENGTH(created_at) +
            24
        ), 0) FROM history",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.0.unwrap_or(0))
}

#[tauri::command]
pub async fn purge_history(
    pool: State<'_, SqlitePool>,
    seconds: i64,
) -> Result<u64, String> {
    if seconds <= 0 {
        return Ok(0);
    }
    history_repo::purge_older_than(pool.inner(), seconds)
        .await
        .map_err(|e| e.to_string())
}
