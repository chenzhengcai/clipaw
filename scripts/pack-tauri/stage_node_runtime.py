#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage a Node.js runtime for the Tauri desktop bundle."""
from __future__ import annotations

import argparse
import http.client
import os
import platform
import shutil
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

NODE_DIST_URL = "https://nodejs.org/dist"
# Official releases are the primary source. The npmmirror copy of the same
# nodejs.org artifacts is used only when the official host is unreachable or
# keeps dropping the connection (common behind restrictive networks); set
# QWENPAW_NODE_DIST_URL to force a single source instead.
NODE_DIST_FALLBACKS = ("https://cdn.npmmirror.com/binaries/node",)
NODE_DIST_ENV = "QWENPAW_NODE_DIST_URL"
HTTP_ATTEMPTS = 4
HTTP_TIMEOUT_SECONDS = 120
REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_VERSION_FILE = REPO_ROOT / f".nvmrc"


def _read_default_node_version() -> str:
    """Read the bundled Node version from the repository pin."""
    version = NODE_VERSION_FILE.read_text(encoding=f"utf-8").strip()
    if not version:
        raise SystemExit(f"empty Node version in {NODE_VERSION_FILE}")
    return version if version.startswith(f"v") else f"v{version}"


DEFAULT_NODE_VERSION = _read_default_node_version()


def _target() -> tuple[str, str, str]:
    system = platform.system()
    machine = platform.machine().lower()
    arch = {
        "amd64": "x64",
        "x86_64": "x64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }.get(machine)
    if arch is None:
        raise SystemExit(f"unsupported machine architecture: {machine!r}")
    if system == "Windows":
        return "win", arch, "zip"
    if system == "Darwin":
        return "darwin", arch, "tar.xz"
    if system == "Linux":
        return "linux", arch, "tar.xz"
    raise SystemExit(f"unsupported platform: {system!r}")


def _node_exe(dest: Path) -> Path:
    if platform.system() == "Windows":
        return dest / "node.exe"
    return dest / "bin" / "node"


def _npx_exe(dest: Path) -> Path:
    if platform.system() == "Windows":
        return dest / "npx.cmd"
    return dest / "bin" / "npx"


def _http_get(url: str) -> bytes:
    """Fetch a URL, retrying transient transport failures.

    Slow links routinely drop mid-body (``IncompleteRead``) or reset the
    connection; those are ``http.client.HTTPException`` instances, not
    ``OSError``, so they need to be retried explicitly instead of aborting the
    whole desktop build on the first hiccup.
    """
    last: Exception | None = None
    for attempt in range(1, HTTP_ATTEMPTS + 1):
        request = urllib.request.Request(url)
        request.add_header("User-Agent", "qwenpaw-build")
        try:
            with urllib.request.urlopen(
                request,
                timeout=HTTP_TIMEOUT_SECONDS,
            ) as response:
                return response.read()
        except (OSError, http.client.HTTPException) as exc:
            last = exc
            if attempt == HTTP_ATTEMPTS:
                break
            wait = 2 ** (attempt - 1)
            print(
                f"  {type(exc).__name__} fetching {url}; "
                f"retrying in {wait}s ({attempt}/{HTTP_ATTEMPTS})",
            )
            time.sleep(wait)
    assert last is not None
    raise last


def _dist_bases() -> tuple[str, ...]:
    override = os.environ.get(NODE_DIST_ENV, "").strip()
    if override:
        return (override.rstrip("/"),)
    return (NODE_DIST_URL, *NODE_DIST_FALLBACKS)


def _download_archive(version: str, archive_name: str) -> bytes:
    failures: list[str] = []
    for base in _dist_bases():
        url = f"{base}/{version}/{archive_name}"
        print(f"Downloading {url}")
        try:
            return _http_get(url)
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            failures.append(f"{url}: {type(exc).__name__}: {exc}")
            print(f"  source failed: {type(exc).__name__}: {exc}")
    raise SystemExit(
        "could not download the Node.js runtime:\n  " + "\n  ".join(failures),
    )


def _extract(archive: Path, suffix: str, workdir: Path) -> Path:
    if suffix == "zip":
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(workdir)
    else:
        with tarfile.open(archive, "r:xz") as tar:
            try:
                tar.extractall(workdir, filter="data")
            except TypeError:
                _validate_tar_members(tar, workdir)
                tar.extractall(workdir)

    roots = [
        path
        for path in workdir.iterdir()
        if path.is_dir() and path.name.startswith("node-")
    ]
    if len(roots) != 1:
        raise SystemExit("failed to locate extracted Node.js directory")
    return roots[0]


def _validate_tar_members(tar: tarfile.TarFile, workdir: Path) -> None:
    root = workdir.resolve()
    for member in tar.getmembers():
        target = (root / member.name).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            raise SystemExit(
                f"tar member escapes target: {member.name}",
            ) from None


def _prune_runtime(dest: Path) -> None:
    # C headers only matter when compiling native addons, which the bundled
    # runtime never does; they add ~64MB to the installer payload.
    shutil.rmtree(dest / "include", ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", required=True)
    parser.add_argument(
        "--node-version",
        default=os.environ.get("QWENPAW_NODE_VERSION", DEFAULT_NODE_VERSION),
    )
    args = parser.parse_args()

    version = args.node_version
    platform_name, arch, suffix = _target()
    target = f"{platform_name}-{arch}"
    dest = Path(args.dest).resolve()
    marker = dest / ".node-runtime-version"

    if (
        _node_exe(dest).is_file()
        and _npx_exe(dest).is_file()
        and marker.is_file()
        and marker.read_text(encoding="utf-8").strip() == f"{version}-{target}"
    ):
        _prune_runtime(dest)
        print(f"node-runtime already staged ({version}-{target}); skipping")
        return

    archive_name = f"node-{version}-{target}.{suffix}"
    print(f"Staging Node.js {version} for {target}...")

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        archive = tmpdir / archive_name
        archive.write_bytes(_download_archive(version, archive_name))
        extracted = _extract(archive, suffix, tmpdir)

        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True, exist_ok=True)
        for item in extracted.iterdir():
            shutil.move(str(item), dest / item.name)

    _prune_runtime(dest)

    if not _node_exe(dest).is_file() or not _npx_exe(dest).is_file():
        raise SystemExit("staging failed: node or npx missing")
    marker.write_text(f"{version}-{target}", encoding="utf-8")
    print(f"Staged node-runtime at {dest}")


if __name__ == "__main__":
    main()
