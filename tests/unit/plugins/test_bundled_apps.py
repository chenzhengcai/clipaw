# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path

from qwenpaw.plugins.bundled_apps import sync_bundled_apps


def _plugin(root: Path, plugin_id: str, version: str = "1.0.0") -> Path:
    plugin = root / plugin_id
    plugin.mkdir(parents=True, exist_ok=True)
    (plugin / "plugin.json").write_text(
        json.dumps(
            {
                "id": plugin_id,
                "version": version,
                "entry": {"backend": "plugin.py"},
                "meta": {"desktop": {"bundle": True, "auto_start": True}},
            }
        ),
        encoding="utf-8",
    )
    (plugin / "plugin.py").write_text("plugin = None\n", encoding="utf-8")
    return plugin


def test_first_sync_installs_and_next_run_is_idempotent(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    _plugin(source, "voice")

    sync_bundled_apps(runtime, source_root=source)
    assert (runtime / "voice" / "plugin.py").is_file()
    marker = runtime / "voice" / "plugin.py"
    marker.write_text("plugin = 'local runtime copy'\n", encoding="utf-8")

    # Same version must not overwrite the installed copy on every launch.
    sync_bundled_apps(runtime, source_root=source)
    assert "local runtime copy" in marker.read_text(encoding="utf-8")


def test_new_version_updates_but_preserves_explicit_disable(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    _plugin(source, "voice", "1.0.0")
    sync_bundled_apps(runtime, source_root=source)
    (runtime / "voice" / "plugin.py").write_text("plugin = 'old'\n", encoding="utf-8")

    _plugin(source, "voice", "1.1.0")
    # Explicit disabled config belongs to the official loader, not the copier;
    # synchronization only replaces files and never writes enabled=true.
    sync_bundled_apps(runtime, source_root=source)
    manifest = json.loads((runtime / "voice" / "plugin.json").read_text("utf-8"))
    assert manifest["version"] == "1.1.0"
    assert not (runtime / "config.json").exists()


def test_uninstalled_plugin_is_not_resurrected(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    _plugin(source, "voice")
    sync_bundled_apps(runtime, source_root=source)
    for path in sorted((runtime / "voice").iterdir()):
        path.unlink()
    (runtime / "voice").rmdir()

    sync_bundled_apps(runtime, source_root=source)
    assert not (runtime / "voice").exists()


def test_disabled_directory_is_not_replaced(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    _plugin(source, "voice")
    sync_bundled_apps(runtime, source_root=source)
    (runtime / "voice").rename(runtime / "voice.disabled")

    sync_bundled_apps(runtime, source_root=source)
    assert (runtime / "voice.disabled").is_dir()
    assert not (runtime / "voice").exists()


def test_non_opted_plugin_is_not_copied(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    plugin = _plugin(source, "other")
    manifest = json.loads((plugin / "plugin.json").read_text("utf-8"))
    manifest["meta"]["desktop"]["auto_start"] = False
    (plugin / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")

    sync_bundled_apps(runtime, source_root=source)
    assert not (runtime / "other").exists()


def test_newer_user_install_is_not_downgraded(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    _plugin(source, "voice", "1.0.0")
    _plugin(runtime, "voice", "2.0.0")
    (runtime / "voice" / "plugin.py").write_text("plugin = 'newer'\n", encoding="utf-8")

    sync_bundled_apps(runtime, source_root=source)
    assert (runtime / "voice" / "plugin.py").read_text(encoding="utf-8") == "plugin = 'newer'\n"


def test_copy_excludes_development_artifacts(tmp_path: Path) -> None:
    source = tmp_path / "source"
    runtime = tmp_path / "runtime"
    plugin = _plugin(source, "voice")
    (plugin / "node_modules").mkdir()
    (plugin / "node_modules" / "large.js").write_text("x", encoding="utf-8")
    (plugin / "__pycache__").mkdir()
    (plugin / "__pycache__" / "plugin.pyc").write_bytes(b"x")

    sync_bundled_apps(runtime, source_root=source)
    assert not (runtime / "voice" / "node_modules").exists()
    assert not (runtime / "voice" / "__pycache__").exists()
