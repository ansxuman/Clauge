use sqlx::SqlitePool;

use crate::db::models::Collection;

pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Collection>, sqlx::Error> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections ORDER BY sort_order ASC")
        .fetch_all(pool)
        .await
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Collection, sqlx::Error> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
}

pub async fn max_sort_order(pool: &SqlitePool) -> Result<(i32,), sqlx::Error> {
    sqlx::query_as("SELECT COALESCE(MAX(sort_order), -1) FROM collections")
        .fetch_one(pool)
        .await
}

pub async fn insert(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO collections (id, name, sort_order) VALUES (?, ?, ?)")
        .bind(id)
        .bind(name)
        .bind(sort_order)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    env_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE collections SET name = ?, env_id = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(name)
    .bind(env_id)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_by_id(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_sort_order(
    pool: &SqlitePool,
    id: &str,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE collections SET sort_order = ? WHERE id = ?")
        .bind(sort_order)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
