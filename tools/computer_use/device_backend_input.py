"""Acting on a mobile device: taps, swipes, text, keys, and the overlay guard.

Everything here goes through `adb shell input`, which works for the unprivileged shell
user. The one thing that is not an input primitive is `error_overlay`, and it belongs
beside the actions rather than beside the screen reader because of what it protects
against: React Native's LogBox sits on top of the app, eats the tap, and `input tap`
still exits 0. Two navigation steps were lost to that during the prototype before the
check existed. A backend that reports such an action as successful is lying.
"""

from __future__ import annotations

import logging
import re
import shlex
import subprocess
from typing import Dict, List, Optional, Sequence

from tools.computer_use.backend import UIElement
from tools.computer_use.device_backend_screen import DeviceError

logger = logging.getLogger("tools.computer_use.device")

_INPUT_TIMEOUT = 30

# Names the ABC's `keys` argument uses, mapped onto Android keycodes. Anything not listed
# is passed through when it already looks like a keycode, so a caller is never blocked
# from a key this table has not heard of.
_KEY_ALIASES: Dict[str, str] = {
    "return": "ENTER", "enter": "ENTER", "esc": "ESCAPE", "escape": "ESCAPE",
    "delete": "DEL", "backspace": "DEL", "forward_delete": "FORWARD_DEL",
    "space": "SPACE", "tab": "TAB", "up": "DPAD_UP", "down": "DPAD_DOWN",
    "left": "DPAD_LEFT", "right": "DPAD_RIGHT", "home": "HOME", "back": "BACK",
    "menu": "MENU", "search": "SEARCH", "power": "POWER", "app_switch": "APP_SWITCH",
    "volume_up": "VOLUME_UP", "volume_down": "VOLUME_DOWN", "camera": "CAMERA",
    "page_up": "PAGE_UP", "page_down": "PAGE_DOWN",
}
# Modifiers Android's `input keycombination` understands (API 31+).
_META_FLAGS: Dict[str, str] = {
    "ctrl": "KEYCODE_CTRL_LEFT", "control": "KEYCODE_CTRL_LEFT",
    "alt": "KEYCODE_ALT_LEFT", "shift": "KEYCODE_SHIFT_LEFT",
    "meta": "KEYCODE_META_LEFT", "cmd": "KEYCODE_META_LEFT", "super": "KEYCODE_META_LEFT",
}


def run_input(adb: Sequence[str], args: List[str], *, timeout: int = _INPUT_TIMEOUT) -> str:
    proc = subprocess.run([*adb, "shell", "input", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    if proc.returncode != 0:
        raise DeviceError(f"input {' '.join(args)} exited {proc.returncode}: "
                          f"{(proc.stderr or proc.stdout or '').strip()[:300]}")
    return proc.stdout


def tap(adb: Sequence[str], x: int, y: int) -> None:
    run_input(adb, ["tap", str(int(x)), str(int(y))])


def long_press(adb: Sequence[str], x: int, y: int, *, ms: int = 700) -> None:
    """A long press is a zero-length swipe. Android has no separate primitive."""
    swipe(adb, x, y, x, y, ms=ms)


def swipe(adb: Sequence[str], x1: int, y1: int, x2: int, y2: int, *, ms: int = 300) -> None:
    run_input(adb, ["swipe", *(str(int(v)) for v in (x1, y1, x2, y2)), str(int(ms))])


def type_text(adb: Sequence[str], text: str) -> None:
    """`input text` encodes a space as %s and has no Unicode path at all.

    Refusing non-ASCII here is deliberate. Sending it anyway drops or mangles characters
    silently, which surfaces later as a test failure about the wrong thing.
    """
    if not text.isascii():
        raise DeviceError("`adb shell input text` cannot send non-ASCII text. "
                          "Paste it through the app, or use an ASCII value.")
    payload = text.replace("%", "%%").replace(" ", "%s")
    run_input(adb, ["text", shlex.quote(payload)])


def _keycode(name: str) -> str:
    key = name.strip()
    if key.upper().startswith("KEYCODE_"):
        return key.upper()
    resolved = _KEY_ALIASES.get(key.lower(), key.upper())
    return f"KEYCODE_{resolved}"


def press_keys(adb: Sequence[str], keys: str) -> str:
    """One key, or a modifier combo through `input keycombination`.

    Returns the keycode sequence actually sent, so a caller can report what happened
    rather than echoing back what was asked for.
    """
    parts = [part for part in re.split(r"[+\s]+", keys.strip()) if part]
    if not parts:
        raise DeviceError("no key given.")
    modifiers = [_META_FLAGS[p.lower()] for p in parts[:-1] if p.lower() in _META_FLAGS]
    unknown = [p for p in parts[:-1] if p.lower() not in _META_FLAGS]
    if unknown:
        raise DeviceError(f"unknown modifier(s): {', '.join(unknown)}")
    final = _keycode(parts[-1])
    if modifiers:
        run_input(adb, ["keycombination", *modifiers, final])
        return " ".join([*modifiers, final])
    run_input(adb, ["keyevent", final])
    return final


def error_overlay(elements: List[UIElement]) -> Optional[str]:
    """The React Native error overlay's headline, or None.

    The overlay carries no resource-id anywhere, so it is identified by the content
    descriptions of its own controls. Treat a hit as "the screen is not the app's" and
    never as the app's error signal: an error that definitely happened, and definitely
    reached logcat, sometimes raised no overlay at all. Assert on the log, use this to
    stop reporting swallowed taps as successes.
    """
    descriptions = {e.attributes.get("content_desc", "") for e in elements}
    if "Dismiss" not in descriptions:
        return None
    if not descriptions & {"Minimize", "Copy"}:
        return None
    for position, element in enumerate(elements):
        text = element.attributes.get("text", "")
        if text.startswith("Log ") and " of " in text:
            tail = [e.attributes.get("text", "") for e in elements[position:position + 6]
                    if e.attributes.get("text")]
            return " | ".join(tail[:3])
    return "an error overlay is covering the app"
