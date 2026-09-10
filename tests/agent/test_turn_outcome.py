"""Tests for the post-turn outcome (``agent/turn_outcome.py``), S6 of
docs/design/herwork-workspace.md.

What matters most is what it declines to do: staging is silent on a surface
that does not dispatch, on a stopped turn, on a chat reply, and on a disabled
feature. What it does say is bounded (3 items, 140 chars), whole-or-nothing
from the model, and persisted on the turn's final assistant row.
"""

from __future__ import annotations

import types

import pytest

from agent.turn_outcome import (
    DISPLAY_METADATA_KEY,
    ITEM_LIMIT,
    MAX_ITEMS,
    OutcomeEvidence,
    TurnOutcome,
    build_outcome,
    cancel_turn_outcome,
    dispatch_turn_outcome,
    model_outcome,
    rules_outcome,
    stage_turn_outcome,
    validate_outcome,
)


class FakeTodos:
    def __init__(self, items):
        self._items = items

    def read(self):
        return [dict(item) for item in self._items]


class FakeDb:
    def __init__(self):
        self.writes = []

    def merge_latest_matching_message_display_metadata(self, session_id, *, role, content, patch):
        self.writes.append((session_id, role, content, patch))

        return True


class FakeAgent:
    def __init__(self, platform="desktop", dispatches=True, todos=()):
        self.platform = platform
        self.valid_tool_names = {"write_file", "patch", "terminal"}
        self._turn_outcome_evidence = None
        self._turn_outcome_dispatch = dispatches
        self._todo_store = FakeTodos(list(todos))
        self._session_db = FakeDb()
        self.session_id = "db-session-1"
        self.provider = "openai"
        self.model = "gpt"
        self.api_key = self.base_url = self.api_mode = None


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_enabled", lambda *a, **k: True)


@pytest.fixture(autouse=True)
def _rules_only(monkeypatch):
    """Rules run inline; the model path forks a thread. Model tests opt back in."""
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_use_model", lambda *a, **k: False)


def user(text):
    return {"role": "user", "content": text}


def call(name, args, call_id):
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [{"id": call_id, "function": {"name": name, "arguments": args}}],
    }


def result(text, call_id):
    return {"role": "tool", "content": text, "tool_call_id": call_id}


LONG = "y" * 400


def snapshot_with_two_errors():
    return [
        user("build the Q3 report"),
        call("write_file", {"path": "output/q3-report.docx", "content": "x"}, "c1"),
        result("ok", "c1"),
        call("terminal", {"command": "soffice --convert-to pdf"}, "c2"),
        result("Error: soffice: command not found", "c2"),
        call("patch", {"path": "output/totals.xlsx", "patch": "x"}, "c3"),
        result("Error: file is locked", "c3"),
        {"role": "assistant", "content": "The report is written; the PDF step failed."},
    ]


def collect():
    events = []

    def emit(event, sid, payload):
        events.append((event, sid, payload))

    return events, emit


def stage(agent=None, messages=None, final="The report is written; the PDF step failed.", **kw):
    agent = agent or FakeAgent(todos=[{"id": "t1", "content": "review the Arabic headings", "status": "pending"}])
    stage_turn_outcome(
        agent, messages_snapshot=messages or snapshot_with_two_errors(), final_response=final,
        interrupted=False, **kw)

    return agent


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------


def test_staging_names_both_errors_and_the_open_todo():
    agent = stage()
    evidence = agent._turn_outcome_evidence

    assert evidence is not None
    assert evidence.turn.failed_tools == ["terminal", "patch"]
    assert evidence.open_todos == ["review the Arabic headings"]

    outcome = rules_outcome(evidence)
    assert outcome.source == "rules"
    assert outcome.failed == ["terminal reported an error", "patch reported an error"]
    assert outcome.open == ["review the Arabic headings"]
    assert outcome.delivered == ["Edited 2 files: output/q3-report.docx, output/totals.xlsx"]


def test_a_tool_less_short_reply_yields_no_outcome():
    agent = stage(messages=[user("hi"), {"role": "assistant", "content": "hello"}], final="hello")

    assert agent._turn_outcome_evidence is None


def test_a_turn_ending_in_an_error_still_yields_one():
    agent = stage(messages=[user("do it"), {"role": "assistant", "content": "boom"}], final="boom", errored=True)

    assert agent._turn_outcome_evidence is not None
    assert rules_outcome(agent._turn_outcome_evidence).failed == ["The turn ended in an error"]


def test_a_long_tool_less_reply_is_work_and_gets_an_outcome():
    agent = stage(messages=[user("explain"), {"role": "assistant", "content": LONG}], final=LONG)

    assert agent._turn_outcome_evidence is not None


@pytest.mark.parametrize("agent", [FakeAgent(dispatches=False), FakeAgent(platform="cron"), FakeAgent(platform="subagent")])
def test_staging_is_a_no_op_without_the_dispatch_gate(agent):
    stage(agent)

    assert agent._turn_outcome_evidence is None


def test_staging_is_silent_when_interrupted():
    agent = FakeAgent()
    stage_turn_outcome(agent, messages_snapshot=snapshot_with_two_errors(), final_response="x", interrupted=True)

    assert agent._turn_outcome_evidence is None


def test_staging_is_silent_when_disabled(monkeypatch):
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_enabled", lambda *a, **k: False)

    assert stage()._turn_outcome_evidence is None


def test_finished_todos_are_not_open():
    agent = FakeAgent(todos=[
        {"id": "a", "content": "done thing", "status": "completed"},
        {"id": "b", "content": "half thing", "status": "in_progress"},
    ])
    stage(agent)

    assert agent._turn_outcome_evidence.open_todos == ["half thing"]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_model_output_off_shape_is_discarded():
    assert validate_outcome("nope", "model") is None
    assert validate_outcome({"delivered": "a string"}, "model") is None
    assert validate_outcome([], "model") is None


def test_lists_are_capped_and_items_clipped():
    outcome = validate_outcome(
        {"delivered": ["a", "b", "c", "d"], "failed": ["z" * 300], "open": [1, "", "  spaced   out  "]}, "model")

    assert outcome.delivered == ["a", "b", "c"]
    assert len(outcome.delivered) == MAX_ITEMS
    assert len(outcome.failed[0]) == ITEM_LIMIT
    assert outcome.failed[0].endswith("…")
    assert outcome.open == ["spaced out"]
    assert outcome.source == "model"


def test_model_failure_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_use_model", lambda *a, **k: True)

    def boom(**kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr("agent.auxiliary_client.call_llm", boom)
    agent = stage()

    outcome = build_outcome(agent, agent._turn_outcome_evidence)
    assert outcome.source == "rules"
    assert outcome.failed


def test_model_answer_in_shape_wins_and_carries_the_language(monkeypatch):
    monkeypatch.setattr("agent.turn_outcome.turn_outcome_use_model", lambda *a, **k: True)
    monkeypatch.setattr("agent.turn_outcome._outcome_config", lambda: {"language": "Arabic"})
    seen = {}

    def fake_call_llm(**kwargs):
        seen.update(kwargs)
        content = '{"delivered": ["تقرير الربع الثالث في output/"], "failed": [], "open": []}'

        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=content))])

    monkeypatch.setattr("agent.auxiliary_client.call_llm", fake_call_llm)
    agent = stage()

    outcome = model_outcome(agent._turn_outcome_evidence)
    assert outcome.source == "model"
    assert outcome.delivered == ["تقرير الربع الثالث في output/"]
    assert seen["task"] == "turn_outcome"
    assert "Arabic" in seen["messages"][0]["content"]


def test_turn_outcome_is_on_the_fast_lane_by_default():
    from agent.auxiliary_client import _FAST_MODEL_TASKS, _task_prefers_fast_model

    assert "turn_outcome" in _FAST_MODEL_TASKS
    assert _task_prefers_fast_model("turn_outcome") is True


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def test_dispatch_emits_one_scoped_event_with_the_client_turn_id_and_persists():
    agent = stage()
    events, emit = collect()

    dispatch_turn_outcome(agent, session_id="sess-1", status="complete", emit=emit, turn_id="user-171-abc")

    assert len(events) == 1
    event, sid, payload = events[0]
    assert event == "session.outcome"
    assert sid == "sess-1"
    assert payload["session_id"] == "sess-1"
    assert payload["turn_id"] == "user-171-abc"
    assert payload["outcome"]["source"] == "rules"
    assert payload["outcome"]["failed"] == ["terminal reported an error", "patch reported an error"]

    assert len(agent._session_db.writes) == 1
    db_session, role, content, patch = agent._session_db.writes[0]
    assert (db_session, role) == ("db-session-1", "assistant")
    assert content == "The report is written; the PDF step failed."
    assert patch[DISPLAY_METADATA_KEY]["turn_id"] == "user-171-abc"
    assert patch[DISPLAY_METADATA_KEY]["failed"] == payload["outcome"]["failed"]


def test_dispatch_consumes_the_evidence_once():
    agent = stage()
    events, emit = collect()

    dispatch_turn_outcome(agent, session_id="sess-1", status="complete", emit=emit)
    dispatch_turn_outcome(agent, session_id="sess-1", status="complete", emit=emit)

    assert len(events) == 1
    assert agent._turn_outcome_evidence is None


def test_an_errored_turn_still_dispatches():
    agent = stage()
    events, emit = collect()

    dispatch_turn_outcome(agent, session_id="sess-1", status="error", emit=emit)

    assert len(events) == 1


@pytest.mark.parametrize("over", [{"status": "interrupted"}, {"agent_continued": True}, {"session_id": ""}])
def test_dispatch_declines(over):
    agent = stage()
    events, emit = collect()
    kwargs = {"session_id": "sess-1", "status": "complete", "emit": emit}
    kwargs.update(over)

    dispatch_turn_outcome(agent, **kwargs)

    assert events == []


def test_a_new_turn_cancels_an_in_flight_outcome(monkeypatch):
    agent = stage()
    events, emit = collect()

    def build_then_new_turn(agent_, evidence):
        cancel_turn_outcome(agent_)

        return TurnOutcome(delivered=["late"], source="rules")

    monkeypatch.setattr("agent.turn_outcome.build_outcome", build_then_new_turn)
    dispatch_turn_outcome(agent, session_id="sess-1", status="complete", emit=emit)

    assert events == []
    assert agent._session_db.writes == []


def test_an_empty_outcome_emits_nothing():
    agent = FakeAgent()
    stage_turn_outcome(agent, messages_snapshot=[user("explain"), {"role": "assistant", "content": LONG}],
                       final_response=LONG, interrupted=False)
    events, emit = collect()

    dispatch_turn_outcome(agent, session_id="sess-1", status="complete", emit=emit)

    assert events == []


def test_evidence_todo_store_is_read_at_staging_time():
    evidence = OutcomeEvidence(turn=stage()._turn_outcome_evidence.turn, todos=[{"content": "x", "status": "pending"}])

    assert evidence.open_todos == ["x"]
