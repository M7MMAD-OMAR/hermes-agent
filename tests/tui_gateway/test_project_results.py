"""Results survive process-owned connections and never confuse reports with snapshots."""
import json
from pathlib import Path

import pytest

from hermes_cli import projects_db
from hermes_cli.project_results import capture_version, list_results, refresh_index, result_versions, review_version
from hermes_constants import get_hermes_home
from hermes_state import SessionDB
from tui_gateway import server


def seed(root):
    folder = root / "Client"
    folder.mkdir()
    db = SessionDB(get_hermes_home() / "state.db")
    db.create_session("source-task", "desktop", cwd=str(folder))
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(folder)])
    return db, folder, pid


def test_index_batches_all_history_and_survives_restart(tmp_path):
    db, folder, pid = seed(tmp_path)
    try:
        db.append_message("source-task", "user", "[Do not index](https://private.example)")
        db.append_message("source-task", "assistant", "[العرض](./عرض.docx) and [site](https://example.com/report.pdf)")
        db.append_message("source-task", "tool", json.dumps({"files_written": [str(folder / "deck.pptx")]}), tool_name="write_file")
        with projects_db.connect_closing() as conn:
            first = refresh_index(conn, batch_size=1)
            assert first["has_more"]
            assert [r["value"] for r in list_results(conn)["results"]] == [str(folder / "deck.pptx")]
            assert refresh_index(conn, batch_size=1)["has_more"]
        with projects_db.connect_closing() as conn:
            assert not refresh_index(conn)["has_more"]
            results = list_results(conn, project_id=pid, limit=2)
            assert len(results["results"]) == 2
            rest = list_results(conn, project_id=pid, before=results["next_cursor"])["results"]
            all_rows = results["results"] + rest
            assert len(all_rows) == 3
            assert {r["value"] for r in all_rows} == {str(folder / "عرض.docx"), str(folder / "deck.pptx"), "https://example.com/report.pdf"}
            assert next(r for r in all_rows if r["value"].startswith("https:"))["kind"] == "link"
            assert all(r["session_id"] == "source-task" and r["version_count"] == 0 for r in all_rows)
            assert refresh_index(conn)["scanned"] == 0
            assert not (get_hermes_home() / "result-snapshots").exists()
    finally:
        db.close()


def test_captured_versions_keep_bytes_and_independent_review(tmp_path):
    db, folder, _ = seed(tmp_path)
    path = folder / "عرض.docx"
    path.write_bytes(b"version one")
    try:
        db.append_message("source-task", "assistant", f"[delivery]({path})")
        with projects_db.connect_closing() as conn:
            refresh_index(conn)
            rid = list_results(conn)["results"][0]["id"]
            v1 = capture_version(conn, rid)
            review_version(conn, v1["id"], "approved")
            assert capture_version(conn, rid)["id"] == v1["id"]
            path.write_bytes(b"version two")
            v2 = capture_version(conn, rid)
        path.unlink()
        with projects_db.connect_closing() as conn:
            versions = result_versions(conn, rid)
            assert [v["number"] for v in versions] == [2, 1]
            assert [v["review_state"] for v in versions] == ["unreviewed", "approved"]
            assert Path(v1["snapshot_path"]).read_bytes() == b"version one"
            assert Path(v2["snapshot_path"]).read_bytes() == b"version two"
            assert list_results(conn)["results"][0]["version_count"] == 2
    finally:
        db.close()


def test_rpc_reports_failures_and_ignores_failed_tools(tmp_path):
    db, folder, _ = seed(tmp_path)
    try:
        db.append_message("source-task", "tool", json.dumps({"error": "failed", "output_path": str(folder / "failed.pdf")}), tool_name="export")
        db.append_message("source-task", "assistant", "[missing](./missing.pdf)")
        assert "result" in server._methods["projects.results.refresh"](1, {})
        results = server._methods["projects.results.list"](2, {})["result"]["results"]
        assert len(results) == 1
        reply = server._methods["projects.results.capture"](3, {"result_id": results[0]["id"]})
        assert "error" in reply
        assert "error" in server._methods["projects.results.review"](4, {"version_id": "foreign", "state": "approved"})
    finally:
        db.close()


def test_snapshot_refuses_secret_aliases_and_special_files(tmp_path):
    db, folder, _ = seed(tmp_path)
    secret = folder / ".secrets" / "report.pdf"
    secret.parent.mkdir()
    secret.write_text("sensitive")
    alias = folder / "report.pdf"
    alias.symlink_to(secret)
    try:
        db.append_message("source-task", "assistant", "[report](./report.pdf)")
        with projects_db.connect_closing() as conn:
            refresh_index(conn)
            rid = list_results(conn)["results"][0]["id"]
            with pytest.raises(ValueError, match="cannot be captured"):
                capture_version(conn, rid)
            alias.unlink()
            alias.mkdir()
            with pytest.raises((ValueError, IsADirectoryError)):
                capture_version(conn, rid)
    finally:
        db.close()


def test_profiles_keep_indexes_and_approval_separate(tmp_path, monkeypatch):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    first_home, second_home = tmp_path / "first-home", tmp_path / "second-home"
    first_home.mkdir()
    second_home.mkdir()
    monkeypatch.setattr(server, "_profile_home", lambda profile: second_home if profile == "second" else first_home)
    token = set_hermes_home_override(first_home)
    try:
        db, folder, _ = seed(tmp_path)
        try:
            path = folder / "delivery.pdf"
            path.write_bytes(b"one profile only")
            db.append_message("source-task", "assistant", "[delivery](./delivery.pdf)")
        finally:
            db.close()
        server._methods["projects.results.refresh"](1, {})
        rid = server._methods["projects.results.list"](2, {})["result"]["results"][0]["id"]
        version = server._methods["projects.results.capture"](3, {"result_id": rid})["result"]["version"]
        assert server._methods["projects.results.list"](4, {"profile": "second"})["result"]["results"] == []
        assert "error" in server._methods["projects.results.preview"](8, {"profile": "second", "version_id": version["id"]})
        assert "error" in server._methods["projects.results.capture"](5, {"profile": "second", "result_id": rid})
        assert "error" in server._methods["projects.results.review"](6, {"profile": "second", "version_id": version["id"], "state": "approved"})
        assert server._methods["projects.results.versions"](7, {"result_id": rid})["result"]["versions"][0]["review_state"] == "unreviewed"
    finally:
        reset_hermes_home_override(token)


def test_oversized_dump_is_reported_without_blocking_later_results(tmp_path):
    db, folder, _ = seed(tmp_path)
    try:
        db.append_message("source-task", "tool", "x" * 300000, tool_name="terminal")
        db.append_message("source-task", "assistant", "[after dump](./delivery.pdf)")
        with projects_db.connect_closing() as conn:
            outcome = refresh_index(conn)
            assert outcome["skipped_oversized"] == 1
            assert list_results(conn)["results"][0]["value"] == str(folder / "delivery.pdf")
    finally:
        db.close()


def test_failed_index_batch_rolls_back_cursor_and_retries(tmp_path):
    db, _, _ = seed(tmp_path)
    try:
        db.append_message("source-task", "assistant", "[result](./result.pdf)")
        with projects_db.connect_closing() as conn:
            conn.execute("CREATE TRIGGER reject_result BEFORE INSERT ON project_results BEGIN SELECT RAISE(ABORT, 'test disk failure'); END")
            with pytest.raises(Exception, match="test disk failure"):
                refresh_index(conn)
            assert conn.execute("SELECT value FROM project_meta WHERE key='results_cursor'").fetchone() is None
            conn.execute("DROP TRIGGER reject_result")
            assert refresh_index(conn)["scanned"] == 1
            assert len(list_results(conn)["results"]) == 1
    finally:
        db.close()


def test_results_are_not_limited_to_thirty_recent_sessions(tmp_path):
    db, folder, pid = seed(tmp_path)
    try:
        db.append_message("source-task", "assistant", "[old delivery](./old.pdf)")
        for index in range(35):
            sid = f"newer-{index}"
            db.create_session(sid, "desktop", cwd=str(folder))
            db.append_message(sid, "assistant", f"[new delivery](./new-{index}.pdf)")
        with projects_db.connect_closing() as conn:
            while refresh_index(conn, batch_size=10)["has_more"]:
                pass
            rows = list_results(conn, project_id=pid)["results"]
            assert len(rows) == 36
            assert any(row["session_id"] == "source-task" for row in rows)
    finally:
        db.close()


def test_generated_documents_are_saved_and_versioned_without_opening_chat(tmp_path):
    db, folder, pid = seed(tmp_path)
    first = '<!doctype html><html><head><title>Client dashboard</title></head><body>' + 'First edition. ' * 20 + '</body></html>'
    second = first.replace('First edition.', 'Revised edition.')
    try:
        db.append_message("source-task", "assistant", "```html\n" + first + "\n```")
        db.append_message("source-task", "assistant", "```html\n" + second + "\n```")
        db.append_message("source-task", "assistant", "```html\n" + second + "\n```")
        with projects_db.connect_closing() as conn:
            while refresh_index(conn, batch_size=2)["has_more"]:
                pass
            results = list_results(conn, project_id=pid)["results"]
            generated = next(r for r in results if r["origin"] == "message")
            assert generated["label"] == "Client dashboard.html"
            versions = result_versions(conn, generated["id"])
            assert len(versions) == 2
            assert Path(versions[1]["snapshot_path"]).read_text() == first
            assert Path(versions[0]["snapshot_path"]).read_text() == second
            assert generated["value"] == versions[0]["snapshot_path"]
            review_version(conn, versions[1]["id"], "approved")
            # An explicit capture cannot copy a made-up logical path or create
            # another version of already persisted message content.
            assert capture_version(conn, generated["id"])["id"] == versions[0]["id"]
            conn.execute("DELETE FROM project_meta WHERE key='results_index_version'")
            conn.commit()
            while refresh_index(conn, batch_size=2)["has_more"]:
                pass
            assert len(result_versions(conn, generated["id"])) == 2
            assert result_versions(conn, generated["id"])[1]["review_state"] == "approved"
    finally:
        db.close()


def test_recent_file_fast_path_does_not_regress_during_backfill(tmp_path):
    db, _, _ = seed(tmp_path)
    try:
        for stamp in range(1, 8):
            db.append_message("source-task", "assistant", "[Delivery](./report.pdf)", timestamp=stamp)
        with projects_db.connect_closing() as conn:
            assert refresh_index(conn, batch_size=2)["has_more"]
            newest = list_results(conn)["results"][0]
            assert newest["reported_at"] == 7
            while refresh_index(conn, batch_size=2)["has_more"]:
                assert list_results(conn)["results"][0]["reported_at"] == 7
            assert list_results(conn)["results"][0]["id"] == newest["id"]
    finally:
        db.close()


def test_only_complete_substantial_fences_become_generated_results():
    from hermes_cli.result_fences import generated_results
    assert list(generated_results('```html\n<p>Small example</p>\n```')) == []
    assert list(generated_results('```python\n' + 'print(1)\n' * 60)) == []
    assert list(generated_results('```markdown\n' + 'Some prose.\n' * 60 + '```')) == []
    code = '# report.py\n' + 'print(1)\n' * 60
    result = list(generated_results('~~~~python\n' + code + '~~~~'))
    assert len(result) == 1 and result[0].label == 'report.py'
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Map</title>' + '<circle r="10"/>' * 150 + '</svg>'
    assert list(generated_results('```svg\n' + svg + '\n```'))[0].kind == 'image'


def test_preview_reads_verified_snapshot_and_refuses_tampering(tmp_path):
    from hermes_cli.project_results import preview_version
    db, folder, _ = seed(tmp_path)
    path = folder / "proposal.md"
    path.write_text("Original version for review")
    try:
        db.append_message("source-task", "assistant", "[proposal](./proposal.md)")
        with projects_db.connect_closing() as conn:
            refresh_index(conn)
            rid = list_results(conn)["results"][0]["id"]
            version = capture_version(conn, rid)
            path.write_text("Changed original")
            assert preview_version(conn, version["id"])["text"] == "Original version for review"
            Path(version["snapshot_path"]).write_text("Tampered snapshot")
            with pytest.raises(ValueError, match="integrity"):
                preview_version(conn, version["id"])
            conn.execute("UPDATE project_result_versions SET snapshot_path=? WHERE id=?", (str(path), version["id"]))
            conn.commit()
            with pytest.raises(ValueError, match="outside"):
                preview_version(conn, version["id"])
    finally:
        db.close()
