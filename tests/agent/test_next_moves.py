"""Tests for post-turn next moves (``agent/next_moves.py``).

The feature runs on every turn of every surface, so most of what matters here
is what it declines to do. The invariants:

* staging is silent on a surface with no strip, an interrupted or empty turn,
  a trivial turn, and a disabled feature — and it never touches the model;
* evidence describes THIS turn, not the conversation;
* the local rules answer with at most one move, or with nothing;
* an untrusted move list is accepted whole or not at all — never partially;
* dispatch emits nothing for an errored, billing-blocked or agent-continued
  turn, and consumes the staged evidence exactly once.
"""

import pytest

from agent.next_moves import (
    MAX_MOVES,
    NextMove,
    TurnEvidence,
    build_moves,
    cancel_next_moves,
    model_moves,
    dispatch_next_moves,
    extract_evidence,
    heuristic_moves,
    stage_next_moves,
    validate_moves,
)


class FakeAgent:
    def __init__(self, platform="desktop", tools=("write_file", "patch"), dispatches=True):
        self.platform = platform
        self.valid_tool_names = set(tools)
        self._next_moves_evidence = None
        # Set by the gateway on the agent it owns; every other surface shares
        # the same finalizer and must not stage.
        self._next_moves_dispatch = dispatches


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    """The shipped default is off; every test here is about what happens on."""
    monkeypatch.setattr("agent.next_moves.next_moves_enabled", lambda *a, **k: True)


@pytest.fixture(autouse=True)
def _rules_only(monkeypatch):
    """Default test world is the local rules: synchronous, and no provider.

    With the model on, dispatch forks a daemon thread, so a test asserting on
    the emitted events would be reading them before the worker wrote them. The
    model tests below opt back in explicitly.
    """
    monkeypatch.setattr("agent.next_moves.next_moves_use_model", lambda *a, **k: False)


@pytest.fixture(autouse=True)
def _no_skill_index(monkeypatch):
    """Skills come from the agent's own system prompt, which a fake has none of."""
    monkeypatch.setattr("agent.next_moves._skill_names", lambda agent: [])


def user(text):
    return {"role": "user", "content": text}


def assistant_call(name, args=None, call_id="c1"):
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [{"id": call_id, "function": {"name": name, "arguments": args or {}}}],
    }


def tool_result(text, call_id="c1", name=""):
    return {"role": "tool", "content": text, "tool_call_id": call_id, "name": name}


LONG = "x" * 400


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------


def test_evidence_covers_only_the_last_turn():
    messages = [
        user("first question"),
        assistant_call("write_file", {"path": "old.py"}),
        user("second question"),
        assistant_call("patch", {"path": "new.py"}, call_id="c2"),
    ]

    evidence = extract_evidence(FakeAgent(), messages, "done")

    assert evidence.user_message == "second question"
    assert evidence.edited_files == ["new.py"]
    assert [name for name, _ in evidence.tool_calls] == ["patch"]


def test_evidence_records_a_failed_tool():
    messages = [
        user("run it"),
        assistant_call("run_command", {"command": "make build"}),
        tool_result("Error: command not found: make"),
    ]

    assert extract_evidence(FakeAgent(), messages, "done").failed_tools == ["run_command"]


def test_a_tool_reporting_its_own_semantics_is_not_a_failure():
    # The narrow matcher earns its keep here: "no matches found" is a result,
    # not a broken step, and a retry pill for it is worse than no pill.
    messages = [
        user("find it"),
        assistant_call("grep", {"query": "nothing"}),
        tool_result("No matches found for 'nothing'."),
    ]

    assert extract_evidence(FakeAgent(), messages, "done").failed_tools == []


def test_ran_tests_reads_the_command_not_the_tool_name():
    messages = [
        user("check"),
        assistant_call("run_command", {"command": "npx vitest run src/store"}),
    ]

    assert extract_evidence(FakeAgent(), messages, "done").ran_tests is True


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------


def test_a_failed_step_outranks_everything_else():
    evidence = TurnEvidence(failed_tools=["run_command"], edited_files=["a.py"])
    moves = heuristic_moves(evidence)

    assert len(moves) == 1
    assert moves[0].kind == "action"
    assert "run_command" in moves[0].label


def test_edits_without_a_test_run_offer_the_tests():
    moves = heuristic_moves(TurnEvidence(edited_files=["a.py"]))

    assert [m.label for m in moves] == ["Run the tests"]
    # Never names a runner: the agent knows the project's and a wrong command
    # is worse than a prompt.
    assert "pytest" not in moves[0].payload and "npm" not in moves[0].payload


def test_edits_with_a_test_run_offer_nothing():
    evidence = TurnEvidence(edited_files=["a.py"], tool_calls=[("run_command", {"command": "pytest -q"})])

    assert heuristic_moves(evidence) == []


def test_a_named_installed_skill_is_offered_once():
    evidence = TurnEvidence(user_message="can you do a security review of this", skills=["security-review", "docx"])

    assert heuristic_moves(evidence) == []

    evidence.user_message = "run the docx skill on it"
    moves = heuristic_moves(evidence)

    assert [(m.kind, m.payload) for m in moves] == [("skill", "/docx ")]


def test_a_skill_the_turn_already_used_is_not_offered():
    evidence = TurnEvidence(
        user_message="use docx",
        skills=["docx"],
        tool_calls=[("docx", {})],
    )

    assert heuristic_moves(evidence) == []


def test_a_skill_name_inside_a_longer_word_does_not_match():
    # "already" contains "read". A skill named `read` must not match it.
    evidence = TurnEvidence(user_message="i already finished that", skills=["read"])

    assert heuristic_moves(evidence) == []


def test_nothing_to_say_says_nothing():
    assert heuristic_moves(TurnEvidence(user_message="thanks")) == []


# ---------------------------------------------------------------------------
# Untrusted payloads
# ---------------------------------------------------------------------------


def good(**over):
    move = {"kind": "followup", "label": "Do the thing", "payload": "Do the thing.", "tip": "because"}
    move.update(over)

    return move


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "not a list",
        [],
        [good(kind="explode")],
        [good(label="")],
        [good(payload="   ")],
        ["not a mapping", good()],
        [good(payload="x" * 500)],
    ],
)
def test_a_malformed_pack_yields_nothing_not_a_partial_strip(raw):
    assert validate_moves(raw) == []


def test_only_the_first_move_is_read():
    # The composer paints one ghost, so one is what crosses the wire. A model
    # that answers with a shortlist gets its own top pick used.
    moves = validate_moves([good(label=f"Move {i}") for i in range(20)])

    assert [m.label for m in moves] == ["Move 0"]
    assert len(moves) == MAX_MOVES


def test_labels_are_clipped_at_the_producer():
    moves = validate_moves([good(label="y" * 200)])

    assert len(moves[0].label) <= 48


# ---------------------------------------------------------------------------
# Staging gates
# ---------------------------------------------------------------------------


def stage(agent=None, **over):
    agent = agent or FakeAgent()
    kwargs = {
        "messages_snapshot": [user("do it"), assistant_call("patch", {"path": "a.py"})],
        "final_response": LONG,
        "interrupted": False,
    }
    kwargs.update(over)
    stage_next_moves(agent, **kwargs)

    return agent


def test_staging_parks_evidence_for_a_real_turn():
    agent = stage()

    assert agent._next_moves_evidence is not None
    assert agent._next_moves_evidence.edited_files == ["a.py"]


@pytest.mark.parametrize(
    "over",
    [
        {"interrupted": True},
        {"final_response": ""},
        # Trivial: no tools and a short answer.
        {"messages_snapshot": [user("hi")], "final_response": "hello"},
    ],
)
def test_staging_declines_a_turn_with_nothing_in_it(over):
    assert stage(**over)._next_moves_evidence is None


@pytest.mark.parametrize("platform", ["cron", "subagent", "CRON"])
def test_staging_skips_surfaces_with_no_strip(platform):
    # Without this every delegated child stages a snapshot nobody reads.
    assert stage(FakeAgent(platform=platform))._next_moves_evidence is None


def test_staging_skips_a_surface_that_cannot_dispatch():
    # CLI, ACP, messaging and cron all run the same finalize_turn. Only the
    # gateway that owns the dispatcher arms this.
    assert stage(FakeAgent(dispatches=False))._next_moves_evidence is None


def test_the_skill_index_is_not_read_for_a_turn_that_is_thrown_away(monkeypatch):
    # Reading it rebuilds the agent's whole system prompt. A trivial turn must
    # never pay that.
    calls = []
    monkeypatch.setattr("agent.next_moves._skill_names", lambda agent: calls.append(1) or [])

    stage(messages_snapshot=[user("hi")], final_response="hello")

    assert calls == []

    stage()

    assert calls == [1]


def test_staging_respects_the_feature_switch(monkeypatch):
    monkeypatch.setattr("agent.next_moves.next_moves_enabled", lambda *a, **k: False)

    assert stage()._next_moves_evidence is None


def test_staging_clears_a_previous_turns_evidence():
    agent = stage()
    stage(agent, interrupted=True)

    assert agent._next_moves_evidence is None


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def collect():
    events = []

    return events, lambda event, sid, payload: events.append((event, sid, payload))


def test_dispatch_emits_one_scoped_offer():
    agent = stage()
    agent._next_moves_evidence.turn_id = "turn-9"
    events, emit = collect()

    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)

    assert len(events) == 1
    event, sid, payload = events[0]
    assert event == "next_moves.offer"
    assert sid == "sess-1"
    assert payload["session_id"] == "sess-1"
    assert payload["turn_id"] == "turn-9"
    assert payload["source"] == "heuristic"
    assert len(payload["moves"]) == 1


def test_dispatch_consumes_the_evidence_exactly_once():
    agent = stage()
    events, emit = collect()

    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)
    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)

    assert len(events) == 1
    assert agent._next_moves_evidence is None


@pytest.mark.parametrize(
    "over",
    [
        {"status": "error"},
        {"status": "interrupted"},
        {"billing_blocked": True},
        {"agent_continued": True},
        {"session_id": ""},
    ],
)
def test_dispatch_declines(over):
    agent = stage()
    events, emit = collect()
    kwargs = {"session_id": "sess-1", "status": "complete", "emit": emit}
    kwargs.update(over)

    dispatch_next_moves(agent, **kwargs)

    assert events == []


def test_dispatch_without_staged_evidence_is_silent():
    events, emit = collect()

    dispatch_next_moves(FakeAgent(), session_id="sess-1", status="complete", emit=emit)

    assert events == []


def test_an_empty_result_emits_no_event_at_all(monkeypatch):
    # No empty strip, no event on the wire — same terminal shape as the titler.
    monkeypatch.setattr("agent.next_moves.build_moves", lambda agent, evidence: ([], "heuristic"))
    agent = stage()
    events, emit = collect()

    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)

    assert events == []


def test_a_generator_that_raises_never_reaches_the_wire(monkeypatch):
    def boom(agent, evidence):
        raise RuntimeError("no")

    monkeypatch.setattr("agent.next_moves.build_moves", boom)
    agent = stage()
    events, emit = collect()

    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)

    assert events == []


def test_build_moves_reports_its_source():
    moves, source = build_moves(FakeAgent(), TurnEvidence(edited_files=["a.py"]))

    assert source == "heuristic"
    assert all(isinstance(move, NextMove) for move in moves)


# ---------------------------------------------------------------------------
# The auxiliary model path
# ---------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, content):
        message = type("M", (), {"content": content})()
        self.choices = [type("C", (), {"message": message})()]


def fake_call(content):
    def call(**kwargs):
        call.kwargs = kwargs

        return FakeResponse(content)

    return call


def test_the_model_answer_is_used_when_it_is_usable(monkeypatch):
    monkeypatch.setattr("agent.next_moves.next_moves_use_model", lambda *a, **k: True)
    monkeypatch.setattr(
        "agent.auxiliary_client.call_llm",
        fake_call('{"moves": [{"kind": "followup", "label": "Ask about X", "tip": "why", "payload": "What about X?"}]}'),
    )

    moves, source = build_moves(FakeAgent(), TurnEvidence(edited_files=["a.py"]))

    assert source == "model"
    assert [m.label for m in moves] == ["Ask about X"]


def test_a_provider_failure_falls_back_to_the_rules(monkeypatch):
    # call_llm RAISES on exhaustion rather than returning None, and a
    # suggestion is never worth surfacing a provider error for.
    def boom(**kwargs):
        raise RuntimeError("provider exhausted")

    monkeypatch.setattr("agent.next_moves.next_moves_use_model", lambda *a, **k: True)
    monkeypatch.setattr("agent.auxiliary_client.call_llm", boom)

    moves, source = build_moves(FakeAgent(), TurnEvidence(edited_files=["a.py"]))

    assert source == "heuristic"
    assert [m.label for m in moves] == ["Run the tests"]


def test_an_empty_model_answer_falls_back_to_the_rules(monkeypatch):
    monkeypatch.setattr("agent.next_moves.next_moves_use_model", lambda *a, **k: True)
    monkeypatch.setattr("agent.auxiliary_client.call_llm", fake_call('{"moves": []}'))

    _moves, source = build_moves(FakeAgent(), TurnEvidence(edited_files=["a.py"]))

    assert source == "heuristic"


def test_the_model_may_not_invent_a_skill_the_user_does_not_have(monkeypatch):
    monkeypatch.setattr(
        "agent.auxiliary_client.call_llm",
        fake_call(
            '{"moves": ['
            '{"kind": "skill", "label": "Use docx", "tip": "why", "payload": "/docx report"},'
            '{"kind": "skill", "label": "Use pptx", "tip": "why", "payload": "/pptx deck"}'
            "]}"
        ),
    )

    moves = model_moves(TurnEvidence(skills=["docx"]))

    assert [m.payload for m in moves] == ["/docx report"]


def test_a_delegate_move_is_dropped_when_delegation_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        "agent.auxiliary_client.call_llm",
        fake_call('{"moves": [{"kind": "delegate", "label": "Split it out", "tip": "why", "payload": "Do X"}]}'),
    )

    assert model_moves(TurnEvidence(can_delegate=False)) == []
    assert len(model_moves(TurnEvidence(can_delegate=True))) == 1


def test_a_malformed_model_answer_falls_back(monkeypatch):
    monkeypatch.setattr("agent.next_moves.next_moves_use_model", lambda *a, **k: True)
    monkeypatch.setattr("agent.auxiliary_client.call_llm", fake_call("not json at all"))

    _moves, source = build_moves(FakeAgent(), TurnEvidence(edited_files=["a.py"]))

    assert source == "heuristic"


def test_a_fresh_turn_fences_off_an_offer_still_being_built(monkeypatch):
    agent = stage()
    events, emit = collect()

    def slow(agent_arg, evidence):
        # Stands in for the round trip: the user sends again mid-flight.
        cancel_next_moves(agent_arg)

        return [NextMove(kind="action", label="Too late", tip="t", payload="p")], "model"

    monkeypatch.setattr("agent.next_moves.build_moves", slow)
    dispatch_next_moves(agent, session_id="sess-1", status="complete", emit=emit)

    assert events == []
