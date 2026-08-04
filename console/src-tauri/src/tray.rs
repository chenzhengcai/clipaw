//! System tray integration for the desktop shell.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::backend;

const SHOW_MENU_ID: &str = "show";
const QUIT_MENU_ID: &str = "quit";

/// How long Rust waits for the frontend to acknowledge a close request before
/// falling back to minimize-to-tray. The frontend acks immediately (before it
/// even reads the remembered preference), so this only elapses when no listener
/// is attached (e.g. during the bootstrap-to-console navigation or a reload).
const CLOSE_ACK_TIMEOUT: Duration = Duration::from_millis(1500);

/// Emitted to the frontend when the user closes the window, asking it to honor
/// the remembered preference or show the close prompt.
pub(crate) const CLOSE_REQUESTED_EVENT: &str = "qwenpaw-close-requested";
/// Emitted once a confirmed quit starts waiting for backend shutdown.
pub(crate) const SHUTDOWN_STARTED_EVENT: &str = "qwenpaw-shutdown-started";

#[derive(Clone)]
struct TrayMenuItems {
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub(crate) struct TrayState {
    menu_items: Mutex<Option<TrayMenuItems>>,
    /// Bumped on every close request so a stale fallback can detect that a newer
    /// request superseded it.
    close_seq: AtomicU64,
    /// Highest close sequence the frontend has acknowledged.
    close_ack: AtomicU64,
    /// Set to true once `exit_app` has started backend shutdown, so the
    /// `ExitRequested` handler knows not to call `block_on(stop_and_wait)`
    /// again — which would freeze the Tauri event loop and leave the frontend
    /// stuck in its loading spinner forever.
    shutdown_initiated: AtomicBool,
    /// Join handle for the detached shutdown thread. Stored so the process
    /// does not exit (killing the thread mid-cleanup) before the sidecar has
    /// been stopped. The `ExitRequested` handler joins this before letting
    /// the process exit.
    shutdown_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

/// Creates the tray icon and its cross-platform menu actions.
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    {
        let tray_state = app.state::<TrayState>();
        let mut menu_items = tray_state
            .menu_items
            .lock()
            .map_err(|_| "failed to lock tray menu state")?;
        *menu_items = Some(TrayMenuItems {
            show: show.clone(),
            quit: quit.clone(),
        });
    }

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("QwenPaw Desktop")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MENU_ID => show_main_window(app),
            QUIT_MENU_ID => exit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let should_show = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );

            if should_show {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        // Use the full-color app icon on every platform. The icon is a colored
        // logo, so it must NOT be flagged as a macOS template image — template
        // images are rendered as a solid monochrome silhouette, which would
        // turn the menu-bar icon into a black blob.
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

/// Asks the frontend to handle a window close request. The frontend honors the
/// remembered choice or shows the close prompt, then calls back into the
/// `minimize_to_tray` / `quit_app` commands.
///
/// To avoid leaving the window unclosable when no listener is attached, a
/// fallback minimizes to tray if the frontend does not `ack_close` in time.
pub(crate) fn request_close(app: &tauri::AppHandle) {
    let seq = {
        let state = app.state::<TrayState>();
        state.close_seq.fetch_add(1, Ordering::SeqCst) + 1
    };

    let _ = app.emit(CLOSE_REQUESTED_EVENT, ());

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_ACK_TIMEOUT);
        let state = app.state::<TrayState>();
        // A newer close request superseded this one; let its own timer decide.
        if state.close_seq.load(Ordering::SeqCst) != seq {
            return;
        }
        // The frontend acknowledged and now owns the flow (prompt or remembered
        // action), so leave it alone.
        if state.close_ack.load(Ordering::SeqCst) >= seq {
            return;
        }
        // Nobody responded: fall back to the safe, recoverable choice instead of
        // quitting, so running tasks are not lost.
        hide_main_window(&app);
    });
}

/// Acknowledges a close request so the Rust-side fallback stands down and lets
/// the frontend drive the prompt / remembered-choice flow.
#[tauri::command]
pub(crate) fn ack_close(app: tauri::AppHandle) {
    let state = app.state::<TrayState>();
    let seq = state.close_seq.load(Ordering::SeqCst);
    state.close_ack.store(seq, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn minimize_to_tray(app: tauri::AppHandle) {
    hide_main_window(&app);
}

#[tauri::command]
pub(crate) fn quit_app(app: tauri::AppHandle) {
    exit_app(&app);
}

/// Updates the tray menu labels with frontend-provided translations.
#[tauri::command]
pub(crate) fn set_tray_labels(
    app: tauri::AppHandle,
    show_window: String,
    quit: String,
) -> Result<(), String> {
    let menu_items = {
        let tray_state = app.state::<TrayState>();
        let guard = tray_state
            .menu_items
            .lock()
            .map_err(|_| "failed to lock tray menu state".to_string())?;
        guard.clone()
    };

    if let Some(items) = menu_items {
        items
            .show
            .set_text(show_window)
            .map_err(|err| err.to_string())?;
        items.quit.set_text(quit).map_err(|err| err.to_string())?;
    }

    Ok(())
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(crate) fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Maximum time the detached shutdown thread waits for the backend sidecar to
/// exit gracefully before letting the desktop window close. The window must not
/// stay visible (and the frontend spinner spinning) for the full 60 s
/// `GRACEFUL_SHUTDOWN_EXIT_TIMEOUT`, because on Windows the backend lifespan
/// `finally` block can spend several minutes in sandbox ACL cleanup
/// (`icacls` / `net user` / `powershell`, each with its own 30 s subprocess
/// timeout). The detached thread keeps running after `app.exit(0)`, and the
/// backend's own `backend_guard.reconcile_singleton_backend` reaps any orphan
/// on the next launch if this thread is itself killed.
const SHUTDOWN_DETACH_TIMEOUT: Duration = Duration::from_secs(10);

fn exit_app(app: &tauri::AppHandle) {
    // Keep a visible, non-interactive status while the sidecar finishes its
    // bounded shutdown. This also gives tray-only exits an explicit status.
    show_main_window(app);
    let _ = app.emit(SHUTDOWN_STARTED_EVENT, ());

    // Mark shutdown as initiated so the ExitRequested handler does NOT call
    // block_on(stop_and_wait) or computer_use_runtime::stop - both would block
    // the Tauri event loop and freeze the frontend's `invoke("quit_app")`
    // promise. The detached thread below owns all cleanup.
    {
        let state = app.state::<TrayState>();
        state.shutdown_initiated.store(true, Ordering::SeqCst);
    }

    // Spawn an OS thread (not a Tauri async task) so backend cleanup runs
    // outside the Tauri event loop. The thread does a bounded graceful
    // shutdown then force-kills any survivor, and finally calls
    // `app.exit(0)` itself - we must NOT call `app.exit(0)` on the main
    // thread here because Tauri v2's `exit()` ultimately calls
    // `process::exit()`, which terminates *all* threads including this one
    // before cleanup finishes. The window is hidden immediately so the user
    // never waits; the process stays alive just long enough for the thread
    // to finish, because the `ExitRequested` handler joins it.
    let app_for_thread = app.clone();
    let spawn_result = std::thread::Builder::new()
        .name("qwenpaw-backend-shutdown".to_string())
        .spawn(move || {
            // Stop the Computer Use helper first - it is an independent native
            // process whose cleanup is cheap and must not be skipped.
            crate::computer_use_runtime::stop(&app_for_thread);

            // Try a graceful backend shutdown with a bounded timeout. We use a
            // dedicated tokio runtime (not `tauri::async_runtime::handle`)
            // because the Tauri runtime may be tearing down after `app.exit(0)`
            // was called on the main thread. The dedicated runtime stays alive
            // as long as this OS thread owns it.
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    log::error!("[backend] failed to build shutdown runtime: {err}");
                    backend::force_kill_sidecar(&app_for_thread);
                    app_for_thread.exit(0);
                    return;
                }
            };
            let result = runtime.block_on(async {
                tokio::time::timeout(
                    SHUTDOWN_DETACH_TIMEOUT,
                    backend::stop_and_wait(&app_for_thread),
                )
                .await
            });

            match result {
                Ok(Ok(())) => {
                    log::info!("[backend] graceful shutdown completed in background");
                }
                Ok(Err(err)) => {
                    log::warn!("[backend] graceful shutdown error in background: {err}");
                }
                Err(_) => {
                    log::warn!(
                        "[backend] graceful shutdown did not finish in {} s; force-killing \
                         (orphan reaped on next launch by backend_guard)",
                        SHUTDOWN_DETACH_TIMEOUT.as_secs()
                    );
                    // Force-kill the sidecar process tree directly so it does
                    // not linger after the desktop exits. We bypass
                    // `stop_and_wait` here because its internal 60 s graceful
                    // timeout is too long; `force_kill_sidecar` sends
                    // SIGKILL/TerminateProcess and, on macOS, reaps the
                    // process tree.
                    backend::force_kill_sidecar(&app_for_thread);
                }
            }

            // Now that cleanup is done, trigger the actual process exit. This
            // fires `ExitRequested`, whose handler joins this very thread
            // (already returning) and lets the process terminate.
            app_for_thread.exit(0);
        });

    match spawn_result {
        Ok(handle) => {
            // Store the handle so `ExitRequested` can join it before letting
            // the process exit, ensuring the thread is not killed mid-cleanup.
            if let Ok(mut guard) = app.state::<TrayState>().shutdown_thread.lock() {
                *guard = Some(handle);
            }
        }
        Err(err) => {
            log::error!("[backend] failed to spawn shutdown thread: {err}");
            // Fallback: best-effort inline kill, then exit immediately. The
            // backend_guard will clean up any orphan on next launch.
            backend::force_kill_sidecar(app);
            app.exit(0);
            return;
        }
    }

    // Hide the window immediately so the user does not wait for backend
    // cleanup. We do NOT call `app.exit(0)` here - the detached thread does
    // that after cleanup, and the `ExitRequested` handler joins it.
    hide_main_window(app);
}

/// Returns true if `exit_app` has already started backend shutdown, so the
/// caller can skip a redundant (and event-loop-blocking) `stop_and_wait`.
pub(crate) fn shutdown_initiated(app: &tauri::AppHandle) -> bool {
    app.state::<TrayState>()
        .shutdown_initiated
        .load(Ordering::SeqCst)
}

/// Joins the detached shutdown thread so the process does not exit (killing
/// the thread mid-cleanup) before the sidecar has been stopped. Called from
/// the `ExitRequested` handler when `shutdown_initiated` is true. The window
/// is already hidden by then, so the user does not see this wait.
///
/// If the join times out (e.g. the thread is hung in an unbounded
/// `child.wait()`), we abandon it and let the process exit; the
/// `backend_guard` reaps any orphan on the next launch.
pub(crate) fn join_shutdown_thread(app: &tauri::AppHandle) {
    let handle = {
        let state = app.state::<TrayState>();
        let mut guard = match state.shutdown_thread.lock() {
            Ok(guard) => guard,
            Err(_) => {
                log::warn!("[backend] shutdown thread state poisoned; skipping join");
                return;
            }
        };
        guard.take()
    };

    if let Some(handle) = handle {
        // The thread's own `stop_and_wait` is bounded by
        // `SHUTDOWN_DETACH_TIMEOUT` (10 s) plus `force_kill_sidecar`, so we
        // poll with a generous budget. `JoinHandle` has no native
        // `join_timeout`, so we use `is_finished` + sleep, then a final
        // blocking `join`.
        let deadline = SHUTDOWN_DETACH_TIMEOUT * 2;
        let poll_interval = Duration::from_millis(100);
        let start = std::time::Instant::now();
        while !handle.is_finished() && start.elapsed() < deadline {
            std::thread::sleep(poll_interval);
        }
        if handle.is_finished() {
            match handle.join() {
                Ok(()) => log::info!("[backend] shutdown thread joined cleanly"),
                Err(_) => log::warn!("[backend] shutdown thread panicked"),
            }
        } else {
            // Thread is still running past the deadline. Abandon it so the
            // process can exit; force-kill as a last resort.
            log::warn!("[backend] shutdown thread did not finish within join timeout; abandoning");
            backend::force_kill_sidecar(app);
            // Drop the handle without joining - the thread will be killed when
            // the process exits.
            drop(handle);
        }
    }
}
