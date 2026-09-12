"""Tests for the device lease.

The property this exists for is **exclusion between processes**. Hermes sessions are
separate processes on one machine, and adb offers no mutual exclusion of its own, so
an in-process registry would report success to every session and protect nothing.
Every in-process assertion here would also pass against a plain dictionary; the
subprocess test is the one that distinguishes a working lease from a decorative one.

The rest pins the bookkeeping: re-acquiring under one identity is a refresh rather
than a self-collision, releasing someone else's lease does nothing, and a refusal names
the session that holds the device.
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap

import pytest

from gateway.device_control_broker import (
    DeviceBusy, DeviceControlBroker, DeviceControlError, DeviceControlScope,
    get_device_control_broker)


@pytest.fixture
def broker(tmp_path, monkeypatch):
    """A broker whose lease files live in a directory of this test's own."""
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    instance = DeviceControlBroker()
    yield instance
    instance.reset()


def _scope(serial="emulator-5554", session="a"):
    return DeviceControlScope(serial=serial, session_id=session, transport_family="adb")


# --- the property the lease exists for ---------------------------------------------


_CHILD = """
import sys
sys.path.insert(0, {repo!r})
import os
os.environ["XDG_RUNTIME_DIR"] = {runtime!r}
from gateway.device_control_broker import DeviceBusy, DeviceControlBroker, DeviceControlScope
broker = DeviceControlBroker()
scope = DeviceControlScope(serial="emulator-5554", session_id="child", transport_family="adb")
try:
    broker.acquire(scope)
    print("ACQUIRED")
except DeviceBusy as exc:
    print("REFUSED", exc)
"""


def _child_result(tmp_path, repo_root):
    source = _CHILD.format(repo=str(repo_root), runtime=str(tmp_path))
    return subprocess.run([sys.executable, "-c", textwrap.dedent(source)],
                          capture_output=True, text=True, timeout=60).stdout.strip()


def test_another_process_cannot_take_a_leased_device(broker, tmp_path, request):
    """The whole point. A dictionary passes every other test in this file and fails this one."""
    repo_root = request.config.rootpath
    broker.acquire(_scope())
    assert _child_result(tmp_path, repo_root).startswith("REFUSED")


def test_another_process_gets_the_device_after_it_is_released(broker, tmp_path, request):
    repo_root = request.config.rootpath
    broker.acquire(_scope())
    broker.release(_scope())
    assert _child_result(tmp_path, repo_root) == "ACQUIRED"


def test_a_killed_holder_frees_the_device(broker, tmp_path, request):
    """The lock belongs to the open descriptor, so the kernel releases it on SIGKILL. There
    is no stale-lease heuristic here because there is nothing for one to decide."""
    repo_root = request.config.rootpath
    source = _CHILD.format(repo=str(repo_root), runtime=str(tmp_path)) + "\nimport os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n"
    subprocess.run([sys.executable, "-c", textwrap.dedent(source)], capture_output=True, timeout=60)
    assert broker.holder("emulator-5554") is None
    assert broker.acquire(_scope()).serial == "emulator-5554"


def test_the_refusal_names_the_holder(broker, tmp_path):
    broker.acquire(_scope(session="planner"))
    other = DeviceControlBroker()
    # A second broker in this process stands in for a second session; the file is the authority.
    with pytest.raises(DeviceBusy, match="planner"):
        other.acquire(_scope(session="builder"))


# --- lease bookkeeping --------------------------------------------------------------


def test_reacquiring_under_the_same_identity_is_a_refresh(broker):
    """A second open in this process would conflict with our own lock and report the
    device busy with ourselves, which is not a useful thing to tell anyone."""
    broker.acquire(_scope())
    assert broker.acquire(_scope()).serial == "emulator-5554"
    assert broker.lease_count == 1


def test_a_second_session_in_this_process_is_still_refused(broker):
    broker.acquire(_scope(session="a"))
    with pytest.raises(DeviceBusy):
        broker.acquire(_scope(session="b"))


def test_releasing_someone_elses_lease_does_nothing(broker):
    broker.acquire(_scope(session="a"))
    assert broker.release(_scope(session="b")) is False
    assert broker.lease_count == 1


def test_release_is_idempotent(broker):
    broker.acquire(_scope())
    assert broker.release(_scope()) is True
    assert broker.release(_scope()) is False


def test_a_lease_needs_a_serial(broker):
    with pytest.raises(DeviceControlError, match="serial"):
        broker.acquire(DeviceControlScope(session_id="a"))


def test_a_wireless_serial_is_still_a_valid_filename(broker):
    """A wireless device's serial is host:port, which is not a filename as it stands."""
    scope = _scope(serial="192.168.1.42:5555")
    broker.acquire(scope)
    assert broker.holder("192.168.1.42:5555")["serial"] == "192.168.1.42:5555"


def test_held_by_other_session_ignores_our_own_lease(broker):
    scope = _scope(session="mine")
    broker.acquire(scope)
    assert broker.held_by_other_session("emulator-5554", scope) is False
    assert broker.held_by_other_session("emulator-5554", _scope(session="theirs")) is True


def test_an_untouched_device_is_free(broker):
    assert broker.holder("emulator-9999") is None
    assert broker.held_by_other_session("emulator-9999", _scope()) is False


def test_reset_releases_everything(broker):
    broker.acquire(_scope(serial="a"))
    broker.acquire(_scope(serial="b"))
    broker.reset()
    assert broker.lease_count == 0
    assert broker.holder("a") is None


def test_the_lease_file_records_who_holds_it(broker, tmp_path):
    broker.acquire(_scope(session="reporter"))
    record = json.loads((tmp_path / "hermes" / "device-leases" / "emulator-5554.lease")
                        .read_text(encoding="utf-8"))
    assert record["session_id"] == "reporter"
    assert record["pid"] > 0


def test_the_process_broker_is_a_singleton():
    assert get_device_control_broker() is get_device_control_broker()
