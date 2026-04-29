use sqlx::SqlitePool;

use crate::db::models::Setting;

pub async fn get_by_key(pool: &SqlitePool, key: &str) -> Result<Option<Setting>, sqlx::Error> {
    sqlx::query_as::<_, Setting>("SELECT * FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
}

pub async fn upsert(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Setting>, sqlx::Error> {
    sqlx::query_as::<_, Setting>("SELECT * FROM settings")
        .fetch_all(pool)
        .await
}
