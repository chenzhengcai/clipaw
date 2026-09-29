# -*- coding: utf-8 -*-
"""Client configuration persistence for the voice plugin.

Solves the Tauri desktop port-change problem: ``localStorage`` is keyed by
origin, so a new port wipes it.  We persist UI preferences (voice shortcut,
connection state, last-used agent, auto-voice config) to a JSON file so they
survive restarts.

Moved verbatim from ``src/qwenpaw/app/routers/workspace.py`` (the fork's
client-config block) so the upstream router reverts to stock.
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("qwenpaw.voice.client_config")

_CLIENT_CONFIG_FILE = Path(
    os.environ.get("QWENPAW_WORKING_DIR", os.path.expanduser("~/.clipaw"))
) / "client-config.json"


def _read_client_config() -> dict:
    try:
        if _CLIENT_CONFIG_FILE.exists():
            return json.loads(_CLIENT_CONFIG_FILE.read_text("utf-8"))
    except Exception:
        pass
    return {}


def _write_client_config(data: dict) -> None:
    try:
        _CLIENT_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CLIENT_CONFIG_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), "utf-8"
        )
    except Exception:
        pass
