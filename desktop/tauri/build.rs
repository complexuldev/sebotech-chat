fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "procs", "foreground", "ptt_watch", "overlay_open", "overlay_close", "overlay_interactive", "overlay_fit", "set_unread", "app_version",
    ])))
    .expect("failed to run tauri build");
}
