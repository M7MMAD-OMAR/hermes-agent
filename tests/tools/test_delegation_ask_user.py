"""A thread asking the person a question, and the guarantees around it.

This is the one phase of the Threads work that loosens a safety boundary: a
delegated child installs a NON-interactive approval callback on purpose, and
turning that into a blocking request for a human is the operator's decision,
not the agent's. So the tests that matter are not "does it ask" but:

1. **The default is unchanged.** With the flag off, the callback is the same
   object that shipped before, not a wrapper that happens to behave the same.
2. **A thread can never wedge.** Every path out is the auto policy, arriving
   late at worst. No exception, no timeout and no broken transport can leave a
   child waiting forever.
3. **Unattended runs never block.** No owner to ask means fall through now,
   not in ten minutes.
"""

import pytest

from tools.delegate_tool_config import _get_subagent_approval_callback, _subagent_auto_approve, _subagent_auto_deny
from tools.delegation_ask_user import (
    DEFAULT_ASK_TIMEOUT_SECONDS,
    ask_timeout_seconds,
    ask_user_enabled,
    build_ask_callback,
    can_ask,
)


def deny(command, description, **kwargs):
    return "deny"


def approve(command, description, **kwargs):
    return "once"


@pytest.fixture
def owner_can_be_asked(monkeypatch):
    """A session that can actually be shown a prompt.

    `can_ask` requires a registered notify callback, because blocking on a
    session nobody is listening to would wait out the whole timeout for
    nothing. The tests that exercise asking have to supply one.
    """
    import tools.approval as approval
    import gateway.session_context as ctx

    monkeypatch.setattr(ctx, "async_delivery_supported", lambda: True)
    monkeypatch.setitem(approval._gateway_notify_cbs, "owner-1", lambda payload: None)

    return "owner-1"


class TestDefaultIsUnchanged:
    def test_the_flag_is_off_by_default(self):
        assert ask_user_enabled({}) is False

    def test_the_callback_is_the_same_auto_policy_object(self, monkeypatch):
        """Not "behaves the same": the SAME function. A wrapper around the
        default path is a new code path in production for no reason."""
        import tools.delegate_tool_config as config

        monkeypatch.setattr(config, "_cfg", lambda: {})
        assert _get_subagent_approval_callback() is _subagent_auto_deny

        monkeypatch.setattr(config, "_cfg", lambda: {"subagent_auto_approve": True})
        assert _get_subagent_approval_callback() is _subagent_auto_approve

    def test_turning_it_on_wraps_rather_than_replaces_the_policy(self, monkeypatch):
        import tools.delegate_tool_config as config

        monkeypatch.setattr(config, "_cfg", lambda: {"subagent_ask_user": True})
        callback = _get_subagent_approval_callback("owner-1")

        assert callback is not _subagent_auto_deny
        assert callable(callback)


class TestUnattendedRunsNeverBlock:
    def test_no_owner_means_nobody_to_ask(self):
        assert can_ask("") is False
        assert can_ask(None) is False

    def test_a_child_with_no_owner_falls_through_to_the_policy(self):
        callback = build_ask_callback("", deny)

        assert callback("rm -rf /", "dangerous") == "deny"

    def test_a_session_nobody_is_listening_to_is_not_asked(self, monkeypatch):
        """No registered prompt surface means blocking would wait out the whole
        timeout for a question nobody can see."""
        import gateway.session_context as ctx

        monkeypatch.setattr(ctx, "async_delivery_supported", lambda: True)

        assert can_ask("nobody-home") is False

    def test_a_session_that_cannot_deliver_does_not_wait(self, monkeypatch):
        """Same rule detached results already follow: a stateless channel or a
        one-shot worker has no one to come back to."""
        import gateway.session_context as ctx

        monkeypatch.setattr(ctx, "async_delivery_supported", lambda: False)

        assert can_ask("owner-1") is False


class TestAThreadCanNeverWedge:
    def test_a_zero_timeout_falls_straight_through(self):
        callback = build_ask_callback("owner-1", deny, timeout_seconds=0)

        assert callback("rm -rf /", "dangerous") == "deny"

    def test_an_unanswered_question_uses_the_auto_policy(self, monkeypatch, owner_can_be_asked):
        import tools.approval_gateway_wait as wait

        monkeypatch.setattr(wait, "_await_gateway_decision", lambda *a, **k: {"resolved": False, "reason": "timeout"})

        assert build_ask_callback("owner-1", deny, timeout_seconds=5)("cmd", "d") == "deny"

    def test_an_exploding_approval_path_uses_the_auto_policy(self, monkeypatch, owner_can_be_asked):
        """Asking must never be able to fail the child."""
        import tools.approval_gateway_wait as wait

        def _boom(*args, **kwargs):
            raise RuntimeError("the gateway is gone")

        monkeypatch.setattr(wait, "_await_gateway_decision", _boom)

        assert build_ask_callback("owner-1", approve, timeout_seconds=5)("cmd", "d") == "once"

    def test_the_fallback_is_whichever_policy_is_configured(self, monkeypatch, owner_can_be_asked):
        import tools.approval_gateway_wait as wait

        monkeypatch.setattr(wait, "_await_gateway_decision", lambda *a, **k: {"resolved": False})

        assert build_ask_callback("owner-1", approve, timeout_seconds=5)("cmd", "d") == "once"
        assert build_ask_callback("owner-1", deny, timeout_seconds=5)("cmd", "d") == "deny"

    def test_the_timeout_is_clamped_below_an_hour(self):
        assert ask_timeout_seconds({"subagent_ask_timeout_seconds": 99_999}) == 3600.0

    def test_a_nonsense_timeout_uses_the_default(self):
        assert ask_timeout_seconds({"subagent_ask_timeout_seconds": "soon"}) == float(DEFAULT_ASK_TIMEOUT_SECONDS)

    def test_a_negative_timeout_is_treated_as_no_waiting(self):
        assert ask_timeout_seconds({"subagent_ask_timeout_seconds": -5}) == 0.0


class TestTheAnswerIsHonoured:
    @pytest.mark.parametrize("choice", ["once", "session", "always", "deny"])
    def test_a_resolved_answer_is_returned_verbatim(self, monkeypatch, owner_can_be_asked, choice):
        import tools.approval_gateway_wait as wait

        monkeypatch.setattr(wait, "_await_gateway_decision", lambda *a, **k: {"resolved": True, "choice": choice})

        assert build_ask_callback("owner-1", deny, timeout_seconds=5)("cmd", "d") == choice

    def test_the_question_names_the_thread_asking_it(self, monkeypatch, owner_can_be_asked):
        """An approval popup that does not say WHICH background worker is
        asking cannot be answered."""
        import tools.approval_gateway_wait as wait

        seen = {}

        def _capture(session_key, notify, data, **kwargs):
            seen.update(data)
            seen["surface"] = kwargs.get("surface")

            return {"resolved": True, "choice": "once"}

        monkeypatch.setattr(wait, "_await_gateway_decision", _capture)
        build_ask_callback("owner-1", deny, timeout_seconds=5, thread_label="Trace the lineage")("cmd", "wipe it")

        assert "Trace the lineage" in seen["description"]
        assert seen["surface"] == "thread"


class TestOwnerResolution:
    def test_an_unknown_child_has_no_owner(self):
        from tools.delegate_tool_child_run import _owner_session_key_for

        assert _owner_session_key_for(None) == ""
        assert _owner_session_key_for("nope") == ""

    def test_the_owner_comes_from_the_live_registry(self, monkeypatch):
        import tools.delegate_tool_registry as registry
        from tools.delegate_tool_child_run import _owner_session_key_for

        monkeypatch.setitem(registry._active_subagents, "sa-1", {"owner_session_id": "coord-1"})
        try:
            assert _owner_session_key_for("sa-1") == "coord-1"
        finally:
            registry._active_subagents.pop("sa-1", None)
