# -*- coding: utf-8 -*-
"""Audio transcription utility.

Transcribes audio files to text using either:
- An OpenAI-compatible ``/v1/audio/transcriptions`` endpoint (Whisper API),
- The locally installed ``openai-whisper`` Python library (Local Whisper), or
- Volcengine BigModel streaming ASR (WebSocket binary protocol).

Transcription is only attempted when explicitly enabled via the
``transcription_provider_type`` config setting.  The default is ``"disabled"``.
"""

import asyncio
import json as _json
import logging
import os
import shutil
import struct
import subprocess
import tempfile
import threading
import uuid as _uuid
from typing import Awaitable, Callable, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Cached local-whisper model (lazy singleton)
# ------------------------------------------------------------------
_local_whisper_model = None
_local_whisper_lock = threading.Lock()


def _get_local_whisper_model():
    """Return a cached whisper model, loading it on first call."""
    global _local_whisper_model  # noqa: PLW0603
    if _local_whisper_model is not None:
        return _local_whisper_model
    with _local_whisper_lock:
        if _local_whisper_model is not None:
            return _local_whisper_model
        import whisper

        _local_whisper_model = whisper.load_model("base")
        return _local_whisper_model


# ------------------------------------------------------------------
# Provider helpers
# ------------------------------------------------------------------


def _url_for_provider(provider) -> Optional[Tuple[str, str]]:
    """Return ``(base_url, api_key)`` if *provider* can serve transcription.

    Supports providers that do not require an API key (e.g. local Ollama).
    """
    from ...providers.openai_provider import OpenAIProvider
    from ...providers.ollama_provider import OllamaProvider

    if isinstance(provider, OpenAIProvider):
        requires_key = getattr(provider, "require_api_key", True)
        key = provider.api_key or ""
        if requires_key and not key:
            return None
        base = provider.base_url.rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return (base, key or "")
    if isinstance(provider, OllamaProvider):
        base = provider.base_url.rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return (base, provider.api_key or "")
    return None


def _get_manager():
    """Return ProviderManager singleton or None."""
    try:
        from ...providers.provider_manager import ProviderManager

        return ProviderManager.get_instance()
    except Exception:
        logger.debug("ProviderManager not initialised yet")
        return None


# ------------------------------------------------------------------
# Public helpers for API / Console UI
# ------------------------------------------------------------------


def list_transcription_providers() -> List[dict]:
    """Return providers capable of audio transcription.

    Each entry is ``{"id": ..., "name": ..., "available": bool}``.
    Availability is based on whether the provider has usable credentials.
    """
    manager = _get_manager()
    if manager is None:
        return []

    results: list[dict] = []
    all_providers = {
        **getattr(manager, "builtin_providers", {}),
        **getattr(manager, "custom_providers", {}),
    }
    for provider in all_providers.values():
        creds = _url_for_provider(provider)
        if creds is not None:
            results.append(
                {
                    "id": provider.id,
                    "name": provider.name,
                    "available": True,
                },
            )
    return results


def get_configured_transcription_provider_id() -> str:
    """Return the explicitly configured provider ID (raw config value)."""
    from ...config import load_config

    return load_config().agents.transcription_provider_id


def check_local_whisper_available() -> dict:
    """Check whether the local whisper provider can be used.

    Returns a dict with::

        {
            "available": bool,
            "ffmpeg_installed": bool,
            "whisper_installed": bool,
        }
    """
    ffmpeg_ok = shutil.which("ffmpeg") is not None

    whisper_ok = False
    try:
        import whisper as _whisper  # noqa: F401

        whisper_ok = True
    except ImportError:
        pass

    return {
        "available": ffmpeg_ok and whisper_ok,
        "ffmpeg_installed": ffmpeg_ok,
        "whisper_installed": whisper_ok,
    }


# ------------------------------------------------------------------
# Transcription backends
# ------------------------------------------------------------------


async def _transcribe_local_whisper(file_path: str) -> Optional[str]:
    """Transcribe using the locally installed ``openai-whisper`` library.

    Requires both ``ffmpeg`` and ``openai-whisper`` to be installed.
    Returns the transcribed text, or ``None`` on failure.
    """
    status = check_local_whisper_available()
    if not status["available"]:
        missing = []
        if not status["ffmpeg_installed"]:
            missing.append("ffmpeg")
        if not status["whisper_installed"]:
            missing.append("openai-whisper")
        logger.warning(
            "Local Whisper unavailable (missing: %s). "
            "Install the missing dependencies to use local transcription.",
            ", ".join(missing),
        )
        return None

    def _run():
        model = _get_local_whisper_model()
        result = model.transcribe(file_path)
        return (result.get("text") or "").strip()

    try:
        text = await asyncio.to_thread(_run)
        if text:
            logger.debug(
                "Local Whisper transcribed %s: %s",
                file_path,
                text[:80],
            )
            return text
        logger.warning(
            "Local Whisper returned empty text for %s",
            file_path,
        )
        return None
    except Exception:
        logger.warning(
            "Local Whisper transcription failed for %s",
            file_path,
            exc_info=True,
        )
        return None


def _get_configured_provider_creds() -> Optional[Tuple[str, str]]:
    """Return ``(base_url, api_key)`` for the explicitly configured provider.

    Returns ``None`` when no provider is configured or the configured
    provider is not found / has no usable credentials.
    """
    from ...config import load_config

    configured_id = load_config().agents.transcription_provider_id
    if not configured_id:
        return None

    manager = _get_manager()
    if manager is None:
        return None

    provider = manager.get_provider(configured_id)
    if provider is None:
        logger.warning(
            "Configured transcription provider '%s' not found",
            configured_id,
        )
        return None

    creds = _url_for_provider(provider)
    if creds is None:
        logger.warning(
            "Configured transcription provider '%s' has no usable credentials",
            configured_id,
        )
    return creds


async def _transcribe_whisper_api(file_path: str) -> Optional[str]:
    """Transcribe using the OpenAI-compatible Whisper API endpoint.

    Only uses the explicitly configured provider — no auto-detection.
    Returns the transcribed text, or ``None`` on failure.
    """
    creds = _get_configured_provider_creds()
    if creds is None:
        logger.warning(
            "No transcription provider configured; skipping transcription",
        )
        return None

    base_url, api_key = creds

    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.warning(
            "openai package not installed; cannot transcribe audio",
        )
        return None

    from ...config import load_config

    model_name = load_config().agents.transcription_model or "whisper-1"

    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key or "none",
        timeout=60,
    )

    try:
        with open(file_path, "rb") as f:
            transcript = await client.audio.transcriptions.create(
                model=model_name,
                file=f,
            )
        text = transcript.text.strip()
        if text:
            logger.debug("Transcribed audio %s: %s", file_path, text[:80])
            return text
        logger.warning("Transcription returned empty text for %s", file_path)
        return None
    except Exception:
        logger.warning(
            "Audio transcription failed for %s",
            file_path,
            exc_info=True,
        )
        return None


# ------------------------------------------------------------------
# Volcengine BigModel streaming ASR
# ------------------------------------------------------------------

# Binary frame header constants
_VOLC_HDR_VERSION = 0b0001  # protocol version 1
_VOLC_HDR_SIZE = 0b0001  # 4 bytes
_VOLC_MSG_FULL_REQUEST = 0b0001  # full client request (with JSON params)
_VOLC_MSG_AUDIO_ONLY = 0b0010  # audio only request
_VOLC_MSG_SERVER_RESP = 0b1001  # full server response
_VOLC_MSG_ERROR = 0b1111  # error from server
_VOLC_FLAG_NO_SEQ = 0b0000  # no sequence number
_VOLC_FLAG_LAST_PKT = 0b0010  # last packet (negative)
_VOLC_SERIAL_JSON = 0b0001  # JSON serialization
_VOLC_SERIAL_NONE = 0b0000  # no serialization
_VOLC_COMP_NONE = 0b0000  # no compression

# Audio chunk size: 200ms of 16kHz 16bit mono PCM = 6400 bytes
_VOLC_CHUNK_SIZE = 6400

_VOLC_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"


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
    """Parse a Volcengine BigModel server response frame.

    Returns a dict ``{"type": "result", "text": "..."}`` or
    ``{"type": "error", "code": N, "message": "..."}``,
    or ``None`` if the frame is unrecognised / too short.
    """
    if len(raw) < 8:
        return None

    msg_type = (raw[1] >> 4) & 0x0F
    flags = raw[1] & 0x0F
    offset = 4

    # Error frame
    if msg_type == _VOLC_MSG_ERROR:
        if len(raw) < offset + 8:
            return None
        error_code = struct.unpack(">I", raw[offset : offset + 4])[0]
        offset += 4
        error_size = struct.unpack(">I", raw[offset : offset + 4])[0]
        offset += 4
        error_msg = raw[offset : offset + error_size].decode(
            "utf-8", errors="replace",
        )
        return {"type": "error", "code": error_code, "message": error_msg}

    # Server response
    if msg_type != _VOLC_MSG_SERVER_RESP:
        return None

    # Skip optional sequence number
    if flags & 0b0001:
        offset += 4

    if len(raw) < offset + 4:
        return None
    payload_size = struct.unpack(">I", raw[offset : offset + 4])[0]
    offset += 4

    if len(raw) < offset + payload_size:
        return None
    payload = raw[offset : offset + payload_size]

    try:
        data = _json.loads(payload.decode("utf-8"))
    except (_json.JSONDecodeError, UnicodeDecodeError):
        logger.debug("Volcengine ASR: failed to decode response JSON")
        return None

    result = data.get("result", {})
    text = result.get("text", "")
    return {"type": "result", "text": text}


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


async def _transcribe_volcengine_bigmodel(file_path: str) -> Optional[str]:
    """Transcribe using Volcengine BigModel streaming ASR over WebSocket.

    Requires ``websockets`` library and ``ffmpeg`` system package.
    Reads API credentials from the envs store
    (``volcengine_asr_api_key``, ``volcengine_asr_resource_id``).

    Returns the transcribed text, or ``None`` on failure.
    """
    try:
        import websockets
    except ImportError:
        logger.warning(
            "websockets library not installed; "
            "needed for Volcengine BigModel ASR. "
            "Install with: uv pip install websockets",
        )
        return None

    # Read credentials from envs store.
    # Supports both old console (App-Key + Access-Key) and new
    # console (X-Api-Key) formats.
    from ...envs import load_envs

    envs = load_envs()
    api_key = envs.get("volcengine_asr_api_key", "") or os.environ.get(
        "VOLCENGINE_ASR_API_KEY", "",
    )
    app_id = envs.get("volcengine_asr_app_id", "") or os.environ.get(
        "VOLCENGINE_ASR_APP_ID", "",
    )
    access_token = envs.get(
        "volcengine_asr_access_token", "",
    ) or os.environ.get("VOLCENGINE_ASR_ACCESS_TOKEN", "")

    if not api_key and not (app_id and access_token):
        logger.warning(
            "Volcengine ASR credentials not configured. "
            "Available env keys: %s. "
            "Set volcengine_asr_api_key (new console) or "
            "volcengine_asr_app_id + volcengine_asr_access_token "
            "(old console) in the Environments settings.",
            sorted(envs.keys()),
        )
        return None

    resource_id = envs.get(
        "volcengine_asr_resource_id",
        "volc.bigasr.sauc.duration",
    )
    logger.debug(
        "Volcengine ASR: app_id=%s access_token=%s api_key=%s resource_id=%s",
        app_id[:6] + "..." if app_id else "(empty)",
        access_token[:6] + "..." if access_token else "(empty)",
        api_key[:6] + "..." if api_key else "(empty)",
        resource_id,
    )

    # Convert audio to PCM
    pcm_path = None
    try:
        pcm_path = _convert_to_pcm16k(file_path)
        with open(pcm_path, "rb") as fh:
            pcm_data = fh.read()

        if not pcm_data:
            logger.warning("Volcengine ASR: empty PCM data")
            return None

        # Build auth headers (old console takes priority if both set)
        if app_id and access_token:
            extra_headers = {
                "X-Api-App-Key": app_id,
                "X-Api-Access-Key": access_token,
                "X-Api-Resource-Id": resource_id,
                "X-Api-Request-Id": str(_uuid.uuid4()),
                "X-Api-Sequence": "-1",
            }
        else:
            extra_headers = {
                "X-Api-Key": api_key,
                "X-Api-Resource-Id": resource_id,
                "X-Api-Request-Id": str(_uuid.uuid4()),
                "X-Api-Sequence": "-1",
            }

        logger.debug(
            "Volcengine ASR: connecting to %s with headers %s",
            _VOLC_WS_URL,
            {k: (v[:8] + "..." if k.endswith("Key") or k.endswith("Token") else v)
             for k, v in extra_headers.items()},
        )

        async with websockets.connect(
            _VOLC_WS_URL,
            additional_headers=extra_headers,
            max_size=2**23,  # 8 MB
        ) as ws:
            # --- Send full client request ---
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
            full_req = _build_volc_frame(
                msg_type=_VOLC_MSG_FULL_REQUEST,
                flags=_VOLC_FLAG_NO_SEQ,
                serial=_VOLC_SERIAL_JSON,
                payload=_json.dumps(params, ensure_ascii=False).encode("utf-8"),
            )
            await ws.send(full_req)
            logger.debug("Volcengine ASR: sent full client request")

            # --- Send audio chunks ---
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

            # --- Send last packet (negative / end marker) ---
            last = _build_volc_frame(
                msg_type=_VOLC_MSG_AUDIO_ONLY,
                flags=_VOLC_FLAG_LAST_PKT,
                serial=_VOLC_SERIAL_NONE,
                payload=b"",
            )
            await ws.send(last)
            logger.debug(
                "Volcengine ASR: sent %d audio chunks + end marker",
                (len(pcm_data) + _VOLC_CHUNK_SIZE - 1) // _VOLC_CHUNK_SIZE,
            )

            # --- Collect results ---
            full_text = ""
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=15.0)
                except asyncio.TimeoutError:
                    logger.debug("Volcengine ASR: receive timeout, finalising")
                    break
                except websockets.exceptions.ConnectionClosedOK as exc:
                    logger.debug(
                        "Volcengine ASR: server closed connection (%s)",
                        exc.reason,
                    )
                    break

                parsed = _parse_volc_frame(raw)
                if parsed is None:
                    continue
                if parsed["type"] == "error":
                    logger.warning(
                        "Volcengine ASR error: code=%s msg=%s",
                        parsed.get("code"),
                        parsed.get("message"),
                    )
                    break
                text = parsed.get("text", "")
                # Bidirectional mode returns cumulative text — each frame
                # contains the full recognition so far.  Replace, don't append.
                if text:
                    full_text = text

            result = full_text.strip() if full_text.strip() else None
            if result:
                logger.debug(
                    "Volcengine ASR transcribed: %s",
                    result[:80],
                )
            else:
                logger.warning("Volcengine ASR returned empty result")
            return result

    except Exception:
        logger.warning(
            "Volcengine BigModel ASR transcription failed for %s",
            file_path,
            exc_info=True,
        )
        return None
    finally:
        if pcm_path and os.path.exists(pcm_path):
            try:
                os.unlink(pcm_path)
            except OSError:
                pass


# ------------------------------------------------------------------
# Streaming transcription entry point (real-time, for WebSocket)
# ------------------------------------------------------------------


async def stream_transcribe_volcengine(
    *,
    on_text: Callable[[str], Awaitable[None]],
    on_done: Callable[[str], Awaitable[None]],
    on_error: Callable[[str], Awaitable[None]],
) -> Tuple[asyncio.Queue, Callable[[], Awaitable[None]]]:
    """Create a streaming Volcengine BigModel ASR session.

    Returns ``(audio_queue, finish)``:

    - Push raw PCM 16kHz 16bit mono bytes into *audio_queue*.
    - Push ``None`` when recording is done.
    - Call ``await finish()`` to clean up after the session.

    *on_text* is called with partial recognition text whenever the
    server sends an update.  *on_done* is called with the final text.
    *on_error* is called on fatal errors.

    The Volcengine WebSocket is opened lazily on the first audio chunk.
    """
    try:
        import websockets
    except ImportError:
        logger.warning("websockets not installed; needed for Volcengine ASR")
        raise RuntimeError("websockets not installed") from None

    from ...envs import load_envs

    envs = load_envs()
    api_key = envs.get("volcengine_asr_api_key", "") or os.environ.get(
        "VOLCENGINE_ASR_API_KEY", "",
    )
    app_id = envs.get("volcengine_asr_app_id", "") or os.environ.get(
        "VOLCENGINE_ASR_APP_ID", "",
    )
    access_token = envs.get(
        "volcengine_asr_access_token", "",
    ) or os.environ.get("VOLCENGINE_ASR_ACCESS_TOKEN", "")

    if not api_key and not (app_id and access_token):
        raise RuntimeError(
            "Volcengine ASR credentials not configured",
        )

    resource_id = envs.get(
        "volcengine_asr_resource_id",
        "volc.bigasr.sauc.duration",
    )

    audio_queue: asyncio.Queue = asyncio.Queue()

    # Build auth headers
    if app_id and access_token:
        extra_headers = {
            "X-Api-App-Key": app_id,
            "X-Api-Access-Key": access_token,
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": str(_uuid.uuid4()),
            "X-Api-Sequence": "-1",
        }
    else:
        extra_headers = {
            "X-Api-Key": api_key,
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": str(_uuid.uuid4()),
            "X-Api-Sequence": "-1",
        }

    async def _run():
        """Background task: drive the Volcengine WebSocket."""
        try:
            async with websockets.connect(
                _VOLC_WS_URL,
                additional_headers=extra_headers,
                max_size=2**23,
            ) as ws:
                # Send full client request
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
                await ws.send(
                    _build_volc_frame(
                        msg_type=_VOLC_MSG_FULL_REQUEST,
                        flags=_VOLC_FLAG_NO_SEQ,
                        serial=_VOLC_SERIAL_JSON,
                        payload=_json.dumps(
                            params, ensure_ascii=False,
                        ).encode("utf-8"),
                    ),
                )
                logger.debug("Volcengine streaming: sent full client request")

                # Feed audio chunks until sentinel
                full_text = ""
                receive_task: Optional[asyncio.Task] = None

                async def _recv_loop():
                    nonlocal full_text
                    while True:
                        try:
                            raw = await asyncio.wait_for(
                                ws.recv(), timeout=10.0,
                            )
                        except asyncio.TimeoutError:
                            continue
                        except websockets.exceptions.ConnectionClosedOK:
                            break
                        parsed = _parse_volc_frame(raw)
                        if parsed is None:
                            continue
                        if parsed["type"] == "error":
                            await on_error(
                                f"ASR error: {parsed.get('message', 'unknown')}",
                            )
                            return
                        text = parsed.get("text", "")
                        if text and text != full_text:
                            full_text = text
                            await on_text(text)

                # Start receiver in background
                receive_task = asyncio.ensure_future(_recv_loop())

                # Feed audio from queue
                while True:
                    chunk = await audio_queue.get()
                    if chunk is None:
                        # Recording done — send end marker
                        await asyncio.sleep(0.3)
                        await ws.send(
                            _build_volc_frame(
                                msg_type=_VOLC_MSG_AUDIO_ONLY,
                                flags=_VOLC_FLAG_LAST_PKT,
                                serial=_VOLC_SERIAL_NONE,
                                payload=b"",
                            ),
                        )
                        logger.debug(
                            "Volcengine streaming: sent end marker",
                        )
                        break

                    await ws.send(
                        _build_volc_frame(
                            msg_type=_VOLC_MSG_AUDIO_ONLY,
                            flags=_VOLC_FLAG_NO_SEQ,
                            serial=_VOLC_SERIAL_NONE,
                            payload=chunk,
                        ),
                    )

                # Wait for receiver to finish
                if receive_task:
                    try:
                        await asyncio.wait_for(receive_task, timeout=20.0)
                    except asyncio.TimeoutError:
                        receive_task.cancel()

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

    task = asyncio.ensure_future(_run())

    async def _finish():
        """Wait for the background task to complete, then clean up."""
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return audio_queue, _finish


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------


async def transcribe_audio(file_path: str) -> Optional[str]:
    """Transcribe an audio file to text.

    Dispatches to the configured transcription backend based on the
    ``transcription_provider_type`` config setting.  When the setting is
    ``"disabled"`` (the default), returns ``None`` immediately.

    Returns the transcribed text, or ``None`` on failure.
    """
    from ...config import load_config

    provider_type = load_config().agents.transcription_provider_type

    if provider_type == "disabled":
        logger.debug("Transcription is disabled; skipping")
        return None
    if provider_type == "local_whisper":
        return await _transcribe_local_whisper(file_path)
    if provider_type == "whisper_api":
        return await _transcribe_whisper_api(file_path)
    if provider_type == "volcengine_bigmodel":
        return await _transcribe_volcengine_bigmodel(file_path)

    logger.warning("Unknown transcription_provider_type: %s", provider_type)
    return None
