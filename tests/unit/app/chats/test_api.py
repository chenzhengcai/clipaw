# -*- coding: utf-8 -*-
"""Ownership-boundary tests for the global chat API."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from qwenpaw.app.chats.api import get_chat, list_chats
from qwenpaw.app.chats.models import ChatSpec


def _make_msg(text: str, role: str = "user") -> dict:
    """Build a minimal Msg dict for session-state payloads."""
    return {
        "name": role,
        "role": role,
        "content": [{"type": "text", "text": text}],
        "metadata": {},
    }


def _chat(chat_id: str, *, app_id: str | None = None) -> ChatSpec:
    meta = (
        {
            "pawapp": {
                "app_id": app_id,
                "agent_id": "datapaw",
            },
        }
        if app_id
        else {}
    )
    return ChatSpec(
        id=chat_id,
        session_id=f"console:{chat_id}",
        user_id="default",
        channel="console",
        meta=meta,
    )


@pytest.mark.asyncio
async def test_list_chats_can_exclude_app_owned_dialogues():
    normal = _chat("normal")
    app_owned = _chat("app-owned", app_id="datapaw")
    manager = SimpleNamespace(
        list_chats=AsyncMock(return_value=[normal, app_owned]),
    )
    tracker = SimpleNamespace(get_status=AsyncMock(return_value="idle"))

    result = await list_chats(
        user_id=None,
        channel=None,
        archived=False,
        include_app_owned=False,
        mgr=manager,
        workspace=SimpleNamespace(task_tracker=tracker),
    )

    assert [chat.id for chat in result] == ["normal"]
    tracker.get_status.assert_awaited_once_with("normal")


@pytest.mark.asyncio
async def test_get_chat_hides_app_owned_dialogue_when_caller_opts_out():
    manager = SimpleNamespace(
        get_chat=AsyncMock(return_value=_chat("app-owned", app_id="datapaw")),
    )

    with pytest.raises(HTTPException) as raised:
        await get_chat(
            chat_id="app-owned",
            include_app_owned=False,
            mgr=manager,
            session=SimpleNamespace(),
            workspace=SimpleNamespace(),
        )

    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_get_chat_merges_pending_user_message_when_running():
    """While a run is active, the user message is not yet in agent.state.context.
    get_chat must merge the early-persisted pending_user_message from chat.meta
    so the history endpoint returns it (issue: agent-switch session loss)."""
    chat = _chat("chat-1")
    chat.meta["pending_user_message"] = _make_msg("hello")
    manager = SimpleNamespace(
        get_chat=AsyncMock(return_value=chat),
    )
    session = SimpleNamespace(
        get_session_state_dict=AsyncMock(
            return_value={
                "agent": {
                    "state": {"context": []},
                },
            },
        ),
    )
    workspace = SimpleNamespace(
        task_tracker=SimpleNamespace(
            get_status=AsyncMock(return_value="running"),
        ),
        config=SimpleNamespace(backend="qwenpaw"),
    )

    result = await get_chat(
        chat_id="chat-1",
        include_app_owned=True,
        mgr=manager,
        session=session,
        workspace=workspace,
    )

    assert result.status == "running"
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    assert result.messages[0].content[0].text == "hello"


@pytest.mark.asyncio
async def test_get_chat_skips_pending_user_message_when_idle():
    """Once the run finishes, the user message is already in
    agent.state.context — the pending entry must not be merged again."""
    chat = _chat("chat-1")
    chat.meta["pending_user_message"] = _make_msg("hello")
    manager = SimpleNamespace(
        get_chat=AsyncMock(return_value=chat),
    )
    session = SimpleNamespace(
        get_session_state_dict=AsyncMock(
            return_value={
                "agent": {
                    "state": {
                        "context": [_make_msg("hello")],
                    },
                },
            },
        ),
    )
    workspace = SimpleNamespace(
        task_tracker=SimpleNamespace(
            get_status=AsyncMock(return_value="idle"),
        ),
        config=SimpleNamespace(backend="qwenpaw"),
    )

    result = await get_chat(
        chat_id="chat-1",
        include_app_owned=True,
        mgr=manager,
        session=session,
        workspace=workspace,
    )

    assert result.status == "idle"
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
