"""Local project evidence, indexed with immutable text and source locators."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time
import unicodedata

from hermes_cli import projects_db
from hermes_cli.sqlite_util import write_txn

_EXTENSIONS = {".md", ".txt", ".pdf", ".docx"}
_SKIP_DIRS = {".git", ".secrets", ".cache", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".next", ".turbo"}
_SKIP_FILES = {"AGENTS.md", "CLAUDE.md", "SKILL.md"}
_MAX_FILE_BYTES = 10 * 1024 * 1024
_MAX_FILES = 5000
_MAX_ENTRIES = 50000
_STOP_WORDS = set("a an the is are was were what which who when where why how of to for in on and or from with this that من ما ماذا الذي التي هو هي في على عن الى الي و او هل كيف متى اين اي".split())


def search_text(text):
    folded = "".join(char for char in unicodedata.normalize("NFKD", text.lower())
                     if not unicodedata.combining(char))
    folded = folded.translate(str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ـ": None}))
    return " ".join(token[2:] if token.startswith("ال") and len(token) > 4 else token
                    for token in re.findall(r"[^\W_]+", folded, re.UNICODE))


def _project(conn, project_id):
    project = projects_db.get_project(conn, str(project_id or ""))
    if project is None:
        raise ValueError("No such project")
    return project


def _allowed(path, roots):
    from agent.file_safety import get_read_block_error
    resolved = path.resolve()
    return (not get_read_block_error(str(resolved)) and ".secrets" not in resolved.parts
            and any(resolved.is_relative_to(root) for root in roots))


def scan_references(conn, project_id):
    """Discover metadata once per refresh; document extraction is a separate batch."""
    project = _project(conn, project_id)
    roots = [Path(folder.path).resolve() for folder in project.folders]
    discovered, failures, visited = {}, [], 0
    truncated = False
    for root in roots:
        if not root.is_dir():
            failures.append({"path": str(root), "error": "Source folder unavailable"})
            continue
        def walk_error(error):
            failures.append({"path": str(error.filename or root), "error": str(error)})
        for folder, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
            dirs[:] = sorted(name for name in dirs if name not in _SKIP_DIRS and not name.startswith('.'))
            visited += len(dirs) + len(names)
            if visited > _MAX_ENTRIES:
                truncated = True
                break
            for name in sorted(names):
                path = Path(folder) / name
                if name in _SKIP_FILES or name.startswith('.') or path.suffix.lower() not in _EXTENSIONS:
                    continue
                try:
                    if not _allowed(path, roots):
                        continue
                    info = path.stat()
                    if not path.is_file():
                        continue
                    discovered[str(path.resolve())] = (info.st_mtime_ns, info.st_size)
                except (OSError, RuntimeError) as exc:
                    failures.append({"path": str(path), "error": str(exc)})
                if len(discovered) >= _MAX_FILES:
                    truncated = True
                    break
            if truncated:
                break
        if truncated:
            break
    with write_txn(conn):
        for path, (mtime, size) in discovered.items():
            too_large = size > _MAX_FILE_BYTES
            conn.execute("""INSERT INTO project_reference_files
                (id,project_id,path,status,error,mtime_ns,size_bytes,checked_at)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,path) DO UPDATE SET
                status=CASE WHEN excluded.size_bytes > ? THEN 'too_large'
                    WHEN project_reference_files.mtime_ns=excluded.mtime_ns
                     AND project_reference_files.size_bytes=excluded.size_bytes
                     AND project_reference_files.status IN ('ready','partial') THEN project_reference_files.status
                    ELSE 'pending' END,
                error=CASE WHEN excluded.size_bytes > ? THEN excluded.error
                    WHEN project_reference_files.mtime_ns=excluded.mtime_ns
                     AND project_reference_files.size_bytes=excluded.size_bytes
                     AND project_reference_files.status='partial' THEN project_reference_files.error
                    ELSE NULL END,
                mtime_ns=excluded.mtime_ns,size_bytes=excluded.size_bytes,checked_at=excluded.checked_at""",
                ("rf_" + secrets.token_hex(12), project.id, path, "too_large" if too_large else "pending",
                 "File exceeds the 10 MiB reference indexing limit" if too_large else None,
                 mtime, size, time.time(), _MAX_FILE_BYTES, _MAX_FILE_BYTES))
        if failures:
            for row in conn.execute("SELECT id,path FROM project_reference_files WHERE project_id=?", (project.id,)):
                if any(Path(row["path"]).is_relative_to(Path(failure["path"])) for failure in failures):
                    conn.execute("UPDATE project_reference_files SET status='unavailable',error='Source unavailable during scan' WHERE id=?", (row["id"],))
        # An incomplete walk is not evidence that unseen files were deleted.
        if not truncated and not failures:
            for row in conn.execute("SELECT id,path FROM project_reference_files WHERE project_id=?", (project.id,)):
                if row["path"] not in discovered:
                    conn.execute("UPDATE project_reference_files SET status='missing',error='Source file unavailable' WHERE id=?", (row["id"],))
    return {"discovered": len(discovered), "truncated": truncated, "failures": failures,
            "pending": conn.execute("SELECT COUNT(*) FROM project_reference_files WHERE project_id=? AND status='pending'", (project.id,)).fetchone()[0]}


def index_references(conn, project_id, *, batch_size=8):
    """Extract outside write transactions; commit each complete version atomically."""
    from tools.read_extract import extract_document_sections_bytes
    project = _project(conn, project_id)
    roots = [Path(folder.path).resolve() for folder in project.folders]
    rows = conn.execute("SELECT * FROM project_reference_files WHERE project_id=? AND status='pending' ORDER BY path LIMIT ?",
                        (project.id, max(1, min(int(batch_size), 16)))).fetchall()
    indexed, failures = 0, []
    for row in rows:
        path = Path(row["path"])
        try:
            if not _allowed(path, roots):
                raise ValueError("File is outside registered source folders")
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as source:
                before = os.fstat(source.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size > _MAX_FILE_BYTES:
                    raise ValueError("Reference must be a regular file within the size limit")
                raw = source.read(_MAX_FILE_BYTES + 1)
            if len(raw) > _MAX_FILE_BYTES:
                raise ValueError("File exceeds the reference indexing limit")
            digest = hashlib.sha256(raw).hexdigest()
            known = conn.execute("SELECT * FROM project_reference_versions WHERE file_id=? AND sha256=?", (row["id"], digest)).fetchone()
            extracted = None if known else extract_document_sections_bytes(raw, str(path))
            after = path.stat()
            if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                raise ValueError("File changed during indexing; refresh to retry")
            if extracted and sum(len(section["text"]) for section in extracted["sections"]) > 4 * 1024 * 1024:
                raise ValueError("Extracted text exceeds the 4 MiB reference limit")
            missing = json.loads(known["missing_pages"]) if known else extracted["missing_pages"]
            if extracted is not None and not extracted["sections"]:
                raise ValueError("No searchable text; OCR may be needed")
            with write_txn(conn):
                existing = conn.execute("SELECT id FROM project_reference_versions WHERE file_id=? AND sha256=?", (row["id"], digest)).fetchone()
                if not existing:
                    vid = "rv_" + secrets.token_hex(12)
                    conn.execute("INSERT INTO project_reference_versions(id,file_id,sha256,indexed_at,extractor,missing_pages) VALUES (?,?,?,?,?,?)",
                                 (vid, row["id"], digest, time.time(), extracted["extractor"], json.dumps(missing)))
                    ordinal = 0
                    for section in extracted["sections"]:
                        for start in range(0, len(section["text"]), 2800):
                            text = section["text"][start:start + 3000]
                            conn.execute("INSERT INTO project_reference_chunks(version_id,ordinal,locator,start,end,text,search_text) VALUES (?,?,?,?,?,?,?)",
                                         (vid, ordinal, section["locator"], section["start"], section["end"], text, search_text(path.stem + ' ' + text)))
                            ordinal += 1
                conn.execute("UPDATE project_reference_files SET current_hash=?,status=?,error=?,mtime_ns=?,size_bytes=? WHERE id=?",
                             (digest, "partial" if missing else "ready", "Pages need OCR: " + ", ".join(map(str, missing)) if missing else None,
                              after.st_mtime_ns, after.st_size, row["id"]))
            indexed += 1
        except Exception as exc:
            failures.append({"path": str(path), "error": str(exc)})
            with write_txn(conn):
                conn.execute("UPDATE project_reference_files SET status='error',error=? WHERE id=?", (str(exc), row["id"]))
    pending = conn.execute("SELECT COUNT(*) FROM project_reference_files WHERE project_id=? AND status='pending'", (project.id,)).fetchone()[0]
    return {"indexed": indexed, "has_more": pending > 0, "pending": pending, "failures": failures}


_CITATION_SELECT = """SELECT c.id AS citation_id,c.text,c.locator,c.start,c.end,v.sha256,v.indexed_at,
    v.extractor,v.missing_pages,f.path,f.status,f.project_id,
    (v.sha256=f.current_hash AND f.status IN ('ready','partial')) AS is_current
    FROM project_reference_chunks c JOIN project_reference_versions v ON v.id=c.version_id
    JOIN project_reference_files f ON f.id=v.file_id"""


def search_references(conn, project_id, query, *, include_history=False, limit=20):
    project = _project(conn, project_id)
    tokens = [token for token in search_text(str(query or "")).split() if token not in _STOP_WORDS][:16]
    if not tokens:
        return {"matches": []}
    expression = " OR ".join('"' + token.replace('"', '""') + '"*' for token in tokens)
    sql = _CITATION_SELECT + " JOIN project_reference_fts ON project_reference_fts.rowid=c.id WHERE f.project_id=? AND project_reference_fts MATCH ?"
    if not include_history:
        sql += " AND v.sha256=f.current_hash AND f.status IN ('ready','partial')"
    sql += " ORDER BY bm25(project_reference_fts), v.indexed_at DESC LIMIT ?"
    return {"matches": [dict(row) for row in conn.execute(sql, (project.id, expression, max(1, min(int(limit), 100))))]}


def reference_citation(conn, project_id, citation_id):
    _project(conn, project_id)
    row = conn.execute(_CITATION_SELECT + " WHERE f.project_id=? AND c.id=?", (project_id, int(citation_id))).fetchone()
    if row is None:
        raise ValueError("No such source citation")
    return dict(row)


def project_brief(conn, project_id):
    from hermes_cli.projects_health import project_with_health
    project = _project(conn, project_id)
    files = [dict(row) for row in conn.execute("SELECT id,path,status,error,current_hash FROM project_reference_files WHERE project_id=? ORDER BY path", (project.id,))]
    approved = [dict(row) for row in conn.execute("""SELECT r.id,r.label,r.session_id,r.session_title,
        v.id AS version_id,v.number,v.captured_at FROM project_results r JOIN project_result_versions v ON v.result_id=r.id
        WHERE r.project_id=? AND v.review_state='approved' ORDER BY v.captured_at DESC LIMIT 10""", (project.id,))]
    return {"project": project_with_health(project), "files": files, "approved_results": approved}
