# -*- coding: utf-8 -*-
"""Tauri sidecar entry point for starting the Python backend."""
from __future__ import annotations

from collections.abc import Sequence
import json
import logging
import multiprocessing as mp
import os
import socket
import sys

import click

from qwenpaw.tauri.env import (
    DESKTOP_APP_ENV,
    DESKTOP_CORS_ORIGINS_ENV,
    DESKTOP_READY_PREFIX,
    ensure_desktop_cors_origins,
)
from qwenpaw.tauri.sidecar_logging import install_sidecar_logging

logger = logging.getLogger(__name__)


def _ensure_qwenpaw_app_not_loaded() -> None:
    if "qwenpaw.app._app" in sys.modules:
        raise RuntimeError(
            "qwenpaw app imported before desktop CORS origins were set",
        )


def _sync_loaded_qwenpaw_constant_cors_origins() -> None:
    constant_module = sys.modules.get("qwenpaw.constant")
    if constant_module is not None:
        constant_module.CORS_ORIGINS = os.environ.get(
            DESKTOP_CORS_ORIGINS_ENV,
            "",
        ).strip()


def _ensure_utf8_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _install_certifi_env() -> None:
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi
    except Exception:
        logger.debug(
            "certifi is unavailable; leaving SSL bundle env unset",
            exc_info=True,
        )
        return

    cert_file = certifi.where()
    if not cert_file or not os.path.isfile(cert_file):
        logger.debug(
            "certifi returned an invalid certificate path: %r",
            cert_file,
        )
        return
    os.environ.setdefault("SSL_CERT_FILE", cert_file)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", cert_file)
    os.environ.setdefault("CURL_CA_BUNDLE", cert_file)


def _install_desktop_runtime() -> None:
    os.environ.setdefault(DESKTOP_APP_ENV, "1")
    # Must run before importing the FastAPI app: it applies CORS middleware
    # from qwenpaw.constant.CORS_ORIGINS at import time.
    _ensure_qwenpaw_app_not_loaded()
    ensure_desktop_cors_origins()
    _sync_loaded_qwenpaw_constant_cors_origins()


def _run_click_command(
    command: click.Command,
    args: Sequence[str],
    label: str,
) -> None:
    try:
        command.main(args=args, standalone_mode=False)
    except click.ClickException as exc:
        message = f"desktop {label} failed: {exc.format_message()}"
        print(message, file=sys.stderr)
        raise RuntimeError(message) from exc
    except click.Abort as exc:
        message = f"desktop {label} aborted"
        print(message, file=sys.stderr)
        raise RuntimeError(message) from exc
    except SystemExit as exc:
        if exc.code in (None, 0):
            return
        message = f"desktop {label} exited with code {exc.code}"
        print(message, file=sys.stderr)
        raise RuntimeError(message) from exc


def _emit_backend_ready(port: int) -> None:
    payload = json.dumps({"port": port}, separators=(",", ":"))
    print(f"{DESKTOP_READY_PREFIX} {payload}", flush=True)


def _load_saved_port(port_file: str) -> int | None:
    """Read the last-used port from the port file, if it exists."""
    try:
        with open(port_file, "r") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def _save_port(port_file: str, port: int) -> None:
    """Persist the port for reuse on next launch."""
    os.makedirs(os.path.dirname(port_file), exist_ok=True)
    with open(port_file, "w") as f:
        f.write(str(port))


def _bind_port(
    host: str,
    preferred: int | None,
    port_file: str,
) -> socket.socket:
    """Bind to *preferred* port, falling back to random if unavailable."""
    import uvicorn

    config = uvicorn.Config(
        "qwenpaw.app._app:app",
        host=host,
        port=preferred or 0,
        reload=False,
        workers=1,
    )
    sock = config.bind_socket()
    actual = _socket_port(sock)
    if preferred is not None and actual != preferred:
        logger.info(
            "Saved port %d is in use, using port %d instead",
            preferred,
            actual,
        )
        # Remove stale port so we don't keep trying it
        try:
            os.unlink(port_file)
        except OSError:
            pass
    return sock


def _run_backend_server(log_level: str) -> None:
    import uvicorn

    from qwenpaw.config.utils import write_last_api
    from qwenpaw.constant import LOG_LEVEL_ENV, WORKING_DIR
    from qwenpaw.utils.logging import (
        SuppressPathAccessLogFilter,
        setup_logger,
    )

    host = "127.0.0.1"
    normalized_log_level = log_level.lower()
    if normalized_log_level not in {
        "critical",
        "error",
        "warning",
        "info",
        "debug",
        "trace",
    }:
        normalized_log_level = "info"

    os.environ[LOG_LEVEL_ENV] = normalized_log_level
    os.environ.pop("QWENPAW_RELOAD_MODE", None)
    setup_logger(normalized_log_level)
    if normalized_log_level in ("debug", "trace"):
        from qwenpaw.cli.main import log_init_timings

        log_init_timings()

    logging.getLogger("uvicorn.access").addFilter(
        SuppressPathAccessLogFilter(["/console/push-messages"]),
    )

    # Try to reuse the port from the last session
    port_file = os.path.join(
        str(WORKING_DIR), ".qwenpaw", "desktop-port.txt",
    )
    preferred = _load_saved_port(port_file)

    backend_socket = _bind_port(host, preferred, port_file)
    try:
        port = _socket_port(backend_socket)
        _save_port(port_file, port)
        write_last_api(host, port)
        _emit_backend_ready(port)
        uvicorn.Server(
            uvicorn.Config(
                "qwenpaw.app._app:app",
                host=host,
                reload=False,
                workers=1,
                log_level=normalized_log_level,
            ),
        ).run(sockets=[backend_socket])
    except Exception:
        backend_socket.close()
        raise


def _socket_port(sock: socket.socket) -> int:
    address = sock.getsockname()
    if not isinstance(address, tuple) or len(address) < 2:
        raise RuntimeError(f"unexpected backend socket address: {address!r}")
    return int(address[1])


def main() -> None:
    _ensure_utf8_stdio()
    _install_desktop_runtime()

    from qwenpaw.constant import LOG_LEVEL_ENV, WORKING_DIR

    install_sidecar_logging(WORKING_DIR / "desktop.log")
    _install_certifi_env()

    # Auto-initialize if no config exists
    config_path = WORKING_DIR / "config.json"
    if not config_path.exists():
        from qwenpaw.cli.init_cmd import init_cmd

        _run_click_command(
            init_cmd,
            args=["--defaults", "--accept-security"],
            label="initialization",
        )

    _run_backend_server(os.environ.get(LOG_LEVEL_ENV, "info"))


if __name__ == "__main__":
    mp.freeze_support()
    main()
