# -*- coding: utf-8 -*-
"""Generic, opt-in bundled application plugin synchronization.

A plugin opts in with ``meta.desktop.bundle`` and ``meta.desktop.auto_start``
in its own manifest.  The host contains no plugin-specific startup logic.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

from packaging.version import InvalidVersion, Version

logger = logging.getLogger(__name__)

_STATE_FILE = ".bundled-apps.json"
_IGNORE = shutil.ignore_patterns(
    "node_modules",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
    ".pytest_cache",
    ".git",
    "tests",
    "*.log",
)


def read_manifest(plugin_dir: Path) -> dict[str, Any]:
    try:
        value = json.loads((plugin_dir / "plugin.json").read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def is_desktop_bundled(manifest: dict[str, Any]) -> bool:
    meta = manifest.get("meta")
    desktop = meta.get("desktop") if isinstance(meta, dict) else None
    return (
        isinstance(desktop, dict)
        and desktop.get("bundle") is True
        and desktop.get("auto_start") is True
    )


def bundled_apps_root() -> Path | None:
    """Locate source or frozen ``plugins/apps`` resources."""
    candidates: list[Path] = []
    frozen = getattr(sys, "_MEIPASS", None)
    if frozen:
        candidates.append(Path(frozen) / "plugins" / "apps")
    here = Path(__file__).resolve()
    candidates.extend(ancestor / "plugins" / "apps" for ancestor in here.parents)
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def _load_state(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        dir=path.parent, prefix=".bundled-apps-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2, sort_keys=True)
        Path(temporary).replace(path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def _copy_plugin(source: Path, target: Path) -> None:
    """Stage a complete copy before replacing the pre-start runtime copy."""
    staging = target.parent / f".{target.name}.bundled-{uuid.uuid4().hex}"
    try:
        shutil.copytree(source, staging, ignore=_IGNORE)
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        staging.replace(target)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def sync_bundled_apps(plugins_dir: Path, *, source_root: Path | None = None) -> None:
    """Sync opted-in apps while preserving disable and uninstall intent.

    First sync installs the plugin and the official loader's absent
    ``plugins.<id>.enabled`` setting defaults to enabled.  A later missing
    target is an uninstall tombstone: the plugin is not resurrected on every
    launch.  ``<id>.disabled`` directories are also left untouched.
    """
    root = source_root or bundled_apps_root()
    if root is None or not root.is_dir():
        return
    state_path = plugins_dir / _STATE_FILE
    state = _load_state(state_path)
    original_state = dict(state)

    for source in sorted(root.iterdir()):
        if not source.is_dir() or source.name.startswith("."):
            continue
        manifest = read_manifest(source)
        if not is_desktop_bundled(manifest):
            continue
        plugin_id = str(manifest.get("id") or source.name)
        version = str(manifest.get("version") or "")
        target = plugins_dir / plugin_id
        disabled = plugins_dir / f"{plugin_id}.disabled"

        if disabled.exists() and not target.exists():
            logger.info("Bundled plugin '%s' remains disabled", plugin_id)
            continue
        if not target.exists() and plugin_id in state:
            logger.info("Bundled plugin '%s' remains uninstalled", plugin_id)
            continue
        if target.exists():
            installed_version = str(read_manifest(target).get("version") or "")
            if version and installed_version == version:
                state.setdefault(plugin_id, {"version": version})
                continue
            if version and installed_version:
                try:
                    if Version(installed_version) > Version(version):
                        # Never downgrade a newer user-installed copy with an
                        # older desktop bundle.
                        state[plugin_id] = {"version": installed_version}
                        logger.info(
                            "Keeping newer installed plugin '%s' (v%s > bundled v%s)",
                            plugin_id,
                            installed_version,
                            version,
                        )
                        continue
                except InvalidVersion:
                    # An unreadable/non-PEP440 target is repaired from the
                    # bundled source rather than compared lexicographically.
                    pass
        try:
            plugins_dir.mkdir(parents=True, exist_ok=True)
            _copy_plugin(source, target)
            state[plugin_id] = {"version": version}
            logger.info(
                "Installed bundled plugin '%s' (v%s) to %s",
                plugin_id,
                version or "?",
                target,
            )
        except Exception as exc:  # startup must remain available
            logger.warning(
                "Failed to sync bundled plugin '%s': %s",
                plugin_id,
                exc,
                exc_info=True,
            )

    if state != original_state:
        try:
            _save_state(state_path, state)
        except OSError:
            logger.warning("Could not persist bundled plugin state", exc_info=True)
