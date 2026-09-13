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
import time
import subprocess
from base64 import b64encode
from typing import Any, Dict, List, Optional, Tuple

from dataclasses import replace

from gateway.device_control_broker import (
    DeviceControlError, DeviceControlScope, get_device_control_broker)
from tools.computer_use.backend import ActionResult, CaptureResult, ComputerUseBackend, UIElement
from tools.computer_use.device_backend_input import (
    error_overlay, long_press, press_keys, run_input, swipe, tap, type_text)
from tools.computer_use.device_backend_screen import (
    DeviceError, ScreenPair, current_activity, draw_som_overlay, forget_screen_size,
    read_elements, read_screen_pair, resolve, screen_size_cached)

logger = logging.getLogger("tools.computer_use.device")

_SERIAL_ENV = "ANDROID_SERIAL"
# Fraction of the screen one scroll tick travels. Two thirds of a viewport per tick matches
# what a person's thumb does and keeps a three-tick default from skipping whole sections.
_SCROLL_SPAN = 0.40
_SCROLL_MS = 400
# How long an action's own read stays good for the capture that usually follows it.
# The read takes about a second on its own, so the pair is already that old when it
# lands; a short window catches the immediate follow-up, which is the only call that
# can use it, and expires before anything else could.
_PAIR_TTL_SECONDS = 0.4
# Unit vectors for the content's travel. Asking to scroll "down" means show me what is
# below, so the finger drags the content up: the sign is inverted on purpose.
_SCROLL_DIRECTIONS = {"down": (0, -1), "up": (0, 1), "right": (-1, 0), "left": (1, 0)}


class AndroidDeviceBackend(ComputerUseBackend):
    """Drives one attached Android device or emulator."""

    accepts_test_ids = True

    def __init__(self, *, permission_mode: str = "standard", serial: str = "",
                 session_id: str = "") -> None:
        self.permission_mode = permission_mode
        self._serial = serial or os.environ.get(_SERIAL_ENV, "").strip()
        self._session_id = session_id
        self._adb: List[str] = []
        self._cli = ""
        self._elements: List[UIElement] = []
        self._scope: Optional[DeviceControlScope] = None
        self._pair: Optional[ScreenPair] = None

    # --- lifecycle -------------------------------------------------------------------

    def start(self) -> None:
        """Resolve the tooling, pick a device, and lease it before touching it.

        The lease is taken here rather than per action because a device is stateful: two
        sessions interleaving taps on one phone produce a result that reads as the app
        misbehaving, and no per-action check can undo a tap the other session already sent.
        """
        from hermes_cli.tools_config_android import adb_command, android_cli_command, attached_devices
        adb, cli = adb_command(), android_cli_command()
        if not adb or not cli:
            raise RuntimeError("Android device support is not provisioned. "
                               "Run: hermes device install --accept-license")
        self._cli = cli
        broker, scope = get_device_control_broker(), self._base_scope()
        if not self._serial:
            self._serial = _free_device_serial(attached_devices(), broker, scope)
        self._scope = replace(scope, serial=self._serial)
        try:
            broker.acquire(self._scope)
        except DeviceControlError as e:
            self._scope = None
            raise RuntimeError(str(e)) from e
        self._adb = [adb, "-s", self._serial]

    def stop(self) -> None:
        """Give the device back. The adb server itself outlives us and belongs to the host,
        so it is never torn down here; only our claim on one serial is."""
        self._pair = None
        forget_screen_size(self._serial)
        if self._scope is not None:
            get_device_control_broker().release(self._scope)
            self._scope = None

    def _base_scope(self) -> DeviceControlScope:
        """Who this backend is, for the lease. The serial is filled in once one is chosen."""
        return DeviceControlScope(session_id=self._session_id or None, transport_family="adb")

    def is_available(self) -> bool:
        from hermes_cli.tools_config_android import android_tools_ready, attached_devices
        return android_tools_ready() and any(
            device["state"] == "device" for device in attached_devices())

    # --- reading ---------------------------------------------------------------------

    def capture(self, mode: str = "som", app: Optional[str] = None, pid: Optional[int] = None,
                window_id: Optional[int] = None) -> CaptureResult:
        """`som` numbers the interactive elements on the frame; `ax` is the hierarchy with no
        image; `vision` is the frame alone. `app` filters the hierarchy to one package."""
        pair = self._take_pair()
        elements: List[UIElement] = []
        if mode != "vision":
            elements = _filter_to_package(pair.elements, app) if app else pair.elements
            self._elements = pair.elements
        width, height = screen_size_cached(self._adb, self._serial)
        if mode == "ax":
            return CaptureResult(mode=mode, width=width, height=height, elements=elements,
                                 app=app or current_activity(self._adb),
                                 note=_capture_note(mode, elements))
        png = draw_som_overlay(pair.png, elements) if (mode == "som" and elements) else pair.png
        note = _capture_note(mode, elements)
        return CaptureResult(mode=mode, width=width, height=height, png_b64=b64encode(png).decode(),
                             elements=elements, app=app or current_activity(self._adb),
                             png_bytes_len=len(png), image_mime_type="image/png", note=note)

    def _take_pair(self) -> ScreenPair:
        """This screen, from the action that just ran when that is still current.

        The loop an agent actually runs is act, capture, act, capture. Every action
        already reads the hierarchy to check for the error overlay, and that read costs
        about a second, so a capture straight afterwards was paying for the same screen
        twice. Taking the frame alongside that read makes the pair reusable at all: what
        is served is one moment's elements with one moment's pixels, never a mix.
        """
        pair = self._pair
        if (pair is not None and pair.serial == self._serial
                and time.monotonic() - pair.taken_at <= _PAIR_TTL_SECONDS):
            self._pair = None  # one capture per action; the next one reads for itself
            return pair
        return read_screen_pair(self._cli, self._serial, self._adb)

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
            width, height = screen_size_cached(self._adb, self._serial)
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
        # Whatever this action does, the screen it leaves is not the one the old pair
        # describes. Cleared before acting so a failure cannot leave a pair behind either.
        self._pair = None
        try:
            act, message = build()
            act()
        except (DeviceError, subprocess.SubprocessError, OSError) as e:
            return ActionResult(ok=False, action=action, message=str(e), effect="unverifiable")
        summary = message() if callable(message) else message
        try:
            pair = read_screen_pair(self._cli, self._serial, self._adb)
        except (DeviceError, subprocess.SubprocessError, OSError):
            return ActionResult(ok=True, action=action, message=summary, effect="unverifiable")
        self._elements, self._pair = pair.elements, pair
        overlay = error_overlay(self._elements)
        if overlay:
            return ActionResult(
                ok=True, action=action, verified=False, effect="suspected_noop",
                message=f"{summary}, but an error overlay is covering the app and swallows "
                        f"input: {overlay}. Dismiss it before acting again.",
                escalation={"recommended": "page", "reason": "error overlay"})
        return ActionResult(ok=True, action=action, message=summary, effect="confirmed",
                            verified=True)


def _capture_note(mode: str, elements: List[UIElement]) -> str:
    """What this capture does not show, when it does not show it.

    A phone's accessibility tree holds what is on screen and nothing else. On a scrolling
    screen that is a fraction of what is there: measured on the demo app's media screen,
    a first capture returned 4 of the 14 addressable elements, and nothing in the result
    said the other 10 existed. An agent then concludes the element it wants is absent,
    which is the wrong conclusion and an expensive one.

    The device reports that a container scrolls and never how far, so this says the first
    and not the second. Guessing an extent would be worse than saying nothing.
    """
    if mode == "som" and not elements:
        return ("No addressable elements were returned. The app may draw its own canvas; "
                "act by coordinate, or capture again once it settles.")
    scrollers = [element for element in elements
                 if "scrollable" in (element.attributes.get("interactions") or [])]
    if not scrollers:
        return ""
    named = ", ".join(
        element.attributes.get("test_id") or element.role for element in scrollers[:3])
    return (f"This screen scrolls ({named}), so it holds elements this capture cannot see. "
            "Scroll and capture again before concluding something is not there.")


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


def _free_device_serial(devices: List[Dict[str, str]], broker, scope: DeviceControlScope) -> str:
    """The serial to lease: the attached devices, minus the ones another session holds.

    Filtering before the ambiguity check is what makes two phones useful. Two attached and
    one leased resolves to the free one instead of refusing, and the refusal stays for the
    case that is genuinely ambiguous.

    Reading the leases and taking one are two steps, so a racing session can take the
    serial this one just saw free. That loses to a loud `DeviceBusy` naming the winner
    rather than to two sessions on one phone, which is the outcome that matters.
    """
    free = [device for device in devices
            if not (device["state"] == "device"
                    and broker.held_by_other_session(device["serial"], scope))]
    if not free and devices:
        raise RuntimeError("Every attached device is already leased by another Hermes "
                           "session. Attach another device, or wait for one to finish.")
    return _sole_device_serial(free)


def _filter_to_package(elements: List[UIElement], package: str) -> List[UIElement]:
    """Keep one package's elements and renumber them, so indices stay 1..n for the model."""
    from dataclasses import replace
    kept = [e for e in elements
            if e.app == package or e.attributes.get("resource_id", "").startswith(f"{package}:")]
    return [replace(element, index=position) for position, element in enumerate(kept, start=1)]
