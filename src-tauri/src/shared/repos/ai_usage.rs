use sqlx::SqlitePool;

/// Aggregated stat row: (group_key, total_calls, input_tokens, output_tokens).
pub type UsageStatRow = (String, i64, i64, i64);

pub async fn stats_by_mode(pool: &SqlitePool) -> Result<Vec<UsageStatRow>, sqlx::Error> {
    sqlx::query_as::<_, UsageStatRow>(
        "SELECT mode, COUNT(*) as total_calls, COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) FROM ai_usage GROUP BY mode"
    )
    .fetch_all(pool)
    .await
}

pub async fn stats_by_model(pool: &SqlitePool) -> Result<Vec<UsageStatRow>, sqlx::Error> {
    sqlx::query_as::<_, UsageStatRow>(
        "SELECT model, COUNT(*) as total_calls, COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) FROM ai_usage GROUP BY model"
    )
    .fetch_all(pool)
    .await
}

pub async fn clear_all(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM ai_usage").execute(pool).await?;
    Ok(())
}

pub async fn record(
    pool: &SqlitePool,
    id: &str,
    mode: &str,
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ai_usage (id, mode, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(mode)
    .bind(model)
    .bind(input_tokens)
    .bind(output_tokens)
    .execute(pool)
    .await?;
    Ok(())
}
