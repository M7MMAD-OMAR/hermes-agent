"""Registered project tools expose all source folders, preserving the primary cwd."""
import json

import pytest

from hermes_cli import projects_db
from tools import project_tools
from tools.registry import registry


@pytest.mark.parametrize("action", ["list", "switch"])
def test_project_tool_exposes_sources_without_switching_into_reference_folder(tmp_path, monkeypatch, action):
    primary, references = tmp_path / "code", tmp_path / "client-references"
    primary.mkdir()
    references.mkdir()
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(primary)], primary_path=str(primary))
        projects_db.add_folder(conn, pid, str(references), label="Approved sources")
    moves = []
    monkeypatch.setattr(project_tools, "_workspace_callback", lambda *args: moves.append(args))
    raw = registry.dispatch("desktop_project", {"action": action, "name": pid}, task_id="task")
    result = json.loads(raw) if isinstance(raw, str) else raw
    project = result["projects"][0] if action == "list" else result
    assert project["primary_path"] == str(primary)
    folders = {folder["path"]: folder for folder in project["folders"]}
    assert folders[str(primary)]["is_primary"] is True
    assert folders[str(references)]["is_primary"] is False
    assert folders[str(references)]["label"] == "Approved sources"
    assert moves == ([] if action == "list" else [("task", str(primary), "Client")])
