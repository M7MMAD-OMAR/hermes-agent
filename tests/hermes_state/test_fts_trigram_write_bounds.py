"""The trigram index stores a bounded prefix of each message.

A trigram tokenizer emits a token per character position, so this index grows
several times faster than the text it covers; the bound is what keeps it from
becoming the largest object in the database (measured: 643 MB of a 1.58 GB
store). These tests pin the two properties that make the bound safe rather than
merely small: bounded rows stay findable through the word index, and every sync
trigger passes back exactly the text it indexed, so an external-content delete
cannot leave orphan tokens behind.
"""

import pytest

from hermes_state import SessionDB
from hermes_state_common import (
    FTS_TRIGRAM_CONTENT_PREFIX_CHARS,
    FTS_TRIGRAM_FULL_CONTENT_HIGH_WATER_KEY,
)


def _past_the_bound(head: str, tail: str) -> str:
    """A message whose *tail* sits beyond the trigram bound, *head* inside it."""
    padding = "padding " * (FTS_TRIGRAM_CONTENT_PREFIX_CHARS // len("padding ") + 8)

    return f"{head} {padding} {tail}"


def _trigram_hits(db: SessionDB, term: str) -> list[int]:
    return [
        row[0]
        for row in db._conn.execute(
            "SELECT rowid FROM messages_fts_trigram WHERE messages_fts_trigram MATCH ?",
            (f'"{term}"',),
        )
    ]


def _integrity_check(db: SessionDB) -> None:
    """FTS5's own audit. A delete that passed different text than the insert did
    leaves the index inconsistent with its content table, and this is what says so."""
    db._conn.execute("INSERT INTO messages_fts_trigram(messages_fts_trigram) VALUES('integrity-check')")


def _meta(db: SessionDB, key: str):
    row = db._conn.execute("SELECT value FROM state_meta WHERE key = ?", (key,)).fetchone()

    return None if row is None else row[0]


def _open_db(path) -> SessionDB:
    session_db = SessionDB(db_path=path)
    if not session_db._fts_enabled or not getattr(session_db, "_trigram_available", False):
        session_db.close()
        pytest.skip("SQLite FTS5 trigram tokenizer unavailable")

    return session_db


@pytest.fixture
def db(tmp_path):
    session_db = _open_db(tmp_path / "state.db")
    session_db.create_session("session", source="cli")
    try:
        yield session_db
    finally:
        session_db.close()


def test_trigram_indexes_the_prefix_while_the_word_index_keeps_the_whole_body(db):
    message_id = db.append_message(
        "session", role="assistant", content=_past_the_bound("headtoken", "tailtoken")
    )

    assert _trigram_hits(db, "headtoken") == [message_id]
    assert _trigram_hits(db, "tailtoken") == []
    # The bound costs infix reach, never findability: the base index still has it.
    assert [row["id"] for row in db.search_messages("tailtoken")] == [message_id]


def test_deleting_a_bounded_row_leaves_no_orphan_tokens(db):
    message_id = db.append_message(
        "session", role="assistant", content=_past_the_bound("doomedtoken", "tailtoken")
    )
    assert _trigram_hits(db, "doomedtoken") == [message_id]

    db._conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))

    assert _trigram_hits(db, "doomedtoken") == []
    _integrity_check(db)


def test_updating_a_bounded_row_reindexes_only_the_new_prefix(db):
    message_id = db.append_message(
        "session", role="assistant", content=_past_the_bound("firsttoken", "tailtoken")
    )

    db._conn.execute(
        "UPDATE messages SET content = ? WHERE id = ?",
        (_past_the_bound("secondtoken", "othertail"), message_id),
    )

    assert _trigram_hits(db, "firsttoken") == []
    assert _trigram_hits(db, "secondtoken") == [message_id]
    _integrity_check(db)


def test_history_written_before_the_bound_keeps_its_tokens(tmp_path):
    path = tmp_path / "state.db"
    first = _open_db(path)
    first.create_session("session", source="cli")
    legacy_id = first.append_message(
        "session", role="assistant", content=_past_the_bound("legacyhead", "legacytail")
    )

    # A store that predates the bound: the whole body is in the index, and no
    # marker has been stamped yet.
    first._conn.execute("DELETE FROM state_meta WHERE key = ?", (FTS_TRIGRAM_FULL_CONTENT_HIGH_WATER_KEY,))
    first._conn.execute(
        "INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content, tool_name) "
        "SELECT 'delete', id, substr(content, 1, ?), tool_name FROM messages WHERE id = ?",
        (FTS_TRIGRAM_CONTENT_PREFIX_CHARS, legacy_id),
    )
    first._conn.execute(
        "INSERT INTO messages_fts_trigram(rowid, content, tool_name) "
        "SELECT id, content, tool_name FROM messages WHERE id = ?",
        (legacy_id,),
    )
    first._conn.commit()
    first.close()

    reopened = _open_db(path)
    try:
        marker = _meta(reopened, FTS_TRIGRAM_FULL_CONTENT_HIGH_WATER_KEY)
        assert marker is not None and int(marker) >= legacy_id

        # The grandfathered row keeps the reach it was indexed with...
        assert _trigram_hits(reopened, "legacytail") == [legacy_id]

        # ...and a row written after the marker takes the bound.
        fresh_id = reopened.append_message(
            "session", role="assistant", content=_past_the_bound("freshhead", "freshtail")
        )
        assert _trigram_hits(reopened, "freshhead") == [fresh_id]
        assert _trigram_hits(reopened, "freshtail") == []

        # Deleting the grandfathered row must pass back its FULL body, or its
        # tokens outlive it.
        reopened._conn.execute("DELETE FROM messages WHERE id = ?", (legacy_id,))
        assert _trigram_hits(reopened, "legacytail") == []
        _integrity_check(reopened)
    finally:
        reopened.close()


def test_a_full_rebuild_drops_the_grandfather_clause(db):
    legacy_id = db.append_message(
        "session", role="assistant", content=_past_the_bound("rebuildhead", "rebuildtail")
    )

    # Put the row back in the grandfathered era, indexed at full length.
    db._conn.execute(
        "INSERT OR REPLACE INTO state_meta(key, value) VALUES(?, ?)",
        (FTS_TRIGRAM_FULL_CONTENT_HIGH_WATER_KEY, str(legacy_id)),
    )
    db._conn.execute(
        "INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content, tool_name) "
        "SELECT 'delete', id, substr(content, 1, ?), tool_name FROM messages WHERE id = ?",
        (FTS_TRIGRAM_CONTENT_PREFIX_CHARS, legacy_id),
    )
    db._conn.execute(
        "INSERT INTO messages_fts_trigram(rowid, content, tool_name) "
        "SELECT id, content, tool_name FROM messages WHERE id = ?",
        (legacy_id,),
    )
    assert _trigram_hits(db, "rebuildtail") == [legacy_id]

    db._rebuild_fts_indexes(db._conn.cursor())

    assert _meta(db, FTS_TRIGRAM_FULL_CONTENT_HIGH_WATER_KEY) is None
    # History carries the bound too now, which is where the disk space comes from.
    assert _trigram_hits(db, "rebuildhead") == [legacy_id]
    assert _trigram_hits(db, "rebuildtail") == []
