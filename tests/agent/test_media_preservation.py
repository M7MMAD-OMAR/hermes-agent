"""Delivered media must outlive the directory it was written to.

The failure these guard against was measured on a real install: of 687 delivered
`MEDIA:` paths, 655 no longer existed. 584 had been written into
`$HERMES_HOME/cache/images`, which the gateway prunes hourly at 24 hours, and 66
into `/tmp`, which is tmpfs. The conversations were all intact; only the results
were gone.
"""

import os
from pathlib import Path

import pytest

from agent import media_preservation
from agent.media_preservation import (
    artifacts_dir,
    preserve_media_file,
    preserve_response_media,
    prune_artifacts,
)


@pytest.fixture(autouse=True)
def hermes_home(tmp_path, monkeypatch):
    """Point HERMES_HOME at a scratch dir so the store never touches the real one."""
    home = tmp_path / "hermes-home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def _write(path: Path, data: bytes = b"result-bytes") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class TestPreserveOneFile:
    def test_survives_deletion_of_the_original(self, tmp_path):
        # The whole point. The producer's directory is a cache or a tmpfs; the
        # preserved copy has to still be readable after it is emptied.
        source = _write(tmp_path / "cache" / "images" / "chart.png")

        preserved = preserve_media_file(str(source), session_key="s1")
        source.unlink()

        assert preserved is not None
        assert Path(preserved).read_bytes() == b"result-bytes"

    def test_files_the_session_delivered_are_grouped_together(self, tmp_path):
        source = _write(tmp_path / "chart.png")

        preserved = Path(preserve_media_file(str(source), session_key="20260906_121936_1e14af"))

        assert preserved.parent.name == "20260906_121936_1e14af"
        assert preserved.parent.parent == artifacts_dir()

    def test_a_session_key_cannot_escape_the_store(self, tmp_path):
        # The key reaches this from session state, so a separator in it must not
        # be able to write outside the store.
        source = _write(tmp_path / "chart.png")

        preserved = Path(preserve_media_file(str(source), session_key="../../etc"))

        # Resolve first: `store / "../.."` still lists the store among its
        # `parents` purely lexically, so the naive assertion passes even when
        # the traversal really did escape.
        assert preserved.resolve().is_relative_to(artifacts_dir().resolve())

    def test_an_unkeyed_delivery_still_lands_somewhere(self, tmp_path):
        source = _write(tmp_path / "chart.png")

        preserved = preserve_media_file(str(source), session_key="")

        assert preserved is not None
        assert Path(preserved).is_file()

    def test_preserving_the_same_file_twice_makes_one_copy(self, tmp_path):
        source = _write(tmp_path / "chart.png")

        first = preserve_media_file(str(source), session_key="s1")
        second = preserve_media_file(str(source), session_key="s1")

        assert first is not None
        # None means "already preserved, keep pointing where you point".
        assert second is None
        assert len(list(Path(first).parent.iterdir())) == 1

    def test_two_different_files_with_one_name_both_survive(self, tmp_path):
        # Two turns each delivering `chart.png` is ordinary. Overwriting would
        # silently destroy the earlier result the user can still scroll back to.
        first_source = _write(tmp_path / "a" / "chart.png", b"first")
        second_source = _write(tmp_path / "b" / "chart.png", b"second")

        first = preserve_media_file(str(first_source), session_key="s1")
        second = preserve_media_file(str(second_source), session_key="s1")

        assert first != second
        assert Path(first).read_bytes() == b"first"
        assert Path(second).read_bytes() == b"second"

    def test_an_already_preserved_path_is_left_alone(self, tmp_path):
        source = _write(tmp_path / "chart.png")
        preserved = preserve_media_file(str(source), session_key="s1")

        assert preserve_media_file(preserved, session_key="s1") is None

    def test_a_missing_file_is_declined_rather_than_raising(self):
        assert preserve_media_file("/nonexistent/never-written.png", session_key="s1") is None

    def test_a_directory_is_declined(self, tmp_path):
        assert preserve_media_file(str(tmp_path), session_key="s1") is None

    def test_a_remote_url_is_declined(self):
        # Nothing to preserve, and treating it as a path would create a junk file.
        assert preserve_media_file("https://example.com/chart.png", session_key="s1") is None

    def test_a_copy_is_made_when_a_hard_link_is_impossible(self, tmp_path, monkeypatch):
        # `/tmp` is a different filesystem from the store on most installs, so
        # the link always fails there and the fallback is the only thing that
        # preserves anything at all.
        def _no_links(src, dst):
            raise OSError("cross-device link")

        monkeypatch.setattr(media_preservation.os, "link", _no_links)
        source = _write(tmp_path / "clip.mp3", b"audio")

        preserved = preserve_media_file(str(source), session_key="s1")
        source.unlink()

        assert Path(preserved).read_bytes() == b"audio"


class TestPreserveAReply:
    def test_repoints_the_reply_at_the_preserved_copy(self, tmp_path):
        source = _write(tmp_path / "chart.png")

        rewritten = preserve_response_media(f"Here it is\n\nMEDIA:{source}", session_key="s1")

        assert str(source) not in rewritten
        assert str(artifacts_dir()) in rewritten

    def test_the_rewritten_path_resolves_after_the_original_is_gone(self, tmp_path):
        # The user-facing invariant: reopening the conversation months later
        # still finds the file.
        source = _write(tmp_path / "clip.mp3", b"audio")
        rewritten = preserve_response_media(f"MEDIA:{source}", session_key="s1")
        source.unlink()

        delivered = rewritten.split("MEDIA:", 1)[1].strip()
        assert Path(delivered).read_bytes() == b"audio"

    def test_preserves_every_file_in_a_multi_delivery_reply(self, tmp_path):
        # The reply that prompted this work delivered six files at once.
        sources = [_write(tmp_path / f"cast_{i}.mp3", f"v{i}".encode()) for i in range(6)]
        reply = "\n\n".join(f"MEDIA:{s}" for s in sources)

        rewritten = preserve_response_media(reply, session_key="s1")

        for source in sources:
            source.unlink()
        for line in rewritten.splitlines():
            if line.startswith("MEDIA:"):
                assert Path(line[len("MEDIA:"):].strip()).is_file()

    def test_one_path_being_a_prefix_of_another_does_not_corrupt_it(self, tmp_path):
        """`clip.mp4` is a prefix of `clip.mp4.bak`.

        Rewriting the shorter path first also rewrites the substring inside the
        longer one, so the longer line ends up naming a path that was never the
        destination of anything. It only LOOKS harmless while the two basenames
        coincide, so this forces a name collision in the store: the real `.bak`
        lands as `clip_1.mp4.bak`, and a corrupted rewrite points at the
        unrelated file already sitting at `clip.mp4.bak`.
        """
        occupied = artifacts_dir() / "s1" / "clip.mp4.bak"
        _write(occupied, b"someone else's file")

        short = _write(tmp_path / "clip.mp4", b"short")
        long = _write(tmp_path / "clip.mp4.bak", b"long")
        reply = f"MEDIA:{short}\n\nMEDIA:{long}"

        rewritten = preserve_response_media(reply, session_key="s1")

        short.unlink()
        long.unlink()
        delivered = [line[len("MEDIA:"):].strip() for line in rewritten.splitlines() if line.startswith("MEDIA:")]
        assert sorted(Path(d).read_bytes() for d in delivered) == [b"long", b"short"]

    def test_a_reply_that_delivers_nothing_is_untouched(self):
        reply = "No files this time."
        assert preserve_response_media(reply, session_key="s1") is reply

    def test_an_unreadable_path_leaves_the_reply_pointing_where_it_did(self):
        # Better a reply naming a path that may exist than one naming a copy that
        # was never made.
        reply = "MEDIA:/nonexistent/never-written.png"
        assert preserve_response_media(reply, session_key="s1") == reply

    def test_an_empty_reply_is_returned_as_is(self):
        assert preserve_response_media("", session_key="s1") == ""


class TestPrune:
    def test_a_store_under_the_cap_loses_nothing(self, tmp_path):
        source = _write(tmp_path / "chart.png")
        preserve_media_file(str(source), session_key="s1")

        assert prune_artifacts(max_bytes=10 * 1024 * 1024) == 0

    def test_drops_the_oldest_first_once_over_the_cap(self, tmp_path):
        store = artifacts_dir() / "s1"
        store.mkdir(parents=True)
        old = _write(store / "old.png", b"x" * 100)
        new = _write(store / "new.png", b"y" * 100)
        os.utime(old, (1_000, 1_000))
        os.utime(new, (2_000, 2_000))

        removed = prune_artifacts(max_bytes=150)

        assert removed == 1
        assert not old.exists()
        assert new.exists()

    def test_prunes_only_down_to_the_cap_not_empty(self, tmp_path):
        store = artifacts_dir() / "s1"
        store.mkdir(parents=True)
        for index in range(4):
            path = _write(store / f"f{index}.png", b"z" * 100)
            os.utime(path, (1_000 + index, 1_000 + index))

        prune_artifacts(max_bytes=250)

        assert len(list(store.iterdir())) == 2

    def test_an_empty_store_is_a_no_op(self):
        assert prune_artifacts(max_bytes=0) == 0
