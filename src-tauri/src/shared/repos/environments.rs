use sqlx::SqlitePool;

use crate::db::models::{EnvVariable, Environment};

// ---------------------------------------------------------------------------
// environments
// ---------------------------------------------------------------------------

pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Environment>, sqlx::Error> {
    sqlx::query_as::<_, Environment>("SELECT * FROM environments ORDER BY sort_order ASC")
        .fetch_all(pool)
        .await
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Environment, sqlx::Error> {
    sqlx::query_as::<_, Environment>("SELECT * FROM environments WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
}

pub async fn max_sort_order(pool: &SqlitePool) -> Result<(i32,), sqlx::Error> {
    sqlx::query_as("SELECT COALESCE(MAX(sort_order), -1) FROM environments")
        .fetch_one(pool)
        .await
}

pub async fn count(pool: &SqlitePool) -> Result<(i64,), sqlx::Error> {
    sqlx::query_as("SELECT COUNT(*) FROM environments")
        .fetch_one(pool)
        .await
}

pub async fn insert(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    color: &str,
    is_default: i32,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO environments (id, name, color, is_default, sort_order) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(color)
    .bind(is_default)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    color: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE environments SET name = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(name)
    .bind(color)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_by_id(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM environments WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Promote first remaining environment (by sort_order ASC) to default.
/// No-op if no environments remain.
pub async fn promote_first_to_default(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE environments SET is_default = 1 WHERE id = (SELECT id FROM environments ORDER BY sort_order ASC LIMIT 1)"
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_default_flag(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE environments SET is_default = 0")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_default(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE environments SET is_default = 1 WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// env_variables
// ---------------------------------------------------------------------------

pub async fn list_variables(
    pool: &SqlitePool,
    environment_id: &str,
) -> Result<Vec<EnvVariable>, sqlx::Error> {
    sqlx::query_as::<_, EnvVariable>(
        "SELECT * FROM env_variables WHERE environment_id = ? ORDER BY sort_order ASC",
    )
    .bind(environment_id)
    .fetch_all(pool)
    .await
}

pub async fn list_variables_unsorted(
    pool: &SqlitePool,
    environment_id: &str,
) -> Result<Vec<EnvVariable>, sqlx::Error> {
    sqlx::query_as::<_, EnvVariable>(
        "SELECT * FROM env_variables WHERE environment_id = ?",
    )
    .bind(environment_id)
    .fetch_all(pool)
    .await
}

pub async fn get_variable_by_id(
    pool: &SqlitePool,
    id: &str,
) -> Result<EnvVariable, sqlx::Error> {
    sqlx::query_as::<_, EnvVariable>("SELECT * FROM env_variables WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
}

pub async fn get_variable_by_env_and_key(
    pool: &SqlitePool,
    environment_id: &str,
    key: &str,
) -> Result<Option<EnvVariable>, sqlx::Error> {
    sqlx::query_as::<_, EnvVariable>(
        "SELECT * FROM env_variables WHERE environment_id = ? AND key = ?",
    )
    .bind(environment_id)
    .bind(key)
    .fetch_optional(pool)
    .await
}

pub async fn max_variable_sort_order(
    pool: &SqlitePool,
    environment_id: &str,
) -> Result<(i32,), sqlx::Error> {
    sqlx::query_as(
        "SELECT COALESCE(MAX(sort_order), -1) FROM env_variables WHERE environment_id = ?",
    )
    .bind(environment_id)
    .fetch_one(pool)
    .await
}

pub async fn insert_variable(
    pool: &SqlitePool,
    id: &str,
    environment_id: &str,
    key: &str,
    value: &str,
    is_secret: i32,
    sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO env_variables (id, environment_id, key, value, is_secret, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(environment_id)
    .bind(key)
    .bind(value)
    .bind(is_secret)
    .bind(sort_order)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_variable_value(
    pool: &SqlitePool,
    id: &str,
    value: &str,
    is_secret: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE env_variables SET value = ?, is_secret = ? WHERE id = ?")
        .bind(value)
        .bind(is_secret)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_variable(
    pool: &SqlitePool,
    id: &str,
    key: &str,
    value: &str,
    is_secret: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE env_variables SET key = ?, value = ?, is_secret = ? WHERE id = ?")
        .bind(key)
        .bind(value)
        .bind(is_secret)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_variable_by_id(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM env_variables WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
