"""Device JSON-RPC handlers, for the surface that shows a phone beside the conversation.

Frames rather than a video stream, deliberately. `screenrecord` gives an H.264 elementary
stream that Electron's `VideoDecoder` can take, and that is the right answer for a smooth
mirror. It is also a codec pipeline, a keyframe policy and a reconnect story, all of them
in a renderer nobody can watch from here. A panel whose job is to show what the agent is
doing to a phone needs to be current, not cinematic: a JPEG every few hundred
milliseconds is enough to follow a tap, costs one `screencap`, and fails by being stale
rather than by going black.

`mobile_record.stream_argv` already builds the streaming command for whoever wants the
smooth version later.
"""

from __future__ import annotations

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method

#: A phone screenshot is a megabyte of PNG. JPEG at this quality is about a tenth of that
#: and the difference is invisible at panel size, which matters when it is sent per frame.
_FRAME_QUALITY = 70
_MAX_FRAME_WIDTH = 900


def _frame_data_url(adb, quality: int, max_width: int):
    """One frame as a JPEG data URL, or None. A remote desktop cannot read a gateway path."""
    import base64
    from io import BytesIO
    from PIL import Image
    from tools.computer_use.device_backend_screen import capture_png

    raw = capture_png(adb)
    image = Image.open(BytesIO(raw)).convert("RGB")
    if image.width > max_width:
        image = image.resize((max_width, round(image.height * max_width / image.width)))
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return (f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}",
            image.width, image.height)


@method("device.status")
def _(rid, params: dict) -> dict:
    """Whether this host can show a device at all, and which one.

    Answers without touching the device where it can, so a panel can ask on every mount
    without making an absent phone expensive.
    """
    try:
        from hermes_cli.tools_config_android import android_tools_status
        from tools.computer_use.device_adb import session_adb
    except Exception as e:
        return _ok(rid, {"available": False, "reason": f"device support is unavailable: {e}"})
    session_id = str(params.get("session_id") or "")
    adb, note = session_adb(session_id)
    status = android_tools_status()
    return _ok(rid, {
        "available": bool(adb),
        "reason": note,
        "provisioned": bool(status.get("ready")),
        "devices": status.get("devices", []),
    })


@method("device.frame")
def _(rid, params: dict) -> dict:
    """One frame of this session's device, plus the size it was captured at.

    Params: ``session_id``, ``quality`` (1 to 95), ``max_width``. Result:
    ``{available, frame, width, height, reason}``. A failure is reported as unavailable
    with its reason rather than as an error, because a panel polling this wants to show
    "the device went away" and keep polling, not to tear itself down.
    """
    try:
        from tools.computer_use.device_adb import session_adb
    except Exception as e:
        return _ok(rid, {"available": False, "reason": f"device support is unavailable: {e}"})
    adb, note = session_adb(str(params.get("session_id") or ""))
    if not adb:
        return _ok(rid, {"available": False, "reason": note})
    try:
        quality = max(1, min(int(params.get("quality") or _FRAME_QUALITY), 95))
        max_width = max(200, min(int(params.get("max_width") or _MAX_FRAME_WIDTH), 2000))
    except (TypeError, ValueError):
        quality, max_width = _FRAME_QUALITY, _MAX_FRAME_WIDTH
    try:
        frame, width, height = _frame_data_url(adb, quality, max_width)
    except Exception as e:
        return _ok(rid, {"available": False, "reason": f"the device did not answer: {e}"})
    return _ok(rid, {"available": True, "frame": frame, "width": width, "height": height,
                     "device": note})


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
