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
use serde::{Deserialize, Serialize};

const SHOW_MENU_ID: &str = "show";
const APPROVALS_MENU_ID: &str = "approvals";
const QUIT_MENU_ID: &str = "quit";
/// Menu id of the macOS application-menu Quit item, which owns `Cmd+Q`.
const APP_QUIT_MENU_ID: &str = "app-quit";

/// How long the exit hook may spend stopping the backend before the process
/// exits anyway. It bounds an OS-initiated quit (`Cmd+Q`, Dock, AppleScript).
const FINISH_EXIT_TIMEOUT: Duration = Duration::from_secs(30);

/// How long Rust waits for the frontend to acknowledge a close request before
/// falling back to minimize-to-tray. The frontend acks immediately (before it
/// renders the prompt), so this only elapses when no listener is attached
/// (e.g. during a document reload).
const CLOSE_ACK_TIMEOUT: Duration = Duration::from_millis(1500);

/// Emitted to the frontend when the user closes the window, asking it to honor
/// the remembered preference or show the close prompt.
pub(crate) const CLOSE_REQUESTED_EVENT: &str = "qwenpaw-close-requested";

#[derive(Clone)]
struct TrayMenuItems {
    show: MenuItem<tauri::Wry>,
    approvals: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    stop_blocked: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CloseAction {
    // Older versions saved the "Run in background" choice as "quit".
    #[serde(alias = "quit")]
    MinimizeToTray,
    StopService,
}

#[derive(Default)]
pub(crate) struct TrayState {
    menu_items: Mutex<Option<TrayMenuItems>>,
    /// Bumped on every close request so a stale fallback can detect that a newer
    /// request superseded it.
    close_seq: AtomicU64,
    /// Highest close sequence the frontend has acknowledged.
    close_ack: AtomicU64,
    close_action: Mutex<Option<CloseAction>>,
    preference_write: tokio::sync::Mutex<()>,
    quitting: AtomicBool,
    shutdown_complete: AtomicBool,
}

/// Creates the tray icon and its cross-platform menu actions.
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let path = app.path().app_config_dir()?.join("close-action.json");
    let preference = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CloseAction>(&bytes).ok());
    *app.state::<TrayState>()
        .close_action
        .lock()
        .expect("tray state poisoned") = preference;
    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show Window", true, None::<&str>)?;
    let approvals = MenuItem::with_id(app, APPROVALS_MENU_ID, "View pending approvals", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit App", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &approvals, &quit])?;

    {
        let tray_state = app.state::<TrayState>();
        let mut menu_items = tray_state
            .menu_items
            .lock()
            .map_err(|_| "failed to lock tray menu state")?;
        *menu_items = Some(TrayMenuItems {
            show: show.clone(),
            approvals: approvals.clone(),
            quit: quit.clone(),
            stop_blocked:
                "QwenPaw is still in use in other windows or apps. Close them before quitting completely."
                    .into(),
        });
    }

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("QwenPaw Desktop")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MENU_ID => show_main_window(app),
            APPROVALS_MENU_ID => {
                show_main_window(app);
                let _ = app.emit("qwenpaw:open-approvals", ());
            }
            QUIT_MENU_ID => request_quit(app),
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
    #[cfg(target_os = "macos")]
    install_quit_menu_item(app)?;
    // `Cmd+Q` is an explicit quit: stop the shared backend when this is the
    // last client instead of leaving it running in the background.
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == APP_QUIT_MENU_ID {
            exit_app(app, 0);
        }
    });
    Ok(())
}

/// Replace the macOS application-menu Quit item.
///
/// Tauri's default menu installs the predefined Quit item, whose native
/// `terminate:` action ends the process immediately. That path never reaches
/// [`exit_app`], so the detached backend would keep running after `Cmd+Q`.
/// Owning the item routes the shortcut through the normal shutdown instead.
#[cfg(target_os = "macos")]
fn install_quit_menu_item(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuItem, MenuItemKind};

    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(application)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let items = application.items()?;
    // The application menu ends with the predefined Quit item; separators are
    // predefined items too, so look for the trailing "Quit <app>" entry and
    // fall back to the last predefined item when the label is unexpected.
    let position = items
        .iter()
        .rposition(|item| match item {
            MenuItemKind::Predefined(item) => item
                .text()
                .is_ok_and(|text| text.starts_with("Quit ") || text == "Quit"),
            _ => false,
        })
        .or_else(|| {
            matches!(items.last(), Some(MenuItemKind::Predefined(_))).then(|| items.len() - 1)
        });
    let Some(position) = position else {
        log::warn!("[tray] macOS application menu has no Quit item to replace");
        return Ok(());
    };
    application.remove_at(position)?;
    let label = format!("Quit {}", app.package_info().name);
    let quit = MenuItem::with_id(app, APP_QUIT_MENU_ID, label, true, Some("CmdOrCtrl+Q"))?;
    application.insert(&quit, position)?;
    log::info!("[tray] Cmd+Q now runs the desktop shutdown instead of AppKit terminate");
    Ok(())
}

/// Window close honors the saved choice; explicit quit always offers the
/// last client a choice between background tasks and quitting completely.
pub(crate) fn request_close(app: &tauri::AppHandle) {
    request_exit(app, true);
}

pub(crate) fn request_quit(app: &tauri::AppHandle) {
    request_exit(app, false);
}

fn request_exit(app: &tauri::AppHandle, honor_preference: bool) {
    let seq = app
        .state::<TrayState>()
        .close_seq
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let others = backend::other_clients(&app).await;
        if app.state::<TrayState>().close_seq.load(Ordering::SeqCst) != seq || is_quitting(&app) {
            return;
        }
        // If the runtime is unavailable, keep both choices accessible.
        let action = if honor_preference {
            *app.state::<TrayState>()
                .close_action
                .lock()
                .expect("tray state poisoned")
        } else {
            None
        };
        if matches!(others, Ok(count) if count > 0)
            && !matches!(action, Some(CloseAction::MinimizeToTray))
        {
            exit_app(&app, 0);
            return;
        }
        match action {
            Some(CloseAction::MinimizeToTray) => hide_main_window(&app),
            Some(CloseAction::StopService) => {
                if stop_service(app.clone()).await.is_ok() {
                    exit_app(&app, 0);
                } else {
                    show_close_prompt(&app, seq);
                }
            }
            None => show_close_prompt(&app, seq),
        }
    });
}

fn show_close_prompt(app: &tauri::AppHandle, seq: u64) {
    show_main_window(app);
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
    exit_app(&app, 0);
}

#[tauri::command]
pub(crate) async fn stop_service(app: tauri::AppHandle) -> Result<(), String> {
    backend::stop_and_wait(&app).await.map_err(|error| {
        if error == backend::OTHER_CLIENTS_ERROR {
            app.state::<TrayState>()
                .menu_items
                .lock()
                .expect("tray state poisoned")
                .as_ref()
                .map(|items| items.stop_blocked.clone())
                .unwrap_or(error)
        } else {
            error
        }
    })
}

/// Updates the tray menu labels with frontend-provided translations.
#[tauri::command]
pub(crate) fn set_tray_labels(
    app: tauri::AppHandle,
    show_window: String,
    quit: String,
    stop_blocked: String,
    view_approvals: Option<String>,
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
        if let Some(label) = view_approvals {
            items.approvals.set_text(label).map_err(|err| err.to_string())?;
        }
        if let Some(stored) = app
            .state::<TrayState>()
            .menu_items
            .lock()
            .expect("tray state poisoned")
            .as_mut()
        {
            stored.stop_blocked = stop_blocked;
        }
        items
            .show
            .set_text(show_window)
            .map_err(|err| err.to_string())?;
        items.quit.set_text(quit).map_err(|err| err.to_string())?;
    }

    Ok(())
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
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

pub(crate) fn is_quitting(app: &tauri::AppHandle) -> bool {
    app.state::<TrayState>().quitting.load(Ordering::SeqCst)
}

pub(crate) fn shutdown_complete(app: &tauri::AppHandle) -> bool {
    app.state::<TrayState>()
        .shutdown_complete
        .load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn get_close_action(app: tauri::AppHandle) -> Option<CloseAction> {
    *app.state::<TrayState>()
        .close_action
        .lock()
        .expect("tray state poisoned")
}

#[tauri::command]
pub(crate) async fn set_close_action(
    app: tauri::AppHandle,
    action: Option<CloseAction>,
) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let _write = state.preference_write.lock().await;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|err| err.to_string())?
        .join("close-action.json");
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let parent = path.parent().ok_or("Missing preference directory")?;
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        let bytes = serde_json::to_vec(&action).map_err(|err| err.to_string())?;
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, bytes).map_err(|err| err.to_string())?;
        std::fs::rename(temporary, path).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())??;
    *app.state::<TrayState>()
        .close_action
        .lock()
        .expect("tray state poisoned") = action;
    Ok(())
}

pub(crate) fn exit_app(app: &tauri::AppHandle, code: i32) {
    if app
        .state::<TrayState>()
        .quitting
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    // Close the window first so quitting feels immediate; the backend is
    // stopped afterwards and only when this is the last client.
    if let Some(window) = app.get_webview_window("main") {
        if let Err(err) = window.destroy() {
            log::warn!("[desktop] failed to destroy window: {err}");
            let _ = window.hide();
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // When this is the last client, stop the shared backend so no orphan
        // process remains after the desktop exits. If other clients are still
        // connected, only detach this client (the shared service keeps running).
        match backend::stop_and_wait(&app).await {
            Ok(()) => {}
            Err(error) if error == backend::OTHER_CLIENTS_ERROR => {
                backend::detach(&app);
            }
            Err(error) => {
                log::warn!("[backend] graceful stop failed ({}); forcing exit", error);
                backend::detach(&app);
            }
        }
        let handle = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = crate::computer_use_runtime::stop(&handle) {
                log::warn!("[computer-use] failed to stop helper: {error}");
            }
        })
        .await;
        app.state::<TrayState>()
            .shutdown_complete
            .store(true, Ordering::SeqCst);
        app.exit(code);
    });
}

/// Last-resort cleanup for exits that never went through [`exit_app`].
///
/// The Dock menu, `osascript ... quit` and — if the Quit menu item could not be
/// replaced — `Cmd+Q` all reach AppKit's `terminate:`, which destroys the event
/// loop directly. The process is already leaving, so blocking here only delays
/// the exit; without it the detached backend would outlive the desktop.
pub(crate) fn finish_exit(app: &tauri::AppHandle) {
    if shutdown_complete(app) {
        return;
    }
    app.state::<TrayState>()
        .quitting
        .store(true, Ordering::SeqCst);
    let cleanup = async {
        match tokio::time::timeout(FINISH_EXIT_TIMEOUT, backend::stop_and_wait(app)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) if error == backend::OTHER_CLIENTS_ERROR => {
                backend::detach(app);
            }
            Ok(Err(error)) => log::warn!("[backend] exit cleanup failed: {error}"),
            Err(_) => log::warn!(
                "[backend] exit cleanup exceeded {}s",
                FINISH_EXIT_TIMEOUT.as_secs()
            ),
        }
    };
    tauri::async_runtime::block_on(cleanup);
    if let Err(error) = crate::computer_use_runtime::stop(app) {
        log::warn!("[computer-use] failed to stop helper: {error}");
    }
    app.state::<TrayState>()
        .shutdown_complete
        .store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::CloseAction;

    #[test]
    fn legacy_background_choice_keeps_the_desktop_shell() {
        let action: CloseAction = serde_json::from_str(r#""quit""#).unwrap();
        assert!(matches!(action, CloseAction::MinimizeToTray));
        assert_eq!(serde_json::to_string(&action).unwrap(), r#""minimize-to-tray""#);
    }

    #[test]
    fn saved_tray_and_stop_service_choices_keep_their_meaning() {
        assert!(matches!(
            serde_json::from_str::<CloseAction>(r#""minimize-to-tray""#).unwrap(),
            CloseAction::MinimizeToTray
        ));
        assert!(matches!(
            serde_json::from_str::<CloseAction>(r#""stop-service""#).unwrap(),
            CloseAction::StopService
        ));
    }
}
