use sqlx::SqlitePool;

use crate::db::models::HistoryEntry;

pub async fn list_recent(pool: &SqlitePool, limit: i32) -> Result<Vec<HistoryEntry>, sqlx::Error> {
    sqlx::query_as::<_, HistoryEntry>(
        "SELECT * FROM history ORDER BY created_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn clear_all(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM history").execute(pool).await?;
    Ok(())
}

pub async fn delete_by_id(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM history WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
