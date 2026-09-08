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
        for target in [str(source), "alias/source.txt", "../reference/source.txt"]:
            result = env.execute(f"printf changed > {shlex.quote(target)}")
            assert result["returncode"] != 0
            assert source.read_text() == "Original reference"
        assert env.execute("printf allowed > output.txt")["returncode"] == 0
        assert (primary / "output.txt").read_text() == "allowed"
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
