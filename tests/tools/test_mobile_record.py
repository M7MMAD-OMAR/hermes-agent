"""Tests for recording the device screen.

The encode happens on the device, so the parts worth pinning are the ones this side
gets wrong: an unbounded request, a file left on the user's phone, and a failure that
reports a path nobody wrote.
"""

from __future__ import annotations

import json

import pytest

from tools import mobile_record as tool


def test_a_request_is_bounded_at_both_ends(monkeypatch, tmp_path):
    """`screenrecord` caps itself at 180 seconds; an unbounded ask should not produce a
    file nobody wants to move around."""
    calls = []

    def fake_run(argv, **kwargs):
        calls.append(argv)
        return _ok()

    def limit_of(argv):
        return argv[argv.index("--time-limit") + 1]

    monkeypatch.setattr(tool.subprocess, "run", fake_run)
    monkeypatch.setattr(tool, "_pull", lambda adb, remote, out: {"path": out, "bytes": 1})
    tool.record(["adb"], str(tmp_path / "a.mp4"), seconds=9999)
    assert limit_of(calls[0]) == str(tool.MAX_SECONDS)
    calls.clear()
    tool.record(["adb"], str(tmp_path / "b.mp4"), seconds=0)
    assert limit_of(calls[0]) == "1"


def test_the_device_file_is_removed_even_though_the_pull_worked(monkeypatch, tmp_path):
    """It is our file and it is large; leaving it on the user's phone is not acceptable."""
    removed = []
    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _ok())
    monkeypatch.setattr(tool, "_pull", lambda adb, remote, out: {"path": out, "bytes": 10})
    monkeypatch.setattr(tool, "_remove", lambda adb, remote: removed.append(remote))
    tool.record(["adb"], str(tmp_path / "a.mp4"), seconds=2)
    assert removed and removed[0].endswith(".mp4")


def test_the_device_file_is_removed_when_the_pull_fails(monkeypatch, tmp_path):
    removed = []
    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _ok())
    monkeypatch.setattr(tool, "_pull", lambda adb, remote, out: {"error": "gone"})
    monkeypatch.setattr(tool, "_remove", lambda adb, remote: removed.append(remote))
    assert "error" in tool.record(["adb"], str(tmp_path / "a.mp4"), seconds=2)
    assert removed


def test_a_failed_recording_reports_the_device_message(monkeypatch, tmp_path):
    monkeypatch.setattr(tool.subprocess, "run",
                        lambda argv, **kw: _fail("Unsupported size 9999x9999"))
    result = tool.record(["adb"], str(tmp_path / "a.mp4"), seconds=2, size="9999x9999")
    assert "Unsupported size" in result["error"]


def test_a_recording_never_reports_a_path_nobody_wrote(monkeypatch, tmp_path):
    """The pull can exit 0 and produce nothing, which would otherwise be reported as a
    successful recording at a path that does not exist."""
    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _ok())
    assert "error" in tool._pull(["adb"], "/sdcard/x.mp4", str(tmp_path / "missing.mp4"))


def test_the_unbounded_stream_removes_screenrecords_own_cap():
    """A live panel wants frames, not a file that stops after three minutes."""
    argv = tool.stream_argv(["adb", "-s", "emulator-5554"], bit_rate="4M")
    assert argv[-1] == "-"
    assert argv[argv.index("--time-limit") + 1] == "0"
    assert "--output-format=h264" in argv
    assert argv[argv.index("--bit-rate") + 1] == "4M"


def test_recording_without_a_device_says_which_reason(monkeypatch):
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: ([], "several devices are attached (a, b)"))
    assert "several devices" in json.loads(tool.mobile_record(session_id="s"))["error"]


def _ok():
    return _Result(0, "")


def _fail(message):
    return _Result(1, message)


class _Result:
    def __init__(self, returncode, stderr):
        self.returncode, self.stderr, self.stdout = returncode, stderr, ""
