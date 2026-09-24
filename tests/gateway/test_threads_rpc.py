"""``thread.list`` / ``thread.get`` / ``thread.transcript`` through the real registry.

These drive ``tui_gateway.server._methods`` exactly as the desktop client does,
against a throwaway ``state.db``. Nothing about the handlers is mocked.

The RPCs are a read over rows that already exist: delegated children carry
``model_config.$._delegate_from`` and their own transcript. So the tests that
matter are the refusals, not the happy path. A thread RPC that will answer for
an ordinary session turns a stale link into someone else's conversation
rendered as work.
"""

from __future__ import annotations

import pytest

import tui_gateway.server as srv

_E_THREADS, _E_NO_THREAD, _E_THREAD_ARG = 5071, 5072, 5073


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Temp HERMES_HOME plus a shared handle on its state.db.

    The handlers reach the database through the gateway's launch handle
    (``srv._get_db``), bound at process launch, so it is pointed at the temp
    database directly (same approach as the bot-mode resolution tests).
    """
    h = tmp_path / ".hermes"
    h.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(h))

    from hermes_state import SessionDB

    handles = []

    def _shared_db():
        database = SessionDB(db_path=h / "state.db")
        handles.append(database)
        return database

    monkeypatch.setattr(srv, "_get_db", _shared_db)
    yield h
    for database in handles:
        try:
            database.close()
        except Exception:
            pass


def _db(home):
    from hermes_state import SessionDB

    return SessionDB(db_path=home / "state.db")


def _seed(home, threads):
    """Build a coordinator and its delegated children exactly as delegate_tool
    does: a child row, the ``_delegate_from`` marker, the goal as message one."""
    database = _db(home)
    try:
        database.create_session("coord-1", source="desktop", model="test-model")
        database.append_message("coord-1", "user", "plan the launch")
        for sid, goal, end_reason, extra in threads:
            database.create_session(
                sid, source="desktop", model="test-model",
                model_config={"_delegate_from": "coord-1"}, parent_session_id="coord-1",
            )
            database.append_message(sid, "user", goal)
            for role, content in extra:
                database.append_message(sid, role, content)
            if end_reason is not None:
                database.end_session(sid, end_reason)
    finally:
        database.close()


def _call(name, params):
    return srv._methods[name](1, params)


def _result(name, params):
    envelope = _call(name, params)
    assert "error" not in envelope, envelope
    return envelope["result"]


def _error(name, params):
    envelope = _call(name, params)
    assert "error" in envelope, envelope
    return envelope["error"]


class TestThreadList:
    def test_lists_delegated_threads_with_inbox_counts(self, home):
        _seed(home, [
            ("t-open", "trace the cyanotype lineage", None, []),
            ("t-done", "build the deck", "agent_close", []),
            ("t-lost", "search the plate books", "ws_orphan_reap", []),
        ])

        result = _result("thread.list", {})

        assert result["counts"] == {"working": 1, "resolved": 1, "failed": 1}
        assert result["total"] == 3
        assert {t["session_id"] for t in result["threads"]} == {"t-open", "t-done", "t-lost"}

    def test_an_ordinary_conversation_is_not_a_thread(self, home):
        _seed(home, [])

        result = _result("thread.list", {})

        assert result["threads"] == []
        assert result["total"] == 0

    def test_scopes_to_one_coordinator(self, home):
        _seed(home, [("t-1", "goal", "agent_close", [])])
        database = _db(home)
        try:
            database.create_session("coord-2", source="desktop", model="test-model")
            database.create_session(
                "t-other", source="desktop", model="test-model",
                model_config={"_delegate_from": "coord-2"}, parent_session_id="coord-2",
            )
            database.append_message("t-other", "user", "someone else's work")
        finally:
            database.close()

        result = _result("thread.list", {"coordinator_session_id": "coord-1"})

        assert [t["session_id"] for t in result["threads"]] == ["t-1"]
        assert result["coordinator_session_id"] == "coord-1"

    def test_state_filter_narrows_rows_but_not_counts(self, home):
        """Counts describe the whole scope on purpose: a section header that
        changed as the client paged or filtered would be unreadable."""
        _seed(home, [
            ("t-open", "goal", None, []),
            ("t-done", "goal two", "agent_close", []),
        ])

        result = _result("thread.list", {"states": ["working"]})

        assert [t["session_id"] for t in result["threads"]] == ["t-open"]
        assert result["counts"] == {"working": 1, "resolved": 1, "failed": 0}

    def test_a_single_state_string_is_accepted(self, home):
        _seed(home, [("t-open", "goal", None, []), ("t-done", "goal two", "agent_close", [])])

        result = _result("thread.list", {"states": "working"})

        assert [t["session_id"] for t in result["threads"]] == ["t-open"]

    def test_unknown_state_matches_nothing_rather_than_everything(self, home):
        _seed(home, [("t-1", "goal", "agent_close", [])])

        assert _result("thread.list", {"states": ["nonsense"]})["threads"] == []

    def test_paging_does_not_repeat_rows(self, home):
        _seed(home, [(f"t-{i}", f"goal {i}", "agent_close", []) for i in range(5)])

        first = _result("thread.list", {"limit": 2, "offset": 0})["threads"]
        second = _result("thread.list", {"limit": 2, "offset": 2})["threads"]

        assert len(first) == len(second) == 2
        assert {t["session_id"] for t in first}.isdisjoint({t["session_id"] for t in second})

    def test_a_bad_limit_is_an_argument_error_not_a_crash(self, home):
        _seed(home, [("t-1", "goal", "agent_close", [])])

        assert _error("thread.list", {"limit": "many"})["code"] == _E_THREAD_ARG

    def test_label_falls_back_to_the_goal_when_untitled(self, home):
        _seed(home, [("t-1", "trace the cyanotype lineage", "agent_close", [])])

        row = _result("thread.list", {})["threads"][0]

        assert row["title"] is None
        assert "cyanotype" in row["label"]


class TestThreadGet:
    def test_returns_the_thread_header(self, home):
        _seed(home, [("t-1", "goal", "agent_close", [])])

        thread = _result("thread.get", {"session_id": "t-1"})["thread"]

        assert thread["session_id"] == "t-1"
        assert thread["state"] == "resolved"
        assert thread["coordinator_session_id"] == "coord-1"

    def test_refuses_an_ordinary_session(self, home):
        """The refusal that matters: a coordinator is not openable as a thread."""
        _seed(home, [("t-1", "goal", "agent_close", [])])

        assert _error("thread.get", {"session_id": "coord-1"})["code"] == _E_NO_THREAD

    def test_refuses_a_missing_session(self, home):
        _seed(home, [])

        assert _error("thread.get", {"session_id": "ghost"})["code"] == _E_NO_THREAD

    def test_requires_a_session_id(self, home):
        _seed(home, [])

        assert _error("thread.get", {})["code"] == _E_THREAD_ARG


class TestThreadTranscript:
    def test_returns_the_threads_own_messages(self, home):
        _seed(home, [("t-1", "the goal", "agent_close", [("assistant", "on it"), ("assistant", "done")])])

        result = _result("thread.transcript", {"session_id": "t-1"})

        assert [m["role"] for m in result["messages"]] == ["user", "assistant", "assistant"]
        assert result["messages"][0]["content"] == "the goal"
        assert result["truncated"] is False
        assert result["thread"]["session_id"] == "t-1"

    def test_pages_the_tail_and_says_so(self, home):
        """A 520 message thread exists on a real machine. The transcript must
        arrive bounded, and the client must be told it is looking at a tail."""
        extra = [("assistant", f"step {i}") for i in range(10)]
        _seed(home, [("t-1", "the goal", "agent_close", extra)])

        result = _result("thread.transcript", {"session_id": "t-1", "limit": 4})

        assert len(result["messages"]) == 4
        assert result["truncated"] is True
        # ``latest`` paging returns the newest rows, still in chronological order.
        assert result["messages"][-1]["content"] == "step 9"

    def test_refuses_an_ordinary_session(self, home):
        _seed(home, [("t-1", "goal", "agent_close", [])])

        assert _error("thread.transcript", {"session_id": "coord-1"})["code"] == _E_NO_THREAD

    def test_requires_a_session_id(self, home):
        _seed(home, [])

        assert _error("thread.transcript", {})["code"] == _E_THREAD_ARG


class TestRegistration:
    def test_every_thread_method_is_registered(self):
        assert {"thread.list", "thread.get", "thread.transcript"} <= set(srv._methods)

    def test_live_subagent_control_is_untouched(self):
        """Threads add durable reads. Steering and stopping stay on the
        existing live RPCs rather than growing a second runtime."""
        assert {"subagent.list", "subagent.steer", "subagent.interrupt"} <= set(srv._methods)


class TestProfileScope:
    """`thread.list` must read the NAMED profile's state.db, not the launch one.

    `@profile_scoped` binds HERMES_HOME for config, secrets and terminal policy,
    but it deliberately does not redirect the session store: `server._get_db` is
    pinned to the import-time launch home process wide (#102526). A handler that
    reads through it answers every profile from the launch database, which both
    leaks threads into a profile that has none and hides a secondary's own.

    These tests fail against a handler that calls `_get_db()` directly, which is
    exactly how this shipped the first time.
    """

    @pytest.fixture
    def two_profiles(self, home, monkeypatch, tmp_path):
        """A second profile home with a thread of its own, wired the way
        `_profile_home` resolves one."""
        from hermes_state import SessionDB

        other = tmp_path / "other-profile"
        other.mkdir(parents=True)

        database = SessionDB(db_path=other / "state.db")
        try:
            database.create_session("coord-other", source="desktop", model="test-model")
            database.create_session(
                "t-other", source="desktop", model="test-model",
                model_config={"_delegate_from": "coord-other"}, parent_session_id="coord-other",
            )
            database.append_message("t-other", "user", "a secondary profile's own work")
        finally:
            database.close()

        monkeypatch.setattr(srv, "_profile_home", lambda profile: other if profile == "other" else None)
        return other

    def test_reads_the_named_profiles_threads(self, home, two_profiles):
        _seed(home, [("t-launch", "the launch profile's work", "agent_close", [])])

        result = _result("thread.list", {"profile": "other"})

        assert [t["session_id"] for t in result["threads"]] == ["t-other"]

    def test_does_not_leak_the_launch_profiles_threads(self, home, two_profiles):
        _seed(home, [("t-launch", "the launch profile's work", "agent_close", [])])

        listed = {t["session_id"] for t in _result("thread.list", {"profile": "other"})["threads"]}

        assert "t-launch" not in listed

    def test_the_launch_profile_still_reads_its_own(self, home, two_profiles):
        _seed(home, [("t-launch", "the launch profile's work", "agent_close", [])])

        result = _result("thread.list", {})

        assert [t["session_id"] for t in result["threads"]] == ["t-launch"]

    def test_a_thread_is_not_reachable_from_the_wrong_profile(self, home, two_profiles):
        _seed(home, [("t-launch", "the launch profile's work", "agent_close", [])])

        assert _error("thread.get", {"profile": "other", "session_id": "t-launch"})["code"] == _E_NO_THREAD

    def test_counts_are_scoped_to_the_profile_too(self, home, two_profiles):
        _seed(home, [
            ("t-a", "one", "agent_close", []),
            ("t-b", "two", "agent_close", []),
        ])

        assert _result("thread.list", {"profile": "other"})["total"] == 1
        assert _result("thread.list", {})["total"] == 2
