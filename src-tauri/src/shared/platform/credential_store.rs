use async_trait::async_trait;

/// Cross-platform secret store used to back SSH profile credentials
/// (passwords + key passphrases), Explorer per-connection secrets, and
/// Cloud auth tokens.
///
/// Per-OS dispatch:
/// - **macOS**: shell-out to `/usr/bin/security`. The system `security`
///   binary is implicitly trusted by Keychain, so reads/writes don't
///   trigger the "X wants to use confidential information" prompt that
///   Security.framework calls from a non-system binary would. Better UX
///   for signed app builds where re-signing changes the binary identity.
/// - **Windows**: the `keyring` crate, Windows Credential Manager backend.
///   No interactive prompts; secrets are bound to the Windows user account.
/// - **Linux**: encrypted file at `$XDG_DATA_HOME/clauge/credentials.bin`
///   (AES-256-GCM, key derived from `/etc/machine-id` via HKDF-SHA256).
///   Secret Service / libsecret is intentionally not used — see
///   `linux_file_store.rs` for the rationale.
#[async_trait]
pub trait CredentialStore: Send + Sync {
    async fn store(&self, key: &str, value: &str) -> Result<(), String>;
    async fn get(&self, key: &str) -> Result<Option<String>, String>;
    async fn delete(&self, key: &str) -> Result<(), String>;
}

const SERVICE_NAME: &str = "Clauge SSH";

// ─── macOS: shell-out to /usr/bin/security ──────────────────────────────────

#[cfg(target_os = "macos")]
pub struct MacosKeychainStore;

#[cfg(target_os = "macos")]
#[async_trait]
impl CredentialStore for MacosKeychainStore {
    async fn store(&self, key: &str, value: &str) -> Result<(), String> {
        let key = key.to_string();
        let value = value.to_string();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("security")
                .args([
                    "add-generic-password",
                    "-U", // update if exists
                    "-s",
                    SERVICE_NAME,
                    "-a",
                    &key,
                    "-w",
                    &value,
                ])
                .output()
                .map_err(|e| format!("security add-generic-password spawn failed: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(format!("security add-generic-password failed: {}", stderr));
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn get(&self, key: &str) -> Result<Option<String>, String> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("security")
                .args([
                    "find-generic-password",
                    "-s",
                    SERVICE_NAME,
                    "-a",
                    &key,
                    "-w",
                ])
                .output()
                .map_err(|e| format!("security find-generic-password spawn failed: {}", e))?;
            if !output.status.success() {
                // `security` returns non-zero when item is not found.
                let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
                if stderr.contains("could not be found") || stderr.is_empty() {
                    return Ok(None);
                }
                return Err(format!(
                    "security find-generic-password failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            let mut s = String::from_utf8_lossy(&output.stdout).to_string();
            // `security -w` prints the password followed by a newline.
            if s.ends_with('\n') {
                s.pop();
            }
            if s.ends_with('\r') {
                s.pop();
            }
            Ok(Some(s))
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            // Best-effort: ignore "not found" errors so this is idempotent.
            let _ = std::process::Command::new("security")
                .args([
                    "delete-generic-password",
                    "-s",
                    SERVICE_NAME,
                    "-a",
                    &key,
                ])
                .output();
            Ok(())
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }
}

// ─── Windows: keyring crate (Windows Credential Manager) ────────────────────

#[cfg(target_os = "windows")]
pub struct KeyringStore;

#[cfg(target_os = "windows")]
impl KeyringStore {
    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE_NAME, key).map_err(|e| format!("keyring entry: {}", e))
    }
}

#[cfg(target_os = "windows")]
#[async_trait]
impl CredentialStore for KeyringStore {
    async fn store(&self, key: &str, value: &str) -> Result<(), String> {
        let key = key.to_string();
        let value = value.to_string();
        tokio::task::spawn_blocking(move || {
            Self::entry(&key)?
                .set_password(&value)
                .map_err(|e| format!("keyring set: {}", e))
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn get(&self, key: &str) -> Result<Option<String>, String> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || match Self::entry(&key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get: {}", e)),
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || match Self::entry(&key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // idempotent
            Err(e) => Err(format!("keyring delete: {}", e)),
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }
}

// ─── Per-OS factory ─────────────────────────────────────────────────────────

/// Returns the platform-appropriate credential store implementation.
#[cfg(target_os = "macos")]
pub fn credential_store() -> impl CredentialStore {
    MacosKeychainStore
}

#[cfg(target_os = "windows")]
pub fn credential_store() -> impl CredentialStore {
    KeyringStore
}

#[cfg(target_os = "linux")]
pub fn credential_store() -> impl CredentialStore {
    super::linux_file_store::LinuxFileStore::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Round-trip the platform-default store. Skipped on Linux because the
    // factory writes to the real $XDG_DATA_HOME/clauge/ and would clobber
    // the developer's credentials. Linux backend has its own isolated tests
    // in `linux_file_store.rs`.
    #[cfg(not(target_os = "linux"))]
    #[tokio::test]
    async fn round_trip() {
        let store = credential_store();
        let key = "clauge-test-key-do-not-collide";
        let value = "secret-value-xyz";

        let _ = store.delete(key).await; // pre-clean

        store.store(key, value).await.expect("store failed");
        let got = store.get(key).await.expect("get failed");
        assert_eq!(got.as_deref(), Some(value));

        store.delete(key).await.expect("delete failed");
        let after = store.get(key).await.expect("get after delete failed");
        assert_eq!(after, None);
    }
}
