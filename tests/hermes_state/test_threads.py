"""Threads read layer: the delegate children the session list hides.

A thread is not a new record. ``tools/delegate_tool.py`` already stamps every
delegated child with ``model_config.$._delegate_from``, the child already
writes its own ``sessions`` row and its own ``messages``, and
``_session_filter_where(exclude_children=True)`` already hides those rows from
session pickers.

So the value of :mod:`hermes_state_threads` is precisely that it lifts ONE
filter and changes nothing else. These tests exercise a real ``SessionDB``
against a real sqlite file, and the load bearing case is
``test_threads_stay_hidden_from_the_ordinary_session_list``: if that ever
fails, revealing threads has leaked sub-agent runs into the sidebar.
"""

import pytest

from hermes_state import SessionDB
from hermes_state_threads import (
    THREAD_STATE_FAILED,
    THREAD_STATE_RESOLVED,
    THREAD_STATE_WORKING,
)


@pytest.fixture
def db(tmp_path):
    handle = SessionDB(db_path=tmp_path / "state.db")
    yield handle
    handle.close()


def _coordinator(db, sid="coord-1", *, goal="plan the launch"):
    db.create_session(sid, source="desktop", model="test-model")
    db.append_message(sid, "user", goal)
    return sid


def _thread(db, sid, coordinator, *, goal="research the history of the style",
            end_reason="agent_close", messages=()):
    """A delegated child exactly as delegate_tool builds one: its own row, the
    ``_delegate_from`` marker, and the goal as its first user message."""
    db.create_session(
        sid, source="desktop", model="test-model",
        model_config={"_delegate_from": coordinator}, parent_session_id=coordinator,
    )
    db.append_message(sid, "user", goal)
    for role, content in messages:
        db.append_message(sid, role, content)
    if end_reason is not None:
        db.end_session(sid, end_reason)
    return sid


class TestThreadIsASession:
    def test_delegate_child_is_listed_as_a_thread(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator)

        threads = db.list_threads()

        assert [t["session_id"] for t in threads] == ["t-1"]
        assert threads[0]["coordinator_session_id"] == coordinator

    def test_an_ordinary_session_is_not_a_thread(self, db):
        _coordinator(db)

        assert db.list_threads() == []
        assert db.count_threads() == 0

    def test_threads_stay_hidden_from_the_ordinary_session_list(self, db):
        """The whole point of the design: revealing threads must not reveal
        them anywhere else. A regression here puts sub-agent runs in the
        sidebar."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator)

        listed = {row["id"] for row in db.list_sessions_rich(limit=50)}

        assert coordinator in listed
        assert "t-1" not in listed
        assert [t["session_id"] for t in db.list_threads()] == ["t-1"]

    def test_transcript_is_the_ordinary_message_store(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, messages=[("assistant", "on it"), ("assistant", "done")])

        messages = db.get_messages("t-1")

        assert [m["role"] for m in messages] == ["user", "assistant", "assistant"]


class TestThreadState:
    def test_open_thread_is_working(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, end_reason=None)

        assert db.list_threads()[0]["state"] == THREAD_STATE_WORKING

    def test_closed_thread_is_resolved(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, end_reason="agent_close")

        assert db.list_threads()[0]["state"] == THREAD_STATE_RESOLVED

    @pytest.mark.parametrize("reason", ["startup_orphan_reap", "ws_orphan_reap"])
    def test_reaped_thread_is_failed_not_resolved(self, db, reason):
        """A reaped session did not finish on its own terms. Rendering it as
        resolved would tell the user work landed that never did."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, end_reason=reason)

        assert db.list_threads()[0]["state"] == THREAD_STATE_FAILED

    def test_state_counts_cover_every_state_even_at_zero(self, db):
        """A section header that vanishes at zero reads as a missing feature."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, end_reason=None)

        counts = db.thread_state_counts()

        assert counts == {THREAD_STATE_WORKING: 1, THREAD_STATE_RESOLVED: 0, THREAD_STATE_FAILED: 0}

    def test_counts_are_scoped_to_the_coordinator(self, db):
        first = _coordinator(db, "coord-1")
        second = _coordinator(db, "coord-2")
        _thread(db, "t-1", first, end_reason=None)
        _thread(db, "t-2", second)
        _thread(db, "t-3", second)

        assert db.thread_state_counts(first)[THREAD_STATE_WORKING] == 1
        assert db.count_threads(second) == 2
        assert db.count_threads() == 3


class TestThreadFiltering:
    def test_state_filter_narrows_the_list(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-open", coordinator, end_reason=None)
        _thread(db, "t-done", coordinator)

        working = db.list_threads(states=[THREAD_STATE_WORKING])

        assert [t["session_id"] for t in working] == ["t-open"]

    def test_unknown_state_matches_nothing_rather_than_everything(self, db):
        """An unrecognised filter name must not silently widen the result to
        every thread, which is the failure mode that hides a client bug."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator)

        assert db.list_threads(states=["nonsense"]) == []

    def test_every_state_named_is_the_same_as_no_filter(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-open", coordinator, end_reason=None)
        _thread(db, "t-done", coordinator)

        named = db.list_threads(states=[THREAD_STATE_WORKING, THREAD_STATE_RESOLVED, THREAD_STATE_FAILED])

        assert len(named) == len(db.list_threads()) == 2

    def test_coordinator_scope_excludes_other_conversations(self, db):
        first = _coordinator(db, "coord-1")
        second = _coordinator(db, "coord-2")
        _thread(db, "t-1", first)
        _thread(db, "t-2", second)

        assert [t["session_id"] for t in db.list_threads(first)] == ["t-1"]

    def test_paging_is_stable_and_does_not_repeat_rows(self, db):
        coordinator = _coordinator(db)
        for index in range(5):
            _thread(db, f"t-{index}", coordinator)

        first = db.list_threads(limit=2, offset=0)
        second = db.list_threads(limit=2, offset=2)

        assert len(first) == len(second) == 2
        assert {t["session_id"] for t in first}.isdisjoint({t["session_id"] for t in second})

    def test_min_message_count_drops_scaffolding(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-goal-only", coordinator)
        _thread(db, "t-worked", coordinator, messages=[("assistant", "a"), ("assistant", "b")])

        worked = db.list_threads(min_message_count=3)

        assert [t["session_id"] for t in worked] == ["t-worked"]


class TestThreadLabel:
    def test_untitled_thread_falls_back_to_its_goal(self, db):
        """Only 8 of 297 delegate children on a real machine carry a title, so
        the goal preview is the label that actually ships."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, goal="trace the cyanotype lineage")

        row = db.list_threads()[0]

        assert row["title"] is None
        assert "cyanotype" in row["label"]

    def test_a_title_wins_over_the_goal_preview(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, goal="trace the cyanotype lineage")
        db.set_auto_title("t-1", "History of the style", source=db.TITLE_SOURCE_DERIVED)

        row = db.list_threads()[0]

        assert row["title"] == "History of the style"
        assert row["label"] == "History of the style"

    def test_a_thread_is_never_nameless(self, db):
        """No title and no goal turn still has to render as something."""
        coordinator = _coordinator(db)
        db.create_session(
            "t-1", source="desktop", model="test-model",
            model_config={"_delegate_from": coordinator}, parent_session_id=coordinator,
        )

        assert db.list_threads()[0]["label"] == "t-1"


class TestGetThread:
    def test_returns_the_thread(self, db):
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator)

        assert db.get_thread("t-1")["session_id"] == "t-1"

    def test_an_ordinary_session_is_not_reachable_as_a_thread(self, db):
        """A stale client link must not turn a real conversation into a thread
        view, which would show it under someone else's coordinator."""
        coordinator = _coordinator(db)

        assert db.get_thread(coordinator) is None

    def test_missing_and_empty_ids_return_none(self, db):
        assert db.get_thread("nope") is None
        assert db.get_thread("") is None


class TestExistingGuardsStillHold:
    def test_deleting_the_coordinator_cascades_to_its_threads(self, db):
        """Already guaranteed by ``_collect_delegate_child_ids``; asserted here
        because the Threads dock makes these rows user visible, so an orphan is
        now something a person can see."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator)
        assert db.count_threads() == 1

        db.delete_session(coordinator)

        assert db.count_threads() == 0

    def test_a_thread_is_not_a_compression_continuation(self, db):
        """Threads and compression rotations both carry ``parent_session_id``.
        Confusing them would make a rotation show up as work in the dock."""
        coordinator = _coordinator(db)
        _thread(db, "t-1", coordinator, end_reason=None)

        assert db.find_live_compression_child(coordinator) is None
