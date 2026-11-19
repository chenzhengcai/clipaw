# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HELPER_PATH = REPO_ROOT / "scripts" / "pack-tauri" / "app_plugins.py"
SPEC = importlib.util.spec_from_file_location("desktop_app_plugins", HELPER_PATH)
HELPER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(HELPER)


def test_both_plugins_opt_in_and_ship_runtime_entries() -> None:
    plugin_ids = {
        path.name for path in HELPER.bundled_plugin_dirs(REPO_ROOT)
    }
    assert {"qwenpaw-voice", "background-theme"} <= plugin_ids

    data = HELPER.collect_bundled_app_data(REPO_ROOT)
    sources = {Path(source) for source, _destination in data}
    destinations = {Path(destination) for _source, destination in data}
    assert any(path.name == "index.js" and "qwenpaw-voice" in path.parts for path in sources)
    assert any(path.name == "index.js" and "background-theme" in path.parts for path in sources)
    assert Path("plugins/apps/qwenpaw-voice/frontend/dist") in destinations
    assert Path("plugins/apps/background-theme/ui") in destinations
    assert all("node_modules" not in path.parts for path in sources)
    assert all("__pycache__" not in path.parts for path in sources)


def test_missing_opted_frontend_fails_before_pyinstaller(tmp_path: Path) -> None:
    plugin = tmp_path / "plugins" / "apps" / "broken"
    plugin.mkdir(parents=True)
    (plugin / "plugin.json").write_text(
        json.dumps(
            {
                "id": "broken",
                "version": "1.0.0",
                "entry": {"frontend": "dist/missing.js"},
                "meta": {"desktop": {"bundle": True, "auto_start": True}},
            }
        ),
        encoding="utf-8",
    )
    try:
        HELPER.collect_bundled_app_data(tmp_path)
    except SystemExit as error:
        assert "dist/missing.js" in str(error)
    else:
        raise AssertionError("missing frontend must fail the packaging preflight")


def test_macos_and_windows_builds_run_shared_plugin_preflight() -> None:
    macos = (REPO_ROOT / "scripts/pack-tauri/build_pyinstaller.sh").read_text(
        encoding="utf-8"
    )
    windows = (REPO_ROOT / "scripts/pack-tauri/build_pyinstaller.ps1").read_text(
        encoding="utf-8"
    )
    outer_macos = (
        REPO_ROOT / "scripts/pack-tauri/build_macos_pyinstaller.sh"
    ).read_text(encoding="utf-8")
    assert "app_plugins.py" in macos
    assert "app_plugins.py" in windows
    assert "--build" in macos
    assert "--build" in windows
    assert "build_pyinstaller.sh" in outer_macos
