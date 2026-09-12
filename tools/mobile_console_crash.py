"""Native crashes and ANRs: the two signal classes the JS console cannot see.

A JavaScript exception reaches the console channels. These two do not, and they are
what "the app died" actually looks like from outside:

* **A native crash** is `AndroidRuntime E FATAL EXCEPTION: <thread>` in logcat's crash
  buffer. No root needed.
* **An ANR** is the structured `am_anr` tag in the events buffer, plus a human-readable
  `ANR in <package>` line in the main one.

**The ANR class is real and, for a React Native app, catches almost nothing.** Under
Hermes the JavaScript thread is not the Android UI thread, so a twelve second block of
the JS thread leaves the app frozen from the user's point of view while Android
considers it perfectly healthy: measured, the accessibility layer kept answering in
under a second throughout and no `am_anr` was filed. The watcher stays because a
genuinely blocked native UI thread does produce one. It is not a "the app froze"
detector, and describing it as one would be a lie the user only discovers in the moment
they needed it.

Delivery goes through the process registry's watch patterns rather than through a new
channel. That path already rate limits, caps a chatty match, and is consumed in
production by the CLI, the gateway and the TUI. The SSE run-event channel the design
originally named is not consumed by the desktop app at all, so building on it would
have produced a pipeline that passes its tests and never reaches anyone.
"""

from __future__ import annotations

import logging
import re
import shlex
import subprocess
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger("tools.mobile_console")

#: In Expo Go the developer's bundle runs inside Expo's own process, not one named after
#: their app, so package-scoped filtering there watches a process that does not exist.
EXPO_GO_PACKAGE = "host.exp.exponent"
#: Substrings the registry watches for. Plain substrings, not regexes: that is what the
#: watch-pattern matcher takes.
CRASH_PATTERNS = ("FATAL EXCEPTION", "ANR in ", "am_anr")
_EXIT_TIMEOUT = 30
#: One `ApplicationExitInfo #N:` block. Fields are pulled out of a block individually
#: rather than by one big pattern, because `subreason` is absent on some exits and an
#: optional group in the middle of a non-greedy pattern silently never matches.
_ENTRY_SPLIT = re.compile(r"ApplicationExitInfo #\d+:")
_FIELD_RES = {
    "timestamp": re.compile(r"timestamp=([\d-]+ [\d:.]+)"),
    "pid": re.compile(r"pid=(\d+)"),
    "reason": re.compile(r"reason=(\d+ \([^)]*\))"),
    "subreason": re.compile(r"subreason=(\d+ \([^)]*\))"),
    "description": re.compile(r"description=(.*?)\s+state=", re.S),
    "trace": re.compile(r"trace=(\S+)"),
}


def watch_command(adb: Sequence[str]) -> str:
    """The shell command whose output the registry watches.

    Both buffers in one process: `crash` carries the native fatal, `events` carries the
    structured ANR record. `-T 1` starts from now rather than replaying the buffer,
    because a crash from an hour ago is not a notification.
    """
    return shlex.join([*adb, "logcat", "-b", "crash", "-b", "events", "-v", "threadtime", "-T", "1"])


def classify(line: str) -> str:
    """Which class a watched line belongs to, for the notification's own wording."""
    if "FATAL EXCEPTION" in line:
        return "native crash"
    if "am_anr" in line or "ANR in " in line:
        return "ANR"
    return "device signal"


def exit_info(adb: Sequence[str], package: str, *, limit: int = 5) -> Dict[str, Any]:
    """Android's own record of why this package's processes ended.

    **Metadata only.** The design left open whether this exposes the trace body; measured
    on API 36, every entry reports `trace=null`, including force stops and ordinary
    exits. So this answers "did it die, when, and why" and never "where". The trace body
    needs `adb bugreport`, which is minutes and megabytes, or root, which a physical
    device does not offer.
    """
    if not adb:
        return {"error": "no device"}
    try:
        result = subprocess.run([*adb, "shell", "dumpsys", "activity", "exit-info", package],
                                capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=_EXIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": f"could not read exit info: {e}"}
    if result.returncode != 0:
        return {"error": (result.stderr or result.stdout or "").strip()[:300]}
    entries = parse_exit_info(result.stdout)[:limit]
    return {
        "package": package,
        "exits": entries,
        "note": ("Android records why a process ended, never where. Every entry reports "
                 "trace=null on this platform, so a stack for a native crash has to come "
                 "from logcat's crash buffer at the moment it happens."),
    }


def parse_exit_info(raw: str) -> List[Dict[str, Any]]:
    """The `ApplicationExitInfo` blocks, newest first, as the fields anyone reads."""
    entries = []
    for block in _ENTRY_SPLIT.split(raw or "")[1:]:
        fields = {name: pattern.search(block) for name, pattern in _FIELD_RES.items()}
        if not (fields["timestamp"] and fields["reason"]):
            continue
        entry: Dict[str, Any] = {
            "timestamp": fields["timestamp"].group(1),
            "reason": fields["reason"].group(1),
        }
        if fields["pid"]:
            entry["pid"] = int(fields["pid"].group(1))
        if fields["subreason"]:
            entry["subreason"] = fields["subreason"].group(1)
        if fields["description"]:
            entry["description"] = " ".join(fields["description"].group(1).split())[:200]
        entry["crashed"] = _is_crash(entry["reason"])
        # Recorded verbatim rather than assumed: every entry measured on API 36 says null.
        entry["trace"] = fields["trace"].group(1) if fields["trace"] else "null"
        entries.append(entry)
    return entries


def _is_crash(reason: str) -> bool:
    """Whether this exit reason is the app dying rather than the app being closed.

    Named rather than numbered, because the numbers are an Android constant table and a
    reader of this file should not have to go and look them up.
    """
    return any(word in reason for word in ("CRASH", "ANR", "SIGNALED", "EXCESSIVE RESOURCE"))


def resolve_package(adb: Sequence[str], package: str = "") -> Optional[str]:
    """The package to scope crash queries to: the caller's, or whatever is in front.

    Returns None when nothing can be resolved, so a caller reports that rather than
    quietly querying an empty string and reporting no crashes.
    """
    if package:
        return package
    if not adb:
        return None
    try:
        out = subprocess.run([*adb, "shell", "dumpsys", "activity", "activities"],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=_EXIT_TIMEOUT).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"topResumedActivity=ActivityRecord\{\S+ \S+ (\S+?)/", out or "")
    return match.group(1) if match else None
