#!/usr/bin/env python3
"""Move already-delivered media into the artifact store and repoint the transcript.

`agent/media_preservation.py` protects every result delivered from now on. It can
do nothing for rows already written, which still point at whatever directory the
producer chose. Any of those files that is still on disk is living on borrowed
time: `cache/images` is pruned hourly at 24 hours, and `/tmp` is tmpfs.

This is the one-time catch-up. Dry run by default; `--apply` writes.

    python3 scripts/preserve_existing_media.py            # report only
    python3 scripts/preserve_existing_media.py --apply     # preserve and repoint

Rows whose file is already gone are counted and left untouched: there is nothing
to preserve, and rewriting a dead path to a different dead path would only make
the record less true.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent.media_preservation import preserve_media_file  # noqa: E402
from hermes_constants import get_hermes_home  # noqa: E402

MEDIA_RE = re.compile(r"MEDIA:(\S+)")


def _paths(content: str) -> list[str]:
    return [p.rstrip(".,)") for p in MEDIA_RE.findall(content or "")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    parser.add_argument("--db", default=str(get_hermes_home() / "state.db"))
    args = parser.parse_args()

    db = Path(args.db)
    if not db.is_file():
        print(f"No state database at {db}")
        return 1

    if args.apply:
        # The rewrite touches the user's whole history. A copy alongside it is
        # cheap next to explaining why it cannot be undone.
        backup = db.with_suffix(db.suffix + ".before-media-preserve")
        if not backup.exists():
            print(f"Backing up {db} -> {backup}")
            shutil.copy2(db, backup)

    conn = sqlite3.connect(str(db))
    rows = conn.execute(
        "SELECT id, session_id, content FROM messages WHERE content LIKE '%MEDIA:%'"
    ).fetchall()

    preserved = rewritten = already_gone = 0

    for message_id, session_id, content in rows:
        updated = content
        for original in dict.fromkeys(_paths(content)):
            if not original.startswith("/"):
                continue
            if not Path(original).is_file():
                already_gone += 1
                continue
            durable = preserve_media_file(original, session_key=session_id or "")
            if durable:
                preserved += 1
                updated = updated.replace(original, durable)
        if updated != content:
            rewritten += 1
            if args.apply:
                conn.execute("UPDATE messages SET content = ? WHERE id = ?", (updated, message_id))

    if args.apply:
        conn.commit()
    conn.close()

    verb = "Preserved" if args.apply else "Would preserve"
    print(f"{verb} {preserved} file(s) across {rewritten} message(s).")
    print(f"{already_gone} reference(s) point at files that are already gone; left as they are.")
    if not args.apply:
        print("\nNothing was written. Re-run with --apply to make it so.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
