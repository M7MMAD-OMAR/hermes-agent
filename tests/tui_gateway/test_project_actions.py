"""Document proposals keep evidence and create one parked native task."""
import pytest

from hermes_cli import kanban_db, projects_db
from hermes_cli.kanban_db_connect import connect_closing
from hermes_cli.project_actions import (
    accept_action, dismiss_action, edit_action, list_actions, propose_actions,
)
from hermes_cli.project_references import index_references, scan_references, search_references


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(tmp_path / "boards"))
    folder = tmp_path / "client"
    folder.mkdir()
    quote = "Ahmed will revise the mobile tabs by Friday."
    (folder / "meeting.txt").write_text(quote)
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(folder)])
        scan_references(conn, pid)
        index_references(conn, pid)
        citation = search_references(conn, pid, "mobile")["matches"][0]
    return pid, {"citation_id": citation["citation_id"], "title": "Revise mobile tabs",
                 "quote": quote, "owner": "Ahmed", "due_text": "Friday"}


def test_acceptance_is_durable_parked_and_retry_safe(source):
    pid, proposal = source
    with projects_db.connect_closing() as conn:
        ids = propose_actions(conn, pid, [proposal])["ids"]
        assert propose_actions(conn, pid, [proposal])["ids"] == ids
        result = accept_action(conn, pid, ids[0])
    with projects_db.connect_closing() as conn:
        assert accept_action(conn, pid, ids[0])["task_id"] == result["task_id"]
        with pytest.raises(ValueError):
            edit_action(conn, pid, ids[0], title="Changed after accepting")
    with connect_closing(board="default") as tasks:
        task = kanban_db.get_task(tasks, result["task_id"])
        assert task.status == "blocked"
        assert task.assignee is None
        assert proposal["quote"] in task.body
        assert "Source SHA256:" in task.body
        assert tasks.execute("SELECT count(*) FROM tasks").fetchone()[0] == 1


def test_quotes_and_attribution_are_validated_atomically(source):
    pid, proposal = source
    with projects_db.connect_closing() as conn:
        for invalid in [{"quote": "Invented"}, {"owner": "Other person"}, {"due_text": "Tomorrow"}]:
            with pytest.raises(ValueError):
                propose_actions(conn, pid, [proposal, {**proposal, **invalid}])
            assert list_actions(conn, pid)["actions"] == []
        other = projects_db.create_project(conn, name="Other")
        with pytest.raises(ValueError):
            propose_actions(conn, other, [proposal])
        action_id = propose_actions(conn, pid, [proposal])["ids"][0]
        edited = edit_action(conn, pid, action_id, title="User's clarified task", owner="New owner")
        assert edited["user_edited"] == 1
        assert edited["due_text"] is None
        dismiss_action(conn, pid, action_id)
        with pytest.raises(ValueError):
            accept_action(conn, pid, action_id)


def test_retry_after_native_commit_does_not_duplicate(source):
    pid, proposal = source

    class FailFinalReceipt:
        def __init__(self, conn):
            self.conn = conn
            self.failed = False

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def execute(self, sql, *args):
            if "SET state='accepted'" in sql and not self.failed:
                self.failed = True
                raise OSError("simulated lost receipt after native commit")
            return self.conn.execute(sql, *args)

    with projects_db.connect_closing() as conn:
        action_id = propose_actions(conn, pid, [proposal])["ids"][0]
        with pytest.raises(OSError):
            accept_action(FailFinalReceipt(conn), pid, action_id)
        assert list_actions(conn, pid)["actions"][0]["state"] == "accepting"
    with projects_db.connect_closing() as conn:
        result = accept_action(conn, pid, action_id)
        assert result["state"] == "accepted"
    with connect_closing(board="default") as tasks:
        assert tasks.execute("SELECT count(*) FROM tasks").fetchone()[0] == 1


def test_concurrent_acceptance_creates_one_native_task(source):
    from concurrent.futures import ThreadPoolExecutor
    pid, proposal = source
    with projects_db.connect_closing() as conn:
        action_id = propose_actions(conn, pid, [proposal])["ids"][0]

    def accept():
        with projects_db.connect_closing() as conn:
            return accept_action(conn, pid, action_id)["task_id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(accept) for _ in range(2)]
        ids = [future.result() for future in futures]
    assert ids[0] == ids[1]
    with connect_closing(board="default") as tasks:
        assert tasks.execute("SELECT count(*) FROM tasks").fetchone()[0] == 1


def test_cli_evidence_to_proposal_and_rpc_review(source, tmp_path):
    import argparse
    import contextlib
    import io
    import json
    from hermes_cli.projects_cmd import build_parser, projects_command
    from tui_gateway import server

    pid, proposal = source
    parser = argparse.ArgumentParser()
    build_parser(parser.add_subparsers())

    def cli(*args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = projects_command(parser.parse_args(["project", *args]))
        assert result == 0
        return json.loads(output.getvalue())

    files = cli("sources", pid)["files"]
    evidence = cli("evidence", pid, files[0]["id"])
    assert evidence["citations"][0]["citation_id"] == proposal["citation_id"]
    assert evidence["next_after"] is None
    draft = server._methods["projects.actions.draft"](0, {"id": pid, "file_id": files[0]["id"]})["result"]
    assert "hermes project evidence" in draft["draft"]
    assert "hermes project propose-actions" in draft["draft"]
    with projects_db.connect_closing() as conn:
        assert list_actions(conn, pid)["actions"] == []
    path = tmp_path / "proposals.json"
    path.write_text(json.dumps([proposal]))
    action_id = cli("propose-actions", pid, "--input", str(path))["ids"][0]
    listed = server._methods["projects.actions.list"](1, {"id": pid})["result"]
    assert listed["actions"][0]["state"] == "pending"
    edited = server._methods["projects.actions.edit"](2, {
        "id": pid, "action_id": action_id, "title": "Reviewed title", "owner": "User assignment",
    })["result"]
    assert edited["user_edited"] == 1
    accepted = server._methods["projects.actions.accept"](3, {"id": pid, "action_id": action_id})["result"]
    assert accepted["state"] == "accepted"
    with connect_closing(board="default") as tasks:
        assert kanban_db.get_task(tasks, accepted["task_id"]).title == "Reviewed title"
