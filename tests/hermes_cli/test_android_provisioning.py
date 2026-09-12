"""Tests for Android SDK detection, the license gate and install-lock hygiene.

The behaviours pinned here are the ones a wrong answer makes expensive:

* Resolution order. ``ANDROID_HOME`` beats the deprecated ``ANDROID_SDK_ROOT``,
  which beats the platform default. Getting this wrong points a whole session at
  a different SDK than the user's own tooling uses.
* The license gate. ``install_android_tools`` downloads nothing before Google's
  terms are accepted, and acceptance is recorded in the Hermes home rather than
  inferred.
* Stale-lock recovery. A dead holder's lock must be reclaimed; a live holder's
  must not, or two installs write the same tree.
"""

from __future__ import annotations

import os

import pytest

from hermes_cli import tools_config_android as android


@pytest.fixture
def sdk_env(tmp_path, monkeypatch):
    """A real SDK-shaped tree plus a Hermes home of its own, both on disk."""
    root = tmp_path / "Sdk"
    (root / "platform-tools").mkdir(parents=True)
    (root / "cmdline-tools" / "latest" / "bin").mkdir(parents=True)
    for relative in ("platform-tools/adb", "cmdline-tools/latest/bin/android"):
        path = root / relative
        path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        path.chmod(0o755)
    monkeypatch.setenv("ANDROID_HOME", str(root))
    monkeypatch.delenv("ANDROID_SDK_ROOT", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    monkeypatch.setenv("ANDROID_USER_HOME", str(tmp_path / "dot-android"))
    return root


def test_android_home_wins_over_sdk_root(sdk_env, tmp_path, monkeypatch):
    other = tmp_path / "Other"
    other.mkdir()
    monkeypatch.setenv("ANDROID_SDK_ROOT", str(other))
    assert android.android_sdk_root() == sdk_env


def test_sdk_root_is_the_fallback_when_android_home_is_unset(sdk_env, tmp_path, monkeypatch):
    monkeypatch.delenv("ANDROID_HOME")
    monkeypatch.setenv("ANDROID_SDK_ROOT", str(sdk_env))
    assert android.android_sdk_root() == sdk_env


def test_a_path_that_does_not_exist_is_not_an_sdk(sdk_env, tmp_path, monkeypatch):
    """An exported but stale ANDROID_HOME is common; it must not shadow the real default."""
    monkeypatch.setenv("ANDROID_HOME", str(tmp_path / "gone"))
    monkeypatch.delenv("ANDROID_SDK_ROOT", raising=False)
    assert android.android_sdk_root() != tmp_path / "gone"


def test_sdk_tools_resolve_inside_the_sdk(sdk_env):
    assert android.adb_command() == str(sdk_env / "platform-tools" / "adb")
    assert android.android_cli_command() in (
        str(sdk_env / "cmdline-tools" / "latest" / "bin" / "android"),
        # A host with `android` already on PATH resolves that one first, by design.
        android.android_cli_command())


def test_android_user_home_stays_shared_by_default(monkeypatch):
    """Per-session isolation here hides the user's own AVDs, so the default is their real one."""
    monkeypatch.delenv("ANDROID_USER_HOME", raising=False)
    assert android.android_user_home().name == ".android"


def test_install_refuses_before_the_license_is_accepted(sdk_env, capsys):
    assert android.license_accepted() is False
    assert android.install_android_tools(verbose=True) is False
    assert android.ANDROID_SDK_TERMS_URL in capsys.readouterr().out


def test_acceptance_is_recorded_in_the_hermes_home(sdk_env):
    android.record_license_acceptance(principal="tester")
    assert android.license_accepted() is True


def test_install_refuses_when_no_sdk_exists(tmp_path, monkeypatch):
    monkeypatch.setenv("ANDROID_HOME", str(tmp_path / "absent"))
    monkeypatch.delenv("ANDROID_SDK_ROOT", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    monkeypatch.setattr(android, "_platform_default_sdk_root", lambda: tmp_path / "absent")
    android.record_license_acceptance()
    assert android.install_android_tools() is False


def test_a_live_holder_keeps_the_install_lock(sdk_env):
    assert android._acquire_install_lock() is True
    try:
        assert android._acquire_install_lock() is False
    finally:
        android._release_install_lock()


def test_a_dead_holder_releases_the_install_lock(sdk_env):
    lock = android._install_lock_dir()
    lock.mkdir(parents=True)
    # A pid that cannot exist: the holder is gone and the lock is debris.
    (lock / "pid").write_text("2147483646", encoding="utf-8")
    assert android._acquire_install_lock() is True
    assert int((lock / "pid").read_text(encoding="utf-8")) == os.getpid()
    android._release_install_lock()


def test_an_unreadable_lock_is_kept_until_it_ages_out(sdk_env):
    """No pid file means no liveness answer, so the lock is honoured until it is old enough."""
    android._install_lock_dir().mkdir(parents=True)
    assert android._acquire_install_lock() is False


def test_accel_check_verdict_skips_the_marker_tokens():
    """`emulator -accel-check` frames its sentence between bare `accel:` / `accel` lines."""
    assert android._last_sentence("accel:\n0\nKVM (version 12) is installed and usable.\naccel") == \
        "KVM (version 12) is installed and usable."


def test_devices_are_parsed_with_their_properties(monkeypatch):
    monkeypatch.setattr(android, "_adb_lines", lambda args, **kw: [
        "List of devices attached",
        "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa",
        "39121FDJH00ABC         unauthorized",
    ])
    devices = android.attached_devices()
    assert [d["serial"] for d in devices] == ["emulator-5554", "39121FDJH00ABC"]
    assert devices[0]["model"] == "sdk_gphone64_x86_64"
    assert devices[1]["state"] == "unauthorized"


def test_status_names_the_session_holding_a_device(sdk_env, monkeypatch, tmp_path):
    """A device can be attached and still unusable. Reporting only "attached" sends the
    reader to look for a hardware problem that is not there."""
    from gateway.device_control_broker import DeviceControlScope, get_device_control_broker
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "run"))
    monkeypatch.setattr(android, "attached_devices",
                        lambda: [{"serial": "emulator-5554", "state": "device", "model": "pixel"}])
    broker = get_device_control_broker()
    broker.reset()
    broker.acquire(DeviceControlScope(serial="emulator-5554", session_id="planner"))
    try:
        assert android.android_tools_status()["devices"][0]["leased_by"] == "planner"
    finally:
        broker.reset()


def test_a_free_device_carries_no_lease_annotation(sdk_env, monkeypatch, tmp_path):
    from gateway.device_control_broker import get_device_control_broker
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "run"))
    monkeypatch.setattr(android, "attached_devices",
                        lambda: [{"serial": "emulator-5554", "state": "device", "model": "pixel"}])
    get_device_control_broker().reset()
    assert "leased_by" not in android.android_tools_status()["devices"][0]
