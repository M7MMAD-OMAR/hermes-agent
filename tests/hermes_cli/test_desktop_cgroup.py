"""hermes_cli/desktop_cgroup.py: the launched tree is pulled back into the launcher's scope."""
from __future__ import annotations

from pathlib import Path

from hermes_cli import desktop_cgroup as dc


def _fake_tree(tmp_path: Path, monkeypatch, *, browser_in: Path, home: Path, pids):
    (home / "cgroup.procs").parent.mkdir(parents=True, exist_ok=True)
    (browser_in / "cgroup.procs").parent.mkdir(parents=True, exist_ok=True)
    (browser_in / "cgroup.procs").write_text("\n".join(str(p) for p in pids))
    monkeypatch.setattr(dc, "_scope_cgroup", lambda unit: home)
    monkeypatch.setattr(dc, "_children", lambda pid: [pids[0]] if pid == 1000 else [])
    monkeypatch.setattr(dc, "cgroup_of", lambda pid: browser_in if pid in pids else None)


def test_rehome_moves_every_process_of_the_foreign_cgroup(tmp_path, monkeypatch):
    home = tmp_path / "hermes-ui.slice" / "hermes-desktop-1.scope"
    foreign = tmp_path / "app.slice" / "app-org.chromium.Chromium-42.scope"
    _fake_tree(tmp_path, monkeypatch, browser_in=foreign, home=home, pids=[42, 43, 44])
    lines = []
    assert dc.rehome_once(1000, "hermes-desktop-1", lines.append) is False
    assert (home / "cgroup.procs").read_text() == "44"  # last write wins in a plain file
    assert lines == ["→ Moved 3 desktop process(es) from app-org.chromium.Chromium-42.scope back into hermes-desktop-1.scope"]


def test_rehome_is_quiet_when_the_tree_is_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes-ui.slice" / "hermes-desktop-1.scope"
    _fake_tree(tmp_path, monkeypatch, browser_in=home, home=home, pids=[42])
    lines = []
    assert dc.rehome_once(1000, "hermes-desktop-1", lines.append) is True
    assert lines == []


def test_rehome_waits_for_the_scope_and_the_browser(monkeypatch):
    monkeypatch.setattr(dc, "_scope_cgroup", lambda unit: None)
    assert dc.rehome_once(1000, "u", print) is None
    monkeypatch.setattr(dc, "_scope_cgroup", lambda unit: Path("/x"))
    monkeypatch.setattr(dc, "_children", lambda pid: [])
    assert dc.rehome_once(1000, "u", print) is None


def test_watcher_stops_after_two_clean_passes_past_the_grace_period(monkeypatch):
    states = iter([None, False, True, True, True, True])
    monkeypatch.setattr(dc, "rehome_once", lambda *a: next(states))
    clock = iter(range(0, 200, 5))
    monkeypatch.setattr(dc.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(dc.time, "sleep", lambda s: None)
    thread = dc.watch_desktop_scope(1, "u", log=lambda _: None, seconds=1000, interval=0)
    thread.join(5)
    assert not thread.is_alive()
