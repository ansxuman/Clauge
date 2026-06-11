use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::SystemAudioError;
use crate::shared::audio::stream::build_capture_stream;
use crate::shared::audio::CaptureEvent;

pub struct WindowsSystemCapture {
    stop_tx: Sender<()>,
    handle: JoinHandle<()>,
}

impl WindowsSystemCapture {
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
                    "loopback capture thread exited before reporting status".to_string(),
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
    let stream = match open_loopback_stream(tx) {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(SystemAudioError::Failed(format!(
            "failed to start loopback stream: {e}"
        ))));
        return;
    }
    let _ = ready_tx.send(Ok(()));
    let _ = stop_rx.recv();
}

fn open_loopback_stream(tx: Sender<CaptureEvent>) -> Result<cpal::Stream, SystemAudioError> {
    let host = cpal::default_host();
    // WASAPI loopback: cpal sets AUDCLNT_STREAMFLAGS_LOOPBACK whenever an
    // *input* stream is built on a render (output) device, so we capture
    // system audio by opening an input stream on the default output device.
    // The render device rejects default_input_config(); its mix format comes
    // from default_output_config().
    let device = host
        .default_output_device()
        .ok_or_else(|| SystemAudioError::Unsupported("no output device".to_string()))?;
    let config = device
        .default_output_config()
        .map_err(|e| SystemAudioError::Failed(format!("no default output config: {e}")))?;
    // When the default output device changes, cpal's WASAPI backend reports
    // ErrorKind::DeviceChanged ("Default audio device changed") through the
    // stream error callback while capture keeps running on the old — now
    // rerouted and silent — device. build_capture_stream forwards that as
    // CaptureEvent::Error with cpal's text intact (err.to_string()), so the
    // recorder can prefix-match it and restart SystemCapture on the new
    // default device.
    build_capture_stream(&device, config, tx)
        .map_err(|e| SystemAudioError::Failed(format!("failed to build loopback stream: {e}")))
}
