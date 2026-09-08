"""Durable, profile-owned artifact discovery and explicitly captured file versions.

Discovery indexes reported paths, not file bytes. A snapshot records the bytes at
capture time and never pretends to reconstruct an earlier assistant's output.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import tempfile
import time
from urllib.parse import unquote, urlparse

from hermes_cli import projects_db
from hermes_cli.sqlite_util import write_txn
from hermes_constants import get_hermes_home

_MAX_MESSAGE_CHARS = 262144
_MAX_CAPTURE_BYTES = 25 * 1024 * 1024
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
_FILE_EXTS = _IMAGE_EXTS | {
    ".pdf", ".docx", ".xlsx", ".pptx", ".html", ".txt", ".json", ".md", ".csv",
    ".zip", ".tar", ".gz", ".avi", ".flac", ".m4a", ".mkv", ".mp3", ".ogg",
    ".opus", ".wav", ".webm", ".mp4", ".mov",
}
_STRONG_KEY = re.compile(r"^(?:artifact_(?:file|image|path|url)|files?_(?:created|modified|written)|generated_(?:file|image|path|url)|media_tag|output_(?:file|path|url)|result_(?:file|path|url)|saved_to|screenshot_path)$", re.I)
_PRODUCER = re.compile(r"(?:^|_)(?:creat(?:e|ion)|download|export|generat(?:e|ion)|render|save|speech|tts|write)(?:_|$)", re.I)
_PRODUCER_KEY = re.compile(r"^(?:artifacts?|attachments?|downloads?|audio|image|video|file_path|local_path|media|path)$", re.I)
_LINK = re.compile(r"!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)")
_URL = re.compile(r"https?://[^\s<>\"')]+")
_PATH = re.compile(r"(?:^|[\s(\"'`])((?:/|~/|\.{1,2}/)[^\s\"'`<>]+)")
_MEDIA = re.compile(r'MEDIA:\s*(`[^`\n]+`|"[^"\n]+"|\'[^\'\n]+\'|\S+)')


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(item.get("text", "")) for item in content if isinstance(item, dict) and item.get("type") == "text")
    return ""


def _candidates(role, content, tool_name):
    try:
        parsed = json.loads(content) if isinstance(content, str) else content
    except (ValueError, TypeError, RecursionError):
        parsed = None
    text = _text(parsed) or _text(content)
    if role == "assistant":
        yield from (m.group(1).strip('<>') for m in _LINK.finditer(text))
        yield from (m.group(0) for m in _URL.finditer(text))
        yield from (m.group(1) for m in _PATH.finditer(text))
    if role not in {"assistant", "tool"}:
        return
    producer = bool(_PRODUCER.search(tool_name or ""))
    if role == "assistant" or producer:
        yield from (m.group(1).strip('`\"\'') for m in _MEDIA.finditer(text))
    if role != "tool" or not isinstance(parsed, (dict, list)):
        return
    if isinstance(parsed, dict) and (parsed.get("error") or parsed.get("success") is False):
        return

    def walk(value, eligible=False, depth=0):
        if depth > 16:
            return
        if isinstance(value, str) and eligible:
            yield value
        elif isinstance(value, list):
            for child in value:
                yield from walk(child, eligible, depth + 1)
        elif isinstance(value, dict):
            for key, child in value.items():
                yield from walk(child, eligible or bool(_STRONG_KEY.match(key)) or (producer and bool(_PRODUCER_KEY.match(key))), depth + 1)
    yield from walk(parsed)


def _artifact(value, cwd):
    value = value.strip().removeprefix("MEDIA:").strip().strip('`\"\'').rstrip('),.;')
    if not value or len(value) > 4096:
        return None
    parsed = urlparse(value)
    remote = parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    native_absolute = os.path.isabs(value)
    if parsed.scheme and not remote and parsed.scheme != "file" and not native_absolute:
        return None
    if parsed.scheme == "file" and parsed.netloc not in {"", "localhost"}:
        return None
    path = unquote(parsed.path) if parsed.scheme in {"file", "http", "https"} else value
    ext = Path(path).suffix.lower()
    if not remote and ext not in _FILE_EXTS:
        return None
    if not remote:
        local = Path(path).expanduser()
        if not local.is_absolute():
            if not cwd:
                return None
            local = Path(cwd) / local
        value = os.path.abspath(local)
    return value, "image" if ext in _IMAGE_EXTS else "link" if remote else "file", Path(path).name or value


def refresh_index(conn, *, batch_size=128):
    """Read a bounded batch directly from state.db; commit entries and cursor together.

    No transcript is sent to the renderer and no source file is read. Oversized
    messages are counted explicitly instead of loading arbitrary tool dumps.
    """
    batch_size = max(1, min(int(batch_size), 256))
    state_path = get_hermes_home() / "state.db"
    if not state_path.exists():
        return {"scanned": 0, "has_more": False, "skipped_oversized": 0}
    with write_txn(conn):
        identity = state_path.stat()
        source_id = f"{identity.st_dev}:{identity.st_ino}"
        previous_source = conn.execute("SELECT value FROM project_meta WHERE key='results_source'").fetchone()
        cursor_row = conn.execute("SELECT value FROM project_meta WHERE key='results_cursor'").fetchone()
        same_source = previous_source and previous_source[0] == source_id
        cursor = int(cursor_row[0]) if cursor_row and same_source else 0
        previous_skipped = conn.execute("SELECT value FROM project_meta WHERE key='results_skipped'").fetchone()
        skipped_total = int(previous_skipped[0]) if previous_skipped and same_source else 0
        source = sqlite3.connect(state_path.as_uri() + "?mode=ro", uri=True)
        try:
            source.row_factory = sqlite3.Row
            rows = source.execute("""SELECT m.id, m.session_id, m.role, m.tool_name,
                CASE WHEN length(m.content) <= ? THEN m.content END AS content,
                length(m.content) > ? AS oversized, m.timestamp, s.title, s.cwd,
                m.active, m._compressed_summary
                FROM messages m JOIN sessions s ON s.id=m.session_id
                WHERE m.id > ? ORDER BY m.id LIMIT ?""",
                (_MAX_MESSAGE_CHARS, _MAX_MESSAGE_CHARS, cursor, batch_size + 1)).fetchall()
        finally:
            source.close()
        has_more = len(rows) > batch_size
        rows = rows[:batch_size]
        skipped = 0
        for row in rows:
            skipped += int(row["oversized"] or 0)
            if not row["active"] or row["_compressed_summary"] or not row["content"]:
                continue
            project = projects_db.project_for_path(conn, row["cwd"], include_archived=True)
            for candidate in set(_candidates(row["role"], row["content"], row["tool_name"])):
                artifact = _artifact(candidate, row["cwd"])
                if not artifact:
                    continue
                value, kind, label = artifact
                conn.execute("""INSERT INTO project_results
                    (id, project_id, session_id, session_title, message_id, value, kind, label, reported_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id, value) DO UPDATE SET
                    message_id=excluded.message_id, reported_at=excluded.reported_at,
                    session_title=excluded.session_title,
                    project_id=COALESCE(project_results.project_id, excluded.project_id)""",
                    ("r_" + secrets.token_hex(12), project.id if project else None,
                     row["session_id"], row["title"] or row["session_id"], row["id"], value,
                     kind, label, row["timestamp"]))
        if rows:
            conn.execute("INSERT OR REPLACE INTO project_meta(key,value) VALUES ('results_cursor',?)", (str(rows[-1]["id"]),))
        conn.execute("INSERT OR REPLACE INTO project_meta(key,value) VALUES ('results_source',?)", (source_id,))
        skipped_total += skipped
        conn.execute("INSERT OR REPLACE INTO project_meta(key,value) VALUES ('results_skipped',?)", (str(skipped_total),))
    return {"scanned": len(rows), "has_more": has_more, "skipped_oversized": skipped,
            "skipped_oversized_total": skipped_total}


def list_results(conn, *, project_id=None, before=None, limit=100):
    """Stable keyset pagination ordered by report time, then id."""
    limit = max(1, min(int(limit), 200))
    clauses, args = [], []
    if project_id:
        clauses.append("r.project_id=?")
        args.append(project_id)
    if before:
        if not isinstance(before, list) or len(before) != 2:
            raise ValueError("Invalid results cursor")
        clauses.append("(r.reported_at, r.id) < (?, ?)")
        args.extend(before)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = conn.execute("""SELECT r.*, (SELECT COUNT(*) FROM project_result_versions v
        WHERE v.result_id=r.id) AS version_count FROM project_results r""" + where +
        " ORDER BY r.reported_at DESC, r.id DESC LIMIT ?", [*args, limit + 1]).fetchall()
    more = len(rows) > limit
    records = [dict(row) for row in rows[:limit]]
    return {"results": records, "next_cursor": [records[-1]["reported_at"], records[-1]["id"]] if more else None}


def result_versions(conn, result_id):
    return [dict(row) for row in conn.execute(
        "SELECT * FROM project_result_versions WHERE result_id=? ORDER BY number DESC", (result_id,))]


def capture_version(conn, result_id):
    """Save immutable bytes on explicit request, without trusting a client path."""
    from agent.file_safety import get_read_block_error
    row = conn.execute("SELECT * FROM project_results WHERE id=?", (result_id,)).fetchone()
    if row is None:
        raise ValueError("No such result")
    if row["value"].startswith(("http://", "https://")):
        raise ValueError("Only local files can be captured")
    path = Path(row["value"]).resolve()
    if get_read_block_error(str(path)) or ".secrets" in path.parts:
        raise ValueError("This file cannot be captured")
    # Nonblocking prevents a replaced FIFO from hanging the gateway worker.
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Only regular files can be captured")
        if before.st_size > _MAX_CAPTURE_BYTES:
            raise ValueError("File exceeds the 25 MiB snapshot limit")
        data = source.read(_MAX_CAPTURE_BYTES + 1)
        after = os.fstat(source.fileno())
    if len(data) > _MAX_CAPTURE_BYTES or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("File changed during capture; retry when writing has finished")
    digest = hashlib.sha256(data).hexdigest()
    directory = get_hermes_home() / "result-snapshots"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / (digest + path.suffix.lower())
    temp_fd, temp_name = tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(temp_fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    with write_txn(conn):
        last = conn.execute("SELECT * FROM project_result_versions WHERE result_id=? ORDER BY number DESC LIMIT 1", (result_id,)).fetchone()
        if last and last["sha256"] == digest:
            return dict(last)
        vid = "v_" + secrets.token_hex(12)
        conn.execute("""INSERT INTO project_result_versions
            (id,result_id,number,sha256,snapshot_path,size_bytes,captured_at)
            VALUES (?,?,?,?,?,?,?)""", (vid, result_id, last["number"] + 1 if last else 1,
            digest, str(target), len(data), time.time()))
        return dict(conn.execute("SELECT * FROM project_result_versions WHERE id=?", (vid,)).fetchone())


def review_version(conn, version_id, state):
    if state not in {"unreviewed", "approved", "changes_requested"}:
        raise ValueError("Invalid review state")
    with write_txn(conn):
        if not conn.execute("UPDATE project_result_versions SET review_state=? WHERE id=?", (state, version_id)).rowcount:
            raise ValueError("No such result version")
        return dict(conn.execute("SELECT * FROM project_result_versions WHERE id=?", (version_id,)).fetchone())
