"""``sessions.trigram_fts: false`` drops the trigram index and keeps search working."""
from __future__ import annotations

from hermes_state import SessionDB


def _table_exists(d: SessionDB, name: str) -> bool:
    with d._lock:
        return d._conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone() is not None


def _seed(d: SessionDB) -> None:
    d.create_session(session_id="s1", source="cli", model="m")
    d.append_message("s1", role="user", content="the wallet page renders a serialized error")
    d.append_message("s1", role="assistant", content="fixed the idempotency proof")


def test_toggle_off_drops_the_trigram_index_and_search_still_works(tmp_path, monkeypatch):
    path = tmp_path / "state.db"
    monkeypatch.setenv("HERMES_TRIGRAM_FTS", "1")
    d = SessionDB(db_path=path)
    try:
        _seed(d)
        assert _table_exists(d, "messages_fts_trigram")
    finally:
        d.close()

    # The next open with the knob off reclaims the derived table; canonical rows are intact.
    monkeypatch.setenv("HERMES_TRIGRAM_FTS", "0")
    d = SessionDB(db_path=path)
    try:
        assert not d._trigram_available
        assert not _table_exists(d, "messages_fts_trigram")
        assert _table_exists(d, "messages_fts")
        assert d.search_messages("wallet", limit=10), "word search must still hit the base index"
        # What the knob trades away: partial-word matches ("idempot" for "idempotency") were the
        # trigram index's job, and the LIKE fallback covers only short CJK terms. Pinned so the
        # trade stays visible.
        assert not d.search_messages("idempot", limit=10)
    finally:
        d.close()

    # And it comes back when re-enabled.
    monkeypatch.setenv("HERMES_TRIGRAM_FTS", "1")
    d = SessionDB(db_path=path)
    try:
        assert d._trigram_available
        assert _table_exists(d, "messages_fts_trigram")
    finally:
        d.close()
