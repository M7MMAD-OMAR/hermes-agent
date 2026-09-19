"""tools/cgroup_placement.py: children of a Hermes process leave the UI's cgroup."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from tools import cgroup_placement as cp


@pytest.fixture(autouse=True)
def _fresh():
    cp.reset_for_tests()
    yield
    cp.reset_for_tests()


def test_hop_argv_moves_the_child_then_execs_the_command(tmp_path):
    argv = cp.hop_argv(["bash", "-c", "echo hi"], tmp_path)
    assert argv[:2] == ["/bin/sh", "-c"]
    assert argv[3] == str(tmp_path / "cgroup.procs")
    assert argv[4:] == ["bash", "-c", "echo hi"]
    # The hop must not swallow a failed write: the command still runs.
    assert "2>/dev/null" in argv[2] and argv[2].endswith('exec "$@"')


@pytest.mark.skipif(sys.platform != "linux", reason="/bin/sh hop is POSIX")
def test_hop_runs_the_command_and_keeps_the_pid(tmp_path):
    import subprocess

    # A plain file stands in for cgroup.procs: the hop writes the pid it then execs into.
    procs = tmp_path / "cgroup.procs"
    procs.write_text("")
    proc = subprocess.run(cp.hop_argv(["/bin/sh", "-c", "echo $$"], tmp_path), capture_output=True, text=True)
    assert proc.returncode == 0
    assert procs.read_text().strip() == proc.stdout.strip()


@pytest.mark.skipif(sys.platform != "linux", reason="cgroup v2 only")
def test_cgroup_of_reads_our_own_placement():
    own = cp.cgroup_of(os.getpid())
    assert own is not None and str(own).startswith(str(cp.CGROUP_ROOT))
    assert cp.cgroup_of(2**22 + 12345) is None


def test_move_pids_reports_only_what_was_written(tmp_path):
    moved = cp.move_pids([12, "x", 34], tmp_path)
    assert moved == [12, 34]
    assert (tmp_path / "cgroup.procs").read_text() == "34"


def test_placement_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("HERMES_CGROUP_PLACEMENT", "0")
    assert cp.placement_enabled() is False
    assert cp.tools_argv(["ls"]) == ["ls"]
    assert cp.place_pids([1]) == []


def test_tools_argv_is_identity_without_a_scope(monkeypatch):
    monkeypatch.setattr(cp, "placement_enabled", lambda: True)
    monkeypatch.setattr(cp, "_start_scope", lambda: None)
    assert cp.tools_argv(["ls", "-l"]) == ["ls", "-l"]


def test_tools_argv_wraps_once_the_scope_exists(monkeypatch, tmp_path):
    monkeypatch.setattr(cp, "placement_enabled", lambda: True)
    calls = []

    def start():
        calls.append(1)
        return tmp_path

    monkeypatch.setattr(cp, "_start_scope", start)
    assert cp.tools_argv(["ls"]) == cp.hop_argv(["ls"], tmp_path)
    assert cp.tools_argv(["pwd"]) == cp.hop_argv(["pwd"], tmp_path)
    assert calls == [1], "the scope is created once per process"


def test_a_failed_scope_is_not_retried_immediately(monkeypatch):
    monkeypatch.setattr(cp, "placement_enabled", lambda: True)
    calls = []

    def start():
        calls.append(1)
        return None

    monkeypatch.setattr(cp, "_start_scope", start)
    cp.tools_argv(["a"])
    cp.tools_argv(["b"])
    assert calls == [1]
