#!/usr/bin/env python3
"""Turn the in-app browser's photograph into something the model can see.

``drive_preview action="look"`` comes back from the renderer carrying a PNG
data URL. On its own that is useless: a base64 blob in a tool result is text
the model cannot read, and it would bloat every later turn. So the bytes are
written to the same screenshot cache ``browser_vision`` uses, and the result is
built the same way: a multimodal envelope when the provider takes images in
tool results, and a path plus a ``MEDIA:`` marker when it does not, which is
what the desktop renders as an inline picture for the reader.
"""

import base64
import binascii
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

_LOOK_QUESTION = "This is the page open in the in-app browser. Read it and answer what the task needs."


def screenshots_dir() -> Path:
    from hermes_constants import get_hermes_dir

    directory = get_hermes_dir("cache/screenshots", "browser_screenshots")
    directory.mkdir(parents=True, exist_ok=True)

    return directory


def decode_data_url(data_url: str) -> Optional[bytes]:
    """The bytes of a base64 ``data:image/...`` URL, or None if it is not one."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    head, _, payload = data_url.partition(",")
    if not payload or "base64" not in head:
        return None
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None


def save_look(data_url: str) -> Optional[Path]:
    """Write the photograph to the screenshot cache; None when it is unreadable."""
    raw = decode_data_url(data_url)
    if not raw:
        return None
    path = screenshots_dir() / f"preview_look_{uuid.uuid4().hex}.png"
    path.write_bytes(raw)

    return path


def look_result(payload: Dict[str, Any], question: str = "") -> Any:
    """Build the tool result for one ``look``.

    ``payload`` is the renderer's answer. Anything without a usable image comes
    straight back, so an error from the renderer still reads as an error.
    """
    path = save_look(payload.get("image", ""))
    if path is None:
        stripped = {key: value for key, value in payload.items() if key != "image"}
        stripped.setdefault("error", "The in-app browser returned no readable image.")
        stripped["success"] = False

        return stripped

    asked = question.strip() or _LOOK_QUESTION
    rest = {key: value for key, value in payload.items() if key != "image"}

    try:
        from tools.vision_tools import (
            _EMBED_MAX_DIMENSION,
            _EMBED_TARGET_BYTES,
            _build_native_vision_tool_result,
            _resize_image_for_vision,
            _should_use_native_vision_fast_path,
        )

        if _should_use_native_vision_fast_path():
            data_url = _resize_image_for_vision(
                path, mime_type="image/png", max_base64_bytes=_EMBED_TARGET_BYTES,
                max_dimension=_EMBED_MAX_DIMENSION, force_jpeg=True)
            native = _build_native_vision_tool_result(
                image_url=str(path), question=asked, image_data_url=data_url,
                image_size_bytes=path.stat().st_size)
            meta = native.setdefault("meta", {})
            meta["screenshot_path"] = str(path)
            meta.update(rest)

            return native
    except Exception:
        # No vision routing available: fall through to the path-only answer,
        # which the desktop still renders as a picture.
        pass

    rest["screenshot_path"] = str(path)
    rest["note"] = f"Screenshot saved. MEDIA:{path}"

    return rest
