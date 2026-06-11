// Session lifecycle: bridge a phone's spawn request to a REAL desktop
// tab. Instead of spawning a headless PTY, the REST handler parks on a
// oneshot and fires `companion:open-session`; the frontend opens the
// tab its normal way, captures the resulting terminalId, and answers
// via `companion_report_opened` / `companion_report_open_failed` — the
// same frontend-confirmation shape as pairing's PendingState. The
// terminalId that comes back is a live fanout hub key the phone can
// mirror.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::oneshot;

/// How long a /v1/sessions spawn blocks waiting for the desktop UI to
/// report the opened tab's terminalId before giving up with 504.
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(30);

/// The frontend's answer to a `companion:open-session` request: either
/// the live terminalId of the tab it opened, or an error string.
pub type OpenResult = Result<String, String>;

#[derive(Default)]
pub struct LifecycleState {
    /// In-flight open requests awaiting the desktop UI's report, keyed
    /// by requestId. `report_opened` / `report_open_failed` take the
    /// sender; an unknown id means the 30s wait already timed out.
    pending: Mutex<HashMap<String, oneshot::Sender<OpenResult>>>,
}

impl LifecycleState {
    pub fn register_pending(&self, request_id: String, tx: oneshot::Sender<OpenResult>) {
        self.pending.lock().insert(request_id, tx);
    }

    pub fn remove_pending(&self, request_id: &str) {
        self.pending.lock().remove(request_id);
    }

    /// Answer a pending open request. Err when the id is unknown —
    /// typically the 30s wait already timed out and dropped the entry.
    pub fn resolve(&self, request_id: &str, result: OpenResult) -> Result<(), String> {
        match self.pending.lock().remove(request_id) {
            Some(tx) => tx
                .send(result)
                .map_err(|_| format!("open request receiver dropped: {}", request_id)),
            None => Err(format!("unknown or expired open request: {}", request_id)),
        }
    }
}

/// Payload for the `companion:open-session` event. The frontend opens
/// the matching tab and reports the terminalId back. Exactly one of
/// `session_id` / `new_session` is set for agent; `profile_id` for ssh.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionEvent {
    pub request_id: String,
    /// "agent" | "ssh"
    pub kind: String,
    pub session_id: Option<String>,
    pub profile_id: Option<String>,
}

/// Payload for `companion:close-session`. The frontend closes the tab
/// whose terminalId matches (programmatic close, no confirm prompt).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseSessionEvent {
    pub terminal_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_delivers_terminal_id() {
        let state = LifecycleState::default();
        let (tx, rx) = oneshot::channel();
        state.register_pending("req-1".into(), tx);
        state.resolve("req-1", Ok("term-9".into())).unwrap();
        assert_eq!(rx.await.unwrap(), Ok("term-9".into()));
    }

    #[tokio::test]
    async fn resolve_delivers_failure() {
        let state = LifecycleState::default();
        let (tx, rx) = oneshot::channel();
        state.register_pending("req-2".into(), tx);
        state.resolve("req-2", Err("boom".into())).unwrap();
        assert_eq!(rx.await.unwrap(), Err("boom".into()));
    }

    #[test]
    fn resolve_unknown_id_errors() {
        let state = LifecycleState::default();
        assert!(state.resolve("nope", Ok("x".into())).is_err());
    }

    #[test]
    fn remove_pending_drops_sender() {
        let state = LifecycleState::default();
        let (tx, _rx) = oneshot::channel::<OpenResult>();
        state.register_pending("req-3".into(), tx);
        state.remove_pending("req-3");
        assert!(state.resolve("req-3", Ok("x".into())).is_err());
    }

    #[test]
    fn open_session_event_camel_case() {
        let ev = OpenSessionEvent {
            request_id: "r1".into(),
            kind: "agent".into(),
            session_id: Some("s1".into()),
            profile_id: None,
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["requestId"], "r1");
        assert_eq!(v["kind"], "agent");
        assert_eq!(v["sessionId"], "s1");
        assert_eq!(v["profileId"], serde_json::Value::Null);
    }
}
