"""Workflow drafts use project ownership and normal skill dispatch without starting work."""
from hermes_cli import projects_db
from hermes_constants import get_hermes_home
from tui_gateway import server


def test_workflow_draft_routes_installed_skill_without_mutating_project(tmp_path):
    folder = tmp_path / "Client"
    folder.mkdir()
    skill = get_hermes_home() / "skills" / "local-browser-preview" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text('---\nname: local-browser-preview\ndescription: Preview the local UI\n---\nUse the current project runtime.\n')
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(folder)])
        before = projects_db.get_project(conn, pid).to_dict()
    result = server._methods["projects.workflow"](1, {
        "id": pid, "workflow": "quick-ui", "approach": "quick", "task": "Fix the tabs at mobile width."
    })["result"]
    assert result["cwd"] == str(folder)
    assert result["draft"].startswith("/local-browser-preview ")
    assert "Fix the tabs at mobile width." in result["draft"]
    assert "Use the current project runtime." not in result["draft"]  # Expansion belongs to submission.
    assert result["skill"] == "local-browser-preview"
    dispatched = server._methods["command.dispatch"](6, {
        "name": "local-browser-preview", "arg": "Fix the tabs at mobile width."
    })["result"]
    assert dispatched["type"] == "skill"
    assert "Use the current project runtime." in dispatched["message"]
    assert "Fix the tabs at mobile width." in dispatched["message"]
    with projects_db.connect_closing() as conn:
        assert projects_db.get_project(conn, pid).to_dict() == before
    folder.rename(tmp_path / "Moved")
    assert "error" in server._methods["projects.workflow"](2, {
        "id": pid, "workflow": "quick-ui", "approach": "quick", "task": "Fix tabs"
    })


def test_workflow_scope_and_missing_skill_are_explicit(tmp_path, monkeypatch):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    other = tmp_path / "Other profile"
    other.mkdir()
    folder = tmp_path / "Research"
    folder.mkdir()
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Research", folders=[str(folder)])
    monkeypatch.setattr(server, "_profile_home", lambda profile: other)
    assert "error" in server._methods["projects.workflow"](3, {
        "profile": "other", "id": pid, "workflow": "research", "task": "Find primary sources"
    })
    token = set_hermes_home_override(other)
    try:
        with projects_db.connect_closing() as conn:
            other_id = projects_db.create_project(conn, name="Other", folders=[str(folder)])
    finally:
        reset_hermes_home_override(token)
    result = server._methods["projects.workflow"](4, {
        "profile": "other", "id": other_id, "workflow": "research", "approach": "standard", "task": "Find primary sources"
    })["result"]
    assert result["skill"] is None and result["missing_skill"] == "grounded-citations"
    assert not result["draft"].startswith("/")
    for workflow in ["client-delivery", "weekly-review"]:
        assert "result" in server._methods["projects.workflow"](5, {
            "profile": "other", "id": other_id, "workflow": workflow, "task": "Prepare a reviewable result"
        })
