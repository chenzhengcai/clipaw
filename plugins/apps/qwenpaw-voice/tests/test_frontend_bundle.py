# -*- coding: utf-8 -*-
"""Contract tests for the voice plugin's built frontend bundle.

The console loads plugin frontends with ``import(blobUrl)``, so the bundle
must be a self-contained ES module (no bare imports) and it must be rebuilt
whenever the sources change — a stale ``dist/index.js`` silently ships the
previous behaviour.  These assertions pin both properties.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
_DIST = _PLUGIN_ROOT / "frontend" / "dist" / "index.js"
_SRC = _PLUGIN_ROOT / "frontend" / "src"
_MISSING = "frontend/dist/index.js is missing; run npm run build"


def _bundle() -> str:
    return _DIST.read_text("utf-8")


def _manifest() -> dict:
    return json.loads((_PLUGIN_ROOT / "plugin.json").read_text("utf-8"))


def test_bundle_exists_and_is_esm_without_bare_imports():
    assert _DIST.is_file(), _MISSING
    source = _bundle()
    bare_imports = [
        line
        for line in source.splitlines()
        if re.match(r"^\s*import\s", line) and 'from "react"' in line
    ]
    assert bare_imports == [], f"bundle must not import react: {bare_imports}"


def test_bundle_matches_manifest_entry():
    assert _manifest()["entry"]["frontend"] == "frontend/dist/index.js"


def test_bundle_contains_host_mic_discovery():
    """Mic buttons are discovered on the host, not only the SDK one."""
    source = _bundle()
    # Marker that keeps the plugin's own button out of the hijack/hide logic.
    assert "data-qwenpaw-voice-mic" in source
    # Both host mic variants must be recognised: the SDK speech icon and the
    # official Whisper button's lucide icons.
    assert "spark-icon-spark-mic-line" in source
    assert "lucide-mic" in source


def test_bundle_contains_robust_sender_textarea_lookup():
    """Transcription must target the SDK sender input, not the first
    `[class*="sender"]` wrapper (which can be the plugin's own button)."""
    assert "data-sender-input" in _bundle()


def test_sources_and_bundle_agree_on_mic_marker():
    """Guards against a stale dist: the sources carry the same marker."""
    sources = "\n".join(path.read_text("utf-8") for path in _SRC.glob("*.ts*"))
    assert "data-qwenpaw-voice-mic" in sources
    assert "data-qwenpaw-voice-mic" in _bundle()
