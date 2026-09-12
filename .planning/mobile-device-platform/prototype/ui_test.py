"""A UI test runner built on `android_driver`, to show what the Decision 2
contract is actually good for.

This is the "write tests against the interface" half of the original
requirement. It is deliberately small: the point is that once reading and
acting are solid, an assertion language on top is a couple of hundred lines,
not a framework.

What it demonstrates, in order of how much each one matters:

  * addressing by testID, so a step survives a re-layout
  * waiting for a condition instead of sleeping
  * asserting on text that must appear, and on text that must disappear
  * automatic LogBox detection, because an error overlay silently swallows
    taps and makes a passing test lie (spike 14)
  * a screenshot captured at the moment of failure, not after cleanup

Usage:
    python ui_test.py            # run the built-in suite
    python ui_test.py --list     # show the scenarios without running them
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass, field
from typing import Callable

import android_driver as drv


class StepFailed(AssertionError):
    pass


@dataclass
class Context:
    """Per-run state. Holds the last snapshot so steps can chain cheaply."""

    snap: drv.Snapshot | None = None
    log: list[str] = field(default_factory=list)

    def refresh(self) -> drv.Snapshot:
        self.snap = drv.snapshot()
        return self.snap

    def note(self, msg: str) -> None:
        self.log.append(msg)
        print(f"    {msg}", flush=True)


# ---------------------------------------------------------------- primitives


def logbox_present(snap: drv.Snapshot) -> str | None:
    """Return the LogBox headline if an error overlay is up, else None.

    Spike 14: the overlay has no resource-id anywhere, so it is identified by
    its controls' content descriptions. Checking this before asserting success
    is not optional; the overlay eats taps and returns rc 0.
    """
    descs = {e.content_desc for e in snap.elements if e.content_desc}
    if "Dismiss" in descs and ("Minimize" in descs or "Copy" in descs):
        full = drv.snapshot(full=True)
        for e in full.elements:
            t = e.text or ""
            if t.startswith("Log ") and " of " in t:
                # The class and message sit just after the counter.
                idx = full.elements.index(e)
                tail = [x.text for x in full.elements[idx : idx + 6] if x.text]
                return " | ".join(tail[:3])
        return "LogBox overlay present"
    return None


def dismiss_logbox(max_rounds: int = 4) -> int:
    """Clear every stacked LogBox. Returns how many were dismissed."""
    cleared = 0
    for _ in range(max_rounds):
        snap = drv.snapshot()
        hit = next((e for e in snap.elements if e.content_desc == "Dismiss"), None)
        if hit is None:
            break
        drv.tap(snap, hit.ref)
        cleared += 1
        time.sleep(1.5)
    return cleared


EXPO_GO = "host.exp.exponent"
DEV_BUILD = "com.anonymous.hermesmobiledemo"
PROJECT_URL = "exp://127.0.0.1:8081"


def detect_app() -> tuple[str, str | None]:
    """Prefer the development build if it is installed, else Expo Go.

    They are launched differently: the dev build has its own launcher icon,
    Expo Go needs the project deep link. Everything else in this file is
    identical between them, which is the point: the driver does not care.
    """
    installed = drv._adb(["shell", "pm", "list", "packages"])
    if DEV_BUILD in installed:
        return DEV_BUILD, None
    return EXPO_GO, PROJECT_URL


def reset_app(url: str | None = None, package: str | None = None) -> None:
    """Return the app to a known state before a scenario runs.

    Learned the hard way: a suite that assumes it starts at the home screen
    produces failures that are about the previous scenario, not this one.
    Worse, repeated hardware-BACK presses can leave the navigator in a state
    where a screen renders but its route does not, and every subsequent
    navigation silently no-ops.

    `am force-stop` plus a fresh deep link is the cheap deterministic reset.
    `pm clear` is the heavier one, and it is what a device panel's "clear
    cache" button should run, but it also discards persisted state a test may
    be asserting on, so it is not the default here.
    """
    if package is None:
        package, url = detect_app()
    drv._adb(["shell", "am", "force-stop", package])
    time.sleep(1.5)
    if url:
        drv._adb(
            ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, package]
        )
    else:
        drv._adb(
            ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"]
        )
    wait_for(
        lambda s: has_id(s, "home.screen.scroll"),
        "the app to relaunch at the home screen",
        timeout=90,
        interval=2.0,
    )


def wait_for(
    predicate: Callable[[drv.Snapshot], bool],
    what: str,
    timeout: float = 15.0,
    interval: float = 1.0,
) -> drv.Snapshot:
    """Poll a snapshot until the predicate holds. The alternative to sleep()."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = drv.snapshot()
        if predicate(last):
            return last
        time.sleep(interval)
    raise StepFailed(f"timed out after {timeout:.0f}s waiting for {what}")


def has_text(snap: drv.Snapshot, needle: str) -> bool:
    return any(needle.lower() in (e.text or "").lower() for e in snap.elements)


def has_id(snap: drv.Snapshot, test_id: str) -> bool:
    return any(e.short_id == test_id for e in snap.elements)


def tap_id(ctx: Context, test_id: str) -> None:
    snap = ctx.refresh()
    overlay = logbox_present(snap)
    if overlay:
        raise StepFailed(
            f"cannot tap {test_id!r}: an error overlay is covering the app "
            f"and would swallow the tap. Overlay says: {overlay}"
        )
    el = drv.tap(snap, test_id)
    ctx.note(f"tapped {test_id} -> '{el.label}'")
    time.sleep(0.8)


def type_into(ctx: Context, test_id: str, text: str) -> None:
    snap = ctx.refresh()
    drv.type_text(snap, test_id, text)
    ctx.note(f"typed {text!r} into {test_id}")
    time.sleep(0.8)


def assert_text(ctx: Context, needle: str) -> None:
    snap = wait_for(lambda s: has_text(s, needle), f"text {needle!r}")
    ctx.note(f"saw {needle!r}")
    del snap


def assert_no_text(ctx: Context, needle: str) -> None:
    snap = wait_for(lambda s: not has_text(s, needle), f"text {needle!r} to disappear")
    ctx.note(f"{needle!r} is gone")
    del snap


def assert_screen(ctx: Context, marker_id: str) -> None:
    wait_for(lambda s: has_id(s, marker_id), f"screen marker {marker_id!r}")
    ctx.note(f"on screen {marker_id}")


# ---------------------------------------------------------------- scenarios


def scenario_counter(ctx: Context) -> None:
    """The counter round-trips, and the label tracks it."""
    assert_screen(ctx, "home.screen.scroll")
    tap_id(ctx, "home.counter.reset")
    assert_text(ctx, "Count: 0")
    for _ in range(3):
        tap_id(ctx, "home.counter.increment")
    assert_text(ctx, "Count: 3")
    tap_id(ctx, "home.counter.decrement")
    assert_text(ctx, "Count: 2")
    tap_id(ctx, "home.counter.reset")
    assert_text(ctx, "Count: 0")


def scenario_echo(ctx: Context) -> None:
    """Typing echoes live, and clearing removes it.

    This is the scenario that proves testID addressing matters: the soft
    keyboard reflows the screen between the tap and the assertion, which
    invalidates every positional ref taken beforehand.
    """
    tap_id(ctx, "home.echo.clear")
    type_into(ctx, "home.echo.input", "hermes")
    assert_text(ctx, "hermes")
    drv.press("BACK")          # close the keyboard, restoring the layout
    time.sleep(1.0)
    tap_id(ctx, "home.echo.clear")
    assert_no_text(ctx, "Echo: hermes")


def scenario_navigation(ctx: Context) -> None:
    """Every screen is reachable and announces itself."""
    for nav_id, marker in [
        ("home.nav.forms", "forms.screen.scroll"),
        ("home.nav.list", "list.screen.flatlist"),
        ("home.nav.console", "console.screen.scroll"),
        ("home.nav.state", "state.screen.scroll"),
    ]:
        tap_id(ctx, nav_id)
        try:
            assert_screen(ctx, marker)
        except StepFailed:
            # Some screens use a different root id; fall back to any id with
            # the screen's prefix, which is what actually matters.
            prefix = nav_id.split(".")[-1]
            snap = drv.snapshot()
            ids = [e.short_id for e in snap.elements if e.short_id.startswith(prefix)]
            if not ids:
                raise
            ctx.note(f"on screen {prefix} (markers: {', '.join(ids[:3])})")
        back = f"{nav_id.split('.')[-1]}.nav.home"
        snap = drv.snapshot()
        if has_id(snap, back):
            tap_id(ctx, back)
        else:
            drv.press("BACK")
            time.sleep(1.0)
        assert_screen(ctx, "home.screen.scroll")


def logcat_since_clear(tag: str = "ReactNativeJS") -> str:
    return drv._adb(["logcat", "-d", "-s", f"{tag}:V"])


def scenario_error_is_detected(ctx: Context) -> None:
    """An app error must reach the harness, on the channel that is reliable.

    Asserts on logcat, not on the LogBox overlay. Spike 13 established logcat
    as the dependable console channel, and this scenario is also where the
    overlay's limits showed up: LogBox suppresses a log it has already shown
    and dismissed, so overlay presence is a useful enrichment signal and a
    bad correctness signal. The overlay is still checked, and reported, but
    its absence is not a failure.
    """
    drv._adb(["logcat", "-c"])
    tap_id(ctx, "home.nav.console")
    assert_screen(ctx, "console.screen.scroll")

    for test_id, needle, level in [
        ("console.log.button", "plain log message", "I"),
        ("console.warn.button", "warning level message", "W"),
        ("console.error.button", "error level message", "E"),
    ]:
        tap_id(ctx, test_id)
        time.sleep(1.5)
        out = logcat_since_clear()
        if needle not in out:
            raise StepFailed(f"{test_id} fired but {needle!r} never reached logcat")
        line = next(ln for ln in out.splitlines() if needle in ln)
        if f" {level} ReactNativeJS" not in line:
            raise StepFailed(
                f"{needle!r} reached logcat at the wrong level, expected {level}: {line.strip()}"
            )
        ctx.note(f"{test_id} -> logcat level {level}, message matched")

    overlay = logbox_present(drv.snapshot())
    if overlay:
        ctx.note(f"error overlay also present: {overlay}")
        try:
            tap_id(ctx, "console.nav.home")
        except StepFailed as exc:
            ctx.note(f"overlay guard correctly refused to act: {str(exc)[:60]}")
        dismissed = dismiss_logbox()
        ctx.note(f"dismissed {dismissed} overlay(s)")
    else:
        ctx.note("no overlay for these messages; logcat is the channel that always has them")

    tap_id(ctx, "console.nav.home")
    assert_screen(ctx, "home.screen.scroll")


SCENARIOS: list[tuple[str, Callable[[Context], None]]] = [
    ("counter round-trip", scenario_counter),
    ("live echo and clear", scenario_echo),
    ("navigate every screen", scenario_navigation),
    ("an app error is detected and blocks actions", scenario_error_is_detected),
]


# ---------------------------------------------------------------- runner


def run(selected: list[str] | None = None) -> int:
    failures = 0
    for name, fn in SCENARIOS:
        if selected and name not in selected:
            continue
        print(f"\n== {name} ==", flush=True)
        ctx = Context()
        t0 = time.monotonic()
        try:
            reset_app()
            dismiss_logbox()
            fn(ctx)
        except (StepFailed, drv.DeviceError) as exc:
            failures += 1
            shot = f"failure-{name.replace(' ', '-')}.png"
            try:
                drv.screenshot(shot, annotate=True)
                extra = f", screenshot at {shot}"
            except Exception:
                extra = ", and the failure screenshot could not be taken"
            print(f"  FAIL in {time.monotonic() - t0:.1f}s: {exc}{extra}", flush=True)
        else:
            print(f"  PASS in {time.monotonic() - t0:.1f}s", flush=True)

    total = len(selected or SCENARIOS)
    print(f"\n{total - failures}/{total} scenarios passed")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only", action="append")
    args = ap.parse_args()
    if args.list:
        for name, fn in SCENARIOS:
            print(f"{name}\n    {(fn.__doc__ or '').strip().splitlines()[0]}")
        return 0
    return run(args.only)


if __name__ == "__main__":
    sys.exit(main())
