//! Fork-owned desktop shutdown orchestration (CliPaw).
//!
//! **Why this module exists (fork divergence note):**
//! Upstream's exit path (`tray.rs::exit_app` + `lib.rs::ExitRequested`) has two
//! unfixed problems as of upstream main 77744172:
//!
//! 1. **Windows quit freeze**: `exit_app` runs `stop_and_wait` (60 s graceful
//!    timeout) *before* `app.exit(0)`, while `ExitRequested` additionally
//!    `block_on(stop_and_wait)`s on the Tauri event loop — the frontend
//!    `invoke("quit_app")` promise never resolves and the window spins for
//!    minutes during sandbox ACL cleanup.
//! 2. **macOS orphan processes**: force-kill only terminates the sidecar root;
//!    Chrome/Playwright browser workers survive as launchd orphans, and
//!    Cmd+Q (`RunEvent::Exit`) has no cleanup at all.
//!
//! This module centralizes the CliPaw fix so that `tray.rs`, `lib.rs`, and
//! `backend.rs` stay as close to upstream as possible (minimizing merge
//! conflict surface). Only the minimal call sites in those files reference
//! `shutdown::*`.
//!
//! Design: "hide the window first, clean up in the background" — the window
//! hides immediately, a detached OS thread performs the bounded graceful
//! shutdown, then force-kills the process tree, and finally terminates the
//! process itself. See `docs/customs/fix-window-close-stuck-and-backend-orphan.md`
//! for the full root-cause analysis.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

use crate::backend;
use crate::tray::{hide_main_window, show_main_window, SHUTDOWN_STARTED_EVENT};

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

/// Maximum time the synchronous `RunEvent::Exit` cleanup waits for the backend
/// sidecar before force-killing it. macOS's `applicationWillTerminate` (which
/// produces `RunEvent::Exit` on Cmd+Q) should return promptly, so this is
/// shorter than the detached thread's 10 s budget.
const EXIT_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Fork-added shutdown state (managed via `.manage()` in `lib.rs`).
///
/// Kept here — not in `tray::TrayState` — so `TrayState` stays byte-identical
/// to upstream and merges cleanly.
#[derive(Default)]
pub(crate) struct ShutdownState {
    /// Set to true once `begin_exit` has started backend shutdown, so the
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

/// Entry point for every "quit the app" path (frontend `quit_app` command,
/// tray Quit menu, macOS Cmd+Q via `lib.rs`).
///
/// Replaces upstream `tray.rs::exit_app`: hides the window immediately and
/// lets a detached OS thread finish backend cleanup, instead of blocking the
/// visible window on the 60 s graceful shutdown.
pub(crate) fn begin_exit(app: &tauri::AppHandle) {
    // Idempotent guard. `begin_exit` can be reached from several sources that
    // race or repeat once `prevent_exit` keeps the process alive on macOS
    // Cmd+Q: a second Cmd+Q, the tray Quit menu, or the frontend `quit_app`
    // command. The first call atomically claims shutdown; later calls return
    // immediately so we never spawn a second shutdown thread or re-show the
    // already-hidden window.
    {
        let state = app.state::<ShutdownState>();
        if state.shutdown_initiated.swap(true, Ordering::SeqCst) {
            return;
        }
    }

    // Keep a visible, non-interactive status while the sidecar finishes its
    // bounded shutdown. This also gives tray-only exits an explicit status.
    show_main_window(app);
    let _ = app.emit_shutdown_started();

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
                    force_kill_sidecar(&app_for_thread);
                    log::logger().flush();
                    std::process::exit(0);
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
                    force_kill_sidecar(&app_for_thread);
                }
            }

            // Now that cleanup is done, exit the process directly. We use
            // `std::process::exit` instead of `app.exit(0)` because the latter
            // fires `ExitRequested`, whose handler would call
            // `join_shutdown_thread` - waiting for *this* thread to finish -
            // while this thread is blocked waiting for `exit(0)` to return.
            // That is a deadlock. `std::process::exit(0)` terminates the
            // process immediately, killing any remaining threads (there should
            // be none besides this one by now).
            log::logger().flush();
            std::process::exit(0);
        });

    match spawn_result {
        Ok(handle) => {
            // Store the handle so `ExitRequested` can join it before letting
            // the process exit, ensuring the thread is not killed mid-cleanup.
            if let Ok(mut guard) = app.state::<ShutdownState>().shutdown_thread.lock() {
                *guard = Some(handle);
            }
        }
        Err(err) => {
            log::error!("[backend] failed to spawn shutdown thread: {err}");
            // Fallback: best-effort inline kill, then exit immediately. The
            // backend_guard will clean up any orphan on next launch.
            force_kill_sidecar(app);
            log::logger().flush();
            std::process::exit(0);
        }
    }

    // Hide the window immediately so the user does not wait for backend
    // cleanup. We do NOT call `app.exit(0)` here - the detached thread does
    // that after cleanup, and the `ExitRequested` handler joins it.
    hide_main_window(app);
}

/// Returns true if `begin_exit` has already started backend shutdown, so the
/// caller can skip a redundant (and event-loop-blocking) `stop_and_wait`.
pub(crate) fn initiated(app: &tauri::AppHandle) -> bool {
    app.state::<ShutdownState>()
        .shutdown_initiated
        .load(Ordering::SeqCst)
}

/// Joins the detached shutdown thread so the process does not exit (killing
/// the thread mid-cleanup) before the sidecar has been stopped. Called from
/// the `ExitRequested` handler when `initiated` is true. The window is
/// already hidden by then, so the user does not see this wait.
///
/// If the join times out (e.g. the thread is hung in an unbounded
/// `child.wait()`), we abandon it and let the process exit; the
/// `backend_guard` reaps any orphan on the next launch.
pub(crate) fn join_shutdown_thread(app: &tauri::AppHandle) {
    let handle = {
        let state = app.state::<ShutdownState>();
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
            force_kill_sidecar(app);
            // Drop the handle without joining - the thread will be killed when
            // the process exits.
            drop(handle);
        }
    }
}

/// Synchronous backend cleanup for OS-initiated exits that bypass
/// `ExitRequested`.
///
/// On macOS, Cmd+Q / app-menu Quit goes through `applicationWillTerminate`
/// -> `Event::LoopDestroyed` -> `RunEvent::Exit`, **not** through
/// `RunEvent::ExitRequested`. The `ExitRequested` handler (where all the
/// detached-thread logic lives) therefore never runs for Cmd+Q, and the
/// process would exit immediately - killing any detached shutdown thread and
/// orphaning the backend sidecar (reparented to launchd, PPID 1). This is the
/// last synchronous chance to stop the sidecar before the process exits.
pub(crate) fn exit_cleanup_blocking(app: &tauri::AppHandle) {
    // Hide the window immediately so the user does not see the UI freeze
    // while we synchronously wait for the backend sidecar to shut down.
    // macOS Cmd+Q reaches here via `applicationWillTerminate`, which blocks
    // the main thread during cleanup; without hiding, the window would
    // appear frozen for 1-2 s.
    hide_main_window(app);

    if initiated(app) {
        // `begin_exit` already spawned a detached shutdown thread; join it so
        // its cleanup finishes before the process exits. The thread calls
        // `std::process::exit(0)` itself when done (terminating the process),
        // so reaching here means it is still running.
        join_shutdown_thread(app);
        return;
    }

    // No prior shutdown was initiated (e.g. direct macOS Cmd+Q). Clean up
    // inline with a bounded timeout, then force-kill the process tree.
    log::info!("[backend] RunEvent::Exit: synchronous backend cleanup");
    crate::computer_use_runtime::stop(app);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build();
    match runtime {
        Ok(rt) => {
            let result = rt.block_on(async {
                tokio::time::timeout(EXIT_CLEANUP_TIMEOUT, backend::stop_and_wait(app)).await
            });
            match result {
                Ok(Ok(())) => log::info!("[backend] graceful shutdown completed on Exit"),
                Ok(Err(err)) => {
                    log::warn!("[backend] graceful shutdown error on Exit: {err}")
                }
                Err(_) => log::warn!(
                    "[backend] graceful shutdown timed out on Exit after {} s; force-killing",
                    EXIT_CLEANUP_TIMEOUT.as_secs()
                ),
            }
        }
        Err(err) => {
            log::error!("[backend] failed to build Exit cleanup runtime: {err}");
        }
    }

    // Always force-kill to reap any survivor and its child process tree.
    force_kill_sidecar(app);
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
///
/// (Moved out of `backend.rs` so that file stays byte-identical to upstream.)
pub(crate) fn force_kill_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<backend::BackendState>();
    let pid = state.sidecar_pid();

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

/// Small helper so the emit call reads like the original tray code without
/// importing `tauri::Emitter` at module top.
trait EmitShutdownStarted {
    fn emit_shutdown_started(&self) -> bool;
}

impl EmitShutdownStarted for tauri::AppHandle {
    fn emit_shutdown_started(&self) -> bool {
        use tauri::Emitter;
        let _ = self.emit(SHUTDOWN_STARTED_EVENT, ());
        true
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
