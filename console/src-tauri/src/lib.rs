//! Tauri desktop entry point and plugin/command registration.

mod backend;
mod backend_download;
#[cfg(all(target_os = "macos", not(debug_assertions)))]
mod computer_use_helper;
mod computer_use_protocol;
mod computer_use_runtime;
mod external_link;
mod runtime_env;
mod tray;
mod updates;

use tauri::{Manager, RunEvent, WebviewWindow, WindowEvent};

/// Opens the WebView DevTools. Gated by the hidden 8-click logo gesture in the
/// frontend so end users cannot open DevTools via the default context menu or
/// keyboard shortcuts in production builds.
#[tauri::command]
fn open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Build the desktop app, wire native plugins/commands, and stop the backend on exit.
pub fn run() {
    let build_result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(updates::is_remote_update_newer)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            backend_download::download_backend_file,
            backend_download::read_workspace_binary_file,
            backend::backend_port,
            backend::backend_startup_error,
            backend::restart_backend,
            external_link::open_external_link,
            updates::check_desktop_update,
            updates::install_desktop_update,
            updates::download_desktop_update,
            updates::install_downloaded_update,
            updates::check_cached_update,
            tray::minimize_to_tray,
            tray::quit_app,
            tray::set_tray_labels,
            tray::ack_close,
        ])
        .manage(backend::BackendState::default())
        .manage(computer_use_runtime::ComputerUseRuntimeState::default())
        .manage(tray::TrayState::default())
        .setup(|app| {
            backend::setup(app)?;
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                tray::request_close(window.app_handle());
            }
        })
        .build(tauri::generate_context!());

    match build_result {
        Ok(app) => {
            app.run(|app_handle, event| match event {
                // `code` is `None` only for OS-initiated quits (e.g. macOS
                // Cmd+Q / app menu Quit). On macOS we call `exit_app` directly
                // (same as the X button / tray Quit) so the detached shutdown
                // thread always runs, even if the frontend WebView is
                // unresponsive after the Cmd+Q signal. Programmatic exits from
                // `quit_app` carry a `code` and fall through to the normal
                // shutdown path below.
                RunEvent::ExitRequested { api, code, .. } => {
                    #[cfg(target_os = "macos")]
                    if code.is_none() {
                        // macOS Cmd+Q / app menu Quit. We MUST prevent the OS
                        // from terminating the app here, otherwise the detached
                        // shutdown thread spawned by `exit_app` is killed
                        // before it can stop the backend sidecar, leaving
                        // `qwenpaw-backend` orphaned (reparented to launchd,
                        // PPID 1). `exit_app` hides the window at once and its
                        // shutdown thread calls `std::process::exit(0)` once
                        // the sidecar is stopped, so preventing the exit only
                        // keeps the process alive long enough for cleanup -
                        // the window still vanishes immediately.
                        api.prevent_exit();
                        tray::exit_app(app_handle);
                        return;
                    }
                    #[cfg(not(target_os = "macos"))]
                    let _ = (&api, &code);
                    // If `quit_app` / tray Quit already started backend shutdown
                    // via `exit_app`, a detached OS thread is handling
                    // `stop_and_wait`, `computer_use_runtime::stop`, and will
                    // call `std::process::exit(0)` itself when done (bypassing
                    // `ExitRequested` to avoid a join deadlock). This branch is
                    // only reached if an external `ExitRequested` fires while
                    // the thread is still running (e.g. macOS second Cmd+Q or
                    // system logout). We join the thread so the process does
                    // not exit mid-cleanup; if the join times out, we abandon
                    // it and let the process exit.
                    if !tray::shutdown_initiated(app_handle) {
                        if let Err(err) =
                            tauri::async_runtime::block_on(backend::stop_and_wait(app_handle))
                        {
                            log::warn!("[backend] graceful shutdown did not complete: {err}");
                        }
                        computer_use_runtime::stop(app_handle);
                    } else {
                        tray::join_shutdown_thread(app_handle);
                    }
                }
                // macOS emits this when the user clicks the Dock icon. Without
                // it, a window hidden via "minimize to tray" can only be
                // restored from the menu-bar icon, leaving a dead Dock icon.
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => {
                    tray::show_main_window(app_handle);
                }
                RunEvent::Exit => {
                    // macOS Cmd+Q / app-menu Quit reaches here (via
                    // `applicationWillTerminate` -> `LoopDestroyed`), NOT
                    // through `ExitRequested`. This is the last synchronous
                    // chance to stop the backend sidecar before the process
                    // exits and orphans it. Without this, the detached
                    // shutdown thread is killed mid-cleanup.
                    tray::exit_cleanup_blocking(app_handle);
                }
                _ => {}
            });
        }
        Err(err) => {
            eprintln!("[QwenPaw Desktop] Fatal startup error: {err}");
            std::process::exit(1);
        }
    }
}
