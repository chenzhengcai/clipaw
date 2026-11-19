# -*- coding: utf-8 -*-
"""Atomic persistence for voice-plugin-only client preferences."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger("qwenpaw.voice.client_config")
_CONFIG_FILE: Path | None = None


def _config_file() -> Path:
    global _CONFIG_FILE
    if _CONFIG_FILE is None:
        try:
            from qwenpaw.constant import WORKING_DIR

            base = Path(WORKING_DIR)
        except Exception:
            base = Path(
                os.environ.get("QWENPAW_WORKING_DIR", "~/.qwenpaw")
            ).expanduser()
        _CONFIG_FILE = base / "qwenpaw-voice" / "client-config.json"
    return _CONFIG_FILE


def _read_client_config() -> dict:
    path = _config_file()
    try:
        value = json.loads(path.read_text("utf-8"))
        if isinstance(value, dict):
            return value
        logger.warning("Voice client config is not an object: %s", path)
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        logger.warning("Voice client config is unreadable: %s", path, exc_info=True)
        backup = path.with_suffix(".json.bak")
        try:
            path.replace(backup)
        except OSError:
            pass
    return {}


def _write_client_config(data: dict) -> None:
    path = _config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        dir=path.parent, prefix=".client-config-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
        Path(temporary).replace(path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise
