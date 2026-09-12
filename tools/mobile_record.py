"""`mobile_record`: a video of what the device did, for showing rather than describing.

A screenshot answers "what does it look like now". Some things only exist in motion: an
animation that stutters, a screen that flashes before it settles, a gesture that lands
somewhere unexpected. This records the device's screen and hands back a file.

The encode happens **on the device**, by its own MediaCodec hardware, so this needs no
ffmpeg, no scrcpy, no vendored jar and no third-party anything: `screenrecord` has been
in Android since API 19. `adb exec-out screenrecord --output-format=h264 -` streams the
same encode over adb with the first byte in about a tenth of a second, which is the
shape a live panel wants; this tool takes the simpler branch, writing an MP4 on the
device and pulling it, because a file is what a caller can attach to a report.

What it cannot do is its own documentation: `screenrecord` captures no audio, refuses
resolutions its encoder does not support, and on some devices will not record DRM
surfaces at all, which come out black.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Sequence

from tools.registry import registry

logger = logging.getLogger("tools.mobile_record")

#: `screenrecord` caps itself at 180 seconds unless told otherwise; this keeps a caller
#: from asking for a file nobody wants to move around.
MAX_SECONDS = 180
DEFAULT_SECONDS = 10
_PULL_TIMEOUT = 120
#: Where on the device the file lands. `/sdcard` is the shell user's own writable space.
_DEVICE_DIR = "/sdcard"


def stream_argv(adb: Sequence[str], *, bit_rate: str = "") -> List[str]:
    """The unbounded H.264 stream, for a consumer that decodes frames as they arrive.

    `--time-limit 0` removes screenrecord's own 180 second cap. Kept here rather than in
    a panel so the one command with the awkward flags has one definition.
    """
    argv = [*adb, "exec-out", "screenrecord", "--time-limit", "0", "--output-format=h264"]
    if bit_rate:
        argv += ["--bit-rate", bit_rate]
    return [*argv, "-"]


def record(adb: Sequence[str], out_path: str, *, seconds: int = DEFAULT_SECONDS,
           size: str = "", bit_rate: str = "") -> Dict[str, Any]:
    """Record for ``seconds`` and pull the file back. Returns the result payload."""
    seconds = max(1, min(int(seconds), MAX_SECONDS))
    remote = f"{_DEVICE_DIR}/hermes-{uuid.uuid4().hex[:12]}.mp4"
    argv = [*adb, "shell", "screenrecord", "--time-limit", str(seconds)]
    if size:
        argv += ["--size", size]
    if bit_rate:
        argv += ["--bit-rate", bit_rate]
    argv.append(remote)

    started = time.time()
    try:
        # The timeout is the recording plus room for the encoder to flush the trailer.
        result = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=seconds + 60)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": f"screenrecord failed: {e}"}
    if result.returncode != 0:
        return {"error": (result.stderr or result.stdout or "").strip()[:300] or
                "screenrecord exited non-zero"}

    pulled = _pull(adb, remote, out_path)
    _remove(adb, remote)
    if "error" in pulled:
        return pulled
    return {"path": pulled["path"], "bytes": pulled["bytes"],
            "seconds": seconds, "elapsed": round(time.time() - started, 1),
            "note": "Encoded by the device, so there is no audio and a DRM surface may "
                    "come out black."}


def _pull(adb: Sequence[str], remote: str, out_path: str) -> Dict[str, Any]:
    destination = Path(out_path).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run([*adb, "pull", remote, str(destination)], capture_output=True,
                                text=True, encoding="utf-8", errors="replace",
                                timeout=_PULL_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": f"could not pull the recording: {e}"}
    if result.returncode != 0 or not destination.is_file():
        return {"error": (result.stderr or result.stdout or "").strip()[:300] or
                "the recording did not arrive"}
    return {"path": str(destination), "bytes": destination.stat().st_size}


def _remove(adb: Sequence[str], remote: str) -> None:
    """Leave nothing behind on the user's device; the file is ours and it is large."""
    try:
        subprocess.run([*adb, "shell", "rm", "-f", remote], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug("could not remove %s from the device: %s", remote, e)


def mobile_record(*, session_id: str = "", seconds: int = DEFAULT_SECONDS, path: str = "",
                  size: str = "", bit_rate: str = "") -> str:
    from tools.computer_use.device_adb import session_adb
    adb, note = session_adb(session_id)
    if not adb:
        return json.dumps({"error": f"nothing to record: {note}"})
    out_path = path or os.path.join(os.getcwd(), f"device-{uuid.uuid4().hex[:8]}.mp4")
    payload = record(adb, out_path, seconds=seconds, size=size, bit_rate=bit_rate)
    payload.setdefault("device", note)
    return json.dumps(payload, indent=2)


MOBILE_RECORD_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "seconds": {
            "type": "integer",
            "description": f"How long to record, 1 to {MAX_SECONDS}. Default {DEFAULT_SECONDS}.",
        },
        "path": {
            "type": "string",
            "description": "Where to write the .mp4. Defaults to the working directory.",
        },
        "size": {
            "type": "string",
            "description": (
                "Optional WIDTHxHEIGHT, e.g. 720x1600. The device refuses sizes its "
                "encoder does not support; omit it to record at the screen's own size."
            ),
        },
        "bit_rate": {
            "type": "string",
            "description": "Optional encoder bit rate, e.g. 4M. Default is the device's own.",
        },
    },
    "required": [],
    "additionalProperties": False,
}


def _mobile_record_check() -> bool:
    try:
        from hermes_cli.tools_config_android import android_tools_ready
        return android_tools_ready()
    except Exception:
        return False


registry.register(
    name="mobile_record",
    toolset="device",
    schema=MOBILE_RECORD_SCHEMA,
    handler=lambda args, **kw: mobile_record(
        session_id=str(kw.get("session_id") or ""),
        seconds=int(args.get("seconds") or DEFAULT_SECONDS),
        path=str(args.get("path") or ""),
        size=str(args.get("size") or ""),
        bit_rate=str(args.get("bit_rate") or ""),
    ),
    check_fn=_mobile_record_check,
    emoji="🎬",
)
