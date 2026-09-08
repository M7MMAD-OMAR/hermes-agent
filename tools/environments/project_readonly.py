"""Mount project references read-only for local terminal and file operations."""
from pathlib import Path
import shutil
import sys


def project_readonly_roots(cwd):
    from hermes_cli import projects_db
    # Ordinary terminals without project metadata do not create a database.
    if not projects_db.projects_db_path().exists():
        return ()
    with projects_db.connect_closing() as conn:
        target = Path(cwd).resolve()
        matches = [(len(str(root)), project) for project in projects_db.list_projects(conn)
                   for folder in project.folders if target.is_relative_to(root := Path(folder.path).resolve())]
        project = max(matches, key=lambda item: item[0])[1] if matches else None
        return tuple(dict.fromkeys(path for folder in project.folders if folder.read_only
                                   for path in (folder.path, str(Path(folder.path).resolve())))) if project else ()


def readonly_argv(argv, roots):
    if not roots:
        return argv
    bwrap = shutil.which("bwrap") if sys.platform == "linux" else None
    if not bwrap:
        raise RuntimeError("Read-only project references require bubblewrap on Linux. This command was not run.")
    canonical = []
    for root in roots:
        path = Path(root).resolve(strict=True)
        if not path.is_dir():
            raise RuntimeError(f"Read-only reference is not a directory: {root}")
        canonical.append(str(path))
    # New procfs and PID namespace prevent reaching the writable host mounts
    # through another process's /proc/<pid>/root. Children inherit the mounts.
    prefix = [bwrap, "--die-with-parent", "--unshare-pid", "--bind", "/", "/",
              "--proc", "/proc", "--dev", "/dev", "--cap-drop", "ALL"]
    for path in sorted(set(canonical), key=len):
        prefix.extend(["--ro-bind", path, path])
    return [*prefix, "--", *argv]
