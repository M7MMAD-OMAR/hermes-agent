"""The preservation hook sits between the reply and the durable transcript row.

Two things have to hold together: the persisted row must carry the durable path,
and the row must not diverge from the reply. `_close_transcript_tail` decides
whether to append a closing assistant message by comparing tail content against
`final_response`, so rewriting one without the other duplicates the whole reply
in the transcript.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from agent.turn_finalizer import _preserve_delivered_media


@pytest.fixture(autouse=True)
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes-home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def _agent(session_id="20260906_121936_1e14af"):
    return SimpleNamespace(session_id=session_id)


def _delivered(tmp_path, name="chart.png", data=b"result"):
    path = tmp_path / "cache" / "images" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class TestTheReplyAndTheRow:
    def test_the_reply_points_at_the_preserved_copy(self, tmp_path):
        source = _delivered(tmp_path)
        reply = f"Done.\n\nMEDIA:{source}"

        rewritten = _preserve_delivered_media(_agent(), [], reply)

        assert str(source) not in rewritten
        source.unlink()
        assert Path(rewritten.split("MEDIA:", 1)[1].strip()).is_file()

    def test_the_assistant_row_is_rewritten_with_it(self, tmp_path):
        # If the row keeps the original path, the persisted transcript is exactly
        # as broken as before, however good the delivered reply is.
        source = _delivered(tmp_path)
        reply = f"Done.\n\nMEDIA:{source}"
        messages = [{"role": "user", "content": "make it"}, {"role": "assistant", "content": reply}]

        rewritten = _preserve_delivered_media(_agent(), messages, reply)

        assert messages[-1]["content"] == rewritten
        assert str(source) not in messages[-1]["content"]

    def test_only_the_row_carrying_this_reply_is_touched(self, tmp_path):
        source = _delivered(tmp_path)
        reply = f"MEDIA:{source}"
        earlier = {"role": "assistant", "content": "an earlier answer"}
        messages = [earlier, {"role": "assistant", "content": reply}]

        _preserve_delivered_media(_agent(), messages, reply)

        assert earlier["content"] == "an earlier answer"

    def test_a_transcript_with_no_matching_row_yet_is_left_alone(self, tmp_path):
        # Some recovery paths return a reply before any assistant row exists;
        # `_close_transcript_tail` appends it afterwards, from the value returned
        # here, so there is nothing to rewrite and nothing to break.
        source = _delivered(tmp_path)
        reply = f"MEDIA:{source}"
        messages = [{"role": "user", "content": "make it"}]

        rewritten = _preserve_delivered_media(_agent(), messages, reply)

        assert len(messages) == 1
        assert str(source) not in rewritten


class TestItCannotCostTheTurn:
    def test_a_reply_delivering_nothing_is_returned_unchanged(self):
        assert _preserve_delivered_media(_agent(), [], "Just text.") == "Just text."

    def test_an_empty_reply_is_returned_unchanged(self):
        assert _preserve_delivered_media(_agent(), [], "") == ""
        assert _preserve_delivered_media(_agent(), [], None) is None

    def test_a_failure_inside_preservation_keeps_the_original_reply(self, tmp_path, monkeypatch):
        # Preservation is a safety net. A net that can drop the turn is worse
        # than no net, so the failure path has to return text, not raise.
        import agent.media_preservation as mp

        def _boom(*args, **kwargs):
            raise RuntimeError("disk gone")

        monkeypatch.setattr(mp, "preserve_response_media", _boom)
        source = _delivered(tmp_path)
        reply = f"MEDIA:{source}"
        messages = [{"role": "assistant", "content": reply}]

        assert _preserve_delivered_media(_agent(), messages, reply) == reply
        assert messages[-1]["content"] == reply

    def test_an_agent_with_no_session_id_still_preserves(self, tmp_path):
        source = _delivered(tmp_path)
        reply = f"MEDIA:{source}"

        rewritten = _preserve_delivered_media(SimpleNamespace(), messages := [], reply)

        assert messages == []
        assert str(source) not in rewritten
