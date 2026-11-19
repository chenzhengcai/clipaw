# -*- coding: utf-8 -*-
"""Process-local voice sessions, closed on plugin unload or app shutdown."""

from __future__ import annotations

import asyncio

_ACTIVE: dict[object, object] = {}


def register(websocket, finish) -> None:
    _ACTIVE[websocket] = finish


def unregister(websocket) -> None:
    _ACTIVE.pop(websocket, None)


async def close_all() -> None:
    """Abort every active upstream session and close every client socket."""
    sessions = list(_ACTIVE.items())
    _ACTIVE.clear()
    for _websocket, finish in sessions:
        try:
            await finish(cancel=True)
        except Exception:
            pass
    for websocket, _finish in sessions:
        try:
            await websocket.close()
        except Exception:
            pass
    await asyncio.sleep(0)
