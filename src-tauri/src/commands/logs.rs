use log::{Level, LevelFilter};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&log_dir);
    app.opener()
        .open_path(log_dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Forward a log line from the frontend (Svelte / WebView) into the
/// Rust-side rolling log file. Used by the console.* wrapper installed
/// in `src/lib/utils/log.ts` so frontend events end up in the same
/// `<app_log_dir>/YYYY-MM-DD/HH.log` as Rust events — instead of being
/// trapped in the WebView's devtools console (which is disabled in
/// release builds).
///
/// `level` is a lowercase string; unknown values fall back to `info`.
#[tauri::command]
pub fn app_log(level: String, target: String, message: String) {
    let lvl = match level.to_ascii_lowercase().as_str() {
        "trace" => Level::Trace,
        "debug" => Level::Debug,
        "info" => Level::Info,
        "warn" | "warning" => Level::Warn,
        "error" => Level::Error,
        _ => Level::Info,
    };
    let target_str = if target.trim().is_empty() {
        "frontend"
    } else {
        target.as_str()
    };
    log::log!(target: target_str, lvl, "{}", message);
}

/// Change the global log level filter at runtime. Cheap escape hatch
/// for the case where editing `settings.json` + restart isn't
/// convenient — UI / dev tools can bump verbosity for one session.
/// Persistent changes belong in `settings.json` (see `app_config.rs`).
#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    let filter = match level.to_ascii_lowercase().as_str() {
        "off" => LevelFilter::Off,
        "trace" => LevelFilter::Trace,
        "debug" => LevelFilter::Debug,
        "info" => LevelFilter::Info,
        "warn" | "warning" => LevelFilter::Warn,
        "error" => LevelFilter::Error,
        other => return Err(format!("Unknown log level: {}", other)),
    };
    log::set_max_level(filter);
    log::info!(target: "logger", "max level set to {}", filter);
    Ok(())
}

/// Return the absolute path of the advanced-settings JSON file. Users
/// open the surrounding folder to edit it; we don't ship a UI for the
/// individual fields (logLevel + future feature flags). Path is
/// resolved even when the file doesn't exist yet — callers can pre-
/// create it themselves.
#[tauri::command]
pub fn get_app_config_path(app: tauri::AppHandle) -> Result<String, String> {
    crate::shared::app_config::config_path(&app)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Could not resolve app_config_dir".to_string())
}
