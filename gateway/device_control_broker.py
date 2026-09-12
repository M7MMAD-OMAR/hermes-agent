"""Leases one mobile device to one Hermes session at a time.

adb has no mutual exclusion of its own. `-s serial` and `ANDROID_SERIAL` are pure
routing, and `--one-device` restricts one adb *server* to one device while doing
nothing about a second, independent session's server pointed at the same serial. So
two sessions driving one phone interleave their taps, and the result looks like the
app misbehaving rather than like two agents fighting.

Shape is `gateway/browser_control_broker.py`'s, with one deliberate difference and one
deliberate omission.

The difference: the authority is a **kernel file lock**, not this process's dictionary.
Hermes sessions are separate processes here, so an in-process registry would protect
only sessions inside one gateway and would report success to every other one. The lock
is released by the kernel when the holding descriptor closes, including on SIGKILL, so
there is no staleness heuristic to get wrong. The scope written into the lease file is
diagnostic, so a refusal can name who holds the device; it is never consulted to decide
whether the device is free.

The omission: the browser broker's `dispatch`, `complete`, `attach`/`detach`,
cancel-frame ordering and single-use tickets all exist to talk to a controller on the
far end of a wire. A device backend runs adb in this process, so there is no far end,
nobody to hand a credential to, and no caller for any of it. `design.md` asked for a
ticket minted, consumed and released; that request assumed the remote-controller shape,
and a ticket with no second party is a credential handed from a function to itself.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger("gateway.device_control")

#: Serials can be host:port for a wireless device, so they are not filenames as they stand.
_UNSAFE_IN_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")

#: Stable identity fields. `serial` names the resource; the rest name who holds it.
_IDENTITY_FIELDS = ("principal_id", "session_id", "task_id", "transport_family", "serial")


class DeviceControlError(Exception):
    """Base for every device-lease failure."""


class DeviceBusy(DeviceControlError):
    """Another session holds this device."""


@dataclass(frozen=True)
class DeviceControlScope:
    """Who is driving which device. Equality is over all fields."""
    serial: str = ""
    principal_id: Optional[str] = None
    session_id: Optional[str] = None
    task_id: Optional[str] = None
    transport_family: Optional[str] = None


def _same_scope_identity(first: DeviceControlScope, second: DeviceControlScope) -> bool:
    return all(getattr(first, name) == getattr(second, name) for name in _IDENTITY_FIELDS)


@dataclass
class _Lease:
    """One held device. `handle` is the open descriptor whose closure frees the lock."""
    scope: DeviceControlScope
    path: Path
    handle: object


def lease_root() -> Path:
    """Where lease files live: the runtime directory, which the OS clears on logout.

    The fallback is per user, because a shared temp directory would let one user's lease
    refuse another's device. Windows already gives each user its own temp directory and
    has no `os.getuid`, so the uid suffix is POSIX-only.
    """
    runtime = os.environ.get("XDG_RUNTIME_DIR", "").strip()
    if runtime:
        base = Path(runtime)
    elif hasattr(os, "getuid"):
        base = Path(tempfile.gettempdir()) / f"hermes-{os.getuid()}"
    else:
        base = Path(tempfile.gettempdir()) / "hermes"
    return base / "hermes" / "device-leases"


def _lease_path(serial: str) -> Path:
    return lease_root() / f"{_UNSAFE_IN_FILENAME.sub('_', serial) or 'unknown'}.lease"


def _try_lock(handle) -> bool:
    """Take an exclusive, non-blocking lock on an open file. False when someone holds it.

    Both branches are kernel locks tied to the open descriptor, so a killed holder frees
    the device without anyone having to notice that it died.
    """
    if sys.platform == "win32":
        import msvcrt
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    import fcntl
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _open_lease_file(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    return os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT, 0o600), "r+", encoding="utf-8")


def _read_record(handle) -> dict:
    try:
        handle.seek(0)
        return json.loads(handle.read() or "{}")
    except (OSError, ValueError):
        return {}


class DeviceControlBroker:
    """Thread-safe registry of the leases this process holds over the per-device file locks."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._leases: Dict[str, _Lease] = {}  # serial -> lease held by THIS process

    # --- leases ----------------------------------------------------------------------

    def acquire(self, scope: DeviceControlScope) -> DeviceControlScope:
        """Take the device named by ``scope.serial``, or raise `DeviceBusy`.

        Re-acquiring under the same identity is a refresh rather than a failure: the lock
        belongs to the open descriptor, so a second open in this same process would
        conflict with our own lease and report the device busy with ourselves.
        """
        if not scope.serial:
            raise DeviceControlError("a lease needs a device serial")
        with self._lock:
            existing = self._leases.get(scope.serial)
            if existing is not None:
                if _same_scope_identity(existing.scope, scope):
                    return existing.scope
                raise DeviceBusy(f"{scope.serial} is already leased by this process "
                                 f"({_describe(existing.scope)}).")
            path = _lease_path(scope.serial)
            handle = _open_lease_file(path)
            if not _try_lock(handle):
                holder = _read_record(handle)
                handle.close()
                raise DeviceBusy(f"{scope.serial} is held by another Hermes session "
                                 f"({_describe_record(holder)}). Attach a second device, or "
                                 f"wait for that session to finish.")
            handle.seek(0)
            handle.truncate()
            handle.write(json.dumps({**asdict(scope), "pid": os.getpid(),
                                     "acquired_at": time.time()}, indent=2))
            handle.flush()
            self._leases[scope.serial] = _Lease(scope=scope, path=path, handle=handle)
        logger.debug("device lease acquired: %s by %s", scope.serial, _describe(scope))
        return scope

    def release(self, scope: DeviceControlScope) -> bool:
        """Give the device back. True iff this call released a lease we were holding.

        Idempotent, because it runs from `stop()`, from session release and from the
        atexit sweep, and any of the three may get there first.
        """
        with self._lock:
            lease = self._leases.get(scope.serial)
            if lease is None or not _same_scope_identity(lease.scope, scope):
                return False
            del self._leases[scope.serial]
        _close_lease(lease)
        return True

    def holder(self, serial: str) -> Optional[dict]:
        """The record of whoever holds ``serial``, or None when it is free.

        Probes with a lock attempt on a descriptor of its own rather than trusting the
        record, so a file left behind by a killed session reads as free.
        """
        with self._lock:
            lease = self._leases.get(serial)
            if lease is not None:
                return {**asdict(lease.scope), "pid": os.getpid()}
        path = _lease_path(serial)
        if not path.is_file():
            return None
        handle = _open_lease_file(path)
        try:
            if _try_lock(handle):
                return None
            return _read_record(handle) or {"serial": serial}
        finally:
            handle.close()

    def serial_for_session(self, session_id: str) -> Optional[str]:
        """The device this session has leased, or None.

        Only this process's leases: another process's lease is that process's business,
        and a session id is unique to the session that owns it either way.
        """
        if not session_id:
            return None
        with self._lock:
            return next((serial for serial, lease in self._leases.items()
                         if lease.scope.session_id == session_id), None)

    def held_by_other_session(self, serial: str, scope: DeviceControlScope) -> bool:
        """Whether ``serial`` is taken by somebody who is not ``scope``."""
        record = self.holder(serial)
        if record is None:
            return False
        return not all(record.get(name) == getattr(scope, name) for name in _IDENTITY_FIELDS)

    def reset(self) -> None:
        """Release every lease this process holds."""
        with self._lock:
            leases, self._leases = list(self._leases.values()), {}
        for lease in leases:
            _close_lease(lease)

    @property
    def lease_count(self) -> int:
        with self._lock:
            return len(self._leases)


def _close_lease(lease: _Lease) -> None:
    """Closing the descriptor is what frees the device; the file itself is only a record."""
    try:
        lease.handle.close()
    except OSError as e:
        logger.debug("device lease close failed for %s: %s", lease.scope.serial, e)


def _describe(scope: DeviceControlScope) -> str:
    named = [f"{name}={getattr(scope, name)}" for name in ("session_id", "task_id", "principal_id")
             if getattr(scope, name)]
    return ", ".join(named) or "an unnamed session"


def _describe_record(record: dict) -> str:
    named = [f"{name}={record[name]}" for name in ("session_id", "task_id", "principal_id", "pid")
             if record.get(name)]
    return ", ".join(named) or "no identifying details recorded"


_GLOBAL_BROKER = DeviceControlBroker()


def get_device_control_broker() -> DeviceControlBroker:
    """The process-wide broker. One per process; the file locks coordinate between them."""
    return _GLOBAL_BROKER
