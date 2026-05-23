// Cross-platform infrastructure shared across modes.
// `credential_store` is the OS-keyring abstraction.
// `shell` resolves the user's preferred shell binary per OS.
// `install_type` distinguishes AppImage / package-manager / DMG / NSIS at runtime.
// `path` resolves the real user PATH so GUI-launched bundles can find
// `claude` / `gh` / `glab` / `git` installed via brew, nvm, asdf, etc.

pub mod credential_store;
pub mod install_type;
#[cfg(target_os = "linux")]
pub mod linux_file_store;
pub mod path;
pub mod shell;
