"""The gateway's two stop paths must be distinguishable in the settled turn.

``_interrupt_session_turn`` is shared by ``session.interrupt`` (a person pressing Stop) and by
the WS orphan reaper (the client's socket went away mid-turn). Before attribution both settled
as the same unexplained ``Operation interrupted.``, which is what made "I sent a message and the
turn died" impossible to triage: the reaper's signature and a mis-hit Stop were the same string.
"""

import types

from agent import interrupt_origin as io
from tui_gateway import session_lifecycle


class _Agent:
    """Records what attribution reached ``hard_interrupt``.

    Declares ``origin`` explicitly because the compat shim only forwards keywords a callable
    actually accepts — a stand-in with ``**kwargs`` would pass even if the shim stopped
    forwarding, which is the regression most worth catching here.
    """

    def __init__(self):
        self.origins = []

    def hard_interrupt(self, message=None, *, tool_reason=None, origin=None):
        self.origins.append(origin)


def _session(agent):
    return {
        "_run_thread": None,
        "agent": agent,
        "history_lock": __import__("threading").RLock(),
        "running": True,
        "session_key": "k",
    }


def _patch_collaborators(monkeypatch):
    """Silence the parts of the interrupt contract this test is not about."""
    monkeypatch.setattr(session_lifecycle, "_session_uses_compute_host", lambda s: False, raising=False)
    monkeypatch.setattr(session_lifecycle, "_clear_pending", lambda sid: None, raising=False)
    monkeypatch.setattr(session_lifecycle, "_clear_inflight_turn", lambda s: None, raising=False)


def test_a_user_stop_is_attributed_to_the_user(monkeypatch):
    _patch_collaborators(monkeypatch)
    agent = _Agent()

    session_lifecycle._interrupt_session_turn("sid", _session(agent))

    assert agent.origins == [io.USER_STOP]


def test_the_reaper_says_the_connection_went_away(monkeypatch):
    """The exact case the triage could not name: the turn died because the socket did."""
    _patch_collaborators(monkeypatch)
    agent = _Agent()

    session_lifecycle._interrupt_session_turn("sid", _session(agent), origin=io.WS_ORPHAN_REAP)

    assert agent.origins == [io.WS_ORPHAN_REAP]


def test_the_two_paths_do_not_settle_alike(monkeypatch):
    """The property that makes attribution worth having at all."""
    _patch_collaborators(monkeypatch)
    stopped, reaped = _Agent(), _Agent()

    session_lifecycle._interrupt_session_turn("sid", _session(stopped))
    session_lifecycle._interrupt_session_turn("sid", _session(reaped), origin=io.WS_ORPHAN_REAP)

    assert io.interrupt_placeholder(stopped.origins[0]) != io.interrupt_placeholder(reaped.origins[0])
    assert "connection" in io.interrupt_placeholder(reaped.origins[0])


def test_an_agent_that_predates_attribution_is_still_interrupted(monkeypatch):
    """A third-party agent must be stopped, not crashed, by the extra keyword."""
    _patch_collaborators(monkeypatch)
    calls = []
    agent = types.SimpleNamespace(interrupt=lambda message=None: calls.append(message))

    session_lifecycle._interrupt_session_turn("sid", _session(agent), origin=io.WS_ORPHAN_REAP)

    assert len(calls) == 1


def test_an_idle_session_is_not_interrupted_at_all(monkeypatch):
    """Attribution must not have turned the ``running`` guard into a no-op."""
    _patch_collaborators(monkeypatch)
    agent = _Agent()
    session = _session(agent)
    session["running"] = False

    session_lifecycle._interrupt_session_turn("sid", session)

    assert agent.origins == []


# ── the soft-interrupt shim ──────────────────────────────────────────────────

class TestSoftInterruptCompat:
    """``request_interrupt`` forwards ``origin`` only where it is accepted.

    The gateway's busy paths call the soft interrupt from inside broad ``except`` blocks, so a
    ``TypeError`` from an unknown keyword would not surface as a bug: it would silently skip the
    interrupt and leave running the very turn the user asked to replace. The same defect took
    three lease tests down when attribution first landed, which is why it is pinned here.
    """

    @staticmethod
    def _legacy():
        calls = []

        class _Legacy:
            def interrupt(self, message=None):
                calls.append(message)

        return _Legacy(), calls

    @staticmethod
    def _modern():
        calls = []

        class _Modern:
            def interrupt(self, message=None, *, origin=None):
                calls.append((message, origin))

        return _Modern(), calls

    def test_a_legacy_agent_is_still_interrupted(self):
        from agent.interrupt_compat import request_interrupt

        agent, calls = self._legacy()

        assert request_interrupt(agent, "follow up", origin=io.USER_MESSAGE) is True
        assert calls == ["follow up"]

    def test_a_modern_agent_receives_the_attribution(self):
        from agent.interrupt_compat import request_interrupt

        agent, calls = self._modern()

        assert request_interrupt(agent, "follow up", origin=io.USER_MESSAGE) is True
        assert calls == [("follow up", io.USER_MESSAGE)]

    def test_an_agent_with_no_interrupt_reports_failure_rather_than_raising(self):
        from agent.interrupt_compat import request_interrupt

        assert request_interrupt(types.SimpleNamespace(), "x", origin=io.USER_MESSAGE) is False

    def test_no_origin_means_no_keyword_at_all(self):
        """A caller that states no origin must produce the pre-attribution call exactly."""
        from agent.interrupt_compat import request_interrupt

        agent, calls = self._modern()
        request_interrupt(agent, "plain")

        assert calls == [("plain", None)]

