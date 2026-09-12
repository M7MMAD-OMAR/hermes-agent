"""`ComputerUseBackend` over a mobile device, Android first.

Selected with ``HERMES_COMPUTER_USE_BACKEND=android``. It satisfies the same contract the
cua-driver backend does, so `handle_computer_use`'s dispatch, its permission gate and its
vision routing all apply unchanged; a device is just another surface to see and act on.

Two shapes of this backend are not shared with the desktop one and are worth knowing:

* A transport-level success is not a semantic one. React Native's error overlay eats taps
  while `input tap` still exits 0, so every action that should change the screen is
  followed by an overlay check and reports ``effect="suspected_noop"`` when one is up.
* Addressing prefers the app's own testID over a positional index. An index is invalidated
  by anything that reflows the screen, and the soft keyboard opening is a reflow.

Never calls `adb kill-server`: the server on this host is shared with every other client,
including the user's own tooling and other Hermes sessions.
"""

from __future__ import annotations

import logging
import os
import subprocess
from base64 import b64encode
from typing import Any, Dict, List, Optional, Tuple

from tools.computer_use.backend import ActionResult, CaptureResult, ComputerUseBackend, UIElement
from tools.computer_use.device_backend_input import (
    error_overlay, long_press, press_keys, run_input, swipe, tap, type_text)
from tools.computer_use.device_backend_screen import (
    DeviceError, capture_png, current_activity, draw_som_overlay, read_elements, resolve,
    screen_size)

logger = logging.getLogger("tools.computer_use.device")

_SERIAL_ENV = "ANDROID_SERIAL"
# Fraction of the screen one scroll tick travels. Two thirds of a viewport per tick matches
# what a person's thumb does and keeps a three-tick default from skipping whole sections.
_SCROLL_SPAN = 0.40
_SCROLL_MS = 400
# Unit vectors for the content's travel. Asking to scroll "down" means show me what is
# below, so the finger drags the content up: the sign is inverted on purpose.
_SCROLL_DIRECTIONS = {"down": (0, -1), "up": (0, 1), "right": (-1, 0), "left": (1, 0)}


class AndroidDeviceBackend(ComputerUseBackend):
    """Drives one attached Android device or emulator."""

    def __init__(self, *, permission_mode: str = "standard", serial: str = "") -> None:
        self.permission_mode = permission_mode
        self._serial = serial or os.environ.get(_SERIAL_ENV, "").strip()
        self._adb: List[str] = []
        self._cli = ""
        self._elements: List[UIElement] = []

    # --- lifecycle -------------------------------------------------------------------

    def start(self) -> None:
        from hermes_cli.tools_config_android import adb_command, android_cli_command, attached_devices
        adb, cli = adb_command(), android_cli_command()
        if not adb or not cli:
            raise RuntimeError("Android device support is not provisioned. "
                               "Run: hermes device install --accept-license")
        self._cli = cli
        if not self._serial:
            self._serial = _sole_device_serial(attached_devices())
        self._adb = [adb, "-s", self._serial] if self._serial else [adb]

    def stop(self) -> None:
        """Nothing to tear down. The adb server outlives us and belongs to the whole host."""

    def is_available(self) -> bool:
        from hermes_cli.tools_config_android import android_tools_ready, attached_devices
        return android_tools_ready() and any(
            device["state"] == "device" for device in attached_devices())

    # --- reading ---------------------------------------------------------------------

    def capture(self, mode: str = "som", app: Optional[str] = None, pid: Optional[int] = None,
                window_id: Optional[int] = None) -> CaptureResult:
        """`som` numbers the interactive elements on the frame; `ax` is the hierarchy with no
        image; `vision` is the frame alone. `app` filters the hierarchy to one package."""
        width, height = screen_size(self._adb)
        elements: List[UIElement] = []
        if mode != "vision":
            elements = read_elements(self._cli, self._serial)
            if app:
                elements = _filter_to_package(elements, app)
            self._elements = elements
        if mode == "ax":
            return CaptureResult(mode=mode, width=width, height=height, elements=elements,
                                 app=app or current_activity(self._adb))
        png = capture_png(self._adb)
        if mode == "som" and elements:
            png = draw_som_overlay(png, elements)
        note = ""
        if mode == "som" and not elements:
            note = ("No addressable elements were returned. The app may draw its own canvas; "
                    "act by coordinate, or capture again once it settles.")
        return CaptureResult(mode=mode, width=width, height=height, png_b64=b64encode(png).decode(),
                             elements=elements, app=app or current_activity(self._adb),
                             png_bytes_len=len(png), image_mime_type="image/png", note=note)

    # --- acting ----------------------------------------------------------------------

    def click(self, *, element: Optional[int] = None, x: Optional[int] = None,
              y: Optional[int] = None, button: str = "left", click_count: int = 1,
              modifiers: Optional[List[str]] = None, delivery_mode: Optional[str] = None,
              bring_to_front: bool = False) -> ActionResult:
        """A right click is a long press: Android's only secondary gesture."""
        def build():
            point, label = self._point(element, x, y)
            def act() -> None:
                if button == "right":
                    long_press(self._adb, *point)
                    return
                for _ in range(max(1, click_count)):
                    tap(self._adb, *point)
            verb = ("long press" if button == "right"
                    else "double tap" if click_count > 1 else "tap")
            return act, f"{verb} {label} at {point}"
        return self._guarded("click", build)

    def drag(self, *, from_element: Optional[int] = None, to_element: Optional[int] = None,
             from_xy: Optional[Tuple[int, int]] = None, to_xy: Optional[Tuple[int, int]] = None,
             button: str = "left", modifiers: Optional[List[str]] = None,
             delivery_mode: Optional[str] = None, bring_to_front: bool = False) -> ActionResult:
        def build():
            start, start_label = self._point(from_element, *(from_xy or (None, None)))
            end, end_label = self._point(to_element, *(to_xy or (None, None)))
            return (lambda: swipe(self._adb, *start, *end, ms=_SCROLL_MS),
                    f"drag {start_label} {start} to {end_label} {end}")
        return self._guarded("drag", build)

    def scroll(self, *, direction: str, amount: int = 3, element: Optional[int] = None,
               x: Optional[int] = None, y: Optional[int] = None, modifiers: Optional[List[str]] = None,
               delivery_mode: Optional[str] = None, bring_to_front: bool = False) -> ActionResult:
        """Scrolling drags the content the opposite way to the direction asked for, which is
        what `direction="down"` means to a reader: show me what is below."""
        if direction not in _SCROLL_DIRECTIONS:
            return ActionResult(ok=False, action="scroll",
                                message=f"direction must be one of {', '.join(_SCROLL_DIRECTIONS)}")
        def build():
            width, height = screen_size(self._adb)
            if element is not None or (x is not None and y is not None):
                centre, _ = self._point(element, x, y)
            else:
                centre = (width // 2, height // 2)
            unit_x, unit_y = _SCROLL_DIRECTIONS[direction]
            dx = int(width * _SCROLL_SPAN / 2) * unit_x
            dy = int(height * _SCROLL_SPAN / 2) * unit_y
            def act() -> None:
                for _ in range(max(1, amount)):
                    swipe(self._adb, centre[0] - dx, centre[1] - dy,
                          centre[0] + dx, centre[1] + dy, ms=_SCROLL_MS)
            return act, f"scroll {direction} x{max(1, amount)} at {centre}"
        return self._guarded("scroll", build)

    def type_text(self, text: str, *, delivery_mode: Optional[str] = None,
                  bring_to_front: bool = False) -> ActionResult:
        return self._guarded("type", lambda: (lambda: type_text(self._adb, text),
                                              f"typed {len(text)} characters"))

    def key(self, keys: str, *, delivery_mode: Optional[str] = None,
            bring_to_front: bool = False) -> ActionResult:
        sent: List[str] = []
        return self._guarded("key", lambda: (lambda: sent.append(press_keys(self._adb, keys)),
                                             lambda: f"sent {sent[0] if sent else keys}"))

    def set_value(self, value: str, element: Optional[int] = None) -> ActionResult:
        """Replace a field's contents: focus it, select all, delete, type."""
        def build():
            point, label = self._point(element, None, None)
            def act() -> None:
                tap(self._adb, *point)
                run_input(self._adb, ["keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"])
                run_input(self._adb, ["keyevent", "KEYCODE_DEL"])
                if value:
                    type_text(self._adb, value)
            return act, f"set {label} to {len(value)} characters"
        return self._guarded("set_value", build)

    # --- inventory -------------------------------------------------------------------

    def list_apps(self) -> List[Dict[str, Any]]:
        """Installed third-party packages, with the foreground one flagged."""
        from tools.computer_use.device_backend_screen import _NOISE_PACKAGES
        foreground = current_activity(self._adb).split("/", 1)[0]
        packages = []
        for line in self._adb_lines(["shell", "pm", "list", "packages", "-3"]):
            name = line.partition(":")[2].strip()
            if name and name not in _NOISE_PACKAGES:
                packages.append({"app": name, "bundle_id": name, "frontmost": name == foreground})
        return packages

    def list_windows(self) -> List[Dict[str, Any]]:
        """Android's analogue of a window is the resumed activity; there is exactly one."""
        activity = current_activity(self._adb)
        if not activity:
            return []
        package, _, name = activity.partition("/")
        return [{"app": package, "title": name or activity, "window_id": 0, "frontmost": True}]

    def focus_app(self, app: str, raise_window: bool = False) -> ActionResult:
        """Bring a package to the front through its launcher intent."""
        def act() -> None:
            proc = subprocess.run(
                [*self._adb, "shell", "monkey", "-p", app,
                 "-c", "android.intent.category.LAUNCHER", "1"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
            if proc.returncode != 0 or "No activities found" in (proc.stdout or ""):
                raise DeviceError(f"{app} has no launchable activity on this device.")
        return self._guarded("focus_app", lambda: (act, f"launched {app}"))

    # --- internals -------------------------------------------------------------------

    def _adb_lines(self, args: List[str], *, timeout: int = 60) -> List[str]:
        proc = subprocess.run([*self._adb, *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
        return (proc.stdout or "").splitlines() if proc.returncode == 0 else []

    def _point(self, element: Optional[int], x: Optional[int],
               y: Optional[int]) -> Tuple[Tuple[int, int], str]:
        """Resolve a target to a tap point and a label for the message.

        An index is resolved against the last capture. A string index is read as a testID,
        because that is the address that survives a re-layout and the schema's `element` is
        the only slot a caller has for it.
        """
        if element is None:
            if x is None or y is None:
                raise DeviceError("no target: pass an element index, a testID, or x and y.")
            return (int(x), int(y)), "point"
        if not self._elements:
            self._elements = read_elements(self._cli, self._serial)
        if isinstance(element, str) and not element.isdigit():
            found = resolve(self._elements, test_id=element)
        else:
            found = resolve(self._elements, element=int(element))
        centre = found.attributes.get("center") or [found.bounds[0] + found.bounds[2] // 2,
                                                    found.bounds[1] + found.bounds[3] // 2]
        return (int(centre[0]), int(centre[1])), f"{found.role} '{found.label}'"

    def _guarded(self, action: str, build) -> ActionResult:
        """Resolve a target, act, then decide whether the screen agrees that it happened.

        Resolution is inside the same guard as the action because it fails for the same
        reasons: an index the screen no longer has, a testID the keyboard covered up. The
        caller gets a refusal it can read, not a traceback.

        The overlay check costs one hierarchy read per action. That is the price of not
        reporting a swallowed tap as a success, which is a failure mode that hides itself
        for several steps and then surfaces as an unrelated-looking error.
        """
        try:
            act, message = build()
            act()
        except (DeviceError, subprocess.SubprocessError, OSError) as e:
            return ActionResult(ok=False, action=action, message=str(e), effect="unverifiable")
        summary = message() if callable(message) else message
        try:
            self._elements = read_elements(self._cli, self._serial)
        except (DeviceError, subprocess.SubprocessError, OSError):
            return ActionResult(ok=True, action=action, message=summary, effect="unverifiable")
        overlay = error_overlay(self._elements)
        if overlay:
            return ActionResult(
                ok=True, action=action, verified=False, effect="suspected_noop",
                message=f"{summary}, but an error overlay is covering the app and swallows "
                        f"input: {overlay}. Dismiss it before acting again.",
                escalation={"recommended": "page", "reason": "error overlay"})
        return ActionResult(ok=True, action=action, message=summary, effect="confirmed",
                            verified=True)


def _sole_device_serial(devices: List[Dict[str, str]]) -> str:
    """Pick the device to drive, refusing to guess between several.

    Routing to the wrong one of two attached devices is silent and looks like the app
    misbehaving, so ambiguity is an error the caller resolves with ANDROID_SERIAL.
    """
    ready = [device for device in devices if device["state"] == "device"]
    if not ready:
        unauthorized = [d["serial"] for d in devices if d["state"] == "unauthorized"]
        if unauthorized:
            raise RuntimeError(f"{', '.join(unauthorized)} has not authorised this computer. "
                               "Accept the USB debugging prompt on the device.")
        raise RuntimeError("No Android device is attached. Start an emulator, or connect a "
                           "device with USB debugging enabled, then try again.")
    if len(ready) > 1:
        raise RuntimeError("Several devices are attached ("
                           + ", ".join(d["serial"] for d in ready)
                           + f"). Set {_SERIAL_ENV} to the one to drive.")
    return ready[0]["serial"]


def _filter_to_package(elements: List[UIElement], package: str) -> List[UIElement]:
    """Keep one package's elements and renumber them, so indices stay 1..n for the model."""
    kept = [e for e in elements
            if e.app == package or e.attributes.get("resource_id", "").startswith(f"{package}:")]
    for position, element in enumerate(kept, start=1):
        element.index = position
    return kept
