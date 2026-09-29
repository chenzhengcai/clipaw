# -*- coding: utf-8 -*-
"""HTTP + WebSocket router for the voice plugin.

Exposes everything the voice frontend needs, under the plugin prefix
``/api/qwenpaw-voice`` (registered in ``plugin.py``):

- ``POST /voice-test-connection``  — Volcengine connectivity test
- ``WS   /transcribe/ws``          — streaming transcription
- ``GET  /client-config``          — read persisted client config
- ``PUT  /client-config``          — merge-write client config
- ``GET  /status``                 — whether the plugin is ready to record

These endpoints were moved out of the upstream
``src/qwenpaw/app/routers/workspace.py`` so that file reverts to stock.
"""

import json
import logging

from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect

from .client_config import _read_client_config, _write_client_config
from .volcengine_asr import (
    _get_volcengine_creds_full,
    stream_transcribe_volcengine,
    test_volcengine_connection,
)

logger = logging.getLogger("qwenpaw.voice.router")


def _credentials_ready() -> bool:
    """Whether Volcengine credentials are configured (new or old console)."""
    api_key, _resource_id, app_id, access_token = _get_volcengine_creds_full()
    return bool(api_key or (app_id and access_token))


def build_router() -> APIRouter:
    """Build the voice plugin router (mounted under ``/api/qwenpaw-voice``)."""
    router = APIRouter()

    @router.get(
        "/status",
        summary="Voice plugin status",
        description="Whether Volcengine ASR credentials are configured.",
    )
    async def voice_status() -> dict:
        return {
            "provider": "volcengine_bigmodel",
            "configured": _credentials_ready(),
        }

    @router.post(
        "/voice-test-connection",
        summary="Test Volcengine ASR connectivity",
        description="Test connection to Volcengine BigModel streaming ASR.",
    )
    async def voice_test_connection(body: dict = Body(default={})):
        api_key = body.get("api_key", "")
        resource_id = body.get("resource_id", "")
        return await test_volcengine_connection(api_key, resource_id)

    @router.get("/client-config", summary="Get client configuration")
    async def get_client_config() -> dict:
        """Return persisted client configuration (UI prefs, shortcuts, etc.)."""
        return _read_client_config()

    @router.put("/client-config", summary="Update client configuration")
    async def put_client_config(body: dict = Body(...)) -> dict:
        """Merge a client configuration key-value pair into the config file."""
        current = _read_client_config()
        current.update(body)
        _write_client_config(current)
        return current

    # ── WebSocket: streaming voice transcription ─────────────────────────
    # Protocol (browser → server):
    #   Binary Frame: raw PCM Int16 16kHz mono audio chunk
    #   Text Frame "DONE": recording finished
    #   Text Frame "RESET": discard current ASR session and start fresh
    # Protocol (server → browser):
    #   {"type": "partial", "text": "..."} — intermediate result
    #   {"type": "final", "text": "..."}   — final result
    #   {"type": "error", "message": "..."} — fatal error

    @router.websocket("/transcribe/ws")
    async def transcribe_ws(websocket: WebSocket):
        """Streaming voice transcription via Volcengine ASR."""
        if not _credentials_ready():
            await websocket.accept()
            await websocket.send_text(
                json.dumps(
                    {"type": "error", "message": "Volcengine ASR not configured"},
                    ensure_ascii=False,
                ),
            )
            await websocket.close()
            return

        await websocket.accept()

        async def _send_json(payload: dict) -> None:
            try:
                await websocket.send_text(
                    json.dumps(payload, ensure_ascii=False),
                )
            except Exception:
                pass

        async def _on_text(text: str) -> None:
            await _send_json({"type": "partial", "text": text})

        async def _on_done(text: str) -> None:
            await _send_json({"type": "final", "text": text})

        async def _on_error(msg: str) -> None:
            await _send_json({"type": "error", "message": msg})

        try:
            audio_queue, finish = await stream_transcribe_volcengine(
                on_text=_on_text,
                on_done=_on_done,
                on_error=_on_error,
            )
        except Exception as start_exc:
            await _send_json(
                {"type": "error", "message": f"Failed to start: {start_exc}"},
            )
            return

        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if "text" in msg:
                    if msg["text"] == "DONE":
                        audio_queue.put_nowait(None)
                        break
                    if msg["text"] == "RESET":
                        audio_queue.put_nowait(None)
                        await finish()
                        audio_queue, finish = await stream_transcribe_volcengine(
                            on_text=_on_text,
                            on_done=_on_done,
                            on_error=_on_error,
                        )
                        continue
                    continue
                if "bytes" in msg and msg["bytes"]:
                    audio_queue.put_nowait(msg["bytes"])

            await finish()
        except WebSocketDisconnect:
            logger.debug("WS transcribe: client disconnected")
        except Exception:
            logger.warning("WS transcribe: unexpected error", exc_info=True)
            await _send_json({"type": "error", "message": "Internal server error"})
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    return router
