# -*- coding: utf-8 -*-
"""Origin validation and DONE/RESET lifecycle tests for the voice router."""

import asyncio
from unittest.mock import AsyncMock, patch

from backend import router as router_mod


def _transcribe_endpoint():
    route = next(
        r for r in router_mod.build_router().routes
        if getattr(r, "path", "") == "/transcribe/ws"
    )
    return route.endpoint


def run(coro):
    return asyncio.run(coro)


class FakeWS:
    def __init__(self, messages, origin=None):
        self.messages = list(messages)
        self.sent_text = []
        self.closed = False
        self.headers = {}
        if origin is not None:
            self.headers["origin"] = origin
        self.headers.setdefault("host", "127.0.0.1:5000")

    async def accept(self):
        pass

    async def receive(self):
        return self.messages.pop(0) if self.messages else {"type": "websocket.disconnect"}

    async def send_text(self, payload):
        self.sent_text.append(payload)

    async def close(self, code=None):
        self.closed = True


def test_cross_origin_rejected():
    ws = FakeWS([], origin="https://evil.example.com")
    run(_transcribe_endpoint()(ws))
    assert ws.closed is True
    assert not ws.sent_text


def test_loopback_origin_accepted():
    ws = FakeWS(
        [{"type": "websocket.receive", "text": "DONE"}],
        origin="http://127.0.0.1:5000",
    )
    finish = AsyncMock()
    with (
        patch.object(router_mod, "_credentials_ready", return_value=True),
        patch.object(router_mod, "stream_transcribe_volcengine", return_value=(asyncio.Queue(), finish)),
        patch.object(router_mod, "register", lambda *_: None),
        patch.object(router_mod, "unregister", lambda *_: None),
    ):
        run(_transcribe_endpoint()(ws))
    finish.assert_awaited_once_with()
    assert ws.closed is True


def test_disconnect_aborts_session():
    ws = FakeWS([], origin="http://127.0.0.1:5000")
    finish = AsyncMock()
    with (
        patch.object(router_mod, "_credentials_ready", return_value=True),
        patch.object(router_mod, "stream_transcribe_volcengine", return_value=(asyncio.Queue(), finish)),
        patch.object(router_mod, "register", lambda *_: None),
        patch.object(router_mod, "unregister", lambda *_: None),
    ):
        run(_transcribe_endpoint()(ws))
    finish.assert_awaited_once_with(cancel=True)


def test_unconfigured_rejects_connection():
    ws = FakeWS([], origin="http://127.0.0.1:5000")
    with patch.object(router_mod, "_credentials_ready", return_value=False):
        run(_transcribe_endpoint()(ws))
    assert ws.closed is True
    assert "not configured" in ws.sent_text[0] if ws.sent_text else False
