"""Cited proposals with explicit review and retry-safe native task acceptance."""
from __future__ import annotations

import hashlib
import json
import secrets
import time

from hermes_cli import projects_db
from hermes_cli.project_references import reference_citation
from hermes_cli.sqlite_util import write_txn
from hermes_constants import get_hermes_home


def _project(conn, project_id):
    project = projects_db.get_project(conn, str(project_id or ""))
    if project is None:
        raise ValueError("No such project")
    return project


def _text(value, limit, *, required=False):
    if value is not None and not isinstance(value, str):
        raise ValueError("Text fields must be strings")
    value = (value or "").strip()
    if len(value) > limit or (required and not value):
        raise ValueError(f"Text must contain {'1' if required else '0'} to {limit} characters")
    return value or None


def extraction_draft(conn, project_id, file_id):
    import shlex
    from hermes_cli.project_workflows import workflow_draft
    project = _project(conn, project_id)
    row = conn.execute("SELECT path,status FROM project_reference_files WHERE id=? AND project_id=?",
                       (file_id, project.id)).fetchone()
    if row is None or row["status"] not in {"ready", "partial"}:
        raise ValueError("Index the selected source before extracting actions")
    command = f"hermes project evidence {shlex.quote(project.id)} {shlex.quote(file_id)}"
    task = (f"Review the indexed document {row['path']!r}. Read saved evidence with: {command}. "
            f"Continue with --after <next_after> when needed. Import proposals using "
            f"hermes project propose-actions {shlex.quote(project.id)} --input <your JSON file>. "
            "Keep each quotation tied to its citation_id and exact saved source version.")
    return workflow_draft(conn, project.id, "document-actions", "standard", task)


def propose_actions(conn, project_id, proposals):
    project = _project(conn, project_id)
    if not isinstance(proposals, list) or not 1 <= len(proposals) <= 50:
        raise ValueError("Supply 1 to 50 cited proposals")
    prepared = []
    for item in proposals:
        if not isinstance(item, dict):
            raise ValueError("Each proposal must be an object")
        citation = reference_citation(conn, project.id, item.get("citation_id"))
        title = _text(item.get("title"), 500, required=True)
        quote = _text(item.get("quote"), 3000, required=True)
        if quote not in citation["text"]:
            raise ValueError("Quote must match the saved citation exactly")
        owner = _text(item.get("owner"), 200)
        due = _text(item.get("due_text"), 200)
        if any(value and value not in quote for value in (owner, due)):
            raise ValueError("Proposed owners and due dates must appear explicitly in the quote; otherwise leave them empty")
        fingerprint = hashlib.sha256(json.dumps([citation["citation_id"], title, quote], ensure_ascii=False).encode()).hexdigest()
        prepared.append((citation["citation_id"], fingerprint, title, quote, owner, due))
    ids = []
    with write_txn(conn):
        for citation_id, fingerprint, title, quote, owner, due in prepared:
            conn.execute("""INSERT INTO project_actions
                (id,project_id,citation_id,fingerprint,title,quote,owner,due_text,created_at)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,fingerprint) DO NOTHING""",
                ("pa_" + secrets.token_hex(12), project.id, citation_id, fingerprint, title, quote, owner, due, time.time()))
            ids.append(conn.execute("SELECT id FROM project_actions WHERE project_id=? AND fingerprint=?", (project.id, fingerprint)).fetchone()[0])
    return {"ids": ids}


def _action(conn, project_id, action_id):
    project = _project(conn, project_id)
    row = conn.execute("SELECT * FROM project_actions WHERE id=? AND project_id=?", (action_id, project.id)).fetchone()
    if row is None:
        raise ValueError("No such action proposal")
    return dict(row)


def list_actions(conn, project_id, *, before=None, limit=50):
    project = _project(conn, project_id)
    limit = max(1, min(int(limit), 100))
    sql = "SELECT * FROM project_actions WHERE project_id=?"
    args = [project.id]
    if before:
        cursor = _action(conn, project.id, before)
        sql += " AND (created_at<? OR (created_at=? AND id>?))"
        args.extend([cursor["created_at"], cursor["created_at"], cursor["id"]])
    rows = conn.execute(sql + " ORDER BY created_at DESC,id LIMIT ?", (*args, limit + 1)).fetchall()
    actions = []
    for row in rows[:limit]:
        action = dict(row)
        action["citation"] = reference_citation(conn, project.id, row["citation_id"])
        actions.append(action)
    return {"actions": actions, "board": project.board_slug or "default",
            "next_before": actions[-1]["id"] if len(rows) > limit else None}


def edit_action(conn, project_id, action_id, *, title, owner=None, due_text=None):
    title, owner, due = _text(title, 500, required=True), _text(owner, 200), _text(due_text, 200)
    with write_txn(conn):
        action = _action(conn, project_id, action_id)
        if action["state"] != "pending":
            raise ValueError("Only pending proposals can be edited")
        conn.execute("UPDATE project_actions SET title=?,owner=?,due_text=?,user_edited=1 WHERE id=?",
                     (title, owner, due, action_id))
    return _action(conn, project_id, action_id)


def dismiss_action(conn, project_id, action_id):
    with write_txn(conn):
        action = _action(conn, project_id, action_id)
        if action["state"] not in {"pending", "dismissed"}:
            raise ValueError("An acceptance in progress must be retried before changing its state")
        conn.execute("UPDATE project_actions SET state='dismissed' WHERE id=?", (action_id,))
    return _action(conn, project_id, action_id)


def _task_body(action, citation):
    location = f"{citation['locator']} {citation['start']}"
    if citation["end"] != citation["start"]:
        location += f"-{citation['end']}"
    details = ["Accepted project action. Saved for manual scheduling, not automatically executed.",
               f"Source: {citation['path']}, {location}", f"Source SHA256: {citation['sha256']}",
               f"Citation ID: {citation['citation_id']}", "Quoted evidence:\n" + action["quote"]]
    for label, key in [("Owner", "owner"), ("Due date as written", "due_text")]:
        if action[key]:
            details.append(f"{label}: {action[key]}")
    details.append("Proposal fields reviewed or edited by the user." if action["user_edited"] else "Owner/date fields are quoted from the source; missing fields remain unspecified.")
    return "\n\n".join(details)


def accept_action(conn, project_id, action_id):
    from hermes_cli import kanban_db as kb
    from hermes_cli.kanban_db_connect import connect_closing
    project = _project(conn, project_id)
    with write_txn(conn):
        action = _action(conn, project.id, action_id)
        if action["state"] == "accepted":
            return action
        if action["state"] not in {"pending", "accepting"}:
            raise ValueError("Only pending actions can be accepted")
        board = action["board"] or project.board_slug or "default"
        if not kb.board_exists(board):
            raise ValueError("The project's task board is unavailable")
        conn.execute("UPDATE project_actions SET state='accepting',board=?,last_error=NULL WHERE id=?", (board, action_id))
    # Freeze edits before crossing stores. Keep 'accepting' after an ambiguous
    # failure so retries cannot silently change an already-created task's body.
    action = _action(conn, project.id, action_id)
    citation = reference_citation(conn, project.id, action["citation_id"])
    scope = hashlib.sha256(str(get_hermes_home().resolve()).encode()).hexdigest()
    key = f"project-action:{scope}:{action_id}"
    try:
        with connect_closing(board=board) as tasks:
            # Native create_task allows nesting. Serialize its preflight lookup
            # too, because its standalone idempotency check precedes its txn.
            with write_txn(tasks):
                existing = tasks.execute("SELECT id FROM tasks WHERE idempotency_key=? ORDER BY created_at LIMIT 1", (key,)).fetchone()
                task_id = existing["id"] if existing else kb.create_task(
                    tasks, title=action["title"], body=_task_body(action, citation),
                    assignee=None, created_by="project-action-inbox", initial_status="blocked",
                    workspace_kind="dir" if project.primary_path else "scratch",
                    workspace_path=project.primary_path, project_id=project.id,
                    idempotency_key=key, board=board)
                saved = kb.get_task(tasks, task_id)
                if saved is None:
                    raise ValueError("Native task could not be read back")
        with write_txn(conn):
            conn.execute("UPDATE project_actions SET state='accepted',task_id=?,last_error=NULL WHERE id=?", (task_id, action_id))
    except Exception as exc:
        with write_txn(conn):
            conn.execute("UPDATE project_actions SET last_error=? WHERE id=?", (str(exc), action_id))
        raise
    return _action(conn, project.id, action_id)
