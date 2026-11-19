//! Lightweight native supervisor; desktop windows are clients, never owners.

use fs2::FileExt;
use std::{
    fs::File,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

/// How long the backend gets to finish its own shutdown after `stop-request`
/// before the supervisor terminates its process group.
const STOP_GRACE: Duration = Duration::from_secs(20);
/// How long the backend gets between SIGTERM and SIGKILL.
const TERMINATE_GRACE: Duration = Duration::from_secs(3);
/// How often the supervisor checks for exit and stop requests.
const POLL: Duration = Duration::from_millis(100);

pub(crate) fn run() -> Result<(), String> {
    let directory = PathBuf::from(
        std::env::var_os("QWENPAW_DESKTOP_DAEMON_DIR").ok_or("Missing daemon directory")?,
    );
    let mut arguments = std::env::args_os().skip(2);
    let program = arguments.next().ok_or("Missing backend executable")?;
    let arguments: Vec<_> = arguments.collect();
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("daemon.lock"))
        .map_err(|err| err.to_string())?;
    match lock.try_lock_exclusive() {
        Ok(()) => {}
        Err(err) if err.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            return Ok(())
        }
        Err(err) => return Err(err.to_string()),
    }
    let stop_request = directory.join("stop-request");
    let force_stop = directory.join("force-stop");
    // Requests from a previous supervisor must not affect this one.
    for request in [&stop_request, &force_stop] {
        if request.exists() {
            std::fs::remove_file(request).map_err(|err| err.to_string())?;
        }
    }
    let installation = PathBuf::from(
        std::env::var_os("QWENPAW_DESKTOP_INSTALLATION_DIR")
            .ok_or("Missing desktop installation directory")?,
    );
    let _registration =
        crate::updates::coordination::register(&installation, directory.clone(), true)?;
    let mut failures = 0u32;
    loop {
        while crate::updates::coordination::maintenance(&installation)? {
            if stopping(&stop_request, &force_stop) {
                return Ok(());
            }
            std::thread::sleep(POLL);
        }
        if stopping(&stop_request, &force_stop) {
            return Ok(());
        }
        let started = Instant::now();
        let mut command = Command::new(&program);
        command.args(&arguments).stdin(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // A dedicated process group lets the supervisor terminate the
            // backend together with the workers it spawned.
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000 | 0x00000200);
        }
        let mut child = command.spawn().map_err(|err| err.to_string())?;
        let status = supervise(&mut child, &stop_request, &force_stop, STOP_GRACE)?;
        if stopping(&stop_request, &force_stop) {
            // The backend is gone; its published runtime must not outlive it.
            let _ = std::fs::remove_file(directory.join("runtime.json"));
            return Ok(());
        }
        // Do not turn a broken installation into an endless restart loop.
        failures = if started.elapsed() >= Duration::from_secs(60) {
            1
        } else {
            failures + 1
        };
        if failures >= 5 {
            return Err(format!(
                "Backend repeatedly exited ({status}); automatic restart stopped"
            ));
        }
        eprintln!("[agent-host] backend exited ({status}); restarting, attempt {failures}");
        std::thread::sleep(Duration::from_secs(1 << (failures - 1)));
        if stopping(&stop_request, &force_stop) {
            return Ok(());
        }
    }
}

fn stopping(stop_request: &Path, force_stop: &Path) -> bool {
    stop_request.exists() || force_stop.exists()
}

/// Wait for the backend, honoring stop requests even when it cannot exit.
///
/// The backend normally stops itself after `stop-request` (written by
/// `/api/runtime/shutdown`). A backend stuck in teardown would otherwise keep
/// this supervisor alive forever, so a grace period and an explicit
/// `force-stop` request both end in termination of the backend process group.
fn supervise(
    child: &mut Child,
    stop_request: &Path,
    force_stop: &Path,
    grace: Duration,
) -> Result<ExitStatus, String> {
    let mut stop_seen: Option<Instant> = None;
    loop {
        if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
            return Ok(status);
        }
        if stop_seen.is_none() && stop_request.exists() {
            stop_seen = Some(Instant::now());
        }
        let forced = force_stop.exists();
        let expired = stop_seen.is_some_and(|started| started.elapsed() >= grace);
        if forced || expired {
            let reason = if forced {
                "force-stop requested"
            } else {
                "graceful shutdown timed out"
            };
            eprintln!("[agent-host] terminating backend: {reason}");
            return match terminate(child)? {
                Some(status) => Ok(status),
                None => Err("Backend did not exit after being terminated".into()),
            };
        }
        std::thread::sleep(POLL);
    }
}

/// Poll for the child exit without blocking stop-request handling.
fn wait_until(child: &mut Child, timeout: Duration) -> Result<Option<ExitStatus>, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        std::thread::sleep(POLL);
    }
}

/// Terminate the backend and the workers it spawned.
#[cfg(unix)]
fn terminate(child: &mut Child) -> Result<Option<ExitStatus>, String> {
    let Ok(pid) = i32::try_from(child.id()) else {
        return Err("Backend pid is out of range".into());
    };
    // The backend is its own process-group leader; signal the group so browser
    // workers do not survive it.
    if unsafe { libc::kill(-pid, libc::SIGTERM) } != 0 {
        let _ = unsafe { libc::kill(pid, libc::SIGTERM) };
    }
    if let Some(status) = wait_until(child, TERMINATE_GRACE)? {
        return Ok(Some(status));
    }
    if unsafe { libc::kill(-pid, libc::SIGKILL) } != 0 {
        let _ = unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    wait_until(child, TERMINATE_GRACE)
}

#[cfg(not(unix))]
fn terminate(child: &mut Child) -> Result<Option<ExitStatus>, String> {
    // The backend's own lifespan shutdown removes the workers it spawned, so
    // terminating it is enough once the graceful window has expired.
    child.kill().map_err(|err| err.to_string())?;
    wait_until(child, TERMINATE_GRACE)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("qwenpaw-supervise-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    /// A backend that ignores the graceful stop request must still be killed,
    /// otherwise quitting the desktop leaves it running in the background.
    #[cfg(unix)]
    #[test]
    fn force_stop_terminates_a_backend_that_cannot_exit() {
        let directory = scratch("force");
        let stop_request = directory.join("stop-request");
        let force_stop = directory.join("force-stop");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 0.05; done")
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(&force_stop, b"instance").unwrap();
        let started = Instant::now();
        let status = supervise(
            &mut child,
            &stop_request,
            &force_stop,
            Duration::from_secs(30),
        )
        .expect("supervisor must terminate the backend");
        assert!(!status.success());
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "force-stop must not wait for the grace period"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// A graceful stop request escalates once the grace period expires.
    #[cfg(unix)]
    #[test]
    fn stop_request_escalates_after_the_grace_period() {
        let directory = scratch("grace");
        let stop_request = directory.join("stop-request");
        let force_stop = directory.join("force-stop");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 0.05; done")
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(&stop_request, b"instance").unwrap();
        let status = supervise(
            &mut child,
            &stop_request,
            &force_stop,
            Duration::from_millis(200),
        )
        .expect("supervisor must terminate the backend");
        assert!(!status.success());
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// A backend that exits on its own is reported without being signalled.
    #[cfg(unix)]
    #[test]
    fn a_backend_that_exits_normally_is_not_terminated() {
        let directory = scratch("graceful");
        let stop_request = directory.join("stop-request");
        let force_stop = directory.join("force-stop");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 0.2; exit 7")
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let status = supervise(
            &mut child,
            &stop_request,
            &force_stop,
            Duration::from_secs(30),
        )
        .expect("supervisor must report the backend exit");
        assert_eq!(status.code(), Some(7));
        let _ = std::fs::remove_dir_all(&directory);
    }
}
