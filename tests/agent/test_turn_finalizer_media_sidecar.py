"""Media preservation must not rewrite what the model reads back.

`_preserve_delivered_media` repoints a delivered `MEDIA:` path at the durable
copy under `$HERMES_HOME/artifacts/<session>/`. That rewrite lands on the
assistant row, and the assistant row is also the model's context, so the store
path used to become the shape a delivery had in the model's own context: the
next turn named a NEW result by the path it expected to be preserved to rather
than the path it actually wrote, nothing was copied there, and the user got a
card for a file that never existed.

The fix is the `api_content` sidecar: the row's content is the preserved copy
(transcript, desktop card) and the sidecar is the path the model wrote (replay).
These tests pin both halves plus the coupling `_preserve_delivered_media`
documents, where a tail that diverges from `final_response` duplicates the reply.
"""

from types import SimpleNamespace

import pytest

from agent.turn_finalizer import finalize_turn
from tests.agent.test_turn_finalizer_final_response_persistence import FakeAgent


@pytest.fixture(autouse=True)
def _no_lifecycle_hooks(monkeypatch):
    monkeypatch.setattr("hermes_cli.plugins.invoke_hook", lambda *_a, **_kw: [])


@pytest.fixture
def delivered(tmp_path, monkeypatch):
    """A real file delivered from outside the store, plus the path it is preserved to."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    source = tmp_path / "out" / "chart.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"png")
    store = tmp_path / "hermes" / "artifacts" / "sess-test" / "chart.png"
    return SimpleNamespace(
        source=str(source),
        store=str(store),
        reply=f"Here it is.\nMEDIA:{source}",
        preserved_reply=f"Here it is.\nMEDIA:{store}",
    )


def _finalize(agent, messages, final_response):
    return finalize_turn(
        agent,
        final_response=final_response,
        api_call_count=2,
        interrupted=False,
        failed=False,
        messages=messages,
        conversation_history=[],
        effective_task_id="task",
        turn_id="turn",
        user_message="draw it",
        original_user_message="draw it",
        _should_review_memory=False,
        _turn_exit_reason="text_response(stop)",
    )


def test_delivered_row_splits_preserved_content_from_replayed_path(delivered):
    """The row the user sees points at the copy; the bytes replayed keep the original."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": delivered.reply},
    ]

    result = _finalize(agent, messages, delivered.reply)

    tail = result["messages"][-1]
    assert tail["content"] == delivered.preserved_reply
    assert tail["api_content"] == delivered.reply
    # The card the user gets is the durable copy, not the path that may be gone.
    assert result["final_response"] == delivered.preserved_reply
    assert agent.persisted_messages[-1]["content"] == delivered.preserved_reply
    assert agent.persisted_messages[-1]["api_content"] == delivered.reply


def test_preserved_reply_is_not_duplicated_into_a_second_row(delivered):
    """The coupling `_preserve_delivered_media` documents: `_close_transcript_tail`
    compares tail content against `final_response`, so a rewrite that leaves the two
    divergent appends the whole reply a second time."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": delivered.reply},
    ]

    result = _finalize(agent, messages, delivered.reply)

    assert [m["role"] for m in result["messages"]].count("assistant") == 1
    assert [m["role"] for m in agent.persisted_messages].count("assistant") == 1


def test_blank_tool_call_tail_filled_by_the_finalizer_gets_the_sidecar(delivered):
    """A pure tool-call tail is filled with `final_response` by `_close_transcript_tail`,
    after the rewrite, so the sidecar has to be stamped once the tail is shaped."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "t1", "type": "function", "function": {"name": "f", "arguments": "{}"}}
            ],
        },
    ]

    result = _finalize(agent, messages, delivered.reply)

    tail = result["messages"][-1]
    assert tail["content"] == delivered.preserved_reply
    assert tail["api_content"] == delivered.reply


def test_appended_closing_row_gets_the_sidecar(delivered):
    """The recovery shape: `final_response` was delivered with no closing assistant row,
    so `_close_transcript_tail` appends one carrying the already-preserved text."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "tool", "tool_call_id": "t1", "name": "f", "content": "ok"},
    ]

    result = _finalize(agent, messages, delivered.reply)

    tail = result["messages"][-1]
    assert tail["role"] == "assistant"
    assert tail["content"] == delivered.preserved_reply
    assert tail["api_content"] == delivered.reply


def test_existing_sidecar_is_not_displaced(delivered):
    """An existing sidecar is the exact bytes already sent for this content; replacing
    it would resend something else."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": delivered.reply, "api_content": "sent bytes"},
    ]

    result = _finalize(agent, messages, delivered.reply)

    assert result["messages"][-1]["api_content"] == "sent bytes"


def test_reply_without_media_keeps_no_sidecar(delivered):
    """Nothing delivered, nothing rewritten, no sidecar invented."""
    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": "No file this time."},
    ]

    result = _finalize(agent, messages, "No file this time.")

    assert "api_content" not in result["messages"][-1]


def test_model_replays_the_path_it_wrote(delivered, monkeypatch):
    """End to end through the real wire build: the assistant row the model reads back
    carries the path it wrote, never the store path it was never told about."""
    from agent.turn_context import build_api_messages

    agent = FakeAgent()
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": delivered.reply},
    ]
    _finalize(agent, messages, delivered.reply)

    agent._current_turn_timestamp = 1_781_976_577.25
    agent._cached_system_prompt = ""
    agent.ephemeral_system_prompt = ""
    agent.prefill_messages = []
    agent._copy_reasoning_content_for_api = lambda _msg, _api_msg: None
    agent._should_sanitize_tool_calls = lambda *_a, **_kw: False
    messages.append({"role": "user", "content": "now crop it"})

    api_messages, _system = build_api_messages(
        agent, messages, current_turn_user_idx=len(messages) - 1,
        ext_prefetch_cache=None, plugin_user_context=None, moa_config=None,
        active_system_prompt="",
    )

    assistant = [m for m in api_messages if m.get("role") == "assistant"][-1]
    assert assistant["content"] == delivered.reply
    assert delivered.store not in assistant["content"]
    assert "api_content" not in assistant


def test_split_survives_a_gateway_restart(delivered, tmp_path):
    """The heal in `media_preservation._recover_source` depends on process-lifetime
    state; this split does not. Through a real SessionDB and back, the row still shows
    the copy and still replays the original."""
    from hermes_state import SessionDB

    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("sess-test", source="cli")
    agent = FakeAgent()

    def persist_to_sqlite(messages, _conversation_history):
        db.replace_messages(agent.session_id, messages)
        agent.persisted_messages = db.get_messages_as_conversation(agent.session_id)

    agent._persist_session = persist_to_sqlite
    messages = [
        {"role": "user", "content": "draw it"},
        {"role": "assistant", "content": delivered.reply},
    ]

    _finalize(agent, messages, delivered.reply)

    restored = agent.persisted_messages[-1]
    assert restored["role"] == "assistant"
    assert restored["content"] == delivered.preserved_reply
    assert restored["api_content"] == delivered.reply
