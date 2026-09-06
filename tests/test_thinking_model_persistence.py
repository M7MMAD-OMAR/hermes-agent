"""The thinking-signature producer must survive a cold resume.

Anthropic validates a thinking signature against the model that minted it, so a
turn signed by Kimi K3 cannot be replayed once the chat switches to Claude. The
converter learns that from the ``thinking_model`` stamp — which is worthless if
it lives only in memory: after a restart the resumed history would come back
unstamped, take the legacy path, and 400 all over again.
"""

from __future__ import annotations

from agent.anthropic_message_convert import convert_messages_to_anthropic
from hermes_state import SessionDB

SIGNED = [{"type": "thinking", "thinking": "weighing the options", "signature": "sig-from-kimi-k3"}]


def _resume(tmp_path, **assistant_extra):
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session("chat-1", source="cli")
        db.append_message("chat-1", role="user", content="hello")
        db.append_message("chat-1", role="assistant", content="an answer", **assistant_extra)

        return db.get_messages_as_conversation("chat-1")
    finally:
        db.close()


def test_the_producer_survives_a_write_and_read(tmp_path):
    restored = _resume(tmp_path, reasoning_details=SIGNED, thinking_model="kimi-k3")
    assistant = [m for m in restored if m.get("role") == "assistant"]

    assert assistant, "the assistant turn must come back at all"
    assert assistant[-1].get("thinking_model") == "kimi-k3"


def test_a_resumed_chat_does_not_replay_a_foreign_signature(tmp_path):
    # The whole point: same failure the user hit, but after a restart.
    restored = _resume(tmp_path, reasoning_details=SIGNED, thinking_model="kimi-k3")

    _system, converted = convert_messages_to_anthropic(
        restored, base_url="https://api.anthropic.com", model="claude-sonnet-5"
    )
    blocks = [b for m in converted if m.get("role") == "assistant" for b in m.get("content", [])]

    assert not any(b.get("type") == "thinking" for b in blocks)
    assert any("weighing the options" in b.get("text", "") for b in blocks), "the reasoning text must survive"


def test_a_resumed_chat_still_replays_its_own_signature(tmp_path):
    restored = _resume(tmp_path, reasoning_details=SIGNED, thinking_model="claude-sonnet-5")

    _system, converted = convert_messages_to_anthropic(
        restored, base_url="https://api.anthropic.com", model="claude-sonnet-5"
    )
    blocks = [b for m in converted if m.get("role") == "assistant" for b in m.get("content", [])]

    assert any(b.get("type") == "thinking" for b in blocks)


def test_an_unstamped_turn_reads_back_without_the_key(tmp_path):
    # Rows written before the column existed must not grow a spurious stamp,
    # which would misreport a producer nobody recorded.
    restored = _resume(tmp_path, reasoning_details=SIGNED)
    assistant = [m for m in restored if m.get("role") == "assistant"][-1]

    assert "thinking_model" not in assistant
