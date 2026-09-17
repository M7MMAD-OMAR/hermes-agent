"""Interrupt attribution: which stop path ended the turn (agent/interrupt_origin.py).

The bug this covers: a turn settling as the bare ``Operation interrupted.`` named no cause, so a
report of "I sent a message and it died" could not be told apart from a reaped connection, a
watchdog abort or a mis-hit Stop without tracing the whole interrupt surface by hand. These tests
pin the two properties that make attribution worth having: an attributed stop says what happened,
and an unattributed one degrades to exactly the historical string rather than guessing.
"""

import threading

import pytest

from agent import interrupt_origin as io
from agent.interrupt_control import InterruptControlMixin
from agent.message_sanitization import close_interrupted_tool_sequence


class _Agent(InterruptControlMixin):
    """The interrupt surface's real dependencies, nothing else.

    Deliberately not a MagicMock: the mixin feature-detects attributes (``_ic_slot`` reads a slot
    directly when its lock exists) and a permissive mock would pass tests the real agent fails.
    """

    quiet_mode = True

    def __init__(self):
        self._interrupt_requested = False
        self._interrupt_message = None
        self._tool_interrupt_reason = None
        self._interrupt_origin = None
        self._hard_interrupt_requested = threading.Event()
        self._pending_redirect = None
        self._pending_redirect_lock = threading.Lock()
        self._pending_steer = None
        self._pending_steer_lock = threading.Lock()
        self._execution_thread_id = None
        self._interrupt_thread_signal_pending = False
        self._tool_worker_threads = set()
        self._tool_worker_threads_lock = threading.Lock()
        self._active_children = []
        self._active_children_lock = threading.Lock()
        self._model_request_active = threading.Event()
        self._executing_tools = False


# ── the registry ─────────────────────────────────────────────────────────────

class TestRegistry:
    def test_unknown_keeps_the_historical_bare_placeholder(self):
        """An unattributed stop must be byte-identical to pre-attribution behavior.

        Anything that matched the old string keeps matching, so adding attribution cannot
        silently change how an un-migrated path is rendered or filtered.
        """
        assert io.interrupt_placeholder(None) == "Operation interrupted."
        assert io.interrupt_placeholder(io.UNKNOWN) == "Operation interrupted."

    def test_an_attributed_stop_names_the_cause(self):
        placeholder = io.interrupt_placeholder(io.WS_ORPHAN_REAP)
        assert placeholder.startswith("Operation interrupted: ")
        assert "connection" in placeholder

    def test_an_unregistered_id_degrades_instead_of_raising(self):
        """Settlement is the turn's last moment; an unknown id must not take it down."""
        assert io.interrupt_placeholder("not_a_real_origin") == "Operation interrupted."
        assert io.get_interrupt_origin("not_a_real_origin").id == io.UNKNOWN

    def test_every_registered_origin_resolves_to_itself(self):
        for origin_id in io.known_interrupt_origins():
            assert io.get_interrupt_origin(origin_id).id == origin_id

    def test_every_non_unknown_origin_has_a_readable_sentence(self):
        """A registered origin with no sentence renders as unattributed, which defeats the point."""
        for origin_id in io.known_interrupt_origins():
            if origin_id == io.UNKNOWN:
                continue
            entry = io.get_interrupt_origin(origin_id)
            assert entry.sentence, f"{origin_id} has no sentence"
            assert not entry.sentence.endswith("."), f"{origin_id} double-punctuates"

    def test_a_new_origin_can_be_registered_without_touching_call_sites(self):
        try:
            io.register_interrupt_origin("test_origin", "test", "a test stopped it")
            assert io.interrupt_placeholder("test_origin") == "Operation interrupted: a test stopped it."
            assert "test_origin" in io.known_interrupt_origins()
        finally:
            io._ORIGINS.pop("test_origin", None)

    def test_an_empty_origin_id_is_rejected(self):
        with pytest.raises(ValueError):
            io.register_interrupt_origin("  ", "x", "y")


# ── publication through interrupt() ──────────────────────────────────────────

class TestPublication:
    def test_explicit_origin_is_published_with_the_interrupt(self):
        agent = _Agent()
        agent.interrupt("stop", hard_cancel=True, origin=io.WS_ORPHAN_REAP)
        assert agent._interrupt_origin == io.WS_ORPHAN_REAP
        assert io.agent_interrupt_origin(agent) == io.WS_ORPHAN_REAP

    def test_a_message_carrying_soft_interrupt_is_inferred_as_the_users_own(self):
        """The only inference we allow: the busy-mode ABI proves this path's meaning."""
        agent = _Agent()
        agent.interrupt("my next message")
        assert agent._interrupt_origin == io.USER_MESSAGE

    def test_a_bare_soft_interrupt_stays_unattributed(self):
        agent = _Agent()
        agent.interrupt()
        assert agent._interrupt_origin == io.UNKNOWN

    def test_hard_interrupt_does_not_invent_user_stop(self):
        """Shutdown, timeout and cache invalidation all hard-stop turns. Calling those
        "you stopped it" would be a confident lie where unknown is honest."""
        agent = _Agent()
        agent.hard_interrupt("Gateway shutting down")
        assert io.agent_interrupt_origin(agent) == io.UNKNOWN

    def test_hard_interrupt_forwards_a_stated_origin(self):
        agent = _Agent()
        agent.hard_interrupt("bye", origin=io.SESSION_CLOSED)
        assert agent._interrupt_origin == io.SESSION_CLOSED

    def test_attribution_survives_clear_interrupt(self):
        """The finalizer closes the transcript AFTER clear_interrupt runs, so the attribution
        has to outlive the clear or every finalizer-settled turn reads as unknown."""
        agent = _Agent()
        agent.interrupt("stop", hard_cancel=True, origin=io.LIVENESS_WATCHDOG)
        agent.clear_interrupt()
        assert agent._interrupt_requested is False, "the interrupt itself must still be cleared"
        assert io.agent_interrupt_origin(agent) == io.LIVENESS_WATCHDOG

    def test_the_turn_boundary_is_what_clears_it(self):
        agent = _Agent()
        agent.interrupt("stop", hard_cancel=True, origin=io.LIVENESS_WATCHDOG)
        agent.clear_interrupt()
        io.reset_interrupt_origin(agent)
        assert io.agent_interrupt_origin(agent) == io.UNKNOWN

    def test_accessors_tolerate_an_agent_without_the_slots(self):
        """Third-party agents and old test doubles predate attribution."""
        class _Bare:
            pass

        assert io.agent_interrupt_origin(_Bare()) == io.UNKNOWN
        io.reset_interrupt_origin(_Bare())  # must not raise

    def test_a_declined_liveness_abort_publishes_nothing(self):
        """A generation claim that goes stale means the turn resumed: no interrupt, and so
        no attribution either. A published origin here would mislabel a turn that lived."""
        agent = _Agent()
        agent._turn_liveness_activity_generation = 7
        agent._liveness_activity_lock = lambda: threading.Lock()
        assert agent.interrupt("stall", hard_cancel=True, require_generation=3,
                               origin=io.LIVENESS_WATCHDOG) is False
        assert agent._interrupt_origin is None


# ── the transcript placeholder ───────────────────────────────────────────────

class TestTranscriptClose:
    @staticmethod
    def _tool_tail():
        return [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
            {"role": "tool", "tool_call_id": "c1", "content": "partial"},
        ]

    def test_an_attributed_close_names_the_cause_in_the_transcript(self):
        messages = self._tool_tail()
        assert close_interrupted_tool_sequence(messages, None, origin=io.WS_ORPHAN_REAP) is True
        assert messages[-1]["role"] == "assistant"
        assert "connection" in messages[-1]["content"]

    def test_an_unattributed_close_is_unchanged(self):
        messages = self._tool_tail()
        close_interrupted_tool_sequence(messages, None)
        assert messages[-1]["content"] == "Operation interrupted."

    def test_real_assistant_text_always_wins_over_the_placeholder(self):
        """Attribution is a fallback for an empty turn, never a replacement for work the
        model actually produced before the stop."""
        messages = self._tool_tail()
        close_interrupted_tool_sequence(messages, "I found the bug in auth.py", origin=io.USER_STOP)
        assert messages[-1]["content"] == "I found the bug in auth.py"

    def test_a_non_tool_tail_is_still_left_alone(self):
        messages = [{"role": "assistant", "content": "done"}]
        assert close_interrupted_tool_sequence(messages, None, origin=io.USER_STOP) is False
        assert len(messages) == 1


# ── the settled turn result ──────────────────────────────────────────────────

class TestSettlement:
    """``abort_turn_on_interrupt`` is the path a mid-turn stop settles through.

    It reads the attribution BEFORE ``clear_interrupt``, which is the ordering that makes the
    whole feature work: clearing first would leave every settled turn reading as unknown.
    """

    @staticmethod
    def _agent_with_tool_tail():
        agent = _Agent()
        agent._persist_session = lambda *a, **k: None
        # The settle path announces the abort through the agent's own printer; a stub that
        # swallows it keeps this test about attribution rather than about display.
        agent._vprint = lambda *a, **k: None
        agent.log_prefix = ""
        return agent

    def test_the_result_names_the_stop_path(self):
        from agent.turn_recovery import abort_turn_on_interrupt

        agent = self._agent_with_tool_tail()
        agent.interrupt("stop", hard_cancel=True, origin=io.WS_ORPHAN_REAP)
        messages = [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
            {"role": "tool", "tool_call_id": "c1", "content": "partial"},
        ]

        result = abort_turn_on_interrupt(
            agent, messages, None, 3, abort_message="Aborting", interrupt_text="",
        )

        assert result["interrupted"] is True
        assert result["interrupt_origin"] == io.WS_ORPHAN_REAP
        assert "connection" in messages[-1]["content"]

    def test_an_unattributed_stop_settles_exactly_as_before(self):
        from agent.turn_recovery import abort_turn_on_interrupt

        agent = self._agent_with_tool_tail()
        agent.interrupt()
        messages = [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
            {"role": "tool", "tool_call_id": "c1", "content": "partial"},
        ]

        result = abort_turn_on_interrupt(
            agent, messages, None, 1, abort_message="Aborting", interrupt_text="",
        )

        assert result["interrupt_origin"] == io.UNKNOWN
        assert messages[-1]["content"] == "Operation interrupted."

    def test_the_attribution_is_read_before_the_clear_wipes_it(self):
        """Ordering regression guard: settle reads, THEN clears."""
        from agent.turn_recovery import abort_turn_on_interrupt

        agent = self._agent_with_tool_tail()
        agent.interrupt("stop", hard_cancel=True, origin=io.LIVENESS_WATCHDOG)

        result = abort_turn_on_interrupt(
            agent, [{"role": "user", "content": "go"}], None, 1,
            abort_message="Aborting", interrupt_text="",
        )

        assert result["interrupt_origin"] == io.LIVENESS_WATCHDOG
        assert agent._interrupt_requested is False, "the interrupt must still be cleared"
