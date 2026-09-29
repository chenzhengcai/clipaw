# -*- coding: utf-8 -*-
"""Voice (Volcengine streaming ASR) plugin entry point.

Registers the plugin's HTTP + WebSocket router under ``/api/qwenpaw-voice``.

The whole point of this plugin is to keep the voice feature *out* of the
upstream tree so merging ``upstream/main`` produces zero conflicts.  See
``docs/customs/voice-transcription.md`` for the full architecture.
"""

# pylint: disable=wrong-import-position

import logging
import sys
from pathlib import Path

# ``qwenpaw plugin install`` execs this file as a plain module (no package),
# so sibling modules are not reachable via package-relative imports unless
# the plugin directory is on sys.path first.
_plugin_dir = str(Path(__file__).resolve().parent)
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)

from qwenpaw.plugins.api import PluginApi  # noqa: E402

from backend.router import build_router  # noqa: E402

logger = logging.getLogger("qwenpaw.voice")


class QwenpawVoicePlugin:
    """Volcengine streaming ASR voice transcription plugin."""

    def register(self, api: PluginApi) -> None:
        """Register the voice HTTP/WS router."""
        logger.info("Registering QwenPaw Voice plugin")
        api.register_http_router(
            build_router(),
            prefix="/qwenpaw-voice",
            tags=["qwenpaw-voice"],
        )
        logger.info("QwenPaw Voice plugin registered")


# The plugin loader requires a module-level ``plugin`` object.
plugin = QwenpawVoicePlugin()
