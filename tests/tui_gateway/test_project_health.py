"""Folder recovery is based on current filesystem evidence, not stored names."""
from hermes_cli import projects_db
from tui_gateway import server


def test_project_health_finds_parent_rename_and_preserves_identity(tmp_path):
    old = tmp_path / "Old parent" / "Client"
    new = tmp_path / "New parent" / "Client"
    new.mkdir(parents=True)
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(old)])
    reply = server._methods["projects.get"](1, {"id": pid, "include_health": True})
    project = reply["result"]["project"]
    assert project["id"] == pid
    assert project["folders"][0]["health"] == "missing"
    assert project["folders"][0]["suggested_paths"] == [str(new)]
    assert project["primary_path"] == str(old)
    old.mkdir(parents=True)
    reply = server._methods["projects.list"](1, {"include_health": True})
    folder = next(p for p in reply["result"]["projects"] if p["id"] == pid)["folders"][0]
    assert folder["health"] == "available"
    assert folder["suggested_paths"] == []


def test_project_health_does_not_offer_a_file_as_a_folder(tmp_path):
    from hermes_cli.projects_health import folder_health, replacement_candidates
    wrong = tmp_path / "new" / "Client"
    wrong.parent.mkdir()
    wrong.write_text("not a directory")
    assert folder_health(str(wrong)) == "not_directory"
    assert replacement_candidates(str(tmp_path / "old" / "Client")) == []
