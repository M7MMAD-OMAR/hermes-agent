"""`session.outcome` at the gateway seam (S6 of docs/design/herwork-workspace.md).

Three contracts:

* The event fires AFTER ``message.complete``, never before, and carries the
  client turn id the desktop sent with ``prompt.submit``; a synthesized
  (agent-initiated) turn carries none and dispatches nothing.
* The outcome is written into the final assistant row's ``display_metadata``
  and comes back with the history projection the desktop rehydrates from.
* The pending client turn id is consumed by the turn that runs, so a later
  queued drain never inherits it.
"""

from __future__ import annotations

import threading
import types

import pytest

from agent.turn_outcome import DISPLAY_METADATA_KEY, OutcomeEvidence, TurnOutcome
from agent.next_moves import TurnEvidence
from tui_gateway import server


class _InlineThread:
    def __init__(self, target=None, daemon=None, args=(), kwargs=None, name=None):
        self._target, self._args, self._kwargs = target, args, kwargs or {}

    def start(self):
        if self._target is not None:
            self._target(*self._args, **self._kwargs)

    def is_alive(self):
        return False

    def join(self, timeout=None):
        return None


def _session(agent, **extra):
    return {
        "agent": agent,
        "session_key": "gw-session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": True,
        "attached_images": [],
        "image_counter": 0,
        "cols": 80,
        "slash_worker": None,
        "show_reasoning": False,
        "tool_progress_mode": "all",
        "inflight_turn": None,
        **extra,
    }


def _agent(final="The report is written."):
    agent = types.SimpleNamespace(session_id="agent-sid-1", clear_interrupt=lambda: None, _session_db=None)

    def run_conversation(*a, **k):
        # What finalize_turn's staging leaves behind, minus finalize_turn itself.
        agent._turn_outcome_evidence = OutcomeEvidence(
            turn=TurnEvidence(final_response=final, tool_calls=[("terminal", {})], failed_tools=["terminal"]))

        return {"final_response": final}

    agent.run_conversation = run_conversation

    return agent


@pytest.fixture()
def turn_env(monkeypatch, tmp_path):
    events = []
    monkeypatch.setattr(server.threading, "Thread", _InlineThread)
    monkeypatch.setattr(server, "_emit", lambda event, sid=None, payload=None, **k: events.append((event, sid, payload)))
    monkeypatch.setattr(server, "_wire_callbacks", lambda sid: None)
    monkeypatch.setattr(server, "_sync_agent_model_with_config", lambda sid, session: None)
    monkeypatch.setattr(server, "_session_cwd", lambda session: str(tmp_path))
    monkeypatch.setattr(server, "_register_session_cwd", lambda session: None)
    monkeypatch.setattr(server, "_tts_stream_begin", lambda: None)
    monkeypatch.setattr(server, "_sync_session_key_after_compress", lambda *a, **k: None)
    monkeypatch.setattr(server, "_get_usage", lambda agent: {})
    # Rules only, so dispatch runs inline and the event list is complete on return.
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_use_model", lambda *a, **k: False)
    monkeypatch.setattr("agent.next_moves.next_moves_enabled", lambda *a, **k: False)

    return events


def test_outcome_fires_after_message_complete_with_the_client_turn_id(turn_env):
    events = turn_env
    session = _session(_agent(), _pending_client_turn_id="user-1700-ab12")

    server._run_prompt_submit("rid", "ui-sid", session, "build it")

    names = [event for event, _sid, _payload in events]
    assert "message.complete" in names and "session.outcome" in names
    assert names.index("session.outcome") > names.index("message.complete")

    outcome = next(payload for event, _sid, payload in events if event == "session.outcome")
    assert outcome["turn_id"] == "user-1700-ab12"
    assert outcome["session_id"] == "ui-sid"
    assert outcome["outcome"]["failed"] == ["terminal reported an error"]
    assert outcome["outcome"]["source"] == "rules"
    # Consumed: nothing left for a later drain to inherit.
    assert "_pending_client_turn_id" not in session


def test_an_agent_continuation_dispatches_no_outcome(turn_env):
    events = turn_env
    session = _session(_agent(), _pending_client_turn_id="user-1700-ab12")

    server._run_prompt_submit("rid", "ui-sid", session, "continue", initiator="agent")

    assert "message.complete" in [event for event, _s, _p in events]
    assert "session.outcome" not in [event for event, _s, _p in events]
    assert session["_turn_client_id"] == ""
    assert "_pending_client_turn_id" not in session


def test_a_turn_without_a_client_id_still_dispatches_with_an_empty_id(turn_env):
    events = turn_env
    session = _session(_agent())

    server._run_prompt_submit("rid", "ui-sid", session, "build it")

    outcome = next(payload for event, _sid, payload in events if event == "session.outcome")
    assert outcome["turn_id"] == ""


def test_outcome_is_persisted_on_the_final_assistant_row_and_projected_with_history(tmp_path):
    from hermes_state import SessionDB

    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session("s1", source="desktop")
        db.append_message("s1", "user", "build the report")
        db.append_message("s1", "assistant", "The report is written.")

        payload = {**TurnOutcome(delivered=["q3-report.docx in output/"], source="model").as_dict(),
                   "turn_id": "user-1"}
        assert db.merge_latest_matching_message_display_metadata(
            "s1", role="assistant", content="The report is written.", patch={DISPLAY_METADATA_KEY: payload})

        rows = db.get_messages_as_conversation("s1")
        assert rows[-1]["display_metadata"][DISPLAY_METADATA_KEY] == payload
        # display_kind untouched: the row is still an ordinary reply.
        assert not rows[-1].get("display_kind")

        # Merge, not replace: a second producer's key survives.
        assert db.merge_latest_matching_message_display_metadata(
            "s1", role="assistant", content="The report is written.", patch={"other": 1})
        meta = db.get_messages_as_conversation("s1")[-1]["display_metadata"]
        assert meta[DISPLAY_METADATA_KEY] == payload and meta["other"] == 1

        projected = server._history_to_messages(rows)
        assert projected[-1]["role"] == "assistant"
        assert projected[-1]["display_metadata"][DISPLAY_METADATA_KEY] == payload

        # No matching row: a no-op, not an error.
        assert not db.merge_latest_matching_message_display_metadata(
            "s1", role="assistant", content="never said", patch={"x": 1})
    finally:
        db.close()
