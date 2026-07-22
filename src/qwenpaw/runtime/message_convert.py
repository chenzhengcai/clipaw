# -*- coding: utf-8 -*-
"""Message conversion between AgentRequest and agentscope Msg."""
from __future__ import annotations

import logging
import mimetypes
from typing import Any, List
from pathlib import Path
from urllib.parse import unquote, urlparse

from ..constant import (
    EXTERNAL_USER_QUERY_MESSAGE_TAG,
    QWENPAW_MESSAGE_TAG_KEY,
)

logger = logging.getLogger(__name__)


def _request_message_metadata(role: str) -> dict[str, str]:
    if role != "user":
        return {}
    return {
        QWENPAW_MESSAGE_TAG_KEY: EXTERNAL_USER_QUERY_MESSAGE_TAG,
    }


def _media_type_to_block_type(media_type: str | None) -> str:
    """Map a MIME media_type to the 1.x block type the frontend expects.

    AS 2.0 uses ``"data"`` for all media; the frontend renderer still
    expects ``"image"``/``"video"``/``"audio"``.
    """
    if not media_type:
        return "data"
    major = media_type.split("/", 1)[0]
    if major in ("image", "video", "audio"):
        return major
    return "data"


def _get_last_user_text(msgs: List[Any]) -> str | None:
    """Extract the text of the last user message from a list of ``Msg``."""
    if not msgs:
        return None
    last = msgs[-1]
    if hasattr(last, "get_text_content"):
        return last.get_text_content()
    return None


def _ensure_url_scheme(url: str) -> str:
    """Prepend ``file://`` when *url* is an absolute local path.

    Handles both Unix paths (``/``, ``~``) and Windows paths
    (e.g. ``C:\\`` or ``C:/``).

    Always ``unquote()`` first so percent-encoded non-ASCII characters
    (e.g. ``%E6%B5%8B%E8%AF%95`` → ``测试``) resolve to the real
    filename on disk.  Then uses ``file://`` + raw path (not
    ``Path.as_uri()``) to avoid re-encoding.
    """
    if url.startswith(("/", "~")):
        resolved = str(Path(unquote(url)).expanduser().resolve())
    elif len(url) >= 3 and url[1] == ":" and url[2] in ("/", "\\"):
        resolved = str(Path(unquote(url)).resolve())
    else:
        return url

    resolved = resolved.replace("\\", "/")
    if not resolved.startswith("/"):
        resolved = "/" + resolved
    return "file://" + resolved


_PREVIEW_MARKER = "/files/preview/"


def _file_url_to_local_path(url: str) -> str | None:
    """Extract a local filesystem path from a file attachment URL.

    Handles three formats produced by the console upload + SDK pipeline:
    - ``http(s)://host/files/preview/<path>`` — extract ``<path>``
    - ``file:///path`` — strip the scheme
    - ``/absolute/path`` — pass through
    """
    if not url or not isinstance(url, str):
        return None
    s = url.strip()
    if not s:
        return None

    idx = s.find(_PREVIEW_MARKER)
    if idx != -1:
        path = s[idx + len(_PREVIEW_MARKER):]
        q = path.find("?")
        if q != -1:
            path = path[:q]
        h = path.find("#")
        if h != -1:
            path = path[:h]
        if not path:
            return None
        decoded = unquote(path)
        if not decoded.startswith("/"):
            decoded = "/" + decoded
        return decoded

    if s.startswith("file:"):
        s = s[5:]
        s = s.lstrip("/")
        decoded = unquote(s)
        return "/" + decoded if not decoded.startswith("/") else decoded

    if s.startswith(("/", "~")):
        return unquote(s)

    if len(s) >= 3 and s[1] == ":" and s[2] in ("/", "\\"):
        return unquote(s)

    return None


# pylint: disable=too-many-branches
def _request_input_to_msgs(
    input_list: List[Any],
) -> List[Any]:
    """Convert ``AgentRequest.input`` (list of 1.x Message) to a list of
    agentscope 2.0 ``Msg`` objects.

    Handles text, image, audio, video, and file content blocks.
    """
    try:
        from agentscope.message import Msg, TextBlock, DataBlock
        from agentscope.message._block import URLSource
    except Exception:
        logger.error(
            "Failed to import agentscope.message; user input will be dropped",
            exc_info=True,
        )
        return []

    _MEDIA_TYPES = {
        "image": "image",
        "audio": "audio",
        "video": "video",
    }

    out: List[Any] = []
    for m in input_list:
        role = getattr(m, "role", None)
        if hasattr(role, "value"):
            role = role.value
        role = role or "user"
        if role == "tool":
            role = "assistant"

        blocks: list = []
        for c in getattr(m, "content", None) or []:
            ctype = getattr(c, "type", None)
            if hasattr(ctype, "value"):
                ctype = ctype.value

            if ctype == "text":
                text = getattr(c, "text", None) or ""
                if text:
                    blocks.append(TextBlock(type="text", text=text))

            elif ctype in _MEDIA_TYPES:
                url = (
                    getattr(c, "image_url", None)
                    or getattr(c, "audio_url", None)
                    or getattr(c, "video_url", None)
                    or getattr(c, "url", None)
                )
                if url:
                    url = _ensure_url_scheme(str(url))
                    url_path = urlparse(url).path
                    guessed, _ = mimetypes.guess_type(url_path)
                    if guessed and guessed.startswith(
                        f"{_MEDIA_TYPES[ctype]}/",
                    ):
                        media_type = guessed
                    else:
                        fallback_ext = "jpeg" if ctype == "image" else "mpeg"
                        media_type = f"{_MEDIA_TYPES[ctype]}/{fallback_ext}"
                    try:
                        blocks.append(
                            DataBlock(
                                source=URLSource(
                                    url=url,
                                    media_type=media_type,
                                ),
                            ),
                        )
                    except Exception:
                        logger.debug(
                            "Failed to create DataBlock for %s url=%s",
                            ctype,
                            url,
                        )

            elif ctype == "file":
                url = getattr(c, "file_url", None) or getattr(c, "url", None)
                if url:
                    local_path = _file_url_to_local_path(str(url))
                    filename = (
                        getattr(c, "file_name", None)
                        or getattr(c, "filename", None)
                        or (local_path.rsplit("/", 1)[-1]
                            if local_path else "file")
                    )
                    if local_path:
                        blocks.append(
                            TextBlock(
                                type="text",
                                text=(
                                    f"File '{filename}' is available at: "
                                    f"{local_path}"
                                ),
                            ),
                        )
                    else:
                        blocks.append(
                            TextBlock(
                                type="text",
                                text=f"File '{filename}'",
                            ),
                        )

        if not blocks:
            continue

        out.append(
            Msg(
                name=role,
                role=role,
                content=blocks,
                metadata=_request_message_metadata(role),
            ),
        )
    return out
