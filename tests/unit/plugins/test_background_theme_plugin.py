# -*- coding: utf-8 -*-
# pylint: disable=redefined-outer-name
"""Unit tests for the background-theme plugin backend REST API."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

_PLUGIN_ROOT = (
    Path(__file__).resolve().parents[3]
    / "plugins"
    / "apps"
    / "background-theme"
)


def _load_plugin_module():
    """Import plugins/apps/background-theme/plugin.py as a standalone module."""
    spec = importlib.util.spec_from_file_location(
        "background_theme_plugin_under_test",
        _PLUGIN_ROOT / "plugin.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


bg_plugin = _load_plugin_module()

app = FastAPI()
app.include_router(bg_plugin.router, prefix="/api/background-theme")


@pytest.fixture(autouse=True)
def _use_tmp_storage(tmp_path: Path):
    """Redirect library dir + config file to a temp directory."""
    library_dir = tmp_path / "library"
    config_file = tmp_path / "config.json"
    with (
        patch.object(bg_plugin, "_LIBRARY_DIR", library_dir),
        patch.object(bg_plugin, "_CONFIG_FILE", config_file),
    ):
        yield {"library_dir": library_dir, "config_file": config_file}


@pytest.fixture
def api_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ── helpers ──────────────────────────────────────────────────────────


async def _upload(api: AsyncClient, name: str, content: bytes = b"fakedata"):
    files = {"file": (name, content, "application/octet-stream")}
    resp = await api.post("/api/background-theme/library", files=files)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── library ──────────────────────────────────────────────────────────


async def test_upload_image_and_list(api_client, _use_tmp_storage):
    async with api_client:
        item = await _upload(api_client, "wallpaper.png")
        assert item["kind"] == "image"
        assert item["url"].startswith(
            "/api/frontend_plugin/background-theme/files/data/library/"
        )
        assert item["name"].endswith("_wallpaper.png")

        listed = await api_client.get("/api/background-theme/library")
        assert listed.status_code == 200
        items = listed.json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == item["name"]


async def test_upload_video_kind(api_client):
    async with api_client:
        item = await _upload(api_client, "loop.mp4")
        assert item["kind"] == "video"


async def test_upload_rejects_unsupported_type(api_client):
    async with api_client:
        resp = await api_client.post(
            "/api/background-theme/library",
            files={"file": ("evil.exe", b"MZ", "application/x-msdownload")},
        )
        assert resp.status_code == 400


async def test_delete_clears_config_reference(api_client, _use_tmp_storage):
    async with api_client:
        item = await _upload(api_client, "bg.jpg")

        put = await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "global",
                "background": {
                    "type": "image",
                    "file": item["name"],
                    "fit": "cover",
                    "dim": 0.4,
                    "blur": 2,
                },
            },
        )
        assert put.status_code == 200

        deleted = await api_client.delete(
            f"/api/background-theme/library/{item['name']}"
        )
        assert deleted.status_code == 200

        cfg = deleted.json()["config"]
        assert cfg["slots"]["global"]["type"] is None
        assert not (_use_tmp_storage["library_dir"] / item["name"]).exists()


# ── config ───────────────────────────────────────────────────────────


async def test_default_config_is_empty_and_disabled(api_client):
    async with api_client:
        resp = await api_client.get("/api/background-theme/config")
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is False  # master switch defaults to OFF
        slots = body["slots"]
        assert slots["global"]["type"] is None
        assert slots["chat"]["type"] is None


async def test_toggle_enabled_roundtrip(api_client, _use_tmp_storage):
    async with api_client:
        on = await api_client.put(
            "/api/background-theme/enabled",
            json={"enabled": True},
        )
        assert on.status_code == 200
        assert on.json()["enabled"] is True

        # persisted
        cfg = await api_client.get("/api/background-theme/config")
        assert cfg.json()["enabled"] is True

        off = await api_client.put(
            "/api/background-theme/enabled",
            json={"enabled": False},
        )
        assert off.json()["enabled"] is False


async def test_put_config_roundtrip(api_client, _use_tmp_storage):
    async with api_client:
        item = await _upload(api_client, "chat.mp4")

        resp = await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "chat",
                "background": {
                    "type": "video",
                    "file": item["name"],
                    "fit": "contain",
                    "dim": 0.5,
                    "blur": 4,
                },
            },
        )
        assert resp.status_code == 200
        slot = resp.json()["slots"]["chat"]
        assert slot["type"] == "video"
        assert slot["file"] == item["name"]
        assert slot["fit"] == "contain"
        assert slot["url"].endswith(item["name"])

        # persisted across a fresh read
        again = await api_client.get("/api/background-theme/config")
        assert again.json()["slots"]["chat"]["file"] == item["name"]


async def test_put_config_validates(api_client, _use_tmp_storage):
    async with api_client:
        # bad slot
        resp = await api_client.put(
            "/api/background-theme/config",
            json={"slot": "nope", "background": None},
        )
        assert resp.status_code == 400

        item = await _upload(api_client, "a.png")
        # kind mismatch
        resp = await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "global",
                "background": {"type": "video", "file": item["name"]},
            },
        )
        assert resp.status_code == 400

        # file not in library
        resp = await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "global",
                "background": {"type": "image", "file": "missing.png"},
            },
        )
        assert resp.status_code == 404

        # path traversal
        resp = await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "global",
                "background": {"type": "image", "file": "../config.json"},
            },
        )
        assert resp.status_code in (403, 404)


async def test_clear_config(api_client, _use_tmp_storage):
    async with api_client:
        item = await _upload(api_client, "x.png")
        await api_client.put(
            "/api/background-theme/config",
            json={
                "slot": "global",
                "background": {"type": "image", "file": item["name"]},
            },
        )
        cleared = await api_client.put(
            "/api/background-theme/config",
            json={"slot": "global", "background": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["slots"]["global"]["type"] is None
