"""Reading a mobile device's screen: the view hierarchy, refs, and the SOM overlay.

The read half and the act half of this backend use different transports on purpose.
`adb shell uiautomator dump` is SIGKILLed for the unprivileged shell user on API 36 and
works only after `adb root`, which a physical device does not offer. The Android CLI's
instrumentation server has no such problem, so reads go through `android layout` while
actions stay on `adb shell input` (see `device_backend_input.py`).

Refs are assigned here rather than passed through. `resource-id` is stable across
re-dumps and across navigation, but it is present on only some elements and is not
unique, so it cannot be the address. It is still the address an agent should prefer
where it exists, because a positional index does not survive a re-layout and the soft
keyboard opening is a re-layout.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from tools.computer_use.backend import UIElement

logger = logging.getLogger("tools.computer_use.device")

_BOUNDS_RE = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")
_CENTER_RE = re.compile(r"\[(-?\d+),(-?\d+)\]")

# The CLI's own instrumentation server is in every dump and is never a target.
_NOISE_PACKAGES = ("com.android.cli.interact.instrumentation",)
# `android layout` can exit 0 and print nothing when the instrumentation server is cold.
# A caller that does not retry sees an empty screen and concludes the app crashed.
_EMPTY_DUMP_RETRIES = 3
_LAYOUT_TIMEOUT = 90
# What the CLI says when its server is alive but no longer able to answer, which happens
# after something else has taken the device's single UiAutomation connection from it. The
# message names nothing a caller can act on, and the fix is always the same: restart it.
_WEDGED_SERVER = "Unrecognized response from instrumentation server"


def _restart_instrumentation(adb: List[str]) -> bool:
    """Force-stop the reader's server so the next call starts a fresh one.

    The server survives losing its UiAutomation connection and then answers every request
    with a refusal, so retrying the same call forever is the one thing that cannot work.
    """
    try:
        from hermes_cli.tools_config_android import LAYOUT_INSTRUMENTATION_PACKAGE
        subprocess.run([*adb, "shell", "am", "force-stop", LAYOUT_INSTRUMENTATION_PACKAGE],
                       capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError, ImportError) as e:
        logger.debug("could not restart the instrumentation server: %s", e)
        return False
    time.sleep(0.5)
    return True


class DeviceError(RuntimeError):
    """A device command failed in a way the caller should see verbatim."""


def _run(argv: List[str], *, timeout: int = _LAYOUT_TIMEOUT) -> str:
    proc = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout)
    if proc.returncode != 0:
        raise DeviceError(f"{' '.join(argv)} exited {proc.returncode}: "
                          f"{(proc.stderr or proc.stdout or '').strip()[:400]}")
    return proc.stdout


def _parse_bounds(raw: str) -> Tuple[int, int, int, int]:
    """Device bounds are `[left,top][right,bottom]`; the ABC wants `(x, y, w, h)`."""
    match = _BOUNDS_RE.match(raw or "")
    if not match:
        return (0, 0, 0, 0)
    left, top, right, bottom = (int(g) for g in match.groups())
    return (left, top, right - left, bottom - top)


def _parse_center(raw: str, bounds: Tuple[int, int, int, int]) -> Tuple[int, int]:
    """The CLI precomputes the tap point. Derive it only when it is missing."""
    match = _CENTER_RE.match(raw or "")
    if match:
        return (int(match.group(1)), int(match.group(2)))
    x, y, width, height = bounds
    return (x + width // 2, y + height // 2)


def _short_id(resource_id: str) -> str:
    """`resource-id` without its package prefix, which is what the app set as its testID."""
    return resource_id.split("/", 1)[-1] if resource_id else ""


def _role(class_name: str) -> str:
    """The widget class's last segment. Android has no AX role vocabulary, and inventing a
    mapping onto macOS's would lose information the model can use directly."""
    return (class_name or "View").rsplit(".", 1)[-1]


def _element_token(item: Dict[str, Any], ordinal: int) -> str:
    """A handle that changes when the element under an index changes.

    The ABC passes this alongside the index so a stale reference errors instead of
    silently acting on whatever moved into that slot.
    """
    identity = "|".join(str(item.get(key, "")) for key in
                        ("resource-id", "text", "content-desc", "class")) + f"|{ordinal}"
    return hashlib.sha1(identity.encode("utf-8")).hexdigest()[:16]


def layout_argv(cli: str, serial: str = "", *, full: bool = False) -> List[str]:
    argv = [cli, "layout", "--flat"]
    if full:
        argv.append("--full")
    if serial:
        argv += ["--device", serial]
    return argv


def read_elements(cli: str, serial: str = "", *, full: bool = False,
                  adb: Optional[List[str]] = None) -> List[UIElement]:
    """The current screen as 1-based SOM elements, interactive ones first in document order."""
    argv = layout_argv(cli, serial, full=full)
    raw = ""
    for attempt in range(_EMPTY_DUMP_RETRIES):
        raw = _run(argv)
        if raw.find("[") >= 0:
            break
        if _WEDGED_SERVER in raw and adb and _restart_instrumentation(adb):
            continue
        time.sleep(1.0 + attempt)
    start = raw.find("[")
    if start < 0:
        raise DeviceError(
            f"`{' '.join(argv)}` returned no JSON after {_EMPTY_DUMP_RETRIES} attempts"
            + (f" (last answer: {raw.strip()[:120]})" if raw.strip() else "")
            + ". Check `adb shell pm list instrumentation`; the instrumentation server may be gone.")
    items = json.loads(raw[start:])

    seen: Dict[Tuple[Any, ...], int] = {}
    elements: List[UIElement] = []
    for item in items:
        resource_id = item.get("resource-id") or ""
        if any(resource_id.startswith(package) for package in _NOISE_PACKAGES):
            continue
        key = (resource_id, item.get("text"), item.get("content-desc"), item.get("class"))
        ordinal = seen.get(key, 0)
        seen[key] = ordinal + 1
        bounds = _parse_bounds(item.get("bounds", ""))
        interactions = tuple(item.get("interactions", ()))
        elements.append(UIElement(
            index=len(elements) + 1,
            role=_role(item.get("class", "")),
            label=(item.get("text") or item.get("content-desc")
                   or _short_id(resource_id) or _role(item.get("class", ""))),
            bounds=bounds,
            app=resource_id.split(":", 1)[0] if ":" in resource_id else "",
            attributes={
                "test_id": _short_id(resource_id),
                "resource_id": resource_id,
                "text": item.get("text") or "",
                "content_desc": item.get("content-desc") or "",
                "interactions": [action.lower() for action in interactions],
                "center": list(_parse_center(item.get("center", ""), bounds)),
                "interactive": bool(interactions),
            },
            element_token=_element_token(item, ordinal),
        ))
    return elements


def find_by_test_id(elements: List[UIElement], test_id: str) -> UIElement:
    """Address by testID, the handle that survives a re-layout.

    Ambiguity is an error rather than a first match: acting on the wrong one of two
    same-named buttons is a silent wrong answer, and the caller has the ref table.
    """
    hits = [e for e in elements if e.attributes.get("test_id") == test_id]
    if not hits:
        present = sorted({e.attributes.get("test_id", "") for e in elements if e.attributes.get("test_id")})
        raise DeviceError(f"no element with testID {test_id!r}. On this screen: "
                          + (", ".join(present[:20]) or "none carry a testID"))
    if len(hits) > 1:
        raise DeviceError(f"testID {test_id!r} matches {len(hits)} elements; address one by index.")
    return hits[0]


def resolve(elements: List[UIElement], *, element: Optional[int] = None,
            test_id: str = "", token: str = "") -> UIElement:
    """Resolve an index or a testID against this capture, refusing a stale token."""
    if test_id:
        return find_by_test_id(elements, test_id)
    if element is None:
        raise DeviceError("no target: pass an element index or a testID.")
    if not 1 <= element <= len(elements):
        raise DeviceError(f"element {element} is not in this capture "
                          f"(it holds {len(elements)}). Capture again; indices do not "
                          "survive a screen change.")
    found = elements[element - 1]
    if token and found.element_token != token:
        raise DeviceError(f"element {element} is no longer the one that token addressed. "
                          "The screen changed; capture again.")
    return found


@dataclass
class ScreenPair:
    """The hierarchy and the pixels of one moment, read together.

    One object rather than two fields, because the only thing that makes a cached read
    safe to reuse is that its elements and its image come from the same instant: a SOM
    index that points at a widget the picture no longer shows is a wrong answer that
    looks right. A caller takes the whole pair or takes a fresh one.
    """

    elements: List[UIElement]
    png: bytes
    serial: str
    taken_at: float


def read_screen_pair(cli: str, serial: str, adb: List[str]) -> ScreenPair:
    """Read the hierarchy and grab the frame at once.

    Concurrent because they are independent and the hierarchy read dominates: measured on
    an emulator, sequential is 1186 ms and concurrent is 991 ms, so the screenshot is free.
    """
    with ThreadPoolExecutor(max_workers=2) as pool:
        elements_task = pool.submit(read_elements, cli, serial, adb=adb)
        png_task = pool.submit(capture_png, adb)
        return ScreenPair(elements=elements_task.result(), png=png_task.result(),
                          serial=serial, taken_at=time.monotonic())


_SCREEN_SIZES: Dict[str, Tuple[int, int]] = {}


def screen_size_cached(adb: List[str], serial: str) -> Tuple[int, int]:
    """The screen size, read once per device.

    It changes only on a rotation or a resize, both of which change the frame's own
    dimensions, so `forget_screen_size` is called from the capture path rather than this
    one guessing. Sixteen milliseconds each, which is nothing alone and is paid on every
    scroll.
    """
    cached = _SCREEN_SIZES.get(serial)
    if cached is not None:
        return cached
    size = screen_size(adb)
    _SCREEN_SIZES[serial] = size
    return size


def forget_screen_size(serial: str) -> None:
    _SCREEN_SIZES.pop(serial, None)


def screen_size(adb: List[str]) -> Tuple[int, int]:
    out = _run([*adb, "shell", "wm", "size"], timeout=30)
    match = re.search(r"(\d+)x(\d+)", out)
    if not match:
        raise DeviceError(f"could not read the screen size from `wm size`: {out.strip()[:200]!r}")
    return int(match.group(1)), int(match.group(2))


def capture_png(adb: List[str], *, timeout: int = 60) -> bytes:
    """A single frame. `exec-out screencap -p` keeps the bytes off the device's storage."""
    proc = subprocess.run([*adb, "exec-out", "screencap", "-p"], capture_output=True, timeout=timeout)
    if proc.returncode != 0 or not proc.stdout:
        raise DeviceError("screencap produced no image: "
                          + (proc.stderr or b"").decode("utf-8", "replace").strip()[:200])
    return proc.stdout


def draw_som_overlay(png: bytes, elements: List[UIElement]) -> bytes:
    """Number every interactive element on the frame, so a vision model can click by index.

    Labels are placed inside the element's own box rather than beside it: a phone screen
    has no margin to spill into, and a label drawn outside a bottom-row button lands off
    the image entirely.
    """
    from PIL import Image, ImageDraw, ImageFont

    image = Image.open(BytesIO(png)).convert("RGB")
    draw = ImageDraw.Draw(image)
    scale = image.width / max(_bounding_width(elements), 1)
    # A phone frame is around 1080 px wide, where the default bitmap font is roughly six
    # pixels tall and unreadable once the image is downscaled for the model.
    font = ImageFont.load_default(size=max(14, image.width // 45))
    for element in elements:
        if not element.attributes.get("interactive"):
            continue
        x, y, width, height = (int(value * scale) for value in element.bounds)
        if width <= 0 or height <= 0:
            continue
        draw.rectangle([x, y, x + width, y + height], outline=(255, 64, 0), width=3)
        label = str(element.index)
        box = draw.textbbox((0, 0), label, font=font)
        pad = 4
        draw.rectangle([x, y, x + (box[2] - box[0]) + 2 * pad, y + (box[3] - box[1]) + 2 * pad],
                       fill=(255, 64, 0))
        draw.text((x + pad, y + pad - box[1]), label, fill=(255, 255, 255), font=font)
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _bounding_width(elements: List[UIElement]) -> int:
    """Widest right edge in the hierarchy, which is the coordinate space the dump used.

    The screenshot and the hierarchy can disagree when the device reports a logical size
    different from the framebuffer's, so overlays are scaled rather than assumed aligned.
    """
    return max((e.bounds[0] + e.bounds[2] for e in elements), default=0)


def current_activity(adb: List[str]) -> str:
    try:
        out = _run([*adb, "shell", "dumpsys", "activity", "activities"], timeout=30)
    except (DeviceError, subprocess.SubprocessError):
        return ""
    match = re.search(r"topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)", out)
    return match.group(1) if match else ""
