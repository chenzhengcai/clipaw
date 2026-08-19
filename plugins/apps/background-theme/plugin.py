# -*- coding: utf-8 -*-
"""Background Theme plugin - backend.

Lets the user pick an image or a video as:

* the global app background (the whole Console surface), and
* the chat dialog background (the chat conversation area).

REST API (mounted under ``/api/background-theme`` via
``api.register_http_router``):

* ``GET  /config``             - active background config for both slots
* ``PUT  /config``             - set / clear one slot's background
* ``GET  /library``            - list uploaded background files
* ``POST /library``            - upload an image/video (multipart)
* ``DELETE /library/{name}``   - delete an uploaded file

Uploaded media live under ``<plugin_dir>/data/library/`` and are served
by the public plugin static route
``/api/frontend_plugin/background-theme/files/data/library/<name>``
(``FileResponse`` handles HTTP Range so videos stream correctly).
"""

import json
import logging
import mimetypes
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from qwenpaw.constant import WORKING_DIR
from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

PLUGIN_ID = "background-theme"

# Data lives OUTSIDE the plugin directory (under the QwenPaw working dir,
# e.g. ~/.qwenpaw/background-theme/), so reinstalling / updating the plugin
# (which rmtree's the plugin dir) never wipes the user's backgrounds.
_DATA_DIR = WORKING_DIR / PLUGIN_ID
_LIBRARY_DIR = _DATA_DIR / "library"
_CONFIG_FILE = _DATA_DIR / "config.json"

# Legacy location (plugin dir) - migrated to _DATA_DIR once at startup.
_LEGACY_DATA_DIR = Path(__file__).resolve().parent / "data"

# Upload guards.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB - background videos can be big.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
SLOTS = ("global", "chat")
_FITS = ("cover", "contain", "fill")

_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

# Defaults applied when the config file has never been written.
_EMPTY_SLOT: Dict[str, Any] = {
    "type": None,
    "file": None,
    "color": None,
    "fit": "cover",
    "dim": 0.35,
    "blur": 0,
    "opacity": 1.0,
}
# Master switch defaults to OFF: backgrounds only render after the user
# explicitly enables the feature (mirrors the theme-plugin toggle UX).
_DEFAULT_ENABLED = False


def _kind_for_suffix(suffix: str) -> Optional[str]:
    """Return "image" / "video" for a file suffix, else None."""
    s = suffix.lower()
    if s in IMAGE_EXTS:
        return "image"
    if s in VIDEO_EXTS:
        return "video"
    return None


def _safe_filename(raw: str) -> str:
    """Keep the display part of an upload name filesystem-safe."""
    name = (raw or "background").replace("\\", "/").split("/")[-1]
    name = _UNSAFE_NAME.sub("_", name).strip("._") or "background"
    return name[:120]


def _media_url(file_name: str) -> str:
    """Auth-protected media URL served by this plugin's own router.

    The frontend appends ``?token=`` (the Console auth supports token
    query params for <img>/<video> which cannot send headers).
    """
    return f"/api/background-theme/files/{file_name}"


def _read_config() -> Dict[str, Any]:
    """Load config.json; missing/corrupt file falls back to defaults."""
    try:
        raw = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            enabled = raw.get("enabled")
            slots = raw.get("slots")
            if isinstance(slots, dict):
                out: Dict[str, Any] = {
                    "enabled": enabled if isinstance(enabled, bool) else _DEFAULT_ENABLED,
                }
                for slot in SLOTS:
                    base = dict(_EMPTY_SLOT)
                    val = slots.get(slot)
                    if isinstance(val, dict):
                        base.update(
                            {k: v for k, v in val.items() if k in base}
                        )
                    out[slot] = base
                return {"enabled": out["enabled"], "slots": {s: out[s] for s in SLOTS}}
    except FileNotFoundError:
        pass
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("[background-theme] config unreadable (%s); reset", exc)
    return {
        "enabled": _DEFAULT_ENABLED,
        "slots": {s: dict(_EMPTY_SLOT) for s in SLOTS},
    }


def _write_config(cfg: Dict[str, Any]) -> None:
    """Persist config.json atomically (temp file + os.replace)."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(_DATA_DIR), prefix=".config-", suffix=".tmp"
    )
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
        Path(tmp_path).replace(_CONFIG_FILE)
    except OSError:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def _library_items() -> List[Dict[str, Any]]:
    """List every file in the library with metadata, newest first."""
    if not _LIBRARY_DIR.exists():
        return []
    items: List[Dict[str, Any]] = []
    for path in _LIBRARY_DIR.iterdir():
        if not path.is_file() or path.name.startswith("."):
            continue
        kind = _kind_for_suffix(path.suffix)
        if kind is None:
            continue
        stat = path.stat()
        items.append(
            {
                "name": path.name,
                "kind": kind,
                "size": stat.st_size,
                "addedAt": int(stat.st_mtime * 1000),
                "url": _media_url(path.name),
            }
        )
    items.sort(key=lambda it: it.get("addedAt") or 0, reverse=True)
    return items


# ── HTTP router ──────────────────────────────────────────────────────

router = APIRouter()


class BackgroundSpec(BaseModel):
    """One slot's background settings (as sent by the settings page)."""

    type: Optional[str] = Field(None, description='"image" | "video" | "color" | null')
    file: Optional[str] = Field(None, description="library file name (image/video)")
    color: Optional[str] = Field(
        None, description='hex color "#RGB" / "#RRGGBB" (type="color")'
    )
    fit: str = Field("cover", description='"cover" | "contain" | "fill"')
    dim: float = Field(0.35, ge=0.0, le=1.0, description="dim overlay opacity")
    blur: float = Field(0.0, ge=0.0, le=40.0, description="blur px")
    opacity: float = Field(
        1.0, ge=0.0, le=1.0, description="background layer transparency (1 = opaque)"
    )


class ConfigUpdate(BaseModel):
    """PUT /config body."""

    slot: str = Field(..., description='"global" | "chat"')
    background: Optional[BackgroundSpec] = Field(
        None, description="null clears the slot"
    )


_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _normalize_hex(value: str) -> str:
    """Validate and normalize a hex color to #RRGGBB (uppercase digits)."""
    value = (value or "").strip()
    if not _HEX_COLOR_RE.match(value):
        raise HTTPException(400, "color must be a hex value like #RGB or #RRGGBB")
    if len(value) == 4:  # #RGB -> #RRGGBB
        value = "#" + "".join(ch * 2 for ch in value[1:])
    return value.upper()


def _decorate(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Attach serving URLs to the config payload for the frontend."""
    out: Dict[str, Any] = {"enabled": cfg.get("enabled") is True, "slots": {}}
    for slot, spec in cfg["slots"].items():
        enriched = dict(spec)
        enriched.pop("url", None)
        if spec.get("type") == "color":
            enriched["url"] = None
            enriched["file"] = None
        elif spec.get("file"):
            enriched["url"] = _media_url(spec["file"])
            enriched["color"] = None
        else:
            enriched["type"] = None
            enriched["url"] = None
            enriched["color"] = None
        out["slots"][slot] = enriched
    return out


@router.get("/config", summary="Get background config (incl. master switch)")
async def get_config() -> Dict[str, Any]:
    return _decorate(_read_config())


class EnabledUpdate(BaseModel):
    """PUT /enabled body - master switch (plugin-manager style toggle)."""

    enabled: bool


@router.put("/enabled", summary="Toggle the background feature on/off")
async def put_enabled(update: EnabledUpdate) -> Dict[str, Any]:
    cfg = _read_config()
    cfg["enabled"] = update.enabled is True
    _write_config(cfg)
    return _decorate(cfg)


@router.put("/config", summary="Set or clear one slot's background")
async def put_config(update: ConfigUpdate) -> Dict[str, Any]:
    slot = update.slot
    if slot not in SLOTS:
        raise HTTPException(400, f"slot must be one of {SLOTS}")

    cfg = _read_config()
    if update.background is None or (
        not update.background.file and not update.background.color
    ):
        cfg["slots"][slot] = dict(_EMPTY_SLOT)
    else:
        spec = update.background
        if spec.type not in ("image", "video", "color"):
            raise HTTPException(400, "type must be image, video or color")
        if spec.fit not in _FITS:
            raise HTTPException(400, f"fit must be one of {_FITS}")
        if spec.type == "color":
            cfg["slots"][slot] = {
                "type": "color",
                "file": None,
                "color": _normalize_hex(spec.color or ""),
                "fit": spec.fit,
                "dim": spec.dim,
                "blur": spec.blur,
                "opacity": spec.opacity,
            }
        else:
            target = _LIBRARY_DIR / (spec.file or "")
            resolved = target.resolve()
            if not resolved.is_relative_to(_LIBRARY_DIR.resolve()):
                raise HTTPException(403, "Access denied")
            if not resolved.exists():
                raise HTTPException(404, f"file not in library: {spec.file}")
            if _kind_for_suffix(resolved.suffix) != spec.type:
                raise HTTPException(400, "file kind does not match type")
            cfg["slots"][slot] = {
                "type": spec.type,
                "file": spec.file,
                "color": None,
                "fit": spec.fit,
                "dim": spec.dim,
                "blur": spec.blur,
                "opacity": spec.opacity,
            }
    _write_config(cfg)
    return _decorate(cfg)


@router.get("/library", summary="List background library")
async def list_library() -> Dict[str, Any]:
    return {"items": _library_items()}


@router.post("/library", summary="Upload a background image/video")
async def upload_library_file(file: UploadFile = File(...)) -> Dict[str, Any]:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    name = file.filename or ""
    kind = _kind_for_suffix(Path(name).suffix)
    if kind is None and ctype.startswith("image/"):
        kind = "image"
    if kind is None and ctype.startswith("video/"):
        kind = "video"
    if kind is None:
        raise HTTPException(
            400,
            "Unsupported file type - please upload an image "
            "(jpg/png/gif/webp/avif) or a video (mp4/webm/mov).",
        )

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413, f"File too large (limit {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)"
        )
    if not data:
        raise HTTPException(400, "Empty file")

    suffix = Path(name).suffix.lower() or (
        mimetypes.guess_extension(ctype) or (".png" if kind == "image" else ".mp4")
    )
    stored_name = f"{uuid.uuid4().hex[:8]}_{_safe_filename(name)}"
    if _kind_for_suffix(Path(stored_name).suffix) is None:
        stored_name = f"{stored_name}{suffix}"

    _LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    target = _LIBRARY_DIR / stored_name
    resolved = target.resolve()
    if not resolved.is_relative_to(_LIBRARY_DIR.resolve()):
        raise HTTPException(403, "Access denied")
    resolved.write_bytes(data)

    logger.info(
        "[background-theme] stored %s (%s, %d bytes)", stored_name, kind, len(data)
    )
    return {
        "name": stored_name,
        "kind": kind,
        "size": len(data),
        "addedAt": int(time.time() * 1000),
        "url": _media_url(stored_name),
    }


@router.delete("/library/{name}", summary="Delete a library file")
async def delete_library_file(name: str) -> Dict[str, Any]:
    target = (_LIBRARY_DIR / name).resolve()
    if not target.is_relative_to(_LIBRARY_DIR.resolve()):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "File not found")
    target.unlink()

    # Clear any slot that referenced the deleted file so the UI never
    # points at a 404 media URL.
    cfg = _read_config()
    changed = False
    for slot in SLOTS:
        if cfg["slots"][slot].get("file") == name:
            cfg["slots"][slot] = dict(_EMPTY_SLOT)
            changed = True
    if changed:
        _write_config(cfg)

    return {"deleted": name, "config": _decorate(cfg) if changed else None}


@router.get("/files/{name}", summary="Serve a background media file")
async def serve_media_file(name: str) -> FileResponse:
    """Stream an uploaded image/video (FileResponse supports HTTP Range,
    so videos play/seek properly). Requires auth like every /api route -
    the frontend passes the token via ``?token=`` query param."""
    target = (_LIBRARY_DIR / name).resolve()
    if not target.is_relative_to(_LIBRARY_DIR.resolve()):
        raise HTTPException(403, "Access denied")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"File not found: {name}")
    return FileResponse(target)


def _migrate_legacy_data() -> None:
    """One-time migration from the old in-plugin data dir (~/plugins/
    <id>/data) to the persistent working-dir location. Never overwrites
    existing files in the new location."""
    if not _LEGACY_DATA_DIR.exists():
        return
    _DATA_DIR.mkdir(parents=True, exist_ok=True)

    legacy_lib = _LEGACY_DATA_DIR / "library"
    if legacy_lib.exists():
        for path in legacy_lib.iterdir():
            if not path.is_file() or path.name.startswith("."):
                continue
            dest = _LIBRARY_DIR / path.name
            if not dest.exists():
                try:
                    path.replace(dest)
                    logger.info("[background-theme] migrated %s", path.name)
                except OSError as exc:
                    logger.warning("[background-theme] migrate %s failed: %s", path.name, exc)

    legacy_cfg = _LEGACY_DATA_DIR / "config.json"
    if legacy_cfg.exists() and not _CONFIG_FILE.exists():
        try:
            legacy_cfg.replace(_CONFIG_FILE)
            logger.info("[background-theme] migrated config.json")
        except OSError as exc:
            logger.warning("[background-theme] migrate config failed: %s", exc)

    # Remove the legacy library dir once empty (config may still live there).
    try:
        if legacy_lib.exists() and not any(legacy_lib.iterdir()):
            legacy_lib.rmdir()
    except OSError:
        pass


# ── Plugin entry point ───────────────────────────────────────────────


class BackgroundThemePlugin:
    """Register the REST router when the plugin loads."""

    def register(self, api: PluginApi) -> None:
        _migrate_legacy_data()
        _LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        api.register_http_router(router, prefix=f"/{PLUGIN_ID}", tags=["background-theme"])
        logger.info(
            "[background-theme] router mounted at /api/%s (data: %s)",
            PLUGIN_ID,
            _DATA_DIR,
        )


plugin = BackgroundThemePlugin()
