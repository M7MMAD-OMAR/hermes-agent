"""A signed thinking block must never be replayed to a model that did not sign it.

Anthropic validates a thinking signature against its producer. After a /model
switch (Kimi K3 -> Claude, or opus <-> sonnet) every stored signature is
unreplayable, and the request fails with
``HTTP 400 messages.N.content.M: Invalid signature in thinking block``.

Two independent carriers hold signed thinking — ``reasoning_details`` and the
verbatim ``anthropic_content_blocks`` replay — and the converter reads the
second one FIRST, which is why a fix that knows only about the first leaves the
failure in place.
"""

from __future__ import annotations

from agent.anthropic_message_convert import convert_messages_to_anthropic

ANTHROPIC = "https://api.anthropic.com"


def _blocks(messages, role="assistant"):
    return [b for m in messages if m.get("role") == role for b in m.get("content", [])]


def _signed_turn(producer: str) -> dict:
    return {
        "role": "assistant",
        "content": "here is the answer",
        "reasoning_details": [
            {"type": "thinking", "thinking": "weighing the options", "signature": "sig-from-" + producer}
        ],
        "thinking_model": producer,
    }


def _history(turn: dict) -> list:
    return [{"role": "user", "content": "hi"}, turn]


def test_signature_from_another_model_is_demoted_to_text():
    _system, converted = convert_messages_to_anthropic(
        _history(_signed_turn("kimi-k3")), base_url=ANTHROPIC, model="claude-sonnet-5"
    )
    blocks = _blocks(converted)
    assert not any(b.get("type") == "thinking" for b in blocks), (
        "a foreign signature must not be replayed — this is the 400 the user saw"
    )
    # The reasoning itself survives as text; only the unusable signature is dropped.
    assert any(b.get("type") == "text" and "weighing the options" in b.get("text", "") for b in blocks)
    assert all("_thinking_signature_invalidated" not in m for m in converted), "internal flag must never ship"


def test_switching_between_two_anthropic_models_also_invalidates():
    # Not only cross-provider: opus and sonnet do not share signatures either.
    _system, converted = convert_messages_to_anthropic(
        _history(_signed_turn("claude-opus-5")), base_url=ANTHROPIC, model="claude-sonnet-5"
    )
    assert not any(b.get("type") == "thinking" for b in _blocks(converted))


def test_same_model_still_replays_its_own_signature():
    _system, converted = convert_messages_to_anthropic(
        _history(_signed_turn("claude-sonnet-5")), base_url=ANTHROPIC, model="claude-sonnet-5"
    )
    thinking = [b for b in _blocks(converted) if b.get("type") == "thinking"]
    assert len(thinking) == 1 and thinking[0]["signature"] == "sig-from-claude-sonnet-5"


def test_unstamped_history_keeps_the_previous_behaviour():
    turn = _signed_turn("claude-sonnet-5")
    del turn["thinking_model"]  # written before the stamp existed
    _system, converted = convert_messages_to_anthropic(
        _history(turn), base_url=ANTHROPIC, model="claude-sonnet-5"
    )
    assert any(b.get("type") == "thinking" for b in _blocks(converted))


def test_verbatim_ordered_block_replay_is_invalidated_too():
    # The carrier the converter reads FIRST: without the flag on this path the
    # foreign signature went out verbatim no matter what reasoning_details said.
    turn = {
        "role": "assistant",
        "content": "",
        "anthropic_content_blocks": [
            {"type": "thinking", "thinking": "interleaved reasoning", "signature": "sig-from-kimi-k3"},
            {"type": "text", "text": "calling a tool"},
        ],
        "thinking_model": "kimi-k3",
    }
    _system, converted = convert_messages_to_anthropic(
        _history(turn), base_url=ANTHROPIC, model="claude-sonnet-5"
    )
    blocks = _blocks(converted)
    assert not any(b.get("type") == "thinking" for b in blocks)
    assert any("interleaved reasoning" in b.get("text", "") for b in blocks)
