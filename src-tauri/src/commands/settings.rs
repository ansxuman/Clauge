use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

use crate::shared::repos::settings as settings_repo;

#[tauri::command]
pub async fn get_setting(
    pool: State<'_, SqlitePool>,
    key: String,
) -> Result<Option<String>, String> {
    let setting = settings_repo::get_by_key(pool.inner(), &key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(setting.map(|s| s.value))
}

#[tauri::command]
pub async fn set_setting(
    pool: State<'_, SqlitePool>,
    key: String,
    value: String,
) -> Result<(), String> {
    settings_repo::upsert(pool.inner(), &key, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(
    pool: State<'_, SqlitePool>,
) -> Result<HashMap<String, String>, String> {
    let settings = settings_repo::list_all(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for s in settings {
        map.insert(s.key, s.value);
    }
    Ok(map)
}
