//! Native desktop client for a shared, independently owned Agent Host.

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use futures_util::StreamExt;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

mod command;
pub(crate) mod daemon;
pub(crate) mod runtime;
mod status;

use status::{Phase, Snapshot, Status};

pub(crate) const OTHER_CLIENTS_ERROR: &str =
    "Other clients are still using QwenPaw. Close them before stopping the service.";

#[derive(Default)]
pub(crate) struct BackendState {
    connection: Mutex<Option<tokio::task::JoinHandle<()>>>,
    runtime: Mutex<Option<runtime::Runtime>>,
    generation: AtomicU64,
    stopping: AtomicBool,
    lifecycle: tokio::sync::Mutex<()>,
    status: Status,
}

impl BackendState {
    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    fn detach(&self) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(connection) = self
            .connection
            .lock()
            .expect("backend connection poisoned")
            .take()
        {
            connection.abort();
        }
        generation
    }
}

#[tauri::command]
pub(crate) fn agent_host_state(state: tauri::State<'_, BackendState>) -> Snapshot {
    state.status.snapshot()
}

/// Retry rediscovers a matching runtime, replacing only an older version.
#[tauri::command]
pub(crate) async fn restart_backend(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendState>();
    let _operation = state.lifecycle.lock().await;
    attach(&app).await
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(
        tauri_plugin_log::Builder::default()
            .clear_targets()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir {
                    file_name: Some("qwenpaw-desktop".into()),
                }),
            ])
            .level(desktop_log_level())
            .build(),
    )?;
    if let Err(err) = crate::computer_use_runtime::prepare(app.handle()) {
        log::warn!("[computer-use] control endpoint unavailable: {err}");
    }
    let app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = restart_backend(app).await {
            log::error!("[backend] connection failed: {err}");
        }
    });
    Ok(())
}

/// Closing this native client releases its connection, not the shared server.
pub(crate) fn detach(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    let generation = state.detach();
    state
        .status
        .publish(app, generation, Phase::Stopped, None, None);
}

pub(crate) fn console_port(app: &tauri::AppHandle) -> Option<u16> {
    app.state::<BackendState>()
        .runtime
        .lock()
        .expect("backend runtime poisoned")
        .as_ref()
        .map(|runtime| runtime.port)
}

pub(crate) async fn other_clients(app: &tauri::AppHandle) -> Result<usize, String> {
    let runtime = app
        .state::<BackendState>()
        .runtime
        .lock()
        .expect("backend runtime poisoned")
        .clone();
    match runtime {
        Some(runtime) => runtime.other_clients().await,
        None => Ok(0),
    }
}

/// This is an explicit global operation, never part of ordinary client exit.
pub(crate) async fn stop_and_wait(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendState>();
    let _operation = state.lifecycle.lock().await;
    let runtime = state
        .runtime
        .lock()
        .expect("backend runtime poisoned")
        .clone();
    let runtime = runtime.ok_or("No connected runtime to stop")?;
    state.stopping.store(true, Ordering::SeqCst);
    let generation = state.generation.load(Ordering::SeqCst);
    state
        .status
        .publish(app, generation, Phase::Stopping, Some(runtime.port), None);
    let result = runtime.stop().await.map(|_| ());
    state.stopping.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => detach(app),
        Err(error) if error == OTHER_CLIENTS_ERROR => {
            state
                .status
                .publish(app, generation, Phase::Ready, Some(runtime.port), None)
        }
        Err(error) => {
            state
                .status
                .publish(app, generation, Phase::Failed, None, Some(error.clone()))
        }
    }
    result
}

async fn connect(
    app: &tauri::AppHandle,
    generation: u64,
) -> Result<(runtime::Runtime, reqwest::Response), String> {
    let state = app.state::<BackendState>();
    let mut waiting = false;
    loop {
        if !state.is_current(generation) || crate::tray::is_quitting(app) {
            return Err("Desktop client is closing".into());
        }
        match runtime::connect(app).await {
            Err(error) if error == crate::updates::coordination::UPDATING => {
                if !waiting {
                    state
                        .status
                        .publish(app, generation, Phase::Stopping, None, None);
                    waiting = true;
                }
                // runtime::connect released the launch lock. Cancellation or
                // a failed update can now unblock us without a manual retry.
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            result => return result,
        }
    }
}

async fn attach(app: &tauri::AppHandle) -> Result<(), String> {
    if crate::tray::is_quitting(app) {
        return Err("Desktop client is closing".into());
    }
    let state = app.state::<BackendState>();
    let generation = state.detach();
    state
        .status
        .publish(app, generation, Phase::Starting, None, None);
    let (runtime, response) = match connect(app, generation).await {
        Ok(connection) => connection,
        Err(message) => {
            if state.is_current(generation) {
                state
                    .status
                    .publish(app, generation, Phase::Failed, None, Some(message.clone()));
            }
            return Err(message);
        }
    };
    if !state.is_current(generation) || crate::tray::is_quitting(app) {
        return Ok(());
    }
    let port = runtime.port;
    *state.runtime.lock().expect("backend runtime poisoned") = Some(runtime);
    state
        .status
        .publish(app, generation, Phase::Ready, Some(port), None);
    let handle = app.clone();
    let connection = tokio::spawn(async move {
        let mut response = response;
        loop {
            let mut stream = response.bytes_stream();
            while let Ok(Some(Ok(_))) =
                tokio::time::timeout(Duration::from_secs(15), stream.next()).await
            {}
            let state = handle.state::<BackendState>();
            if !state.is_current(generation) || state.stopping.load(Ordering::SeqCst) {
                return;
            }
            state
                .status
                .publish(&handle, generation, Phase::Starting, None, None);
            match connect(&handle, generation).await {
                Ok((runtime, connected)) if state.is_current(generation) => {
                    state.status.publish(
                        &handle,
                        generation,
                        Phase::Ready,
                        Some(runtime.port),
                        None,
                    );
                    *state.runtime.lock().expect("backend runtime poisoned") = Some(runtime);
                    response = connected;
                }
                Ok(_) => return,
                Err(error) => {
                    if state.is_current(generation) {
                        state
                            .status
                            .publish(&handle, generation, Phase::Failed, None, Some(error));
                    }
                    return;
                }
            }
        }
    });
    *state
        .connection
        .lock()
        .expect("backend connection poisoned") = Some(connection);
    Ok(())
}

/// Force-kills the sidecar process tree immediately, bypassing the graceful
/// HTTP shutdown. Used by the detached exit thread when the bounded graceful
/// wait elapses, so the sidecar (and, on macOS, its child processes) do not
/// linger as orphans after the desktop window closes.
///
/// On macOS the sidecar's browser-worker children (Chrome/Playwright) are
/// independent processes that survive a bare `child.kill()`. We walk the
/// process tree with `pgrep`/`kill` to reap them. On Windows the Job Object
/// assigned to the Computer Use helper already reaps that subtree; the
/// sidecar's own children are cleaned up by the backend lifespan, so here we
/// only kill the recorded sidecar child.
pub(crate) fn force_kill_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    let pid = state.with_inner(|inner| inner.child.as_ref().map(|child| child.pid()));

    // On macOS, collect the process tree *before* killing the root. Once the
    // root exits, its children are re-parented to launchd (PID 1) and
    // `pgrep -P <root>` returns nothing, so the browser-worker orphans we are
    // trying to reap would be missed. We SIGTERM the descendants first, kill
    // the root, then SIGKILL any survivors.
    #[cfg(target_os = "macos")]
    let descendants = pid.map(kill_process_tree_macos).unwrap_or_default();

    state.force_kill();
    // Reset the full backend state (not just the child handle) so a subsequent
    // `restart_backend` does not hit `StopPlan::Wait` on a stale `terminated`
    // receiver left behind by an interrupted `stop_and_wait`.
    state.finish_stop();

    // Reap survivors that were collected before the root was killed.
    #[cfg(target_os = "macos")]
    {
        for child_pid in &descendants {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &child_pid.to_string()])
                .output();
        }
    }
}

fn desktop_log_level() -> log::LevelFilter {
    if std::env::var("QWENPAW_DESKTOP_DEBUG").is_ok_and(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    }) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    }
}

pub(crate) fn runtime_for_update(
    app: &tauri::AppHandle,
    directory: &std::path::Path,
) -> Result<Option<runtime::Runtime>, String> {
    let state = app.state::<BackendState>();
    if let Some(runtime) = state
        .runtime
        .lock()
        .expect("backend runtime poisoned")
        .as_ref()
    {
        if runtime.uses_directory(directory) {
            return Ok(Some(runtime.clone()));
        }
    }
    runtime::Runtime::read(directory)
}

pub(crate) fn suspend_for_update(app: &tauri::AppHandle) {
    app.state::<BackendState>()
        .stopping
        .store(true, Ordering::SeqCst);
}

pub(crate) async fn recover_after_update(app: &tauri::AppHandle) {
    if !app
        .state::<BackendState>()
        .stopping
        .swap(false, Ordering::SeqCst)
    {
        return;
    }
    if let Err(error) = crate::computer_use_runtime::prepare(app) {
        log::warn!("[updates] Computer Use recovery failed: {error}");
    }
    if let Err(error) = restart_backend(app.clone()).await {
        log::warn!("[updates] runtime recovery failed: {error}");
    }
}

/// Collects and SIGTERMs the process tree rooted at `root_pid` on macOS,
/// returning the collected descendant PIDs so the caller can SIGKILL any
/// survivors after killing the root.
///
/// The Tauri shell spawns the Python sidecar as an independent process. When
/// the sidecar is force-killed, its child processes (Chrome/Playwright browser
/// workers spawned by the backend) are orphaned and keep running because macOS
/// does not link child lifetime to parent. This walks the tree with `pgrep -P`
/// and sends SIGTERM to every descendant, so the user does not end up with
/// ghost `qwenpaw-backend` / Chrome processes after quitting.
///
/// Must be called *before* killing `root_pid`, because macOS re-parents
/// orphans to launchd (PID 1) once the root exits, making `pgrep -P` return
/// nothing.
#[cfg(target_os = "macos")]
fn kill_process_tree_macos(root_pid: u32) -> Vec<u32> {
    use std::collections::HashSet;
    use std::process::Command;

    /// Recursively collect all descendant PIDs of `pid` via `pgrep -P`.
    /// A `visited` set guards against cycles and duplicate entries from
    /// shared-parent processes.
    fn collect_descendants(pid: u32, visited: &mut HashSet<u32>) -> Vec<u32> {
        let output = match Command::new("pgrep")
            .args(["-P", &pid.to_string()])
            .output()
        {
            Ok(output) => output,
            Err(err) => {
                log::debug!("[backend] pgrep -P {pid} failed: {err}");
                return Vec::new();
            }
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let children: Vec<u32> = text
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .filter(|child| visited.insert(*child))
            .collect();
        let mut all = Vec::new();
        for child in children {
            all.extend(collect_descendants(child, visited));
            all.push(child);
        }
        all
    }

    let mut visited = HashSet::new();
    let descendants = collect_descendants(root_pid, &mut visited);
    if descendants.is_empty() {
        return Vec::new();
    }

    log::info!(
        "[backend] SIGTERM {} descendant process(es) on macOS",
        descendants.len()
    );

    // SIGTERM descendants so they can flush state; the caller SIGKILLs
    // survivors after killing the root.
    for pid in &descendants {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }

    descendants
}
