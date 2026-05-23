use aes_gcm::aead::{Aead, KeyInit, OsRng, rand_core::RngCore};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use async_trait::async_trait;
use hkdf::Hkdf;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::credential_store::CredentialStore;

// File-backed credential store for Linux. Replaces Secret Service / libsecret:
// gnome-keyring's "unlock with login password" dialog pops whenever the user's
// keyring password drifts from their login password (very common on autologin
// distros, post-password-reset, fresh installs that skipped the keyring step),
// and any cancelled prompt makes every store/get fail with "no result found".
//
// Threat model parity with the apps that ship this pattern on Linux (VS Code,
// GitHub CLI, Discord, Signal when SS is flaky):
//   - File mode 0600 → other local users can't read.
//   - AES-256-GCM with key derived from /etc/machine-id via HKDF-SHA256 →
//     device-bound. A disk image without the matching machine-id can't decrypt.
//   - Same-user processes COULD derive the same key (machine-id is 0444); but
//     such a process can already scrape ~/.ssh/, browser cookies, etc., so
//     this is not a meaningful regression.

const FILE_MAGIC: &[u8; 4] = b"CLG1";
const FILE_VERSION: u8 = 1;
const HKDF_SALT: &[u8] = b"Clauge-LinuxFileStore-v1";
const HKDF_INFO: &[u8] = b"clauge.credentials";
const NONCE_LEN: usize = 12;

pub struct LinuxFileStore {
    path: PathBuf,
    key: [u8; 32],
    // Serialise writes (read-modify-write of the whole file). Reads are cheap
    // and don't contend often, so a single Mutex is fine. `Arc` so the same
    // lock is shared across `spawn_blocking` closures (without it, each
    // closure would lock its own private mutex and race on the file).
    lock: Arc<Mutex<()>>,
}

impl LinuxFileStore {
    /// Infallible by design — the factory in `credential_store::credential_store()`
    /// returns `impl CredentialStore`, so we can't surface init errors there
    /// without refactoring ~14 call sites. Instead, fall back to a hostname+HOME-
    /// derived key on the (vanishingly rare) systems where neither machine-id
    /// file is readable, and let runtime store/get/delete surface real I/O errors.
    pub fn new() -> Self {
        let path = credentials_path();
        if let Some(parent) = path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                log::warn!("[linux_file_store] mkdir {}: {}", parent.display(), e);
            }
        }
        let ikm = read_machine_id().unwrap_or_else(|| {
            log::warn!(
                "[linux_file_store] no machine-id; using HOME+hostname fallback (weaker device binding)"
            );
            fallback_ikm()
        });
        let key = derive_key(ikm.as_bytes());
        Self { path, key, lock: Arc::new(Mutex::new(())) }
    }

}

// `load` and `save` are free functions (not `&self` methods) so the
// `spawn_blocking` closures below can call them with just `path` + `key`
// without reconstructing a `LinuxFileStore` (which would create a fresh
// Mutex and defeat the shared lock).
fn load(path: &PathBuf, key: &[u8; 32]) -> Result<BTreeMap<String, String>, String> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(format!("read {}: {}", path.display(), e)),
    };
    if bytes.len() < 5 + NONCE_LEN {
        // Corrupt / truncated — treat as empty so the user isn't bricked.
        log::warn!("[linux_file_store] credentials file too short ({} bytes), resetting", bytes.len());
        return Ok(BTreeMap::new());
    }
    if &bytes[0..4] != FILE_MAGIC {
        log::warn!("[linux_file_store] credentials file magic mismatch, resetting");
        return Ok(BTreeMap::new());
    }
    if bytes[4] != FILE_VERSION {
        return Err(format!("unsupported credentials file version: {}", bytes[4]));
    }
    let nonce = Nonce::from_slice(&bytes[5..5 + NONCE_LEN]);
    let ciphertext = &bytes[5 + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decrypt failed (machine-id changed?)".to_string())?;
    let map: BTreeMap<String, String> = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("parse credentials: {}", e))?;
    Ok(map)
}

fn save(path: &PathBuf, key: &[u8; 32], map: &BTreeMap<String, String>) -> Result<(), String> {
    let plaintext = serde_json::to_vec(map).map_err(|e| format!("encode: {}", e))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|e| format!("encrypt: {}", e))?;

    let mut out = Vec::with_capacity(5 + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(FILE_MAGIC);
    out.push(FILE_VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    // Atomic write: tmp → fsync → rename. Avoids leaving a half-written
    // file if the process dies mid-write.
    let tmp = path.with_extension("bin.tmp");
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)
            .map_err(|e| format!("open tmp: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
        }
        f.write_all(&out).map_err(|e| format!("write tmp: {}", e))?;
        f.sync_all().map_err(|e| format!("fsync tmp: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[async_trait]
impl CredentialStore for LinuxFileStore {
    async fn store(&self, key: &str, value: &str) -> Result<(), String> {
        let key = key.to_string();
        let value = value.to_string();
        let path = self.path.clone();
        let aes_key = self.key;
        let lock = Arc::clone(&self.lock);
        tokio::task::spawn_blocking(move || {
            let _guard = lock.lock().map_err(|e| format!("lock poisoned: {}", e))?;
            let mut map = load(&path, &aes_key)?;
            map.insert(key, value);
            save(&path, &aes_key, &map)
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn get(&self, key: &str) -> Result<Option<String>, String> {
        let key = key.to_string();
        let path = self.path.clone();
        let aes_key = self.key;
        // Reads don't need the lock — they're idempotent against any
        // consistent on-disk snapshot. A reader can race a writer, but
        // it'll always see either the pre- or post-rename file (the
        // atomic rename in `save` guarantees this).
        tokio::task::spawn_blocking(move || {
            let map = load(&path, &aes_key)?;
            Ok(map.get(&key).cloned())
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let key = key.to_string();
        let path = self.path.clone();
        let aes_key = self.key;
        let lock = Arc::clone(&self.lock);
        tokio::task::spawn_blocking(move || {
            let _guard = lock.lock().map_err(|e| format!("lock poisoned: {}", e))?;
            let mut map = load(&path, &aes_key)?;
            if map.remove(&key).is_some() {
                save(&path, &aes_key, &map)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("join error: {}", e))?
    }
}

// ─── helpers ────────────────────────────────────────────────────────────────

fn credentials_path() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| {
            std::env::var_os("HOME").map(|h| {
                let mut p = PathBuf::from(h);
                p.push(".local/share");
                p
            })
        })
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("clauge").join("credentials.bin")
}

fn read_machine_id() -> Option<String> {
    // systemd-style id (preferred). Falls back to the legacy D-Bus location
    // which existed before systemd standardised /etc/machine-id.
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(s) = fs::read_to_string(path) {
            let id = s.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn fallback_ikm() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let user = std::env::var("USER").unwrap_or_default();
    let host = hostname_best_effort();
    format!("clauge:{}:{}:{}", host, user, home)
}

fn hostname_best_effort() -> String {
    fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown-host".to_string())
}

fn derive_key(ikm: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(HKDF_SALT), ikm);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm)
        .expect("HKDF expand 32 bytes is always valid");
    okm
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct ScopedDir {
        path: PathBuf,
    }
    impl ScopedDir {
        fn new(label: &str) -> Self {
            let n = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "clauge-linux-file-store-{}-{}-{}",
                std::process::id(),
                label,
                n
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }
    impl Drop for ScopedDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn store_in(dir: &ScopedDir) -> LinuxFileStore {
        LinuxFileStore {
            path: dir.path.join("credentials.bin"),
            key: derive_key(b"test-machine-id-0123456789abcdef"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    #[tokio::test]
    async fn round_trip_single_key() {
        let dir = ScopedDir::new("round_trip");
        let store = store_in(&dir);
        store.store("k1", "v1").await.unwrap();
        assert_eq!(store.get("k1").await.unwrap().as_deref(), Some("v1"));
        store.delete("k1").await.unwrap();
        assert_eq!(store.get("k1").await.unwrap(), None);
    }

    #[tokio::test]
    async fn multiple_keys_persist_independently() {
        let dir = ScopedDir::new("multi");
        let store = store_in(&dir);
        store.store("a", "1").await.unwrap();
        store.store("b", "2").await.unwrap();
        store.store("c", "3").await.unwrap();
        store.delete("b").await.unwrap();
        assert_eq!(store.get("a").await.unwrap().as_deref(), Some("1"));
        assert_eq!(store.get("b").await.unwrap(), None);
        assert_eq!(store.get("c").await.unwrap().as_deref(), Some("3"));
    }

    #[tokio::test]
    async fn missing_file_returns_none_without_error() {
        let dir = ScopedDir::new("missing");
        let store = store_in(&dir);
        assert_eq!(store.get("never-written").await.unwrap(), None);
        store.delete("never-written").await.unwrap();
    }

    #[tokio::test]
    async fn delete_missing_key_is_idempotent() {
        let dir = ScopedDir::new("del_idem");
        let store = store_in(&dir);
        store.store("present", "x").await.unwrap();
        store.delete("absent").await.unwrap();
        assert_eq!(store.get("present").await.unwrap().as_deref(), Some("x"));
    }

    #[tokio::test]
    async fn overwrites_existing_value() {
        let dir = ScopedDir::new("overwrite");
        let store = store_in(&dir);
        store.store("k", "v1").await.unwrap();
        store.store("k", "v2").await.unwrap();
        assert_eq!(store.get("k").await.unwrap().as_deref(), Some("v2"));
    }

    #[tokio::test]
    async fn corrupted_magic_returns_empty_rather_than_error() {
        let dir = ScopedDir::new("corrupt");
        let path = dir.path.join("credentials.bin");
        fs::write(&path, b"NOPE----garbagebytesnotaheader").unwrap();
        let store = LinuxFileStore {
            path,
            key: derive_key(b"test-machine-id"),
            lock: Arc::new(Mutex::new(())),
        };
        assert_eq!(store.get("anything").await.unwrap(), None);
    }

    #[tokio::test]
    async fn wrong_key_returns_error_on_existing_file() {
        let dir = ScopedDir::new("wrong_key");
        let path = dir.path.join("credentials.bin");
        let store_a = LinuxFileStore {
            path: path.clone(),
            key: derive_key(b"machine-id-A"),
            lock: Arc::new(Mutex::new(())),
        };
        store_a.store("k", "v").await.unwrap();
        let store_b = LinuxFileStore {
            path,
            key: derive_key(b"machine-id-B"),
            lock: Arc::new(Mutex::new(())),
        };
        assert!(store_b.get("k").await.is_err());
    }
}
