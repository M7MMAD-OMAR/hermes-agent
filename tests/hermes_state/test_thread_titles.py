"""A delegated thread is named from its goal, once, as its row is created.

Before this, only 8 of 297 delegate children on a live machine carried a
title, so the Threads dock labelled every row from the goal PREVIEW: a hard
truncation at 60 characters that lands mid-word. The preview is still the
fallback and still renders, so nothing here may fail loudly.

The case that actually bites is the sibling collision. One fan-out spawns
several children whose goals differ only by a repo path or a review dimension
("Review a code diff for CODE REUSE problems, in the repo ..."), their derived
titles are identical after truncation, and the unique-title index would leave
every sibling but the first unnamed.
"""

import pytest

from agent.title_generator import apply_instant_title, derive_title
from hermes_state import SessionDB


@pytest.fixture
def db(tmp_path):
    handle = SessionDB(db_path=tmp_path / "state.db")
    # The coordinator has to exist first: a thread row carries a real
    # ``parent_session_id`` foreign key, which is part of why a thread cannot
    # outlive the conversation that spawned it.
    handle.create_session("coord-1", source="desktop", model="test-model")
    yield handle
    handle.close()


def _thread(db, sid, coordinator="coord-1"):
    db.create_session(
        sid, source="desktop", model="test-model",
        model_config={"_delegate_from": coordinator}, parent_session_id=coordinator,
    )
    return sid


class TestThreadTitleFromGoal:
    def test_a_long_goal_becomes_a_readable_title(self, db):
        goal = "Perform an adversarial review of the new recovery-target HBA authority and report back"
        _thread(db, "t-1")

        title = apply_instant_title(db, "t-1", goal, dedupe=True)

        assert title
        assert len(title) < len(goal)
        assert db.get_session_title("t-1") == title

    def test_the_title_becomes_the_thread_label(self, db):
        _thread(db, "t-1")
        db.append_message("t-1", "user", "Research the history of the cyanotype style")

        apply_instant_title(db, "t-1", "Research the history of the cyanotype style", dedupe=True)

        assert db.list_threads()[0]["label"] == db.get_session_title("t-1")


class TestSiblingCollisions:
    def test_siblings_with_colliding_titles_are_all_named(self, db):
        """The failure this dedupe exists to stop: one fan-out, several
        children, and every sibling but the first left unnamed."""
        goal = "Review a code diff for problems in the repo, and report every finding you can justify"
        for index in range(3):
            _thread(db, f"t-{index}")
            apply_instant_title(db, f"t-{index}", goal, dedupe=True)

        titles = [db.get_session_title(f"t-{index}") for index in range(3)]

        assert all(titles), titles
        assert len(set(titles)) == 3, titles

    def test_without_dedupe_a_sibling_is_left_unnamed(self, db):
        """Pins WHY threads opt in: the default is off for the chat critical
        path, and that default would lose the sibling's name."""
        goal = "Review a code diff for problems in the repo, and report every finding you can justify"
        for index in range(2):
            _thread(db, f"t-{index}")
            apply_instant_title(db, f"t-{index}", goal)

        assert db.get_session_title("t-0")
        assert db.get_session_title("t-1") is None


class TestNeverRaises:
    def test_a_short_goal_is_used_as_is(self, db):
        """A two word goal is a perfectly good thread name; it is only the
        long ones that need trimming."""
        _thread(db, "t-1")

        assert apply_instant_title(db, "t-1", "ship it", dedupe=True) == "ship it"

    def test_a_machine_authored_opener_leaves_the_row_unnamed(self, db):
        """Scaffolding is not a name. The dock falls back to the preview."""
        _thread(db, "t-1")

        assert apply_instant_title(db, "t-1", "[System note: resumed]", dedupe=True) is None
        assert db.get_session_title("t-1") is None

    def test_an_empty_goal_is_a_no_op(self, db):
        _thread(db, "t-1")

        assert apply_instant_title(db, "t-1", "", dedupe=True) is None

    def test_a_missing_session_does_not_raise(self, db):
        assert apply_instant_title(db, "ghost", "Research the cyanotype lineage", dedupe=True) is None

    def test_a_user_title_is_never_overwritten(self, db):
        _thread(db, "t-1")
        db.set_session_title("t-1", "My own name")

        apply_instant_title(db, "t-1", "Research the history of the cyanotype style", dedupe=True)

        assert db.get_session_title("t-1") == "My own name"

    def test_titling_twice_does_not_rename_the_thread(self, db):
        goal = "Research the history of the cyanotype style and its revival"
        _thread(db, "t-1")

        first = apply_instant_title(db, "t-1", goal, dedupe=True)
        apply_instant_title(db, "t-1", "A completely different goal to research", dedupe=True)

        assert db.get_session_title("t-1") == first


class TestDeriveTitleOnRealGoals:
    @pytest.mark.parametrize("goal", [
        "Perform an adversarial review of the new recovery-target HBA authority",
        "Review a code diff for CODE REUSE problems, in the repo /home/user/project",
        "Research professional audio post-production practice for assembling segments",
    ])
    def test_real_delegation_goals_produce_a_title(self, goal):
        """These are goals taken from the live delegation history, not invented
        ones: a titler that only works on tidy prose is not useful here."""
        title = derive_title(goal)

        assert title
        assert len(title) <= len(goal)
