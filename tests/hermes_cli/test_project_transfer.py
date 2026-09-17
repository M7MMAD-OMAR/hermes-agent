"""Carrying a project, its data and its conversations into another profile.

A project is a pointer at folders on disk, so nothing here may touch the filesystem: what
crosses is the record in ``projects.db`` and the history in ``state.db``. These tests pin
which conversations travel (exactly the ones the sidebar lists under the project), that a
copy leaves the source intact, that a move retires it, and that running either twice is
safe.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import projects_db as pdb
from hermes_cli import project_transfer
from hermes_state import SessionDB


@pytest.fixture()
def profile_env(tmp_path, monkeypatch):
    """``~`` and HERMES_HOME under tmp_path, with one named profile ``dn`` that exists."""
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    default_home = tmp_path / ".hermes"
    default_home.mkdir(exist_ok=True)
    monkeypatch.setenv("HERMES_HOME", str(default_home))
    (default_home / "profiles" / "dn").mkdir(parents=True)
    return tmp_path


@pytest.fixture()
def stores(tmp_path, profile_env):
    source_conn = pdb.connect(tmp_path / ".hermes" / "projects.db")
    target_conn = pdb.connect(tmp_path / ".hermes" / "profiles" / "dn" / "projects.db")
    source_db = SessionDB(db_path=tmp_path / ".hermes" / "state.db")
    target_db = SessionDB(db_path=tmp_path / ".hermes" / "profiles" / "dn" / "state.db")
    yield source_conn, target_conn, source_db, target_db
    source_db.close()
    target_db.close()
    source_conn.close()
    target_conn.close()


def _seed_session(db, session_id: str, cwd: str, *, turns: int = 2, title: str = "") -> None:
    db.create_session(session_id, source="tui", cwd=cwd)
    db.set_session_title(session_id, title or session_id)
    for i in range(1, turns + 1):
        db.append_message(session_id, "user", f"question {i}")
        db.append_message(session_id, "assistant", f"answer {i}")


def _plan(stores, project_id, target="dn"):
    source_conn, _target_conn, source_db, _target_db = stores
    return project_transfer.plan_transfer(
        project_id=project_id, target_profile=target,
        source_conn=source_conn, source_db=source_db)


def _run(stores, plan, *, retire_source=False):
    source_conn, target_conn, source_db, target_db = stores
    return project_transfer.transfer_project(
        plan, source_conn=source_conn, target_conn=target_conn,
        source_db=source_db, target_db=target_db, retire_source=retire_source)


def test_the_plan_carries_exactly_the_conversations_the_sidebar_lists(stores, tmp_path):
    source_conn, _t, source_db, _td = stores
    outer = tmp_path / "work" / "sdeira"
    inner = outer / "vendor" / "other"
    inner.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(outer)])
    pdb.create_project(source_conn, name="Vendor", folders=[str(inner)])
    _seed_session(source_db, "s_outer", str(outer))
    _seed_session(source_db, "s_nested", str(inner))

    plan = _plan(stores, pid)

    # The nested folder belongs to the deeper project in the sidebar, so it must not
    # ride along with its ancestor here either.
    assert plan["session_ids"] == ["s_outer"]
    assert plan["session_count"] == 1
    assert plan["message_count"] == 4
    assert plan["ok"] is True


def test_a_copy_leaves_the_source_conversations_exactly_where_they_were(stores, tmp_path):
    source_conn, target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))

    report = _run(stores, _plan(stores, pid))

    assert report["ok"] is True
    assert report["moved_sessions"] == 1
    assert len(target_db.get_messages("s_one")) == 4
    donor = source_db.get_session("s_one")
    assert donor is not None and not donor.get("archived")
    assert pdb.get_project(source_conn, pid) is not None
    assert folder.is_dir()  # a project is a pointer; the transfer never touches disk


def test_a_move_retires_the_source_conversations_and_archives_the_record(stores, tmp_path):
    source_conn, _t, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))

    report = _run(stores, _plan(stores, pid), retire_source=True)

    assert report["ok"] is True
    assert report["retired_source_sessions"] is True
    assert report["source_archived"] is True
    donor = source_db.get_session("s_one")
    assert donor["archived"]
    assert donor["end_reason"] == "adopted_by_profile"
    assert len(target_db.get_messages("s_one")) == 4
    # Archived, not deleted: gone from the live listing, still restorable by id.
    assert [p.id for p in pdb.list_projects(source_conn)] == []
    assert [p.id for p in pdb.list_projects(source_conn, include_archived=True)] == [pid]
    assert folder.is_dir()  # a project is a pointer; the transfer never touches disk


def test_running_the_same_transfer_twice_carries_nothing_the_second_time(stores, tmp_path):
    source_conn, target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))
    plan = _plan(stores, pid)

    first = _run(stores, plan)
    second = _run(stores, _plan(stores, pid) if pdb.get_project(source_conn, pid) else plan)

    assert first["moved_sessions"] == 1
    assert second["moved_sessions"] == 0
    assert second["skipped_sessions"] == 1
    assert second["ok"] is True
    assert len(pdb.list_projects(target_conn)) == 1  # not duplicated
    assert len(target_db.get_messages("s_one")) == 4


def test_a_target_that_already_holds_the_folder_is_merged_not_duplicated(stores, tmp_path):
    source_conn, target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    extra = tmp_path / "work" / "contracts"
    folder.mkdir(parents=True)
    extra.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder), str(extra)])
    existing = pdb.create_project(target_conn, name="Sdeira over there", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))

    plan = _plan(stores, pid)
    report = _run(stores, plan)

    assert plan["target_project_id"] == existing
    assert any("merges into" in note for note in plan["notes"])
    assert report["target_project_id"] == existing
    assert len(pdb.list_projects(target_conn)) == 1
    # The folders the source knew about are added to the record that is already there.
    assert {f.path for f in pdb.get_project(target_conn, existing).folders} == {str(folder), str(extra)}


def test_an_unknown_target_profile_is_a_blocker_not_an_exception(stores, tmp_path):
    source_conn, _t, _s, _td = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])

    plan = _plan(stores, pid, target="nope")

    assert plan["ok"] is False
    assert plan["blockers"] == ["no profile named 'nope'"]
    assert _run(stores, plan)["ok"] is False


def test_delivered_results_travel_and_the_document_index_is_re_queued(stores, tmp_path):
    source_conn, target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))
    source_conn.execute(
        "INSERT INTO project_results (id, project_id, session_id, session_title, message_id, value,"
        " kind, label, reported_at, origin) VALUES ('r_1',?,'s_one','Sdeira',1,'/out/report.pdf',"
        "'file','Report',1.0,'file')", (pid,))
    source_conn.execute(
        "INSERT INTO project_reference_files (id, project_id, path, status, current_hash)"
        " VALUES ('rf_1',?,'/docs/brief.pdf','indexed','abc')", (pid,))
    source_conn.commit()

    plan = _plan(stores, pid)
    report = _run(stores, plan)

    assert report["copied_results"] == 1
    assert report["copied_reference_files"] == 1
    assert any("re-scanned" in note for note in plan["notes"])
    row = target_conn.execute(
        "SELECT path, status, current_hash FROM project_reference_files").fetchone()
    # The chunks and their FTS index do not survive the crossing, so the document is
    # queued for a fresh scan rather than arriving with a stale hash.
    assert (row[0], row[1], row[2]) == ("/docs/brief.pdf", "pending", None)
    assert target_conn.execute("SELECT value FROM project_results").fetchone()[0] == "/out/report.pdf"


def test_a_conversation_that_fails_to_cross_is_reported_not_hidden(stores, tmp_path, monkeypatch):
    """One bad lineage must not lose the count of the ones that made it, and must not let a
    move archive a source whose history is only partly on the other side."""
    source_conn, target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "sdeira"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Sdeira", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder))
    _seed_session(source_db, "s_two", str(folder))

    real = target_db.adopt_session_lineage_from

    def _fail_on_second(donor_db, session_id, **kwargs):
        if session_id == "s_two":
            raise RuntimeError("donor read failed")
        return real(donor_db, session_id, **kwargs)

    monkeypatch.setattr(target_db, "adopt_session_lineage_from", _fail_on_second)
    report = _run(stores, _plan(stores, pid), retire_source=True)

    assert report["ok"] is False
    assert report["moved_sessions"] == 1
    assert report["failed_sessions"] == 1
    assert len(target_db.get_messages("s_one")) == 4
    # The source record stays live: half a history is not a completed move.
    assert report["source_archived"] is False
    assert [p.id for p in pdb.list_projects(source_conn)] == [pid]


def test_a_long_conversation_the_untrusted_import_cap_would_refuse_still_travels(stores, tmp_path):
    """A transfer carries content this machine already stores, at the user's request.

    The per-session import cap bounds an untrusted ``sessions.import`` payload; applying it
    to a local adoption made a real conversation impossible to move (measured: 16.6 MB of
    tool output across 438 messages) and reported only "1 could not be carried".
    """
    source_conn, _target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "big"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Big", folders=[str(folder)])
    source_db.create_session("s_big", source="tui", cwd=str(folder))
    source_db.set_session_title("s_big", "a long coding session")
    # One message past the untrusted per-session ceiling, the shape that failed.
    source_db.append_message("s_big", "user", "please review")
    source_db.append_message("s_big", "tool", "x" * (SessionDB._IMPORT_MAX_SESSION_BYTES + 1))

    report = _run(stores, _plan(stores, pid))

    assert report["ok"] is True
    assert report["failed_sessions"] == 0
    assert report["moved_sessions"] == 1
    assert len(target_db.get_messages("s_big")) == 2


def test_a_refusal_names_the_conversation_and_the_reason(stores, tmp_path, monkeypatch):
    """"1 could not be carried" with no conversation and no cause leaves nothing to act on —
    and re-running, which the dialog suggests, cannot help a standing reason."""
    source_conn, _target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "named"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Named", folders=[str(folder)])
    _seed_session(source_db, "s_one", str(folder), title="the one that fails")

    monkeypatch.setattr(
        target_db, "adopt_session_lineage_from",
        lambda *a, **k: {"ok": False, "adopted": False, "imported": 0, "skipped": 0,
                         "errors": [{"error": "session exceeds the import size limit"}]})
    report = _run(stores, _plan(stores, pid))

    assert report["ok"] is False
    assert "the one that fails" in report["error"]
    assert "session exceeds the import size limit" in report["error"]


def test_a_wholesale_failure_summary_stays_readable(stores, tmp_path, monkeypatch):
    """Every failed conversation in the string would be unreadable for a whole project."""
    source_conn, _target_conn, source_db, target_db = stores
    folder = tmp_path / "work" / "many"
    folder.mkdir(parents=True)
    pid = pdb.create_project(source_conn, name="Many", folders=[str(folder)])
    for i in range(6):
        _seed_session(source_db, f"s_{i}", str(folder), title=f"conversation {i}")

    monkeypatch.setattr(
        target_db, "adopt_session_lineage_from",
        lambda *a, **k: {"ok": False, "adopted": False, "imported": 0, "skipped": 0, "errors": []})
    report = _run(stores, _plan(stores, pid))

    assert report["failed_sessions"] == 6
    assert "and 3 more" in report["error"]
    assert report["error"].count("conversation ") == project_transfer._FAILURE_DETAIL_LIMIT
