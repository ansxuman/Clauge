use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::SystemAudioError;
use crate::shared::audio::stream::build_capture_stream;
use crate::shared::audio::CaptureEvent;

pub struct LinuxSystemCapture {
    stop_tx: Sender<()>,
    handle: JoinHandle<()>,
}

impl LinuxSystemCapture {
    pub fn start(tx: Sender<CaptureEvent>) -> Result<Self, SystemAudioError> {
        let (stop_tx, stop_rx) = channel();
        let (ready_tx, ready_rx) = channel();
        let handle = std::thread::spawn(move || run_capture(tx, stop_rx, ready_tx));
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { stop_tx, handle }),
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => {
                let _ = handle.join();
                Err(SystemAudioError::Failed(
                    "monitor capture thread exited before reporting status".to_string(),
                ))
            }
        }
    }

    pub fn stop(self) {
        let _ = self.stop_tx.send(());
        let _ = self.handle.join();
    }
}

fn run_capture(
    tx: Sender<CaptureEvent>,
    stop_rx: Receiver<()>,
    ready_tx: Sender<Result<(), SystemAudioError>>,
) {
    // Device enumeration happens here, not in start(): connecting to the
    // PulseAudio/PipeWire daemon and listing sources can block, so it must
    // stay off the caller's thread and report failures through the ready
    // handshake.
    let stream = match open_monitor_stream(tx) {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(SystemAudioError::Failed(format!(
            "failed to start monitor stream: {e}"
        ))));
        return;
    }
    let _ = ready_tx.send(Ok(()));
    let _ = stop_rx.recv();
}

fn open_monitor_stream(tx: Sender<CaptureEvent>) -> Result<cpal::Stream, SystemAudioError> {
    let host = cpal::default_host();
    let device = find_monitor_device(&host)?.ok_or_else(|| {
        SystemAudioError::Unsupported(
            "no monitor source found — system audio requires PulseAudio/PipeWire".to_string(),
        )
    })?;
    let config = device
        .default_input_config()
        .map_err(|e| SystemAudioError::Failed(format!("no input config on monitor source: {e}")))?;
    build_capture_stream(&device, config, tx)
        .map_err(|e| SystemAudioError::Failed(format!("failed to build monitor stream: {e}")))
}

fn find_monitor_device(host: &cpal::Host) -> Result<Option<cpal::Device>, SystemAudioError> {
    // cpal's PulseAudio host (enabled via the "pulseaudio" cargo feature, and
    // preferred by default_host() when the daemon socket exists — PipeWire
    // counts via pipewire-pulse) lists each output sink's monitor as a
    // capture source whose backend id is "<sink>.monitor". The id is the
    // PulseAudio-internal name; description().name() is the human-readable
    // text ("Monitor of ..."), checked as a fallback. On bare ALSA no device
    // matches and we return None.
    let default_monitor_id = host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|id| format!("{}.monitor", id.id()));
    let devices = host
        .input_devices()
        .map_err(|e| SystemAudioError::Failed(format!("failed to enumerate input devices: {e}")))?;
    // Prefer the default sink's monitor so capture follows what the user
    // actually hears; otherwise fall back to the first monitor found.
    let mut fallback = None;
    for device in devices {
        let id = device.id().ok();
        let id_str = id.as_ref().map(|id| id.id());
        let is_monitor = id_str.is_some_and(|s| s.ends_with(".monitor"))
            || device
                .description()
                .is_ok_and(|desc| desc.name().starts_with("Monitor of "));
        if !is_monitor {
            continue;
        }
        if id_str.is_some() && id_str == default_monitor_id.as_deref() {
            return Ok(Some(device));
        }
        if fallback.is_none() {
            fallback = Some(device);
        }
    }
    Ok(fallback)
}
