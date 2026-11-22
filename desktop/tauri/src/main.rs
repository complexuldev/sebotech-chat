// FolkChat for Windows: a small native shell around the live site (https://complexuldev.github.io/sebotech-chat/).
// The chat itself stays a web page (so updates reach everyone instantly); this adds what a page can't do:
//   - game detection (which game is running)            -> `procs`, `foreground`
//   - push-to-talk that works while a game is focused    -> `ptt_watch` + "ptt" events
//   - a see-through, click-through, always-on-top overlay -> `overlay_*`
//   - tray icon, close-to-tray, start with Windows, single instance
//   - low memory: one shared WebView2 browser for every window, and a "low memory" hint while hidden.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const APP_URL: &str = "https://complexuldev.github.io/sebotech-chat/";
// Every window must use the same arguments, so they all share ONE WebView2 browser process (saves RAM).
// The first three are wry's defaults (it drops them when we pass our own).
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,msEdgeShopping,msShowWalletUI,msEdgeCollections \
--disable-sync --disable-background-networking --disable-component-update --no-default-browser-check \
--autoplay-policy=no-user-gesture-required";

static PTT_VK: AtomicU32 = AtomicU32::new(0);
static QUITTING: AtomicBool = AtomicBool::new(false);
static LOW_MEM: AtomicBool = AtomicBool::new(false);

fn allowed_in_app(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some(h) if h == "complexuldev.github.io"
        || h == "sebotech-chat.firebaseapp.com" || h == "accounts.google.com" || h.ends_with(".google.com") || h == "apis.google.com")
}

// ---------------- memory: ask WebView2 to trim itself while the window is hidden/minimised ----------------
fn set_low_memory<R: Runtime>(w: &WebviewWindow<R>, low: bool) {
    if LOW_MEM.swap(low, Ordering::SeqCst) == low { return; }
    #[cfg(windows)]
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::Interface;
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL });
            }
        }
    });
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        set_low_memory(&w, false);
    }
}

// ---------------- game detection ----------------
/// Names (lower-case .exe) of all running programs. The site matches them against its list of games.
#[tauri::command]
fn procs() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::*;
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut ok = Process32FirstW(snap, &mut e).is_ok();
            while ok {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push(String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase());
                ok = Process32NextW(snap, &mut e).is_ok();
            }
            let _ = CloseHandle(snap);
        }
    }
    out.sort();
    out.dedup();
    out
}

#[derive(serde::Serialize, Default)]
struct Fg { exe: String, title: String }

/// The program in front (its .exe name and window title), e.g. to tell Minecraft apart from other Java apps.
#[tauri::command]
fn foreground() -> Fg {
    let mut fg = Fg::default();
    #[cfg(windows)]
    unsafe {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::*;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return fg; }
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n > 0 { fg.title = String::from_utf16_lossy(&buf[..n as usize]); }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid != 0 {
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut path = [0u16; 520];
                let mut len = path.len() as u32;
                if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut len).is_ok() {
                    let full = String::from_utf16_lossy(&path[..len as usize]);
                    fg.exe = full.rsplit('\\').next().unwrap_or("").to_lowercase();
                }
                let _ = CloseHandle(h);
            }
        }
    }
    fg
}

// ---------------- push-to-talk: watch one key/mouse button even while a game has focus ----------------
/// `vk` = Windows virtual-key code to watch, 0 = stop. Sends "ptt" true/false to the main window.
/// It only reads the key state (GetAsyncKeyState), so the key still reaches the game.
#[tauri::command]
fn ptt_watch(vk: u32) { PTT_VK.store(vk.min(255), Ordering::SeqCst); }

fn ptt_thread<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut last = false;
        loop {
            let vk = PTT_VK.load(Ordering::Relaxed);
            if vk == 0 {
                if last { last = false; let _ = app.emit_to("main", "ptt", false); }
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }
            #[cfg(windows)]
            let down = unsafe { (windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 };
            #[cfg(not(windows))]
            let down = false;
            if down != last { last = down; let _ = app.emit_to("main", "ptt", down); }
            std::thread::sleep(Duration::from_millis(15));
        }
    });
}

// ---------------- overlay ----------------
/// Opens the see-through overlay at (x, y) (logical pixels). It ignores the mouse, so clicks go to the game.
#[tauri::command]
async fn overlay_open<R: Runtime>(app: AppHandle<R>, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") { let _ = w.show(); return Ok(()); }
    let w = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("FolkChat overlay")
        .inner_size(260.0, 340.0)
        .position(x.unwrap_or(16.0), y.unwrap_or(16.0))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = w.set_ignore_cursor_events(true);
    Ok(())
}

#[tauri::command]
fn overlay_close<R: Runtime>(app: AppHandle<R>) {
    if let Some(w) = app.get_webview_window("overlay") { let _ = w.destroy(); }
}

/// Move mode: the overlay takes the mouse so it can be dragged; off = clicks pass through again.
#[tauri::command]
fn overlay_interactive<R: Runtime>(app: AppHandle<R>, on: bool) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.set_ignore_cursor_events(!on);
        let _ = w.emit_to("overlay", "ovl-move", on);
    }
}

/// The overlay page tells us how tall its content is, so the window is never bigger than needed.
#[tauri::command]
fn overlay_fit<R: Runtime>(app: AppHandle<R>, h: f64) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.set_size(tauri::LogicalSize::new(260.0, h.clamp(40.0, 900.0)));
        if !w.is_visible().unwrap_or(true) { let _ = w.show(); }
    }
}

/// Unread messages: tray tooltip + flash the taskbar button when the window isn't focused.
#[tauri::command]
fn set_unread<R: Runtime>(app: AppHandle<R>, n: u32, flash: bool) {
    if let Some(t) = app.tray_by_id("tray") {
        let _ = t.set_tooltip(Some(if n > 0 { format!("FolkChat · {} necitite", n) } else { "FolkChat".to_string() }));
    }
    if flash {
        if let Some(w) = app.get_webview_window("main") {
            if !w.is_focused().unwrap_or(true) { let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational)); }
        }
    }
}

#[tauri::command]
fn app_version<R: Runtime>(app: AppHandle<R>) -> String { app.package_info().version.to_string() }

fn main() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![procs, foreground, ptt_watch, overlay_open, overlay_close, overlay_interactive, overlay_fit, set_unread, app_version])
        .setup(move |app| {
            let handle = app.handle().clone();
            let opener = app.handle().clone();
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(APP_URL.parse().unwrap()))
                .title("FolkChat")
                .inner_size(1200.0, 800.0)
                .min_inner_size(420.0, 560.0)
                .center()
                .visible(!hidden)
                .additional_browser_args(BROWSER_ARGS)
                .on_new_window(move |url, _features| {
                    // Google sign-in popups stay in the app; every other link opens in the normal browser.
                    if allowed_in_app(&url) { NewWindowResponse::Allow } else {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                        NewWindowResponse::Deny
                    }
                })
                .build()?;
            if hidden { set_low_memory(&main, true); }

            let open_i = MenuItem::with_id(app, "open", "Deschide FolkChat", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Ieși din FolkChat", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("FolkChat")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => { QUITTING.store(true, Ordering::SeqCst); app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e { show_main(tray.app_handle()); }
                })
                .build(app)?;

            ptt_thread(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                // X hides FolkChat next to the clock, so calls keep going and messages still ring.
                WindowEvent::CloseRequested { api, .. } if label == "main" && !QUITTING.load(Ordering::SeqCst) => {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(w) = window.app_handle().get_webview_window("main") { set_low_memory(&w, true); }
                }
                WindowEvent::Resized(_) if label == "main" => {
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        let min = w.is_minimized().unwrap_or(false);
                        set_low_memory(&w, min);
                    }
                }
                WindowEvent::Focused(true) if label == "main" => {
                    if let Some(w) = window.app_handle().get_webview_window("main") { set_low_memory(&w, false); }
                }
                WindowEvent::Moved(p) if label == "overlay" => {
                    let s = window.scale_factor().unwrap_or(1.0);
                    let l = p.to_logical::<f64>(s);
                    let _ = window.app_handle().emit_to("main", "ovl-pos", (l.x, l.y));
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running FolkChat");
}
