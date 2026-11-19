# -*- coding: utf-8 -*-
"""Authenticated-by-origin HTTP and bounded WebSocket voice routes."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect

from .client_config import _read_client_config, _write_client_config
from .sessions import register, unregister
from .volcengine_asr import (
    _get_volcengine_creds_full,
    stream_transcribe_volcengine,
    test_volcengine_connection,
)

logger = logging.getLogger("qwenpaw.voice.router")
_MAX_AUDIO_BYTES = 20 * 1024 * 1024
_TAURI_ORIGINS = {
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
}


def _credentials_ready() -> bool:
    api_key, _resource_id, app_id, access_token = _get_volcengine_creds_full()
    return bool(api_key or (app_id and access_token))


def _loopback(hostname: str | None) -> bool:
    if hostname == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname or "").is_loopback
    except ValueError:
        return False


def _origin_allowed(origin: str | None, request_host: str) -> bool:
    """Reject cross-site browser WebSockets before accepting the socket.

    Native local clients may omit Origin. Browser origins must match the
    request host, be an explicit loopback development origin, or be Tauri.
    """
    if not origin:
        return True
    try:
        parsed = urlsplit(origin)
        host = urlsplit(f"//{request_host}").hostname
        if parsed.scheme not in {"http", "https", "tauri"} or not parsed.hostname:
            return False
        if origin.lower().rstrip("/") in _TAURI_ORIGINS:
            return True
        if parsed.netloc.lower() == request_host.lower():
            return True
        return _loopback(parsed.hostname) and _loopback(host)
    except ValueError:
        return False


def build_router() -> APIRouter:
    router = APIRouter()

    @router.get("/status")
    async def voice_status() -> dict:
        return {
            "provider": "volcengine_bigmodel",
            "configured": _credentials_ready(),
        }

    @router.post("/voice-test-connection")
    async def voice_test_connection(body: dict = Body(default={})):
        return await test_volcengine_connection(
            body.get("api_key", ""), body.get("resource_id", ""),
        )

    @router.get("/client-config")
    async def get_client_config() -> dict:
        return _read_client_config()

    @router.put("/client-config")
    async def put_client_config(body: dict = Body(...)) -> dict:
        current = _read_client_config()
        current.update(body)
        _write_client_config(current)
        return current

    @router.websocket("/transcribe/ws")
    async def transcribe_ws(websocket: WebSocket):
        if not _origin_allowed(
            websocket.headers.get("origin"), websocket.headers.get("host", "")
        ):
            await websocket.close(code=1008)
            return
        if not _credentials_ready():
            await websocket.accept()
            await websocket.send_text(
                json.dumps({"type": "error", "message": "ASR not configured"}),
            )
            await websocket.close()
            return

        await websocket.accept()

        async def _send_json(payload: dict) -> None:
            try:
                await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            except Exception:
                pass

        try:
            audio_queue, finish = await stream_transcribe_volcengine(
                on_text=lambda text: _send_json({"type": "partial", "text": text}),
                on_done=lambda text: _send_json({"type": "final", "text": text}),
                on_error=lambda message: _send_json(
                    {"type": "error", "message": message}
                ),
            )
        except Exception as start_exc:
            await _send_json({"type": "error", "message": f"Failed to start: {start_exc}"})
            await websocket.close()
            return

        register(websocket, finish)
        graceful = False
        total_audio_bytes = 0
        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if "text" in msg:
                    command = msg["text"]
                    if command == "DONE":
                        await audio_queue.put(None)
                        graceful = True
                        break
                    if command == "RESET":
                        await audio_queue.put(None)
                        await finish(cancel=True)
                        audio_queue, finish = await stream_transcribe_volcengine(
                            on_text=lambda text: _send_json(
                                {"type": "partial", "text": text}
                            ),
                            on_done=lambda text: _send_json(
                                {"type": "final", "text": text}
                            ),
                            on_error=lambda message: _send_json(
                                {"type": "error", "message": message}
                            ),
                        )
                        register(websocket, finish)
                        total_audio_bytes = 0
                    continue
                if "bytes" in msg and msg["bytes"]:
                    total_audio_bytes += len(msg["bytes"])
                    if total_audio_bytes > _MAX_AUDIO_BYTES:
                        await _send_json(
                            {"type": "error", "message": "Audio limit exceeded"}
                        )
                        break
                    try:
                        audio_queue.put_nowait(msg["bytes"])
                    except asyncio.QueueFull:
                        await _send_json(
                            {"type": "error", "message": "Audio queue full"}
                        )
                        break
            if graceful:
                await finish()
                finish = None
        except WebSocketDisconnect:
            logger.debug("Voice client disconnected")
        except Exception:
            logger.warning("Voice WebSocket failed", exc_info=True)
            await _send_json({"type": "error", "message": "Internal server error"})
        finally:
            try:
                if finish is not None:
                    await finish(cancel=not graceful)
            finally:
                unregister(websocket)
                try:
                    await websocket.close()
                except Exception:
                    pass

    return router
