"""The logcat half of the device console: the channel that always works.

CDP is the better channel where it exists, because it carries structured arguments and
real stack frames that logcat flattens to text. It is also absent exactly where most
people first run an Expo project: in Expo Go the engine reports that it does not support
debugging over CDP and `Runtime.consoleAPICalled` never fires once, while every level
still reaches logcat. So both channels run and the caller is told which one is live.

Three things here look like over-engineering and are not. Each one was a silent failure.
"""

from __future__ import annotations

import logging
import re
import subprocess
import time
from typing import Callable, List, Optional, Sequence

from tools.mobile_console_cdp import ConsoleRecord

logger = logging.getLogger("tools.mobile_console")

DEFAULT_TAG = "ReactNativeJS"
_LEVEL_BY_LOGCAT = {"V": 0, "D": 0, "I": 1, "W": 2, "E": 3, "F": 3}
_THREADTIME_RE = re.compile(
    r"^\d\d-\d\d \S+\s+\d+\s+\d+\s+([VDIWEF])\s+(\S+)\s*:\s?(.*)$")
_POLL_SECONDS = 1.0
_POLL_TIMEOUT = 20
#: Lines already emitted, capped so a long-lived session does not grow without bound.
_SEEN_LIMIT = 4000


def logcat_argv(adb: Sequence[str], tags: Sequence[str]) -> List[str]:
    """A read-and-exit logcat invocation filtered to ``tags``.

    Deliberately no `-t N`. On this adb `-t` is applied **before** the tag filter, so
    `-s ReactNativeJS:V -t 6` returns the last six lines of the whole buffer and then
    filters them, usually to nothing at all.
    """
    return [*adb, "logcat", "-v", "threadtime", "-d",
            "-s", *[f"{tag}:V" for tag in tags]]


def clear_buffer(adb: Sequence[str]) -> bool:
    """Drop what the device has buffered, so the next read starts from now."""
    try:
        return subprocess.run([*adb, "logcat", "-c"], capture_output=True,
                              timeout=_POLL_TIMEOUT).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _parse(line: str, previous: Optional[ConsoleRecord]) -> Optional[ConsoleRecord]:
    """One threadtime line as a record, folding a continuation into its predecessor.

    A multi-line structured object arrives as N separately tagged lines, so a line
    indented further than the one before it belongs to that one.
    """
    match = _THREADTIME_RE.match(line)
    if not match:
        return None
    level_char, tag, text = match.group(1), match.group(2), match.group(3)
    if previous is not None and text.startswith(("  ", "\t")) and text.strip():
        previous.message += "\n" + text
        return None
    return ConsoleRecord(ts=time.time(), level=_LEVEL_BY_LOGCAT.get(level_char, 0),
                         kind="logcat", channel="logcat", message=text, extra={"tag": tag})


def poll_forever(adb: Sequence[str], tags: Sequence[str], *, on_record: Callable,
                 should_stop: Callable[[], bool]) -> None:
    """Poll logcat until told to stop.

    Polling rather than tailing, for a reason that is invisible until you lose an hour
    to it: **`adb logcat` block-buffers when its stdout is a pipe**, so a live
    `for line in proc.stdout` tail stays completely silent until 4 KiB accumulates,
    which on a quiet app is minutes. It reads exactly like a broken logcat. The other
    fix is `stdbuf -oL`, which is coreutils and is not on every host.
    """
    argv, seen, previous = logcat_argv(adb, tags), [], None
    seen_set = set()
    while not should_stop():
        try:
            output = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=_POLL_TIMEOUT).stdout
        except (OSError, subprocess.SubprocessError) as e:
            logger.debug("logcat poll failed: %s", e)
            _sleep_unless_stopped(should_stop)
            continue
        for line in output.splitlines():
            if line in seen_set:
                continue
            seen.append(line)
            seen_set.add(line)
            if len(seen) > _SEEN_LIMIT:
                seen_set.discard(seen.pop(0))
            record = _parse(line, previous)
            if record is not None:
                previous = record
                on_record(record)
        _sleep_unless_stopped(should_stop)


def _sleep_unless_stopped(should_stop: Callable[[], bool]) -> None:
    """Sleep in short slices so a stop request is acted on promptly."""
    deadline = time.monotonic() + _POLL_SECONDS
    while time.monotonic() < deadline and not should_stop():
        time.sleep(0.1)
