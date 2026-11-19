# -*- coding: utf-8 -*-
"""Volcengine BigModel streaming ASR — self-contained in the voice plugin.

This module was extracted verbatim from
``src/qwenpaw/agents/utils/audio_transcription.py`` so that the Volcengine
streaming capability ships as a plugin and the upstream file reverts to
its stock Whisper-API / local-whisper implementation (zero upstream diff).

Protocol reference: docs/customs/voice-transcription.md
"""

import asyncio
import json as _json
import logging
import os
import shutil
import ssl
import struct
import subprocess
import tempfile
import uuid as _uuid
from typing import Awaitable, Callable, Optional, Tuple

logger = logging.getLogger("qwenpaw.voice.volcengine")

# ------------------------------------------------------------------
# Volcengine BigModel streaming ASR constants
# ------------------------------------------------------------------

_VOLC_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"

# Binary frame header constants
_VOLC_HDR_VERSION = 0b0001  # protocol version 1
_VOLC_HDR_SIZE = 0b0001  # 4 bytes
_VOLC_MSG_FULL_REQUEST = 0b0001  # full client request (with JSON params)
_VOLC_MSG_AUDIO_ONLY = 0b0010  # audio only request
_VOLC_MSG_SERVER_RESP = 0b1001  # full server response
_VOLC_MSG_ERROR = 0b1111  # error from server
_VOLC_FLAG_NO_SEQ = 0b0000  # no sequence number
_VOLC_FLAG_LAST_PKT = 0b0010  # last packet (negative / end marker)
_VOLC_SERIAL_JSON = 0b0001  # JSON serialization
_VOLC_SERIAL_NONE = 0b0000  # no serialization
_VOLC_COMP_NONE = 0b0000  # no compression

# Audio chunk size: 200ms of 16kHz 16bit mono PCM = 6400 bytes
_VOLC_CHUNK_SIZE = 6400
_VOLC_QUEUE_MAX = 50
_VOLC_FINAL_TIMEOUT_S = 25.0


def _build_volc_frame(
    msg_type: int,
    flags: int,
    serial: int,
    payload: bytes,
) -> bytes:
    """Build a Volcengine BigModel binary frame.

    Frame layout (big-endian)::

        4 bytes header | 4 bytes payload_size | payload

    Header layout (4 bytes)::

        Byte 0: [protocol_version:4][header_size:4]
        Byte 1: [message_type:4][flags:4]
        Byte 2: [serialization:4][compression:4]
        Byte 3: reserved
    """
    header = bytearray(4)
    header[0] = (_VOLC_HDR_VERSION << 4) | _VOLC_HDR_SIZE
    header[1] = (msg_type << 4) | flags
    header[2] = (serial << 4) | _VOLC_COMP_NONE
    header[3] = 0x00
    size = struct.pack(">I", len(payload))
    return bytes(header) + size + payload


def _parse_volc_frame(raw: bytes) -> Optional[dict]:
    """Parse one server frame, including gzip and final-frame markers."""
    if len(raw) < 8:
        return None

    header_size = (raw[0] & 0x0F) * 4
    if header_size < 4 or len(raw) < header_size + 4:
        return None
    msg_type = (raw[1] >> 4) & 0x0F
    flags = raw[1] & 0x0F
    compression = raw[2] & 0x0F
    offset = header_size

    if msg_type == _VOLC_MSG_ERROR:
        # Error responses carry code + message size + message directly.
        if len(raw) < offset + 8:
            return None
        error_code = struct.unpack(">I", raw[offset : offset + 4])[0]
        error_size = struct.unpack(">I", raw[offset + 4 : offset + 8])[0]
        offset += 8
        if len(raw) < offset + error_size:
            return None
        error_msg = raw[offset : offset + error_size].decode(
            "utf-8", errors="replace",
        )
        return {"type": "error", "code": error_code, "message": error_msg}

    if msg_type != _VOLC_MSG_SERVER_RESP:
        return None

    sequence = None
    if flags & 0b0001:
        if len(raw) < offset + 4:
            return None
        sequence = struct.unpack(">i", raw[offset : offset + 4])[0]
        offset += 4
    if len(raw) < offset + 4:
        return None
    payload_size = struct.unpack(">I", raw[offset : offset + 4])[0]
    offset += 4
    if payload_size > 2**23 or len(raw) < offset + payload_size:
        return None
    payload = raw[offset : offset + payload_size]

    if compression == 1:
        import gzip

        try:
            payload = gzip.decompress(payload)
        except (OSError, EOFError):
            logger.debug("Volcengine ASR: invalid gzip response")
            return None
    elif compression != 0:
        logger.debug("Volcengine ASR: unsupported compression %d", compression)
        return None

    try:
        data = _json.loads(payload.decode("utf-8"))
    except (_json.JSONDecodeError, UnicodeDecodeError):
        logger.debug("Volcengine ASR: failed to decode response JSON")
        return None
    if not isinstance(data, dict):
        return None
    result = data.get("result", {})
    text = result.get("text", "") if isinstance(result, dict) else ""
    is_final = bool(flags & _VOLC_FLAG_LAST_PKT) or (
        sequence is not None and sequence < 0
    )
    return {"type": "result", "text": text, "is_final": is_final}


def _convert_to_pcm16k(file_path: str) -> str:
    """Convert an audio file to PCM 16kHz 16bit mono via ffmpeg.

    Returns path to a temporary .pcm file.  Caller is responsible for cleanup.
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "ffmpeg is required for Volcengine BigModel ASR. "
            "Install ffmpeg as a system package.",
        )

    out_fd, out_path = tempfile.mkstemp(suffix=".pcm")
    os.close(out_fd)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                file_path,
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                out_path,
            ],
            check=True,
            capture_output=True,
        )
        return out_path
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        logger.warning("ffmpeg conversion failed: %s", stderr[:200])
        if os.path.exists(out_path):
            os.unlink(out_path)
        raise RuntimeError("Audio conversion to PCM failed") from exc


def _build_volcengine_ssl_ctx() -> "ssl.SSLContext":
    """Build a verified TLS context, optionally trusting an enterprise CA."""
    ctx = ssl.create_default_context()
    ca_file = os.environ.get("VOLCENGINE_ASR_CA_FILE")
    if ca_file:
        ctx.load_verify_locations(cafile=ca_file)
    return ctx


def _get_volcengine_creds_full() -> Tuple[str, str, str, str]:
    """Return (api_key, resource_id, app_id, access_token) for Volcengine ASR.

    Reads credentials from the envs store (where the Settings page saves them)
    and falls back to environment variables.  Supports both the new console
    (X-Api-Key) and old console (App-Key + Access-Key) auth formats.
    """
    try:
        from qwenpaw.envs import load_envs
        envs = load_envs()
    except Exception:
        envs = {}

    api_key = (
        envs.get("volcengine_asr_api_key", "")
        or os.environ.get("VOLCENGINE_ASR_API_KEY", "")
    )
    app_id = (
        envs.get("volcengine_asr_app_id", "")
        or os.environ.get("VOLCENGINE_ASR_APP_ID", "")
    )
    access_token = (
        envs.get("volcengine_asr_access_token", "")
        or os.environ.get("VOLCENGINE_ASR_ACCESS_TOKEN", "")
    )
    resource_id = (
        envs.get("volcengine_asr_resource_id", "")
        or os.environ.get("VOLCENGINE_ASR_RESOURCE_ID", "")
        or "volc.bigasr.sauc.duration"
    )
    return api_key, resource_id, app_id, access_token


def _build_volcengine_headers(
    api_key: str, resource_id: str, app_id: str, access_token: str,
) -> dict:
    """Build auth headers for Volcengine ASR WebSocket connection."""
    request_id = str(_uuid.uuid4())
    if app_id and access_token:
        return {
            "X-Api-App-Key": app_id,
            "X-Api-Access-Key": access_token,
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
        }
    return {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": request_id,
        "X-Api-Sequence": "-1",
    }


def _build_volcengine_config_payload() -> bytes:
    """Build the JSON config payload for the full client request frame."""
    params = {
        "user": {"uid": "qwenpaw"},
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": "zh-CN",
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    return _json.dumps(params, ensure_ascii=False).encode("utf-8")


async def _send_volcengine_config(ws) -> None:
    """Send the full client request (JSON config) frame."""
    payload = _build_volcengine_config_payload()
    frame = _build_volc_frame(
        msg_type=_VOLC_MSG_FULL_REQUEST,
        flags=_VOLC_FLAG_NO_SEQ,
        serial=_VOLC_SERIAL_JSON,
        payload=payload,
    )
    await ws.send(frame)


async def _send_volcengine_audio(ws, pcm_data: bytes) -> None:
    """Send all audio chunks followed by the end marker."""
    for i in range(0, len(pcm_data), _VOLC_CHUNK_SIZE):
        chunk = pcm_data[i : i + _VOLC_CHUNK_SIZE]
        frame = _build_volc_frame(
            msg_type=_VOLC_MSG_AUDIO_ONLY,
            flags=_VOLC_FLAG_NO_SEQ,
            serial=_VOLC_SERIAL_NONE,
            payload=chunk,
        )
        await ws.send(frame)

    # Brief pause to let server process audio before end marker
    await asyncio.sleep(0.3)

    # Send end marker (empty payload, last-packet flag)
    last = _build_volc_frame(
        msg_type=_VOLC_MSG_AUDIO_ONLY,
        flags=_VOLC_FLAG_LAST_PKT,
        serial=_VOLC_SERIAL_NONE,
        payload=b"",
    )
    await ws.send(last)


async def test_volcengine_connection(
    api_key: str = "", resource_id: str = ""
) -> dict:
    """Test connectivity to Volcengine BigModel ASR service.

    Accepts optional credentials; if omitted, reads from the envs store.
    Returns ``{"ok": True}`` or ``{"ok": False, "error": "..."}``.
    """
    try:
        import websockets
    except ImportError:
        return {"ok": False, "error": "websockets library not installed"}

    # Use provided credentials, otherwise fall back to envs store
    if api_key:
        resource_id = resource_id or "volc.bigasr.sauc.duration"
    else:
        api_key, resource_id, _, _ = _get_volcengine_creds_full()

    if not api_key:
        return {"ok": False, "error": "No API Key configured"}

    headers = {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": str(_uuid.uuid4()),
        "X-Api-Sequence": "-1",
    }

    try:
        async with websockets.connect(
            _VOLC_WS_URL,
            additional_headers=headers,
            max_size=2**23,
            open_timeout=10,
            ssl=_build_volcengine_ssl_ctx(),
        ) as ws:
            await _send_volcengine_config(ws)

            # Send 200ms of silence as test audio
            silence = b"\x00" * _VOLC_CHUNK_SIZE
            audio_frame = _build_volc_frame(
                msg_type=_VOLC_MSG_AUDIO_ONLY,
                flags=_VOLC_FLAG_NO_SEQ,
                serial=_VOLC_SERIAL_NONE,
                payload=silence,
            )
            await ws.send(audio_frame)

            # Send end marker
            end_frame = _build_volc_frame(
                msg_type=_VOLC_MSG_AUDIO_ONLY,
                flags=_VOLC_FLAG_LAST_PKT,
                serial=_VOLC_SERIAL_NONE,
                payload=b"",
            )
            await ws.send(end_frame)

            # Only a valid non-error server response proves connectivity.
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=8.0)
            except asyncio.TimeoutError:
                return {"ok": False, "error": "Timed out waiting for ASR response"}
            parsed = _parse_volc_frame(raw)
            if parsed is None:
                return {"ok": False, "error": "Invalid ASR response"}
            if parsed["type"] == "error":
                return {
                    "ok": False,
                    "error": f"Server error: {parsed.get('message', 'unknown')}",
                }
            return {"ok": True}

    except Exception as e:
        return {"ok": False, "error": str(e)}


async def stream_transcribe_volcengine(
    *,
    on_text: Callable[[str], Awaitable[None]],
    on_done: Callable[[str], Awaitable[None]],
    on_error: Callable[[str], Awaitable[None]],
) -> Tuple[asyncio.Queue, Callable[[], Awaitable[None]]]:
    """Create a streaming Volcengine BigModel ASR session.

    Returns ``(audio_queue, finish)``:

    - Push raw PCM 16kHz 16bit mono bytes into *audio_queue*.
    - Push ``None`` when recording is done (sends end marker to server).
    - Call ``await finish()`` to clean up after the session.

    *on_text* is called with partial recognition text whenever the
    server sends an update.  *on_done* is called with the final text.
    *on_error* is called on fatal errors.

    The Volcengine WebSocket is opened eagerly so the server is ready
    to receive audio as soon as the first chunk arrives.
    """
    try:
        import websockets
    except ImportError:
        logger.warning("websockets not installed; needed for Volcengine ASR")
        raise RuntimeError("websockets not installed") from None

    api_key, resource_id, app_id, access_token = _get_volcengine_creds_full()
    if not api_key and not (app_id and access_token):
        raise RuntimeError("Volcengine ASR credentials not configured")

    extra_headers = _build_volcengine_headers(
        api_key, resource_id, app_id, access_token,
    )

    audio_queue: asyncio.Queue = asyncio.Queue(maxsize=_VOLC_QUEUE_MAX)

    async def _run():
        """Background task: drive the Volcengine WebSocket."""
        receive_task: Optional[asyncio.Task] = None
        try:
            async with websockets.connect(
                _VOLC_WS_URL,
                additional_headers=extra_headers,
                max_size=2**23,
                open_timeout=20,
                ping_interval=30,
                ssl=_build_volcengine_ssl_ctx(),
            ) as ws:
                await _send_volcengine_config(ws)
                logger.debug("Volcengine streaming: sent full client request")

                full_text = ""
                failed = False

                async def _recv_loop():
                    nonlocal full_text, failed
                    while True:
                        try:
                            raw = await asyncio.wait_for(
                                ws.recv(), timeout=10.0,
                            )
                        except asyncio.TimeoutError:
                            continue
                        except (
                            websockets.exceptions.ConnectionClosedOK,
                            websockets.exceptions.ConnectionClosedError,
                        ):
                            break
                        parsed = _parse_volc_frame(raw)
                        if parsed is None:
                            continue
                        if parsed["type"] == "error":
                            failed = True
                            await on_error(
                                f"ASR error: {parsed.get('message', 'unknown')}",
                            )
                            return
                        text = parsed.get("text", "")
                        if text and text != full_text:
                            full_text = text
                            await on_text(text)
                        if parsed.get("is_final"):
                            return

                receive_task = asyncio.ensure_future(_recv_loop())

                # Feed audio chunks from queue until sentinel
                while True:
                    chunk = await audio_queue.get()
                    if chunk is None:
                        # Recording done — send end marker
                        await asyncio.sleep(0.3)
                        end_frame = _build_volc_frame(
                            msg_type=_VOLC_MSG_AUDIO_ONLY,
                            flags=_VOLC_FLAG_LAST_PKT,
                            serial=_VOLC_SERIAL_NONE,
                            payload=b"",
                        )
                        await ws.send(end_frame)
                        logger.debug("Volcengine streaming: sent end marker")
                        break

                    frame = _build_volc_frame(
                        msg_type=_VOLC_MSG_AUDIO_ONLY,
                        flags=_VOLC_FLAG_NO_SEQ,
                        serial=_VOLC_SERIAL_NONE,
                        payload=chunk,
                    )
                    await ws.send(frame)

                # Wait for receiver to finish, then always reclaim the task.
                if receive_task:
                    try:
                        await asyncio.wait_for(receive_task, timeout=20.0)
                    except asyncio.TimeoutError:
                        receive_task.cancel()
                        try:
                            await receive_task
                        except asyncio.CancelledError:
                            pass

                if not failed:
                    await on_done(full_text.strip())

        except websockets.exceptions.InvalidStatus as exc:
            logger.warning(
                "Volcengine streaming: WebSocket rejected (HTTP %s)",
                exc.response.status_code,
            )
            await on_error(
                f"Connection rejected (HTTP {exc.response.status_code})",
            )
        except Exception:
            logger.warning(
                "Volcengine streaming transcription failed",
                exc_info=True,
            )
            await on_error("Streaming transcription failed")
        finally:
            if receive_task is not None:
                if not receive_task.done():
                    receive_task.cancel()
                try:
                    await receive_task
                except asyncio.CancelledError:
                    pass

    task = asyncio.ensure_future(_run())

    async def _finish(cancel: bool = False):
        """Drain a normal DONE, or abort on disconnect/reset/shutdown."""
        if cancel:
            if not task.done():
                task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            return
        if not task.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(task), timeout=_VOLC_FINAL_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                await on_error("Timed out waiting for final transcription")
            except asyncio.CancelledError:
                pass

    return audio_queue, _finish
