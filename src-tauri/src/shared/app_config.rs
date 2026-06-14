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
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::OnceLock;

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
    /// Named diagnostic areas to surface in a release build. Each entry
    /// elevates that area's `diag!(area: …)` lines from debug to info, so
    /// you can read one subsystem's reasoning without flipping the global
    /// `logLevel` (which firehoses everything). `"*"` enables all areas.
    /// e.g. `"diagnostics": ["notify"]`. The same areas also reveal any
    /// debug-only UI gated on them (see `app_diagnostics_enabled`).
    pub diagnostics: Vec<String>,
    // Future fields go here. Examples we have on the roadmap:
    //   pub experimental_features: HashMap<String, bool>,
    //   pub telemetry: Option<bool>,
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

/// Enabled diagnostic areas, populated once from `settings.json` in
/// `apply()`. Read by `diagnostics_enabled` on every `diag!` call, so it's
/// a plain set behind a `OnceLock` (set once at boot, lock-free reads).
static DIAG_AREAS: OnceLock<HashSet<String>> = OnceLock::new();

fn set_diagnostics(areas: &[String]) {
    let set: HashSet<String> = areas
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    // First write wins; `apply` runs once at boot. Ignore a redundant set.
    let _ = DIAG_AREAS.set(set);
}

/// Is `area` (or the `"*"` wildcard) enabled for prod-visible diagnostics?
/// False before `apply` runs or when `settings.json` lists no areas.
pub fn diagnostics_enabled(area: &str) -> bool {
    match DIAG_AREAS.get() {
        Some(set) => set.contains("*") || set.contains(&area.to_ascii_lowercase()),
        None => false,
    }
}

/// Tauri-facing check so the frontend can reveal debug-only UI (e.g. the
/// companion "Send test" button) when its area is enabled in `settings.json`.
#[tauri::command]
pub fn app_diagnostics_enabled(area: String) -> bool {
    diagnostics_enabled(&area)
}

/// Log at **info** when `area` is an enabled diagnostic area, else at
/// **debug**. Lets a single `settings.json` knob (`"diagnostics": [..]`)
/// surface one subsystem's decision trail in a release build without
/// raising the global `logLevel`. Target defaults to the area name.
#[macro_export]
macro_rules! diag {
    (area: $area:expr, target: $t:expr, $($a:tt)+) => {
        if $crate::shared::app_config::diagnostics_enabled($area) {
            log::info!(target: $t, $($a)+);
        } else {
            log::debug!(target: $t, $($a)+);
        }
    };
    (area: $area:expr, $($a:tt)+) => {
        if $crate::shared::app_config::diagnostics_enabled($area) {
            log::info!(target: $area, $($a)+);
        } else {
            log::debug!(target: $area, $($a)+);
        }
    };
}

/// Apply the loaded config to side-effectful subsystems. Call this
/// after `logger::init` so `log::set_max_level` has something to act on.
pub fn apply(cfg: &AppConfig) {
    set_diagnostics(&cfg.diagnostics);
    if !cfg.diagnostics.is_empty() {
        log::info!(
            target: "app_config",
            "diagnostics areas enabled from settings.json: {:?}",
            cfg.diagnostics
        );
    }
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
