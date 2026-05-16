// Advanced / diagnostic settings — loaded from a plain JSON file
// instead of the SQLite settings table. Kept separate from `settings`
// so the Settings UI stays uncluttered: anything that ends up here is
// a developer / power-user knob (log verbosity, future feature flags,
// experimental toggles) that doesn't need a visible control. Users
// edit the file directly; the path is exposed via
// `get_app_config_path` so they can find it.
//
// Schema is intentionally extensible — every field is `Option<…>` so
// adding a new key never breaks older configs, and missing keys fall
// back to the field's `serde(default)`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Resolved location of the JSON file:
///   `<app_config_dir>/settings.json`
/// where `app_config_dir` follows the Tauri convention per OS:
///   macOS:   `~/Library/Application Support/com.clauge.desktop/`
///   Linux:   `~/.config/com.clauge.desktop/`
///   Windows: `%APPDATA%\com.clauge.desktop\`
pub fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    /// Global log verbosity. Accepts `off / error / warn / info /
    /// debug / trace`. Unset → `info` in release, `debug` in debug
    /// builds (the compile-time default in `logger::init`).
    pub log_level: Option<String>,
    // Future fields go here. Examples we have on the roadmap:
    //   pub experimental_features: HashMap<String, bool>,
    //   pub telemetry: Option<bool>,
    //   pub debug_flags: HashMap<String, serde_json::Value>,
}

/// Read `settings.json`. Missing file or malformed JSON → default
/// (empty) config. Never panics; this runs before the rolling logger
/// is fully up so we must be belt-and-suspenders safe.
pub fn load(app: &tauri::AppHandle) -> AppConfig {
    let Some(path) = config_path(app) else { return AppConfig::default() };
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return AppConfig::default(),
    };
    match serde_json::from_str::<AppConfig>(&raw) {
        Ok(cfg) => cfg,
        Err(e) => {
            // Log the parse failure but don't bail. The log might not
            // be initialised yet at the very first call site — eprintln
            // is the only universally-safe sink during boot.
            eprintln!("[clauge] {} is malformed JSON: {}", path.display(), e);
            AppConfig::default()
        }
    }
}

/// Apply the loaded config to side-effectful subsystems. Call this
/// after `logger::init` so `log::set_max_level` has something to act on.
pub fn apply(cfg: &AppConfig) {
    if let Some(level_str) = cfg.log_level.as_deref() {
        let filter = match level_str.to_ascii_lowercase().as_str() {
            "off" => Some(log::LevelFilter::Off),
            "error" => Some(log::LevelFilter::Error),
            "warn" | "warning" => Some(log::LevelFilter::Warn),
            "info" => Some(log::LevelFilter::Info),
            "debug" => Some(log::LevelFilter::Debug),
            "trace" => Some(log::LevelFilter::Trace),
            _ => None,
        };
        if let Some(f) = filter {
            log::set_max_level(f);
            log::info!(target: "app_config", "log level set from settings.json: {}", f);
        } else {
            log::warn!(
                target: "app_config",
                "ignoring unknown logLevel '{}' in settings.json (expected off/error/warn/info/debug/trace)",
                level_str
            );
        }
    }
}
