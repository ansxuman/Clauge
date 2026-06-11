use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::stream::build_capture_stream;
use super::CaptureEvent;

pub struct MicCapture {
    stop_tx: Sender<()>,
    handle: JoinHandle<()>,
}

impl MicCapture {
    pub fn start(tx: Sender<CaptureEvent>) -> Result<Self, String> {
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
                Err("mic capture thread exited before reporting status".to_string())
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
    ready_tx: Sender<Result<(), String>>,
) {
    let stream = match open_input_stream(tx) {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(format!("failed to start mic stream: {e}")));
        return;
    }
    let _ = ready_tx.send(Ok(()));
    let _ = stop_rx.recv();
}

fn open_input_stream(tx: Sender<CaptureEvent>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no default input device".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("no default input config: {e}"))?;
    build_capture_stream(&device, config, tx).map_err(|e| format!("failed to build mic stream: {e}"))
}
