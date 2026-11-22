// Screen-share sound without the call in it: captures everything Windows is playing EXCEPT FolkChat itself
// (WASAPI "process loopback", the same trick Discord uses). FolkChat's WebView2 processes are children of
// this app, so excluding our process tree removes your friends' voices from what you share.
// Needs Windows 10 2004 or newer. Output: 48 kHz stereo, 16-bit, sent in ~40 ms chunks.
#![cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use windows::core::{implement, Interface, IUnknown, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcessId, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Done(mpsc::SyncSender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.0.try_send(());
        Ok(())
    }
}

fn err(e: impl std::fmt::Display) -> String { e.to_string() }

/// Runs until `stop` is set. `ready` gets Ok once capturing (or the error), `on_data` gets PCM chunks.
pub fn run(stop: Arc<AtomicBool>, ready: mpsc::Sender<Result<(), String>>, mut on_data: impl FnMut(Vec<u8>)) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let res = (|| -> Result<(IAudioClient, IAudioCaptureClient, windows::Win32::Foundation::HANDLE), String> {
            let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
                ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
                Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                    ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                        TargetProcessId: GetCurrentProcessId(),
                        ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
                    },
                },
            };
            let mut pv = std::mem::ManuallyDrop::new(PROPVARIANT::default());
            let inner = &mut *pv.Anonymous.Anonymous;
            inner.vt = VT_BLOB;
            inner.Anonymous.blob = BLOB {
                cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                pBlobData: &mut params as *mut _ as *mut u8,
            };
            let (tx, rx) = mpsc::sync_channel(1);
            let handler: IActivateAudioInterfaceCompletionHandler = Done(tx).into();
            let op = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*pv as *const PROPVARIANT), &handler).map_err(err)?;
            rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "audio activation timed out".to_string())?;
            let mut hr = HRESULT(0);
            let mut unk: Option<IUnknown> = None;
            op.GetActivateResult(&mut hr, &mut unk).map_err(err)?;
            hr.ok().map_err(err)?;
            let client: IAudioClient = unk.ok_or("no audio client")?.cast().map_err(err)?;
            let fmt = WAVEFORMATEX { wFormatTag: 3 /* IEEE float */, nChannels: 2, nSamplesPerSec: 48000, nAvgBytesPerSec: 48000 * 8, nBlockAlign: 8, wBitsPerSample: 32, cbSize: 0 };
            client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                200_000, 0, &fmt, None).map_err(err)?;
            let ev = CreateEventW(None, false, false, PCWSTR::null()).map_err(err)?;
            client.SetEventHandle(ev).map_err(err)?;
            let cap: IAudioCaptureClient = client.GetService().map_err(err)?;
            client.Start().map_err(err)?;
            Ok((client, cap, ev))
        })();
        let (client, cap, ev) = match res {
            Ok(x) => { let _ = ready.send(Ok(())); x }
            Err(e) => { let _ = ready.send(Err(e)); CoUninitialize(); return; }
        };
        // 40 ms of 48 kHz stereo 16-bit = 1920 frames * 4 bytes
        let mut out: Vec<u8> = Vec::with_capacity(8192);
        while !stop.load(Ordering::Relaxed) {
            WaitForSingleObject(ev, 100);
            loop {
                let n = match cap.GetNextPacketSize() { Ok(n) => n, Err(_) => 0 };
                if n == 0 { break; }
                let mut data: *mut u8 = std::ptr::null_mut();
                let (mut frames, mut flags) = (0u32, 0u32);
                if cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() { break; }
                let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null();
                let samples = frames as usize * 2;
                if silent {
                    out.resize(out.len() + samples * 2, 0);
                } else {
                    let f = std::slice::from_raw_parts(data as *const f32, samples);
                    for &x in f {
                        let v = (x.clamp(-1.0, 1.0) * 32767.0) as i16;
                        out.extend_from_slice(&v.to_le_bytes());
                    }
                }
                let _ = cap.ReleaseBuffer(frames);
            }
            if out.len() >= 1920 * 4 { on_data(std::mem::take(&mut out)); out.reserve(8192); }
        }
        let _ = client.Stop();
        let _ = CloseHandle(ev);
        drop(cap); drop(client);
        CoUninitialize();
    }
}
