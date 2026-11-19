# -*- coding: utf-8 -*-
"""Build and collect manifest-opted desktop app plugins (stdlib only)."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any

EXCLUDED_PARTS = {
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".git",
    "tests",
}
EXCLUDED_FILES = {".DS_Store"}


def _manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Plugin manifest is not an object: {path}")
    return value


def _desktop_opted_in(manifest: dict[str, Any]) -> bool:
    desktop = manifest.get("meta", {}).get("desktop", {})
    return (
        isinstance(desktop, dict)
        and desktop.get("bundle") is True
        and desktop.get("auto_start") is True
    )


def bundled_plugin_dirs(repo_root: Path) -> list[Path]:
    root = repo_root / "plugins" / "apps"
    if not root.is_dir():
        return []
    result = []
    for plugin_dir in sorted(root.iterdir()):
        manifest_path = plugin_dir / "plugin.json"
        if not manifest_path.is_file():
            continue
        if _desktop_opted_in(_manifest(manifest_path)):
            result.append(plugin_dir)
    return result


def collect_bundled_app_data(repo_root: Path) -> list[tuple[str, str]]:
    """Return PyInstaller ``datas`` entries for runtime-readable plugins."""
    datas: list[tuple[str, str]] = []
    for plugin_dir in bundled_plugin_dirs(repo_root):
        manifest = _manifest(plugin_dir / "plugin.json")
        entry = manifest.get("entry", {})
        frontend = entry.get("frontend") if isinstance(entry, dict) else None
        if frontend and not (plugin_dir / frontend).is_file():
            raise SystemExit(
                f"Bundled plugin frontend is missing: {plugin_dir / frontend}. "
                "Build plugin frontends before PyInstaller."
            )
        for path in sorted(plugin_dir.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(plugin_dir)
            if EXCLUDED_PARTS.intersection(relative.parts):
                continue
            if path.name in EXCLUDED_FILES or path.suffix in {".pyc", ".log"}:
                continue
            target = Path("plugins/apps") / plugin_dir.name / relative.parent
            datas.append((str(path), str(target)))
    return datas


def build_bundled_app_frontends(repo_root: Path) -> None:
    """Run each opted-in plugin's own build, never a host-specific build."""
    for plugin_dir in bundled_plugin_dirs(repo_root):
        for candidate in (plugin_dir / "frontend", plugin_dir / "ui"):
            package = candidate / "package.json"
            if not package.is_file():
                continue
            package_data = json.loads(package.read_text("utf-8"))
            if "build" not in package_data.get("scripts", {}):
                continue
            print(f"[app-plugins] npm ci && npm run build: {candidate}", flush=True)
            npm = "npm.cmd" if os.name == "nt" else "npm"
            subprocess.run([npm, "ci"], cwd=candidate, check=True)
            subprocess.run([npm, "run", "build"], cwd=candidate, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    root = args.repo_root.resolve()
    if args.build:
        build_bundled_app_frontends(root)
    count = len(bundled_plugin_dirs(root))
    print(f"[app-plugins] {count} manifest-opted desktop plugin(s) ready")


if __name__ == "__main__":
    main()
