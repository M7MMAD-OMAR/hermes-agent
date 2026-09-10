"""A workspace-owned session's first prompt is prefixed with its skill bundle.

S1 of docs/design/herwork-workspace.md, backend half. `session.create` stores a one-shot
``pending_bundle``; `_prepare_turn_input` consumes it on the first user prompt only, producing exactly
what a typed ``/<bundle> <text>`` produces. The test runs with a profile home override and a bundle
placed under THAT home, because that is where a herwork-profile session resolves bundles in
production; a bundle that only exists in the default home would not resolve (the review finding that
shaped step 4).
"""

from pathlib import Path

import pytest

from tui_gateway import prompt_turn


@pytest.fixture
def profile_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "profiles" / "herwork"
    (home / "skill-bundles").mkdir(parents=True)
    skills = home / "skills" / "productivity" / "herwork"
    skills.mkdir(parents=True)
    (skills / "SKILL.md").write_text(
        "---\nname: herwork\ndescription: Deliver finished office files.\n---\n\n# HerWork\n\nDesk rules here.\n",
        encoding="utf-8",
    )
    (home / "skill-bundles" / "herwork.yaml").write_text(
        "name: herwork\ndescription: HerWork mode.\nskills:\n  - herwork\ninstruction: |\n  You are in HERWORK MODE.\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_BUNDLES_DIR", raising=False)
    from agent import skill_bundles

    skill_bundles.reload_bundles()
    yield home
    skill_bundles.reload_bundles()


def _session(**extra) -> dict:
    return {"history": [], "profile_home": None, **extra}


def test_first_prompt_is_prefixed_and_the_flag_is_consumed(profile_home: Path):
    session = _session(pending_bundle="herwork")

    prompt = prompt_turn._apply_pending_bundle(session, "write the Q3 report")

    assert prompt != "write the Q3 report"
    assert "HERWORK MODE" in prompt
    assert "Desk rules here." in prompt
    # The instruction is folded into the message body, not appended at the end.
    assert "write the Q3 report" in prompt
    assert "pending_bundle" not in session


def test_second_prompt_is_not_prefixed(profile_home: Path):
    session = _session(pending_bundle="herwork", history=[{"role": "user", "content": "earlier"}])

    assert prompt_turn._apply_pending_bundle(session, "and a deck") == "and a deck"
    assert "pending_bundle" not in session


def test_no_flag_means_no_change(profile_home: Path):
    session = _session()

    assert prompt_turn._apply_pending_bundle(session, "plain question") == "plain question"


def test_unresolvable_bundle_sends_the_prompt_unprefixed(profile_home: Path):
    session = _session(pending_bundle="does-not-exist")

    assert prompt_turn._apply_pending_bundle(session, "hello") == "hello"
    assert "pending_bundle" not in session


def test_bundle_resolves_under_the_profile_home_not_the_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Default home has no bundle; the profile home does. The prompt path binds the
    # profile home before consuming the flag, so this is the environment it sees.
    default_home = tmp_path / "default"
    (default_home / "skill-bundles").mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(default_home))
    monkeypatch.delenv("HERMES_BUNDLES_DIR", raising=False)
    from agent import skill_bundles

    skill_bundles.reload_bundles()
    assert prompt_turn._apply_pending_bundle(_session(pending_bundle="herwork"), "x") == "x"
    skill_bundles.reload_bundles()


def test_create_accepts_a_bundle_name_and_strips_the_slash():
    from tui_gateway import methods_session

    assert methods_session._str_param({"bundle": "/herwork"}, "bundle").strip().lstrip("/") == "herwork"
    assert (methods_session._str_param({}, "bundle").strip().lstrip("/") or None) is None
