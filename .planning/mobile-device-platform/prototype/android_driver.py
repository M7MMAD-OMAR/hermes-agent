"""Reference implementation of Decision 2's AndroidBackend contract.

This is a prototype, not production code. It exists to prove the contract
end to end on a real device before any of it is wired into Hermes:

    read   -> `android layout --flat`      (JSON, works unprivileged)
    act    -> `adb shell input ...`        (works unprivileged)
    refs   -> synthesized here, not passed through from resource-id

Spike 1 established why the split is what it is. `adb shell uiautomator
dump` is SIGKILLed for the ordinary shell user on API 36, so the read half
has to go through the Android CLI's instrumentation server. `adb shell
input` was confirmed fine unprivileged, so the act half stays on adb.

Spike 1 also established that `resource-id` is stable across re-dumps but is
present on only some elements and is not unique, so a ref cannot simply be a
resource-id. `Snapshot` below assigns refs and keeps a table, mirroring what
`browser_snapshot` already does for ARIA refs.

Usage:

    python android_driver.py snapshot
    python android_driver.py find "Sign in"
    python android_driver.py tap e12
    python android_driver.py type e3 "hello@example.com"
    python android_driver.py screenshot out.png
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

BOUNDS_RE = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")

# Elements the agent should never be handed as targets. The launcher and the
# CLI's own instrumentation server are noise in every snapshot.
NOISE_PACKAGES = (
    "com.android.cli.interact.instrumentation",
)


class DeviceError(RuntimeError):
    """A device command failed in a way the caller should see verbatim."""


def _run(argv: list[str], timeout: int = 90) -> str:
    proc = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise DeviceError(
            f"{shlex.join(argv)} exited {proc.returncode}\n"
            f"stdout: {proc.stdout.strip()}\n"
            f"stderr: {proc.stderr.strip()}"
        )
    return proc.stdout


@dataclass
class Element:
    """One addressable thing on screen.

    `ref` is assigned by the snapshot, not read from the device. `identity`
    is the tuple the ref is derived from, kept so a later snapshot can decide
    whether the same ref still points at the same thing.
    """

    ref: str
    cls: str
    resource_id: str | None
    text: str | None
    content_desc: str | None
    interactions: tuple[str, ...]
    bounds: tuple[int, int, int, int]
    center: tuple[int, int]
    ordinal: int

    @property
    def identity(self) -> tuple[Any, ...]:
        return (self.resource_id, self.text, self.content_desc, self.cls, self.ordinal)

    @property
    def label(self) -> str:
        """What a human, or an agent reading a snapshot, calls this."""
        return self.text or self.content_desc or self.resource_id or self.cls

    @property
    def short_id(self) -> str:
        """resource-id without the package prefix, which is the testID."""
        if not self.resource_id:
            return ""
        return self.resource_id.split("/", 1)[-1]

    def describe(self) -> str:
        acts = ",".join(a.lower() for a in self.interactions) or "static"
        rid = f" #{self.short_id}" if self.short_id else ""
        return f"[{self.ref}]{rid} {self.cls.rsplit('.', 1)[-1]} '{self.label}' ({acts}) at {self.center}"


@dataclass
class Snapshot:
    elements: list[Element]
    by_ref: dict[str, Element] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.by_ref = {e.ref: e for e in self.elements}

    def resolve(self, ref: str) -> Element:
        el = self.by_ref.get(ref)
        if el is None:
            raise DeviceError(
                f"ref {ref!r} is not in this snapshot. "
                f"Take a fresh snapshot; refs do not survive a screen change."
            )
        return el

    def by_id(self, test_id: str) -> Element:
        """Address by testID, which is the stable handle across re-layouts.

        Positional refs are invalidated by anything that reflows the screen,
        including the soft keyboard opening. A testID is not, so this is the
        addressing mode an agent should prefer whenever the app sets one.
        """
        hits = [e for e in self.elements if e.short_id == test_id]
        if not hits:
            close = [e.short_id for e in self.elements if e.short_id]
            raise DeviceError(
                f"no element with testID {test_id!r}. Present on this screen: "
                + ", ".join(sorted(close)[:20])
            )
        if len(hits) > 1:
            raise DeviceError(
                f"testID {test_id!r} matches {len(hits)} elements. "
                f"Use a ref from `snapshot` to pick one."
            )
        return hits[0]

    def find(self, needle: str, interactive_only: bool = True) -> list[Element]:
        """Case-insensitive substring match over the things a human would read."""
        low = needle.lower()
        hits = []
        for e in self.elements:
            if interactive_only and not e.interactions:
                continue
            haystack = " ".join(
                part for part in (e.text, e.content_desc, e.short_id) if part
            ).lower()
            if low in haystack:
                hits.append(e)
        return hits

    def render(self, interactive_only: bool = True) -> str:
        lines = []
        for e in self.elements:
            if interactive_only and not e.interactions:
                continue
            lines.append(e.describe())
        return "\n".join(lines)


def _parse_bounds(raw: str) -> tuple[int, int, int, int]:
    m = BOUNDS_RE.match(raw or "")
    if not m:
        return (0, 0, 0, 0)
    return tuple(int(g) for g in m.groups())  # type: ignore[return-value]


def _parse_center(raw: str, bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    """`center` is precomputed by the CLI. Derive it only if it is missing."""
    m = re.match(r"\[(-?\d+),(-?\d+)\]", raw or "")
    if m:
        return (int(m.group(1)), int(m.group(2)))
    x1, y1, x2, y2 = bounds
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def snapshot(serial: str | None = None, full: bool = False) -> Snapshot:
    """Read the screen and assign refs.

    Refs are `e<N>` in document order over the elements we keep. They are
    valid only for this snapshot, exactly like browser refs.
    """
    argv = ["android", "layout", "--flat"]
    if full:
        argv.append("--full")
    if serial:
        argv += ["--device", serial]

    # `android layout` can exit 0 and print nothing. Observed on this device
    # when the instrumentation server is cold or was just reinstalled. It is
    # not an error condition the CLI reports, so the caller has to retry.
    raw = ""
    for attempt in range(3):
        raw = _run(argv)
        # The first run prints an install line before the JSON.
        start = raw.find("[")
        if start >= 0:
            break
        time.sleep(1.0 + attempt)
    else:
        raise DeviceError(
            "`android layout` returned no JSON after 3 attempts. "
            "The instrumentation server may not be installed; check "
            "`adb shell pm list instrumentation`."
        )
    data = json.loads(raw[start:])

    # Count duplicates so the ordinal in `identity` is meaningful.
    seen: dict[tuple[Any, ...], int] = {}
    elements: list[Element] = []
    for item in data:
        rid = item.get("resource-id")
        if rid and any(rid.startswith(pkg) for pkg in NOISE_PACKAGES):
            continue
        bounds = _parse_bounds(item.get("bounds", ""))
        key = (rid, item.get("text"), item.get("content-desc"), item.get("class"))
        ordinal = seen.get(key, 0)
        seen[key] = ordinal + 1
        elements.append(
            Element(
                ref=f"e{len(elements)}",
                cls=item.get("class", "?"),
                resource_id=rid,
                text=item.get("text"),
                content_desc=item.get("content-desc"),
                interactions=tuple(item.get("interactions", ())),
                bounds=bounds,
                center=_parse_center(item.get("center", ""), bounds),
                ordinal=ordinal,
            )
        )
    return Snapshot(elements)


def _adb(args: list[str], serial: str | None = None) -> str:
    argv = ["adb"]
    if serial:
        argv += ["-s", serial]
    return _run(argv + args)


def _target(snap: Snapshot, handle: str) -> Element:
    """A handle is a positional ref (`e12`) or a testID (`home.nav.list`)."""
    if re.fullmatch(r"e\d+", handle):
        return snap.resolve(handle)
    return snap.by_id(handle)


def tap(snap: Snapshot, handle: str, serial: str | None = None) -> Element:
    el = _target(snap, handle)
    x, y = el.center
    _adb(["shell", "input", "tap", str(x), str(y)], serial)
    return el


def tap_id(test_id: str, serial: str | None = None) -> Element:
    """Snapshot, then tap by testID. The self-correcting form of `tap`."""
    return tap(snapshot(serial), test_id, serial)


def type_text(snap: Snapshot, handle: str, text: str, serial: str | None = None) -> Element:
    """Focus the field, then type. `input text` needs escaping for spaces."""
    el = tap(snap, handle, serial)
    time.sleep(0.3)
    # `input text` treats %s as a space and chokes on unescaped shell metachars.
    payload = text.replace("%", "%%").replace(" ", "%s")
    _adb(["shell", "input", "text", shlex.quote(payload)], serial)
    return el


def press(key: str, serial: str | None = None) -> None:
    keycode = key if key.startswith("KEYCODE_") else f"KEYCODE_{key.upper()}"
    _adb(["shell", "input", "keyevent", keycode], serial)


def swipe(
    x1: int, y1: int, x2: int, y2: int, ms: int = 300, serial: str | None = None
) -> None:
    _adb(["shell", "input", "swipe", *map(str, (x1, y1, x2, y2, ms))], serial)


def scroll(direction: str = "down", serial: str | None = None) -> None:
    """Scroll the screen by roughly half a viewport."""
    w, h = screen_size(serial)
    mid_x = w // 2
    if direction == "down":
        swipe(mid_x, int(h * 0.70), mid_x, int(h * 0.30), 400, serial)
    else:
        swipe(mid_x, int(h * 0.30), mid_x, int(h * 0.70), 400, serial)


def screen_size(serial: str | None = None) -> tuple[int, int]:
    out = _adb(["shell", "wm", "size"], serial)
    m = re.search(r"(\d+)x(\d+)", out)
    if not m:
        raise DeviceError(f"could not parse `wm size`: {out!r}")
    return int(m.group(1)), int(m.group(2))


def screenshot(path: str, annotate: bool = False, serial: str | None = None) -> str:
    """Single frame. Use `screenrecord` for a stream, see spike 11."""
    argv = ["android", "screen", "capture", "--output", path]
    if annotate:
        argv.append("--annotate")
    if serial:
        argv += ["--device", serial]
    _run(argv)
    return path


def resolve_visual(screenshot_path: str, template: str) -> str:
    """Substitute `#N` labels from an annotated screenshot into a string.

    This is the vision fallback for screens whose accessibility tree is thin,
    which is the known weak spot for Compose, Flutter and some RN surfaces.
    """
    return _run(
        [
            "android",
            "screen",
            "resolve",
            "--screenshot",
            screenshot_path,
            "--string",
            template,
        ]
    ).strip()


def current_activity(serial: str | None = None) -> str:
    out = _adb(["shell", "dumpsys", "activity", "activities"], serial)
    m = re.search(r"topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)", out)
    return m.group(1) if m else "unknown"


def _main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]

    if cmd == "snapshot":
        snap = snapshot(full="--full" in rest)
        print(f"# {current_activity()}")
        print(snap.render(interactive_only="--full" not in rest))
        return 0

    if cmd == "find":
        snap = snapshot()
        hits = snap.find(rest[0])
        if not hits:
            print(f"no interactive element matching {rest[0]!r}")
            return 1
        for e in hits:
            print(e.describe())
        return 0

    if cmd == "tap":
        snap = snapshot()
        print("tapped", tap(snap, rest[0]).describe())
        return 0

    if cmd == "ids":
        snap = snapshot()
        for e in snap.elements:
            if e.short_id:
                print(f"{e.short_id:38} {e.cls.rsplit('.',1)[-1]:12} '{e.label}'")
        return 0

    if cmd == "type":
        snap = snapshot()
        print("typed into", type_text(snap, rest[0], rest[1]).describe())
        return 0

    if cmd == "press":
        press(rest[0])
        return 0

    if cmd == "scroll":
        scroll(rest[0] if rest else "down")
        return 0

    if cmd == "screenshot":
        print(screenshot(rest[0] if rest else "screen.png", annotate="--annotate" in rest))
        return 0

    print(f"unknown command {cmd!r}")
    return 2


if __name__ == "__main__":
    try:
        sys.exit(_main(sys.argv[1:]))
    except DeviceError as exc:
        print(f"device error: {exc}", file=sys.stderr)
        sys.exit(1)
