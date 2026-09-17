"""Where a mid-turn correction goes, and what the person is told about it.

Two defects are covered here.

The dead window: between the model request clearing and the tool batch starting, ``redirect()``
saw neither of its own flags and declined. Declining is right when the turn is over and wrong
when the loop is merely between phases — the same answer for two opposite situations — so a
correction typed at the wrong millisecond was demoted from "change this turn" to "run as a
separate turn afterwards", which reads as the message being ignored.

The silent park: ``redirect()`` asks tool workers to yield, but only the local terminal backend
can adopt a live host process, so on a container backend the request is accepted and dropped and
the correction waits for the whole command. Accepted-and-waiting and accepted-and-delivered
looked identical to the client. Now they do not.
"""

import threading

import pytest

from agent import interrupt_control as ic
from agent.interrupt_control import InterruptControlMixin
from tools import interrupt as interrupt_mod


class _Agent(InterruptControlMixin):
    """A real mixin over the exact attribute set ``redirect()`` reads."""

    quiet_mode = True
    api_mode = "chat_completions"

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
        self._model_request_active = threading.Event()
        self._turn_loop_active = threading.Event()
        self._executing_tools = False
        self._execution_thread_id = threading.current_thread().ident
        self._interrupt_thread_signal_pending = False
        self._tool_worker_threads = set()
        self._tool_worker_threads_lock = threading.Lock()
        self._active_children = []
        self._active_children_lock = threading.Lock()
        self._last_correction_delivery = None
        self.aborted = []

    def _active_request_abort(self, reason):
        self.aborted.append(reason)


@pytest.fixture
def agent():
    a = _Agent()
    yield a
    # The per-thread yield registry is process-global; leaking a request would make the next
    # test's wait release for no reason.
    interrupt_mod.consume_yield(a._execution_thread_id)


# ── the dead window ──────────────────────────────────────────────────────────

class TestDeadWindow:
    def test_a_correction_between_phases_waits_for_the_tool_boundary(self, agent):
        """Live loop, no model request, no tools: the window this test exists for."""
        agent._turn_loop_active.set()

        assert agent.redirect("use tabs, not spaces") is True
        assert agent._pending_steer == "use tabs, not spaces"
        assert agent._interrupt_requested is False, "a between-phases correction must not interrupt"
        assert agent.aborted == [], "nothing was in flight to abort"

    def test_a_correction_after_the_turn_ends_is_still_declined(self, agent):
        """The other half of the same branch: with no loop there is nothing to correct, and
        the caller must be told so it can queue a fresh turn rather than strand the text."""
        assert agent.redirect("too late") is False
        assert agent._pending_steer is None

    def test_between_phases_reports_a_tool_boundary_delivery(self, agent):
        agent._turn_loop_active.set()
        agent.redirect("wait for it")
        assert agent.last_correction_delivery() in (
            ic.DELIVERY_TOOL_BOUNDARY, ic.DELIVERY_TOOL_BLOCKED
        )

    def test_a_live_model_request_still_takes_the_cancel_path(self, agent):
        """The fix must not swallow the case redirect was built for."""
        agent._turn_loop_active.set()
        agent._model_request_active.set()

        assert agent.redirect("actually, use Postgres") is True
        assert agent._pending_redirect == "actually, use Postgres"
        assert agent._interrupt_requested is True
        assert agent.aborted == ["redirect_abort"]
        assert agent.last_correction_delivery() == ic.DELIVERY_MODEL_CANCELLED
        assert agent._pending_steer is None, "a cancellable request is redirected, not steered"

    def test_tool_execution_still_takes_the_steer_and_yield_path(self, agent):
        agent._turn_loop_active.set()
        agent._executing_tools = True

        assert agent.redirect("stop that build") is True
        assert agent._pending_steer == "stop that build"
        assert agent._interrupt_requested is False
        assert interrupt_mod.is_thread_yield_requested(agent._execution_thread_id) is False, (
            "no worker was registered, so no yield should have been aimed anywhere"
        )

    def test_the_yield_is_aimed_at_every_registered_worker(self, agent):
        agent._turn_loop_active.set()
        agent._executing_tools = True
        worker = 999_001
        agent._tool_worker_threads.add(worker)
        try:
            agent.redirect("change of plan")
            assert interrupt_mod.is_thread_yield_requested(worker) is True
        finally:
            interrupt_mod.consume_yield(worker)

    def test_empty_text_is_rejected_before_anything_is_touched(self, agent):
        agent._turn_loop_active.set()
        assert agent.redirect("   ") is False
        assert agent._pending_steer is None
        assert agent.last_correction_delivery() is None

    def test_a_second_correction_merges_rather_than_replacing(self, agent):
        """Two fast corrections are two things the person wants; losing one is losing intent."""
        agent._turn_loop_active.set()
        agent._model_request_active.set()
        agent.redirect("use Postgres")
        agent.redirect("and add an index")
        assert "use Postgres" in agent._pending_redirect
        assert "and add an index" in agent._pending_redirect

    def test_an_agent_without_the_flag_keeps_the_old_decline(self, agent):
        """Third-party agents and old doubles have no ``_turn_loop_active``; they must keep
        the pre-change behavior rather than crash or silently steer into nothing."""
        del agent._turn_loop_active
        assert agent.redirect("anything") is False


# ── honest delivery reporting ────────────────────────────────────────────────

class TestDeliveryReporting:
    def test_a_yieldable_wait_reports_a_prompt_boundary(self, agent):
        agent._turn_loop_active.set()
        agent._executing_tools = True
        with interrupt_mod.yieldable_wait(agent._execution_thread_id):
            agent.redirect("hurry up")
        assert agent.last_correction_delivery() == ic.DELIVERY_TOOL_BOUNDARY

    def test_a_backend_that_cannot_yield_reports_blocked(self, agent):
        """A container backend has no adoptable host process. The correction is still accepted
        and still arrives, but it waits — and saying so is the whole point."""
        agent._turn_loop_active.set()
        agent._executing_tools = True
        agent.redirect("hurry up")
        assert agent.last_correction_delivery() == ic.DELIVERY_TOOL_BLOCKED

    def test_delivery_is_only_recorded_for_accepted_corrections(self, agent):
        agent.redirect("no live turn")
        assert agent.last_correction_delivery() is None

    def test_an_agent_without_the_slot_reports_nothing(self):
        class _Bare(InterruptControlMixin):
            pass

        assert _Bare().last_correction_delivery() is None


# ── the yield registry itself ────────────────────────────────────────────────

class TestYieldRegistry:
    def test_a_wait_publishes_and_retracts_its_yieldability(self):
        tid = threading.current_thread().ident
        assert interrupt_mod.any_thread_yieldable([tid]) is False
        with interrupt_mod.yieldable_wait(tid):
            assert interrupt_mod.any_thread_yieldable([tid]) is True
        assert interrupt_mod.any_thread_yieldable([tid]) is False

    def test_an_unconsumed_request_dies_with_the_wait_it_was_aimed_at(self):
        """Latent bug: a yield nobody consumed used to sit on the thread and release the NEXT,
        unrelated command — a wait ending early for a message sent minutes earlier."""
        tid = threading.current_thread().ident
        with interrupt_mod.yieldable_wait(tid):
            interrupt_mod.request_yield(tid)
        assert interrupt_mod.is_thread_yield_requested(tid) is False

    def test_entering_a_wait_clears_a_stale_request(self):
        tid = threading.current_thread().ident
        interrupt_mod.request_yield(tid)
        try:
            with interrupt_mod.yieldable_wait(tid):
                assert interrupt_mod.is_thread_yield_requested(tid) is False
        finally:
            interrupt_mod.consume_yield(tid)

    def test_the_scope_is_retracted_even_when_the_wait_raises(self):
        tid = threading.current_thread().ident
        with pytest.raises(RuntimeError):
            with interrupt_mod.yieldable_wait(tid):
                raise RuntimeError("command blew up")
        assert interrupt_mod.any_thread_yieldable([tid]) is False

    def test_any_thread_yieldable_ignores_none_and_empty(self):
        assert interrupt_mod.any_thread_yieldable([]) is False
        assert interrupt_mod.any_thread_yieldable([None, None]) is False

    def test_one_yieldable_worker_is_enough(self):
        tid = threading.current_thread().ident
        with interrupt_mod.yieldable_wait(tid):
            assert interrupt_mod.any_thread_yieldable([123_456, None, tid]) is True

    def test_clearing_the_interrupt_also_clears_yieldability(self):
        """A thread whose interrupt was cleared is no longer inside the wait we marked."""
        tid = threading.current_thread().ident
        with interrupt_mod.yieldable_wait(tid):
            interrupt_mod.set_interrupt(False, tid)
            assert interrupt_mod.any_thread_yieldable([tid]) is False
