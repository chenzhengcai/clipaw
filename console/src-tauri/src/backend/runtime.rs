//! Reuse a matching runtime or replace an older one under the launch lock.

use std::{fs::File, path::PathBuf, process::Stdio, time::Duration};

use fs2::FileExt;
use serde::Deserialize;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const TOKEN_HEADER: &str = "X-QwenPaw-Control-Token";

/// How long a quit waits for the backend to finish its own shutdown before the
/// supervisor is asked to terminate it. Healthy shutdowns take a few seconds.
const GRACEFUL_EXIT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long each escalation step waits for the backend lifetime locks to be
/// released. Bounds the time a quit can spend cleaning up.
const FORCED_EXIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Deserialize)]
pub(crate) struct Runtime {
    protocol: u32,
    version: String,
    instance: String,
    token: String,
    pub port: u16,
    mode: String,
    /// Backend PID, published so an unresponsive backend can still be stopped
    /// when its supervisor is gone. Older runtimes do not publish it.
    #[serde(default)]
    pid: Option<u32>,
    #[serde(skip)]
    client_id: String,
    #[serde(skip)]
    directory: PathBuf,
}

impl Runtime {
    pub async fn other_clients(&self) -> Result<usize, String> {
        #[derive(Deserialize)]
        struct Clients {
            other_clients: usize,
        }
        let clients = client()?
            .get(format!(
                "http://127.0.0.1:{}/api/runtime/clients",
                self.port
            ))
            .header(TOKEN_HEADER, &self.token)
            .header("X-QwenPaw-Client", &self.client_id)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map_err(|err| err.to_string())?
            .error_for_status()
            .map_err(|err| err.to_string())?
            .json::<Clients>()
            .await
            .map_err(|err| err.to_string())?;
        Ok(clients.other_clients)
    }

    pub async fn stop(&self) -> Result<File, String> {
        let operation = self.acquire_launch_lock().await?;
        self.stop_locked().await?;
        Ok(operation)
    }

    /// Stop the backend as part of quitting the desktop.
    ///
    /// Unlike [`Runtime::stop`], which trusts a slow but healthy backend, this
    /// escalates when the backend cannot finish its own teardown, so quitting
    /// never leaves an orphaned supervisor or backend behind.
    pub async fn stop_for_exit(&self) -> Result<(), String> {
        self.stop_with_escalation(GRACEFUL_EXIT_TIMEOUT, FORCED_EXIT_TIMEOUT)
            .await
    }

    /// [`Runtime::stop_for_exit`] with explicit escalation timeouts.
    async fn stop_with_escalation(&self, grace: Duration, forced: Duration) -> Result<(), String> {
        let _operation = self.acquire_launch_lock().await?;
        if let Err(error) = self.request_shutdown().await {
            if error == super::OTHER_CLIENTS_ERROR {
                return Err(error);
            }
            // A backend that hung after its own teardown no longer answers.
            log::warn!("[backend] shutdown request failed: {error}");
            match self.other_clients().await {
                // Still reachable and idle: retry once before escalating.
                Ok(0) => {
                    if let Err(retry) = self.request_shutdown().await {
                        if retry == super::OTHER_CLIENTS_ERROR {
                            return Err(retry);
                        }
                    }
                }
                Ok(_) => return Err(super::OTHER_CLIENTS_ERROR.into()),
                Err(_) => {}
            }
        }
        if self.wait_released(grace).await? {
            return Ok(());
        }
        log::warn!(
            "[backend] graceful shutdown exceeded {}ms; terminating the backend",
            grace.as_millis()
        );
        // The supervisor watches this file, so a backend stuck in its own
        // teardown is terminated instead of surviving the desktop.
        let _ = std::fs::write(self.directory.join("force-stop"), &self.instance);
        if self.wait_released(forced).await? {
            return Ok(());
        }
        // The supervisor may be gone already; stop the backend directly. The
        // supervisor launches it as a process-group leader, so the browser
        // workers it spawned go down with it.
        match self.pid {
            Some(pid) if is_backend_process(pid) => {
                log::warn!("[backend] supervisor unresponsive; killing backend pid={pid}");
                terminate_process_group(pid);
            }
            Some(pid) => log::warn!("[backend] published backend pid={pid} is stale"),
            None => log::warn!("[backend] running backend did not publish a pid"),
        }
        if self.wait_released(forced).await? {
            return Ok(());
        }
        Err("The backend did not stop and may still be running".into())
    }

    async fn acquire_launch_lock(&self) -> Result<File, String> {
        let operation = lock_file(self.directory.join("launch.lock"))?;
        let started = std::time::Instant::now();
        while !try_lock(&operation)? {
            if started.elapsed() >= Duration::from_secs(5) {
                return Err("Runtime startup is in progress; try stopping again shortly".into());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(operation)
    }

    async fn request_shutdown(&self) -> Result<(), String> {
        let response = client()?
            .post(format!(
                "http://127.0.0.1:{}/api/runtime/shutdown",
                self.port
            ))
            .header(TOKEN_HEADER, &self.token)
            .header("X-QwenPaw-Client", &self.client_id)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|err| err.to_string())?;
        if response.status() == reqwest::StatusCode::CONFLICT {
            return Err(super::OTHER_CLIENTS_ERROR.into());
        }
        // A stopping server can reject shutdown with 503. Its lifetime
        // locks, not the HTTP response, establish that it has fully exited.
        if response.status() != reqwest::StatusCode::SERVICE_UNAVAILABLE {
            response.error_for_status().map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    /// Wait until both lifetime leases are released.
    ///
    /// A supervisor can have exited while Python is still alive, so both files
    /// must be free before the backend counts as stopped.
    async fn wait_released(&self, timeout: Duration) -> Result<bool, String> {
        let started = std::time::Instant::now();
        loop {
            let daemon = lock_file(self.directory.join("daemon.lock"))?;
            let runtime = lock_file(self.directory.join("runtime.lock"))?;
            if try_lock(&daemon)? && try_lock(&runtime)? {
                return Ok(true);
            }
            if started.elapsed() >= timeout {
                return Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// The caller holds launch.lock throughout shutdown and replacement.
    async fn stop_locked(&self) -> Result<(), String> {
        self.request_shutdown().await?;
        if !self.wait_released(Duration::from_secs(60)).await? {
            return Err("Runtime did not finish shutting down within 60 seconds".into());
        }
        Ok(())
    }
}

/// Terminate the backend process group.
///
/// The supervisor launches the backend with `process_group(0)`, so the backend
/// PID is also the process-group id and signalling the group stops the browser
/// workers the backend spawned.
#[cfg(unix)]
fn terminate_process_group(pid: u32) {
    let Ok(pid) = i32::try_from(pid) else {
        return;
    };
    if unsafe { libc::kill(-pid, libc::SIGKILL) } != 0 {
        let _ = unsafe { libc::kill(pid, libc::SIGKILL) };
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_pid: u32) {}

/// Confirm a published pid still belongs to a backend before signalling it.
///
/// A backend that was killed leaves `runtime.json` behind, and its pid may have
/// been reused, so an unverified `SIGKILL` could hit an unrelated process.
#[cfg(unix)]
fn is_backend_process(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains("qwenpaw")
        })
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_backend_process(_pid: u32) -> bool {
    false
}

/// Wait for a supervisor that is still starting a backend to publish it.
///
/// Quitting while the backend is starting must not leave it running: the
/// desktop waits for the runtime record so it can stop it like any other.
pub(crate) async fn wait_for_runtime(
    directory: &std::path::Path,
    timeout: Duration,
) -> Option<Runtime> {
    let started = std::time::Instant::now();
    loop {
        match Runtime::read(directory) {
            Ok(Some(runtime)) => return Some(runtime),
            // No supervisor and no backend: nothing is starting.
            Ok(None) => return None,
            Err(error) => log::debug!("[backend] runtime is still starting: {error}"),
        }
        if started.elapsed() >= timeout {
            log::warn!("[backend] timed out waiting for the starting runtime");
            return None;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub(super) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(1))
        .build()
        .map_err(|err| err.to_string())
}

pub(crate) fn directory() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Home directory unavailable")?;
    let working = std::env::var("QWENPAW_WORKING_DIR")
        .or_else(|_| std::env::var("COPAW_WORKING_DIR"))
        .ok()
        .filter(|path| !path.is_empty())
        .map(|path| {
            if path == "~" {
                home.clone()
            } else if let Some(rest) = path.strip_prefix("~/") {
                home.join(rest)
            } else {
                PathBuf::from(path)
            }
        })
        .unwrap_or_else(|| {
            let legacy = home.join(".copaw");
            if legacy.exists() {
                legacy
            } else {
                home.join(".qwenpaw")
            }
        });
    std::fs::create_dir_all(&working).map_err(|err| {
        format!(
            "Cannot create working directory {}: {err}",
            working.display()
        )
    })?;
    let directory = working
        .canonicalize()
        .map_err(|err| {
            format!(
                "Cannot resolve working directory {}: {err}",
                working.display()
            )
        })?
        .join("runtime")
        .join("shared");
    std::fs::create_dir_all(&directory).map_err(|err| {
        format!(
            "Cannot create shared runtime directory {}: {err}",
            directory.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).map_err(
            |err| {
                format!(
                    "Cannot set shared runtime permissions {}: {err}",
                    directory.display()
                )
            },
        )?;
    }
    Ok(directory)
}

fn lock_file(path: PathBuf) -> Result<File, String> {
    File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|err| err.to_string())
}

fn try_lock(file: &File) -> Result<bool, String> {
    match file.try_lock_exclusive() {
        Ok(()) => Ok(true),
        Err(err) if err.raw_os_error() == fs2::lock_contended_error().raw_os_error() => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

pub(super) async fn connect(
    app: &tauri::AppHandle,
) -> Result<(Runtime, reqwest::Response), String> {
    let directory = directory()?;
    let started = std::time::Instant::now();
    // Serializes discovery and startup across desktop processes. The backend
    // separately holds runtime.lock, even if its launching client crashes.
    let launch_lock = lock_file(directory.join("launch.lock"))?;
    while !try_lock(&launch_lock)? {
        if started.elapsed() >= Duration::from_secs(180) {
            return Err("Timed out waiting for runtime startup".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    log::info!(
        "[backend] discovery admitted after {}ms",
        started.elapsed().as_millis()
    );
    let mut launched = false;
    let environment: std::collections::HashMap<_, _> =
        crate::runtime_env::collect(app).into_iter().collect();
    let payload = serde_json::json!({
        "client": "desktop",
        "installation": crate::updates::coordination::installation(app)?,
        "control_port": environment.get("QWENPAW_COMPUTER_USE_CONTROL_PORT").and_then(|port| port.parse::<u16>().ok()),
        "control_token": environment.get("QWENPAW_COMPUTER_USE_CONTROL_TOKEN").cloned().unwrap_or_default(),
    });
    let client = client()?;
    loop {
        if crate::tray::is_quitting(app) {
            return Err("Desktop client is closing".into());
        }
        if started.elapsed() >= Duration::from_secs(180) {
            return Err(format!(
                "Runtime did not become ready; see {}",
                directory.join("launcher.log").display()
            ));
        }
        // An existing runtime may finish exiting while discovery is polling.
        // Launch at most once here, including the interval before its daemon
        // acquires its lifetime lock.
        if !launched {
            crate::updates::coordination::ensure_available(app, &directory)?;
            let runtime_lock = lock_file(directory.join("daemon.lock"))?;
            if try_lock(&runtime_lock)? {
                FileExt::unlock(&runtime_lock).map_err(|err| err.to_string())?;
                let backend_lock = lock_file(directory.join("runtime.lock"))?;
                if try_lock(&backend_lock)? {
                    FileExt::unlock(&backend_lock).map_err(|err| err.to_string())?;
                    launch(app, &directory)?;
                    launched = true;
                }
            }
        }
        if let Ok(bytes) = std::fs::read(directory.join("runtime.json")) {
            if let Ok(mut runtime) = serde_json::from_slice::<Runtime>(&bytes) {
                if runtime.protocol != 1 || runtime.mode != "shared" {
                    return Err("The existing runtime cannot accept shared clients".into());
                }
                let request = client
                    .post(format!(
                        "http://127.0.0.1:{}/api/runtime/connect",
                        runtime.port
                    ))
                    .header(TOKEN_HEADER, &runtime.token)
                    .json(&payload);
                if let Ok(Ok(response)) =
                    tokio::time::timeout(Duration::from_secs(2), request.send()).await
                {
                    if response.status().is_success()
                        && response
                            .headers()
                            .get("X-QwenPaw-Instance")
                            .and_then(|value| value.to_str().ok())
                            == Some(runtime.instance.as_str())
                    {
                        runtime.client_id = response
                            .headers()
                            .get("X-QwenPaw-Client")
                            .and_then(|value| value.to_str().ok())
                            .ok_or("Missing desktop client identity")?
                            .to_owned();
                        runtime.directory = directory.clone();
                        // Release versions are synced from Python by
                        // sync_tauri_version.mjs during packaging.
                        // Development runs mutable Python source and uses the
                        // Cargo placeholder version, not a packaged release.
                        #[cfg(not(debug_assertions))]
                        {
                            let version = semver::Version::parse(&runtime.version)
                                .map_err(|err| format!("Invalid backend version: {err}"))?;
                            let current = &app.package_info().version;
                            let ordering = crate::updates::compare_pep440(&version, current)
                                .ok_or("Unsupported backend or desktop version")?;
                            match ordering {
                                std::cmp::Ordering::Greater => {
                                    return Err(format!(
                                        "A newer QwenPaw backend ({version}) is already running. \
                                         This desktop is {current}. Open or install the newer desktop version."
                                    ));
                                }
                                std::cmp::Ordering::Less => {
                                    if launched {
                                        return Err(format!(
                                            "The bundled backend ({version}) does not match this desktop ({current}). \
                                             Reinstall QwenPaw and retry."
                                        ));
                                    }
                                    log::info!(
                                        "[backend] replacing runtime {version} with {current}"
                                    );
                                    runtime.stop_locked().await?;
                                    drop(response);
                                    launch(app, &directory)?;
                                    launched = true;
                                    continue;
                                }
                                std::cmp::Ordering::Equal => {}
                            }
                        }
                        log::info!(
                            "[backend] shared runtime {} connected after {}ms (launched={launched})",
                            runtime.version,
                            started.elapsed().as_millis()
                        );
                        return Ok((runtime, response));
                    }
                }
            } else if !launched {
                return Err(
                    "Cannot read the running backend version. Quit the old QwenPaw service and retry."
                        .into(),
                );
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn launch(app: &tauri::AppHandle, directory: &std::path::Path) -> Result<(), String> {
    let backend = super::command::create(app)?;
    let mut command =
        std::process::Command::new(std::env::current_exe().map_err(|err| err.to_string())?);
    command
        .arg("--agent-host")
        .arg(backend.get_program())
        .args(backend.get_args());
    if let Some(directory) = backend.get_current_dir() {
        command.current_dir(directory);
    }
    for (key, value) in backend.get_envs() {
        if let Some(value) = value {
            command.env(key, value);
        } else {
            command.env_remove(key);
        }
    }
    command.env("QWENPAW_DESKTOP_DAEMON_DIR", directory);
    command.env(
        "QWENPAW_DESKTOP_INSTALLATION_DIR",
        crate::updates::coordination::installation(app)?,
    );
    let log = File::options()
        .create(true)
        .append(true)
        .open(directory.join("launcher.log"))
        .map_err(|err| err.to_string())?;
    command
        .env(
            "QWENPAW_WORKING_DIR",
            directory
                .parent()
                .and_then(|path| path.parent())
                .ok_or("Missing data directory")?,
        )
        .env("QWENPAW_DESKTOP_APP", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONFAULTHANDLER", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|err| err.to_string())?))
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        // Detached console and breakaway prevent the launching shell's job or
        // console teardown from terminating a runtime used by other clients.
        command.creation_flags(0x00000008 | 0x00000200 | 0x01000000);
    }
    let child = command.spawn();
    #[cfg(windows)]
    let child = child.or_else(|error| {
        if error.raw_os_error() != Some(5) {
            return Err(error);
        }
        // Some launchers forbid job breakaway. The daemon can still outlive
        // its window, but remains subject to that launcher's job lifetime.
        log::warn!("[backend] detached launch denied; retrying without job breakaway");
        command.creation_flags(0x00000008 | 0x00000200).spawn()
    });
    let mut child = child.map_err(|err| format!("Cannot launch shared runtime: {err}"))?;
    log::info!("[backend] launched shared runtime pid={}", child.id());
    std::thread::spawn(move || {
        if let Err(err) = child.wait() {
            log::warn!("[backend] could not reap runtime launcher: {err}");
        }
    });
    Ok(())
}

impl Runtime {
    pub(crate) fn read(directory: &std::path::Path) -> Result<Option<Self>, String> {
        if try_lock(&lock_file(directory.join("daemon.lock"))?)?
            && try_lock(&lock_file(directory.join("runtime.lock"))?)?
        {
            return Ok(None);
        }
        let bytes = std::fs::read(directory.join("runtime.json")).map_err(|e| e.to_string())?;
        let mut runtime: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if runtime.mode != "shared" || runtime.protocol != 1 {
            return Err("The existing runtime cannot coordinate an update".into());
        }
        runtime.directory = directory.to_path_buf();
        Ok(Some(runtime))
    }

    pub(crate) fn uses_directory(&self, directory: &std::path::Path) -> bool {
        self.directory == directory
    }

    pub(crate) async fn check_update_clients(&self, installation: &str) -> Result<(), String> {
        #[derive(Deserialize)]
        struct Client {
            client: String,
            installation: String,
        }
        #[derive(Deserialize)]
        struct Clients {
            clients: Vec<Client>,
        }
        let clients: Clients = client()?
            .get(format!(
                "http://127.0.0.1:{}/api/runtime/clients",
                self.port
            ))
            .header(TOKEN_HEADER, &self.token)
            .header("X-QwenPaw-Client", &self.client_id)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if clients
            .clients
            .iter()
            .any(|c| c.client != "desktop" || c.installation != installation)
        {
            return Err(
                "QwenPaw is connected to another app. Disconnect it before updating.".into(),
            );
        }
        Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn mark_update(&self, installation: &std::path::Path) -> Result<(), String> {
        std::fs::write(
            self.directory.join("update-installation"),
            installation.to_string_lossy().as_bytes(),
        )
        .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::Runtime;
    use std::path::Path;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    fn parse(json: &str) -> Runtime {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn published_runtime_exposes_the_backend_pid() {
        let runtime = parse(
            r#"{"protocol":1,"version":"2.3.1","instance":"i","token":"t",
                "port":50013,"mode":"shared","pid":4242}"#,
        );
        assert_eq!(runtime.pid, Some(4242));
    }

    /// Runtimes published by older builds carry no pid and must stay usable.
    #[test]
    fn runtime_records_without_a_pid_still_deserialize() {
        let runtime = parse(
            r#"{"protocol":1,"version":"2.3.1","instance":"i","token":"t",
                "port":50013,"mode":"shared"}"#,
        );
        assert_eq!(runtime.pid, None);
    }

    #[test]
    fn a_pid_that_is_not_a_backend_is_not_signalled() {
        // Guards the last-resort kill against a reused pid.
        assert!(!super::is_backend_process(u32::MAX - 1));
    }

    /// The fake backend publishes itself, holds the lifetime lock, and either
    /// exits on the shutdown request or waits for the supervisor's force-stop.
    const FAKE_BACKEND: &str = r#"
import fcntl, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer

directory, mode = sys.argv[1], sys.argv[2]
lock = open(os.path.join(directory, "runtime.lock"), "a+b")
fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")
        if mode == "exit":
            threading.Timer(0.05, os._exit, (0,)).start()

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
with open(os.path.join(directory, "runtime.json"), "w") as stream:
    json.dump(
        {
            "protocol": 1,
            "version": "9.9.9",
            "instance": "test-instance",
            "token": "test-token",
            "port": server.server_address[1],
            "mode": "shared",
            "pid": os.getpid(),
        },
        stream,
    )
print("ready", flush=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
while not os.path.exists(os.path.join(directory, "force-stop")):
    time.sleep(0.02)
os._exit(0)
"#;

    fn scratch(name: &str) -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("qwenpaw-runtime-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn start_backend(directory: &Path, mode: &str) -> Option<Child> {
        let script = directory.join("fake_backend.py");
        std::fs::write(&script, FAKE_BACKEND).unwrap();
        let child = Command::new("python3")
            .arg(&script)
            .arg(directory)
            .arg(mode)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if directory.join("runtime.json").exists() {
                return Some(child);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }

    /// A backend that finishes its own teardown needs no escalation.
    #[test]
    fn quitting_stops_a_healthy_backend_without_killing_it() {
        let directory = scratch("graceful");
        let Some(mut child) = start_backend(&directory, "exit") else {
            eprintln!("python3 unavailable; skipping");
            return;
        };
        let runtime = Runtime::read(&directory).unwrap().expect("published");
        let result = tauri::async_runtime::block_on(
            runtime.stop_with_escalation(Duration::from_secs(5), Duration::from_secs(5)),
        );
        assert!(result.is_ok(), "{result:?}");
        assert!(!directory.join("force-stop").exists());
        assert!(child.wait().is_ok());
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// A backend that hangs after its shutdown request must still be stopped,
    /// otherwise quitting leaves it running in the background.
    #[test]
    fn quitting_forces_a_hung_backend_to_stop() {
        let directory = scratch("hung");
        let Some(mut child) = start_backend(&directory, "hang") else {
            eprintln!("python3 unavailable; skipping");
            return;
        };
        let runtime = Runtime::read(&directory).unwrap().expect("published");
        let started = Instant::now();
        let result = tauri::async_runtime::block_on(
            runtime.stop_with_escalation(Duration::from_millis(200), Duration::from_secs(5)),
        );
        assert!(result.is_ok(), "{result:?}");
        assert!(
            directory.join("force-stop").exists(),
            "the hung backend must be force-stopped"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(child.wait().is_ok());
        let _ = std::fs::remove_dir_all(&directory);
    }
}
