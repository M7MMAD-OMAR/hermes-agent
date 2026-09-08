"""Real local shells and file tools cannot modify protected references."""
import shlex
import shutil
import sys

import pytest

from hermes_cli import projects_db
from tools.environments.local import LocalEnvironment
from tools.file_operations import ShellFileOperations

pytestmark = pytest.mark.skipif(sys.platform != "linux" or not shutil.which("bwrap"), reason="Requires Linux bubblewrap")


def test_protected_sources_reject_file_shell_and_background_writes(tmp_path):
    primary, reference = tmp_path / "project", tmp_path / "reference"
    primary.mkdir()
    reference.mkdir()
    source = reference / "source.txt"
    source.write_text("Original reference")
    (primary / "alias").symlink_to(reference, target_is_directory=True)
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(primary), str(reference)])
        prepared, moves = projects_db.prepare_project_edit(conn, pid, "Client", [
            {"path": str(primary)}, {"path": str(reference), "read_only": True},
        ])
        projects_db.save_project_edit(conn, pid, "Client", prepared, moves)
    env = LocalEnvironment(cwd=str(primary))
    try:
        ops = ShellFileOperations(env, cwd=str(primary))
        assert ops.write_file("alias/source.txt", "Bad file edit").error
        assert ops.patch_replace("alias/source.txt", "Original", "Changed").error
        for target in [str(source), "alias/source.txt", "../reference/source.txt"]:
            result = env.execute(f"printf changed > {shlex.quote(target)}")
            assert result["returncode"] != 0
            assert source.read_text() == "Original reference"
        assert env.execute("printf allowed > output.txt")["returncode"] == 0
        assert (primary / "output.txt").read_text() == "allowed"
        nested = f"from pathlib import Path; Path({str(source)!r}).write_text('nested write')"
        assert env.execute(f"{shlex.quote(sys.executable)} -c {shlex.quote(nested)}")["returncode"] != 0
        env.cwd = str(tmp_path)
        assert env.execute(f"printf bad > {shlex.quote(str(source))}")["returncode"] != 0
        from tools.process_registry import ProcessRegistry
        from tools.terminal_tool_background import _spawn
        registry = ProcessRegistry()
        session = _spawn(registry, env=env, env_type="local", command="printf bad > alias/source.txt",
                         cwd=str(primary), effective_task_id="readonly-test", task_id="readonly-test",
                         session_key="", effective_pty=False)
        registry.wait(session.id, timeout=10)
        assert source.read_text() == "Original reference"
    finally:
        env.cleanup()


def test_missing_reference_or_unavailable_enforcement_does_not_run(tmp_path, monkeypatch):
    from tools.environments.project_readonly import readonly_argv
    with pytest.raises(FileNotFoundError):
        readonly_argv(["true"], [str(tmp_path / "missing")])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="not run"):
        readonly_argv(["true"], [str(tmp_path)])


def test_symbolic_project_root_and_profile_ownership(tmp_path):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from tools.environments.project_readonly import project_readonly_roots
    project, reference, alias = tmp_path / "project", tmp_path / "reference", tmp_path / "project-link"
    project.mkdir()
    reference.mkdir()
    alias.symlink_to(project, target_is_directory=True)
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Linked project", folders=[str(alias), str(reference)])
        prepared, moves = projects_db.prepare_project_edit(conn, pid, "Linked project", [
            {"path": str(alias)}, {"path": str(reference), "read_only": True},
        ])
        projects_db.save_project_edit(conn, pid, "Linked project", prepared, moves)
    assert str(reference) in project_readonly_roots(str(project))
    token = set_hermes_home_override(tmp_path / "other-profile")
    try:
        assert project_readonly_roots(str(project)) == ()
    finally:
        reset_hermes_home_override(token)
