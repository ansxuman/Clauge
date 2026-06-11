use std::sync::mpsc::Sender;

use cpal::traits::DeviceTrait;
use cpal::{FromSample, SampleFormat, SizedSample};

use super::{AudioFrame, CaptureEvent};

/// Builds a cpal input stream for the device's reported sample format,
/// converting samples to f32 and forwarding frames over `tx`. Stream errors
/// are forwarded as `CaptureEvent::Error` keeping cpal's message text
/// verbatim (`err.to_string()`), so consumers can match on it. Callers wrap
/// the returned error string with source-specific context.
pub(crate) fn build_capture_stream(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    tx: Sender<CaptureEvent>,
) -> Result<cpal::Stream, String> {
    let channels = config.channels();
    let rate = config.sample_rate();
    let format = config.sample_format();
    let config: cpal::StreamConfig = config.into();
    match format {
        SampleFormat::F32 => build::<f32>(device, config, channels, rate, tx),
        SampleFormat::I16 => build::<i16>(device, config, channels, rate, tx),
        SampleFormat::U16 => build::<u16>(device, config, channels, rate, tx),
        SampleFormat::I32 => build::<i32>(device, config, channels, rate, tx),
        SampleFormat::U32 => build::<u32>(device, config, channels, rate, tx),
        SampleFormat::F64 => build::<f64>(device, config, channels, rate, tx),
        other => Err(format!("unsupported sample format: {other}")),
    }
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: u16,
    rate: u32,
    tx: Sender<CaptureEvent>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let err_tx = tx.clone();
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let samples: Vec<f32> = data.iter().map(|&s| s.to_sample::<f32>()).collect();
                let _ = tx.send(CaptureEvent::Frame(AudioFrame {
                    samples,
                    channels,
                    rate,
                }));
            },
            move |err| {
                let _ = err_tx.send(CaptureEvent::Error(err.to_string()));
            },
            None,
        )
        .map_err(|e| e.to_string())
}
