//! Cross-platform PATH resolution for spawning developer-tool binaries.
//!
//! GUI-launched processes inherit a stripped PATH from the OS launcher
//! (launchd on macOS, gnome-shell / kde on Linux). Tools installed by
//! Homebrew, nvm, asdf, cargo, bun, and the Claude Code installer live
//! outside that PATH, so a bare `Command::new("claude")` from inside a
//! bundled `.app` fails with NotFound even when the binary is reachable
//! from the user's terminal.
//!
//! `user_path()` resolves the PATH a real interactive shell would see
//! (by sourcing it on Unix, by reading the environment on Windows),
//! caches the result, and `find_binary()` uses it to return absolute
//! paths. `apply_user_path()` injects that PATH into a Command so any
//! sub-spawn (e.g. `gh` calling `git`) sees the same view.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[cfg(not(target_os = "windows"))]
use super::shell::default_user_shell;

/// PATH separator for the current platform.
#[cfg(target_os = "windows")]
const PATH_SEP: char = ';';
#[cfg(not(target_os = "windows"))]
const PATH_SEP: char = ':';

/// The PATH a real interactive shell would see. Cached for the life of
/// the process; the first call may fork a shell (~50–100 ms on Unix).
pub fn user_path() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(resolve_user_path)
}

#[cfg(not(target_os = "windows"))]
fn resolve_user_path() -> String {
    // Source the user's login+interactive shell so rc files (nvm, fnm,
    // asdf, brew shellenv) export their PATH adjustments before we read
    // back $PATH. `printf %s` keeps the output free of a trailing newline.
    let mut parts: Vec<String> = Vec::new();
    let (shell_path, shell_kind) = default_user_shell();
    let args = shell_kind.exec_command_argv("printf %s \"$PATH\"");
    if let Ok(output) = Command::new(&shell_path).args(&args).output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() {
                parts.push(p);
            }
        }
    }

    // Belt-and-braces: prepend canonical locations so we still resolve
    // common tools when the login-shell probe fails (e.g. user has a
    // broken rc file). Duplicates are filtered below.
    if let Some(home) = dirs::home_dir() {
        let h = home.to_string_lossy().to_string();
        parts.push(format!(
            "{h}/.claude/local:{h}/.local/bin:{h}/.cargo/bin:{h}/.bun/bin:{h}/.deno/bin"
        ));
    }
    if cfg!(target_os = "macos") {
        parts.push(
            "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin".to_string(),
        );
    } else {
        parts.push("/usr/local/bin:/usr/local/sbin".to_string());
    }
    if let Ok(inherited) = std::env::var("PATH") {
        parts.push(inherited);
    }

    dedupe_path(&parts.join(":"))
}

#[cfg(target_os = "windows")]
fn resolve_user_path() -> String {
    // Windows GUI apps inherit the user PATH from the registry-merged
    // environment block, so the parent process variable is already the
    // correct view of system + user PATH. That covers most installs.
    //
    // The CLI installers we care about often drop binaries into per-tool
    // user directories that aren't always on the system PATH — Claude
    // Code's installer uses %USERPROFILE%\.local\bin, OpenCode uses
    // %USERPROFILE%\.opencode\bin, and npm-global tools live under
    // %APPDATA%\npm. Append those after the system PATH so detection
    // still works when the user hasn't manually added them.
    let mut parts: Vec<String> = Vec::new();
    if let Ok(inherited) = std::env::var("PATH") {
        if !inherited.is_empty() {
            parts.push(inherited);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let h = home.to_string_lossy().to_string();
        parts.push(format!(
            "{h}\\.local\\bin;{h}\\.opencode\\bin;{h}\\.cargo\\bin;{h}\\.bun\\bin;{h}\\.deno\\bin"
        ));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        parts.push(format!("{appdata}\\npm"));
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        // Some installers (eg. winget shims) land here.
        parts.push(format!("{localappdata}\\Programs"));
    }
    dedupe_path(&parts.join(";"))
}

fn dedupe_path(p: &str) -> String {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for part in p.split(PATH_SEP) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed);
        }
    }
    out.join(&PATH_SEP.to_string())
}

/// Resolve a bare binary name to an absolute path using `user_path()`.
/// Returns `None` if not found. Cached per-name so repeated spawns
/// don't re-walk PATH.
pub fn find_binary(name: &str) -> Option<PathBuf> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<PathBuf>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let guard = cache.lock().unwrap();
        if let Some(v) = guard.get(name) {
            return v.clone();
        }
    }
    let resolved = lookup_binary(name);
    cache
        .lock()
        .unwrap()
        .insert(name.to_string(), resolved.clone());
    resolved
}

#[cfg(not(target_os = "windows"))]
fn lookup_binary(name: &str) -> Option<PathBuf> {
    let as_path = PathBuf::from(name);
    if as_path.is_absolute() {
        return as_path.is_file().then_some(as_path);
    }
    for dir in user_path().split(PATH_SEP) {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn lookup_binary(name: &str) -> Option<PathBuf> {
    let as_path = PathBuf::from(name);
    if as_path.is_absolute() {
        return as_path.is_file().then_some(as_path);
    }
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let exts: Vec<String> = pathext
        .split(';')
        .map(|e| e.trim().trim_start_matches('.').to_string())
        .filter(|e| !e.is_empty())
        .collect();
    let has_ext = std::path::Path::new(name).extension().is_some();
    for dir in user_path().split(PATH_SEP) {
        if dir.is_empty() {
            continue;
        }
        let base = PathBuf::from(dir).join(name);
        if has_ext && base.is_file() {
            return Some(base);
        }
        for ext in &exts {
            let with_ext = base.with_extension(ext);
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }
    }
    None
}

/// True when `name` resolves on the user's PATH.
pub fn is_on_path(name: &str) -> bool {
    find_binary(name).is_some()
}

/// Inject the resolved user PATH into a `Command`'s environment so any
/// sub-spawns (e.g. `gh` invoking `git`) inherit the same view.
pub fn apply_user_path(cmd: &mut Command) {
    cmd.env("PATH", user_path());
}
