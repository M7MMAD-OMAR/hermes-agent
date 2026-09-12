"""One place that decides which device an adb command talks to.

Two things led here. A session that leased `phone-b` was reading `phone-a`'s logs,
because the console resolved "the device" independently of the lease. And the crash
watcher spawns a detached process that outlives the turn, so the serial it is given has
to be the right one at spawn time; there is nobody left to correct it afterwards.

**No per-session adb server.** The design proposed isolating the transport with
`ADB_SERVER_SOCKET=localfilesystem:<path>` alongside the lease. Two servers do coexist,
and both see an emulator, which is a TCP connection to its console port. A USB device is
not that: one adb server claims the interface exclusively, and a second server is the
classic way to make a physical device go offline for both. That case could not be tested
on this host, and it is the case Tier 2 calls the true zero-install path. The lease
already gives one session one device, and `kill-server` is never called, which is the
hygiene the isolation was written for. So routing is what is isolated, not the server.
"""

from __future__ import annotations

import os
from typing import List, Optional, Tuple

SERIAL_ENV = "ANDROID_SERIAL"


def session_adb(session_id: str = "") -> Tuple[List[str], str]:
    """The adb invocation for this session, and a line saying why that device.

    Returns `([], reason)` rather than an unrouted adb when the answer is ambiguous.
    Falling back to whichever device answers first is the failure that reads as the app
    misbehaving, and it is silent.
    """
    from hermes_cli.tools_config_android import adb_command, attached_devices
    adb = adb_command()
    if not adb:
        return [], "adb is not installed; run `hermes device install --accept-license`"

    leased = _leased_serial(session_id)
    if leased:
        return [adb, "-s", leased], f"{leased}, leased by this session"

    pinned = os.environ.get(SERIAL_ENV, "").strip()
    if pinned:
        return [adb, "-s", pinned], f"{pinned}, pinned by {SERIAL_ENV}"

    ready = [device["serial"] for device in attached_devices() if device["state"] == "device"]
    if not ready:
        return [], "no device is attached"
    if len(ready) > 1:
        # Reading a log is not exclusive, so no lease is required to do it. Guessing
        # which of several phones the reader meant is a different matter.
        return [], (f"several devices are attached ({', '.join(ready)}); set {SERIAL_ENV} "
                    "to the one to read, or take one through the device surface")
    return [adb, "-s", ready[0]], f"{ready[0]}, the only device attached"


def _leased_serial(session_id: str) -> Optional[str]:
    """The device this session already holds, when the broker is reachable."""
    try:
        from gateway.device_control_broker import get_device_control_broker
        return get_device_control_broker().serial_for_session(session_id)
    except Exception:
        return None
