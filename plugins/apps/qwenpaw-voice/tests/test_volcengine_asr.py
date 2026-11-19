# -*- coding: utf-8 -*-
"""Network-free tests for the Volcengine ASR adapter."""

import asyncio
import json
import ssl
import struct
from unittest.mock import AsyncMock, patch

import websockets

from backend import volcengine_asr as asr


class FakeConnect:
    def __init__(self, ws):
        self.ws = ws

    async def __aenter__(self):
        return self.ws

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeWebSocket:
    def __init__(self, final_text="最终结果", *, close_after_final=True, error_msg=None):
        self.sent = []
        self._final_text = final_text
        self._close_after_final = close_after_final
        self._error_msg = error_msg
        self._end_marker_received = False
        self._response_sent = False
        self._event = asyncio.Event()

    async def send(self, payload):
        self.sent.append(payload)
        if len(payload) >= 4:
            msg_type = (payload[1] >> 4) & 0x0F
            flags = payload[1] & 0x0F
            if msg_type == asr._VOLC_MSG_AUDIO_ONLY and flags == asr._VOLC_FLAG_LAST_PKT:
                self._end_marker_received = True
                self._event.set()

    async def recv(self):
        if self._error_msg:
            raise websockets.exceptions.ConnectionClosedError(None, None)
        if not self._end_marker_received:
            await self._event.wait()
        if not self._response_sent:
            self._response_sent = True
            header = bytearray(4)
            header[0] = (asr._VOLC_HDR_VERSION << 4) | asr._VOLC_HDR_SIZE
            header[1] = (asr._VOLC_MSG_SERVER_RESP << 4) | 0b0011
            header[2] = (asr._VOLC_SERIAL_JSON << 4) | 0
            header[3] = 0x00
            payload = json.dumps(
                {"result": {"text": self._final_text}}, ensure_ascii=False,
            ).encode()
            return bytes(header) + struct.pack(">i", -1) + struct.pack(">I", len(payload)) + payload
        raise websockets.exceptions.ConnectionClosedOK(None, None)


def run(coro):
    return asyncio.run(coro)


def test_ssl_context_keeps_verification(monkeypatch):
    monkeypatch.delenv("VOLCENGINE_ASR_CA_FILE", raising=False)
    ctx = asr._build_volcengine_ssl_ctx()
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_done_waits_for_final_and_sends_end_marker():
    async def scenario():
        ws = FakeWebSocket(final_text="你好世界")
        done = AsyncMock()
        errors = AsyncMock()
        with (
            patch.object(asr, "_get_volcengine_creds_full", return_value=("key", "resource", "", "")),
            patch("websockets.connect", return_value=FakeConnect(ws)),
        ):
            queue, finish = await asr.stream_transcribe_volcengine(
                on_text=AsyncMock(), on_done=done, on_error=errors,
            )
            queue.put_nowait(None)
            await asyncio.wait_for(finish(), timeout=5.0)

        done.assert_awaited_once_with("你好世界")
        errors.assert_not_awaited()
        assert any(
            (p[1] >> 4) & 0x0F == asr._VOLC_MSG_AUDIO_ONLY
            and p[1] & 0x0F == asr._VOLC_FLAG_LAST_PKT
            for p in ws.sent
        )

    run(scenario())


def test_reset_cancels_without_final():
    async def scenario():
        ws = FakeWebSocket(final_text="你好世界")
        done = AsyncMock()
        errors = AsyncMock()
        with (
            patch.object(asr, "_get_volcengine_creds_full", return_value=("key", "resource", "", "")),
            patch("websockets.connect", return_value=FakeConnect(ws)),
        ):
            _queue, finish = await asr.stream_transcribe_volcengine(
                on_text=AsyncMock(), on_done=done, on_error=errors,
            )
            await asyncio.wait_for(finish(cancel=True), timeout=5.0)

        done.assert_not_awaited()
        errors.assert_not_awaited()

    run(scenario())


def test_connection_test_rejects_timeout():
    async def scenario():
        ws = FakeWebSocket(final_text=None)
        ws.recv = AsyncMock(side_effect=asyncio.TimeoutError)
        with patch("websockets.connect", return_value=FakeConnect(ws)):
            return await asr.test_volcengine_connection("key", "resource")

    assert run(scenario()) == {
        "ok": False,
        "error": "Timed out waiting for ASR response",
    }


def test_connection_test_accepts_valid_response():
    async def scenario():
        ws = FakeWebSocket(final_text="")
        ws.recv = AsyncMock(
            return_value=asr._build_volc_frame(
                asr._VOLC_MSG_SERVER_RESP,
                asr._VOLC_FLAG_NO_SEQ,
                asr._VOLC_SERIAL_JSON,
                b'{"result":{"text":""}}',
            ),
        )
        with patch("websockets.connect", return_value=FakeConnect(ws)):
            return await asr.test_volcengine_connection("key", "resource")

    assert run(scenario()) == {"ok": True}


def test_parser_marks_final_frame_with_negative_sequence():
    payload = json.dumps({"result": {"text": "done"}}).encode()
    header = bytearray(4)
    header[0] = (asr._VOLC_HDR_VERSION << 4) | asr._VOLC_HDR_SIZE
    header[1] = (asr._VOLC_MSG_SERVER_RESP << 4) | 0b0011
    header[2] = (asr._VOLC_SERIAL_JSON << 4) | 0
    header[3] = 0x00
    raw = bytes(header) + struct.pack(">i", -1) + struct.pack(">I", len(payload)) + payload

    parsed = asr._parse_volc_frame(raw)
    assert parsed["type"] == "result"
    assert parsed["text"] == "done"
    assert parsed["is_final"] is True


def test_parser_decompresses_gzip():
    import gzip as _gzip

    payload = json.dumps({"result": {"text": "gzip"}}).encode()
    compressed = _gzip.compress(payload)
    header = bytearray(4)
    header[0] = (asr._VOLC_HDR_VERSION << 4) | asr._VOLC_HDR_SIZE
    header[1] = (asr._VOLC_MSG_SERVER_RESP << 4) | asr._VOLC_FLAG_NO_SEQ
    header[2] = (asr._VOLC_SERIAL_JSON << 4) | 1
    header[3] = 0x00
    raw = bytes(header) + struct.pack(">I", len(compressed)) + compressed

    parsed = asr._parse_volc_frame(raw)
    assert parsed["text"] == "gzip"


def test_audio_queue_is_bounded():
    assert asr._VOLC_QUEUE_MAX == 50


def test_legacy_credentials_use_app_key_headers():
    headers = asr._build_volcengine_headers("", "resource", "app", "token")
    assert headers["X-Api-App-Key"] == "app"
    assert "X-Api-Key" not in headers
