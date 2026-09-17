"""Reading JSON back from an auxiliary model that ignored ``response_format``.

``response_format`` is an OpenAI-only parameter. Anthropic and the local runtimes accept
the call and answer with correct JSON inside a ``` fence, which a bare ``json.loads``
reads as a parse error. Every auxiliary task treats a parse error as "the model declined"
and silently uses its rule table, so the failure looks like a feature being unhelpful
rather than broken: turn outcomes showed a list of edited files instead of an outcome.
"""

from __future__ import annotations

from agent.auxiliary_client import parse_json_reply


def test_plain_json_is_read():
    assert parse_json_reply('{"open": ["run the build"]}') == {"open": ["run the build"]}


def test_a_fenced_body_is_read():
    reply = '```json\n{"delivered": ["the report"], "failed": [], "open": []}\n```'

    assert parse_json_reply(reply) == {"delivered": ["the report"], "failed": [], "open": []}


def test_an_unlabelled_fence_is_read():
    assert parse_json_reply('```\n{"a": 1}\n```') == {"a": 1}


def test_prose_around_the_object_is_ignored():
    assert parse_json_reply('Sure, here you go:\n{"a": 1}\nHope that helps.') == {"a": 1}


def test_a_bare_array_is_read():
    assert parse_json_reply('```json\n[{"kind": "skill"}]\n```') == [{"kind": "skill"}]


def test_nothing_parseable_returns_the_default():
    assert parse_json_reply("I cannot answer that.") is None
    assert parse_json_reply("", default={}) == {}
    assert parse_json_reply(None, default={}) == {}


def test_an_unterminated_object_is_not_half_read():
    """A truncated reply is a declined answer, never a partial outcome."""
    assert parse_json_reply('{"delivered": ["the report"') is None
