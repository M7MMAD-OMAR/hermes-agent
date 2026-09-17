"""Copy or move one project, its folders, its data and its conversations into another profile.

A Hermes project is a POINTER at directories on disk, never a container for them: nothing
here touches the filesystem, and the same folder can be a project in several profiles at
once. What a profile owns privately is the record (``projects.db``) and the history
(``state.db``), and those are what this module carries across.

Sessions are chosen by the same rule the sidebar groups by
(:func:`tui_gateway.project_tree.owned_session_ids`), so the conversations that travel are
exactly the ones the user saw listed under the project. Each lineage is carried one at a
time through :meth:`SessionDB.adopt_session_lineage_from`, which is idempotent and, in
copy mode, leaves the source untouched.

Copy is the default. ``retire_source`` archives the donor rows with
``end_reason='adopted_by_profile'``, and that archive is deliberately outside the
recoverable set, so a move cannot be undone from the UI: it is always an explicit choice.
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
from pathlib import Path
from typing import Any, Callable, Optional

from hermes_cli import projects_db as pdb
from hermes_cli.sqlite_util import write_txn

logger = logging.getLogger(__name__)

# Sources the sidebar tree never groups, so a transfer does not carry them either.
_EXCLUDED_SOURCES = ["cron", "kanban"]

# Enough to cover any real project's history while still bounding a runaway store.
_SESSION_SCAN_LIMIT = 20000


def _target_projects_db(profile: str) -> Path:
    """``projects.db`` inside *profile*'s home. Raises when the profile does not exist."""
    from hermes_cli.profiles import get_profile_dir
    return Path(get_profile_dir(profile)) / "projects.db"


def target_state_db(profile: str) -> Path:
    """``state.db`` inside *profile*'s home (the session store the conversations land in)."""
    from hermes_cli.profiles import get_profile_dir
    return Path(get_profile_dir(profile)) / "state.db"


def open_target_projects_db(profile: str):
    """Context manager over the target profile's projects.db, created if the profile has none."""
    return pdb.connect_closing(_target_projects_db(profile))


def _session_rows(db: Any) -> list[dict]:
    """Session rows in the shape ``project_tree`` groups, from any SessionDB-like store."""
    rows = db.list_sessions_rich(
        limit=_SESSION_SCAN_LIMIT, offset=0, order_by_last_active=True, min_message_count=1,
        include_children=False, exclude_sources=_EXCLUDED_SOURCES,
        include_archived=False, compact_rows=True)
    return [{"id": r.get("id"), "cwd": r.get("cwd"), "git_repo_root": r.get("git_repo_root"),
             "message_count": r.get("message_count") or 0} for r in rows]


def collect_owned_sessions(
        db: Any, conn: sqlite3.Connection, project_id: str,
        *, resolve: Optional[Callable] = None) -> list[dict]:
    """Rows for the sessions *project_id* owns, judged against EVERY project in *conn*."""
    from tui_gateway.project_tree import owned_session_ids
    projects = [p.to_dict() for p in pdb.list_projects(conn)]
    sessions = _session_rows(db)
    wanted = set(owned_session_ids(project_id, projects, sessions, resolve))
    return [s for s in sessions if s["id"] in wanted]


def plan_transfer(
        *, project_id: str, target_profile: str, source_conn: sqlite3.Connection,
        source_db: Any, resolve: Optional[Callable] = None) -> dict:
    """What a transfer would carry, and what stands in its way. Writes nothing.

    ``blockers`` non-empty means :func:`transfer_project` would refuse. ``notes`` are the
    things a person should read before confirming (a merge into an existing project, an
    index that will be rebuilt rather than copied).
    """
    from hermes_cli.profiles import normalize_profile_name, profile_exists

    blockers: list[str] = []
    notes: list[str] = []
    project = pdb.get_project(source_conn, project_id)
    if project is None:
        return {"ok": False, "blockers": [f"no project {project_id!r} in this profile"],
                "notes": [], "project_id": project_id, "target_profile": target_profile}

    canon = ""
    try:
        canon = normalize_profile_name(target_profile)
    except Exception as exc:
        blockers.append(str(exc))
    if canon and not profile_exists(canon):
        blockers.append(f"no profile named {canon!r}")

    target_project_id = None
    target_project_name = ""
    if canon and not blockers:
        with open_target_projects_db(canon) as target_conn:
            primary = project.primary_path or next(
                (f.path for f in project.folders if f.is_primary),
                project.folders[0].path if project.folders else None)
            existing = pdb.find_by_primary_path(target_conn, primary) if primary else None
            if existing is not None:
                target_project_id = existing.id
                target_project_name = existing.name
                notes.append(f"merges into the existing project '{existing.name}' there")

    owned = collect_owned_sessions(source_db, source_conn, project.id, resolve=resolve)
    counts = _data_counts(source_conn, project.id)
    if counts["reference_files"]:
        notes.append("indexed reference documents are re-scanned in the target, not copied")
    if counts["actions"]:
        notes.append("proposed actions stay behind: they cite chunks of an index that is rebuilt there")

    return {
        "ok": not blockers,
        "project_id": project.id,
        "name": project.name,
        "slug": project.slug,
        "target_profile": canon or target_profile,
        "folders": [f.path for f in project.folders],
        "session_count": len(owned),
        "message_count": sum(int(s.get("message_count") or 0) for s in owned),
        "session_ids": [s["id"] for s in owned],
        "target_project_id": target_project_id,
        "target_project_name": target_project_name,
        "reference_file_count": counts["reference_files"],
        "result_count": counts["results"],
        "blockers": blockers,
        "notes": notes,
    }


def _data_counts(conn: sqlite3.Connection, project_id: str) -> dict:
    def one(sql: str) -> int:
        try:
            return int(conn.execute(sql, (project_id,)).fetchone()[0])
        except sqlite3.Error:
            return 0
    return {
        "reference_files": one("SELECT COUNT(*) FROM project_reference_files WHERE project_id = ?"),
        "results": one("SELECT COUNT(*) FROM project_results WHERE project_id = ?"),
        "actions": one("SELECT COUNT(*) FROM project_actions WHERE project_id = ?"),
    }


def _ensure_target_project(target_conn: sqlite3.Connection, project, plan: dict) -> str:
    """The id of the project in the target that this transfer lands in, creating it if needed.

    An existing project on the same primary path is reused rather than duplicated: two
    records pointing at one folder is exactly the state ``create_project`` refuses.
    """
    if plan.get("target_project_id"):
        pid = str(plan["target_project_id"])
        existing = pdb.get_project(target_conn, pid)
        have = {f.path for f in (existing.folders if existing else [])}
        for folder in project.folders:
            if folder.path not in have:
                pdb.add_folder(target_conn, pid, folder.path, label=folder.label)
        return pid
    primary = project.primary_path or next(
        (f.path for f in project.folders if f.is_primary),
        project.folders[0].path if project.folders else None)
    return pdb.create_project(
        target_conn, name=project.name, slug=project.slug,
        folders=[f.path for f in project.folders], primary_path=primary,
        description=project.description, icon=project.icon, color=project.color,
        board_slug=project.board_slug)


def _copy_project_data(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection,
                       source_id: str, target_id: str) -> dict:
    """Carry the rows that survive the crossing: delivered results, and the LIST of indexed
    documents (re-queued as pending). Chunks, their FTS index and the actions that cite them
    stay behind on purpose: the FTS table is contentless over ``project_reference_chunks``
    rowids, so copied chunks would carry a search index that points at the wrong rows. The
    documents are files on disk and the scan is idempotent, so the target rebuilds an index
    that is correct instead of inheriting one that is not.
    """
    # Both connections are in the house autocommit mode (``isolation_level=''`` with every
    # writer wrapped in ``write_txn``), so no transaction is open here and the explicit
    # BEGIN IMMEDIATE below cannot nest.
    copied = {"results": 0, "reference_files": 0}
    try:
        results = source_conn.execute(
            "SELECT session_id, session_title, message_id, value, kind, label, reported_at, origin "
            "FROM project_results WHERE project_id = ?", (source_id,)).fetchall()
        references = source_conn.execute(
            "SELECT path FROM project_reference_files WHERE project_id = ?", (source_id,)).fetchall()
    except sqlite3.Error:
        logger.debug("project data tables unavailable in the source store", exc_info=True)
        return copied

    with write_txn(target_conn):
        for row in results:
            cursor = target_conn.execute(
                "INSERT OR IGNORE INTO project_results "
                "(id, project_id, session_id, session_title, message_id, value, kind, label, reported_at, origin) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                ("r_" + secrets.token_hex(12), target_id, *tuple(row)))
            copied["results"] += cursor.rowcount if cursor.rowcount > 0 else 0
        for row in references:
            cursor = target_conn.execute(
                "INSERT OR IGNORE INTO project_reference_files (id, project_id, path, status) "
                "VALUES (?,?,?,'pending')",
                ("rf_" + secrets.token_hex(12), target_id, row[0]))
            copied["reference_files"] += cursor.rowcount if cursor.rowcount > 0 else 0
    return copied


def transfer_project(
        plan: dict, *, source_conn: sqlite3.Connection, target_conn: sqlite3.Connection,
        source_db: Any, target_db: Any, retire_source: bool = False) -> dict:
    """Carry out *plan* (from :func:`plan_transfer`). Copies unless ``retire_source``.

    Re-running is safe: the project is reused rather than duplicated, data rows are
    insert-or-ignore on their natural keys, and a lineage already present in the target is
    skipped by the adoption primitive.
    """
    if plan.get("blockers"):
        return {"ok": False, "error": "; ".join(plan["blockers"]), **_empty_report(plan)}
    project = pdb.get_project(source_conn, str(plan["project_id"]))
    if project is None:
        return {"ok": False, "error": "the project disappeared from this profile", **_empty_report(plan)}

    target_id = _ensure_target_project(target_conn, project, plan)
    copied = _copy_project_data(source_conn, target_conn, project.id, target_id)

    moved, skipped, failed = [], [], []
    for session_id in list(plan.get("session_ids") or []):
        try:
            # One lineage at a time: a project's whole history never has to fit in memory at once.
            # A lineage already present is not short-circuited here, so a re-run of a move still
            # retires the donor rows the first run left behind.
            adoption = target_db.adopt_session_lineage_from(
                source_db, session_id, retire_donor=retire_source)
        except Exception as exc:
            logger.warning("transfer: session %s could not be carried: %s", session_id, exc)
            failed.append(session_id)
            continue
        if not adoption.get("adopted"):
            failed.append(session_id)
        elif int(adoption.get("imported") or 0) > 0:
            moved.append(session_id)
        else:
            skipped.append(session_id)

    source_archived = False
    if retire_source and not failed:
        # Archived, never deleted: the record can come back with `hermes projects restore`
        # even though the conversations it listed now live in the other profile.
        source_archived = pdb.archive_project(source_conn, project.id)

    return {
        "ok": not failed,
        "error": "" if not failed else f"{len(failed)} conversation(s) could not be carried",
        "project_id": project.id,
        "target_project_id": target_id,
        "target_profile": plan.get("target_profile", ""),
        "moved_sessions": len(moved),
        "skipped_sessions": len(skipped),
        "failed_sessions": len(failed),
        "copied_results": copied["results"],
        "copied_reference_files": copied["reference_files"],
        "source_archived": source_archived,
        "retired_source_sessions": bool(retire_source and (moved or skipped) and not failed),
    }


def _empty_report(plan: dict) -> dict:
    return {"project_id": plan.get("project_id", ""), "target_project_id": "",
            "target_profile": plan.get("target_profile", ""), "moved_sessions": 0,
            "skipped_sessions": 0, "failed_sessions": 0, "copied_results": 0,
            "copied_reference_files": 0, "source_archived": False,
            "retired_source_sessions": False}
