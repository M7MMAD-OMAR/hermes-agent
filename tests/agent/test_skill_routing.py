"""Picking the two or three skills a turn is about, out of sixty.

The traps this file exists to catch, in order of how much they would cost:

1. **A hint for a skill the model cannot see.** The catalogue is parsed out of
   the rendered index precisely so this is impossible; a test has to hold that
   line, because the tempting "optimisation" is to re-read the skills directory.
2. **A confident wrong guess.** A picker with no score floor always returns its
   three least-bad matches. One turn of that and the reader learns to ignore
   the line forever, which is worse than never shipping it.
3. **Folding non-Latin text to zero.** An ASCII word pattern scores an Arabic or
   CJK message at zero against everything and then silently returns nothing.
   Silence is the correct output for a message that matches nothing, so this
   failure is invisible unless tested directly.
4. **Touching the cached system prompt.** The whole design rests on the hint
   riding the ephemeral channel. A test asserts the system prompt is byte
   identical with and without one.
"""

import pytest

from agent.skill_routing import (
    DEFAULT_MAX_SKILLS,
    SkillEntry,
    begin_turn,
    catalogue_entries,
    format_hint,
    merge_into_context,
    pick_skills,
)

RENDERED_INDEX = """## Skills
Before replying, scan the skills below.

<available_skills>
  automation: Skills for driving browsers and devices.
    - orbit-usage: Drive a private headless browser through Orbit. [browser, orbit]
    - blocked-page-recovery: Recover when a page blocks automation. [browser]
  writing: Skills for prose.
    - institutional-copy: Company copy that must not read as AI. [copywriting, editorial]
    - manim-video: Manim CE animations for maths videos. [animation, video]
</available_skills>
"""


def entry(name, description="", tags=()):
    return SkillEntry(name=name, description=description, tags=tuple(tags))


class Agent:
    """Only what the router reads."""

    def __init__(self, index=RENDERED_INDEX):
        self._index = index
        self._skill_hint = None


@pytest.fixture
def routed(monkeypatch):
    """Skill routing on, with a catalogue the test controls."""

    def _install(config, index=RENDERED_INDEX):
        import agent.skill_routing as routing

        monkeypatch.setattr(routing, "_routing_config", lambda _agent: config)
        monkeypatch.setattr(routing, "_skills_prompt_for", lambda _agent: index)

        return Agent(index)

    return _install


class TestReadingTheCatalogue:
    def test_every_visible_skill_becomes_an_entry(self):
        names = [e.name for e in catalogue_entries(RENDERED_INDEX)]

        assert names == ["orbit-usage", "blocked-page-recovery", "institutional-copy", "manim-video"]

    def test_a_category_line_is_not_a_skill(self):
        """Categories carry no dash. Treating one as a skill would hint at a name
        `skill_view` cannot open."""
        names = [e.name for e in catalogue_entries(RENDERED_INDEX)]

        assert "automation" not in names
        assert "writing" not in names

    def test_tags_are_lifted_off_the_description(self):
        orbit = catalogue_entries(RENDERED_INDEX)[0]

        assert orbit.tags == ("browser", "orbit")
        assert orbit.description == "Drive a private headless browser through Orbit."

    def test_an_unparseable_index_yields_nothing_rather_than_raising(self):
        assert catalogue_entries("") == []
        assert catalogue_entries("not an index at all") == []

    def test_a_name_repeated_by_two_sources_appears_once(self):
        """Project-local skills shadow profile-local ones by name; two lines for
        one name must not become two hint slots for the same skill."""
        doubled = RENDERED_INDEX + "    - orbit-usage: A shadowing copy. [browser]\n"

        assert [e.name for e in catalogue_entries(doubled)].count("orbit-usage") == 1


class TestPicking:
    ENTRIES = [
        entry("orbit-usage", "Drive a private headless browser through Orbit.", ["browser", "orbit"]),
        entry("blocked-page-recovery", "Recover when a page blocks automation.", ["browser"]),
        entry("institutional-copy", "Company copy that must not read as AI.", ["copywriting"]),
    ]

    def test_the_name_is_the_strongest_signal(self):
        assert pick_skills("please use orbit for this", self.ENTRIES)[0] == "orbit-usage"

    def test_a_hyphenated_name_is_reachable_from_either_part(self):
        assert "blocked-page-recovery" in pick_skills("the page is blocked, recovery please", self.ENTRIES)

    def test_a_turn_that_matches_nothing_gets_silence(self):
        """Not the alphabetically first skill, and not three weak guesses."""
        assert pick_skills("what time is the standup tomorrow", self.ENTRIES) == []

    def test_the_hint_is_capped(self):
        many = [entry(f"browser-skill-{i}", "browser automation things", ["browser"]) for i in range(20)]

        assert len(pick_skills("browser automation things", many)) == DEFAULT_MAX_SKILLS

    def test_a_lower_cap_is_honoured(self):
        assert len(pick_skills("orbit browser automation", self.ENTRIES, max_skills=1)) == 1

    def test_equal_scores_break_by_name_so_the_hint_does_not_flicker(self):
        tied = [entry("zebra", "browser automation"), entry("alpha", "browser automation")]

        assert pick_skills("browser automation", tied, min_score=1.0) == ["alpha", "zebra"]

    def test_an_empty_catalogue_picks_nothing(self):
        assert pick_skills("orbit browser", []) == []

    def test_a_pasted_stack_trace_does_not_displace_the_request(self):
        """Scoring is bounded to the head of the message, and a paste of unrelated
        vocabulary contributes nothing anyway. Note what this does NOT claim: a
        long paste that really is about another skill SHOULD rank that skill,
        because then it is what the turn is about."""
        trace = "\n".join(
            f'  File "/app/mod_{i}.py", line {i}, in handler\n    raise ValueError(token)'
            for i in range(400)
        )

        assert pick_skills(f"use orbit for this\n{trace}", self.ENTRIES)[0] == "orbit-usage"


class TestNonLatinText:
    """An ASCII `\\w` would score these at zero against everything and return
    nothing, which is indistinguishable from a correct no-match."""

    def test_arabic_scores_against_an_arabic_description(self):
        entries = [
            entry("arabic-copy", "كتابة نصوص تسويقية بالعربية", ["تسويق"]),
            entry("orbit-usage", "Drive a headless browser."),
        ]

        assert pick_skills("بدي كتابة نصوص تسويقية جديدة", entries) == ["arabic-copy"]

    def test_cjk_matches_on_character_bigrams_not_whole_runs(self):
        """Chinese has no spaces, so the whole clause tokenises as one word that
        only ever matches an identical clause."""
        entries = [
            entry("chinese-copy", "撰写中文营销文案"),
            entry("orbit-usage", "Drive a headless browser."),
        ]

        assert pick_skills("帮我写中文营销文案吧", entries) == ["chinese-copy"]

    def test_an_arabic_request_still_finds_a_skill_by_its_latin_term(self):
        """How this actually earns its keep for an Arabic-speaking operator: the
        technical nouns stay Latin even mid-sentence."""
        entries = [
            entry("orbit-usage", "Drive a private headless browser through Orbit.", ["browser", "orbit"]),
            entry("institutional-copy", "Company copy."),
        ]

        assert pick_skills("بدي تشغل المتصفح عبر Orbit وتشوف الصفحة", entries) == ["orbit-usage"]

    def test_a_pure_arabic_request_against_an_english_catalogue_stays_silent(self):
        """The honest limit of a lexical picker, pinned so nobody is surprised by
        it later: no shared vocabulary means no hint, never a guess."""
        entries = [entry("orbit-usage", "Drive a private headless browser.", ["browser"])]

        assert pick_skills("بدي خطة تنفيذ واختبارات شاملة", entries) == []


class TestTheTurnBoundary:
    def test_off_by_default(self, monkeypatch):
        import agent.skill_routing as routing

        def _never(_agent):
            raise AssertionError("the catalogue was read with routing off")

        monkeypatch.setattr(routing, "_routing_config", lambda _agent: {})
        monkeypatch.setattr(routing, "_skills_prompt_for", _never)
        agent = Agent()
        begin_turn(agent, "please use orbit for this")

        assert agent._skill_hint == ""

    def test_enabled_produces_a_hint(self, routed):
        agent = routed({"enabled": True, "min_skills": 2})
        begin_turn(agent, "please drive the browser through orbit for me")

        assert "orbit-usage" in agent._skill_hint

    def test_shadow_decides_and_injects_nothing(self, routed, caplog):
        agent = routed({"mode": "shadow", "min_skills": 2})
        with caplog.at_level("INFO"):
            begin_turn(agent, "please drive the browser through orbit for me")

        assert agent._skill_hint == ""
        assert "orbit-usage" in caplog.text

    def test_a_short_message_is_not_a_selection_problem(self, routed):
        agent = routed({"enabled": True, "min_skills": 2})
        begin_turn(agent, "orbit")

        assert agent._skill_hint == ""

    def test_a_short_catalogue_needs_no_hint(self, routed):
        """With four visible skills the model can already read the whole list."""
        agent = routed({"enabled": True})
        begin_turn(agent, "please drive the browser through orbit for me")

        assert agent._skill_hint == ""

    def test_a_multimodal_message_is_read_through_to_its_text(self, routed):
        agent = routed({"enabled": True, "min_skills": 2})
        begin_turn(agent, [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
            {"type": "text", "text": "please drive the browser through orbit for me"},
        ])

        assert "orbit-usage" in agent._skill_hint

    def test_a_broken_catalogue_read_leaves_the_turn_alone(self, monkeypatch):
        import agent.skill_routing as routing

        def _boom(_agent):
            raise RuntimeError("the prompt builder is down")

        monkeypatch.setattr(routing, "_routing_config", lambda _agent: {"enabled": True, "min_skills": 1})
        monkeypatch.setattr(routing, "_skills_prompt_for", _boom)
        agent = Agent()
        begin_turn(agent, "please drive the browser through orbit for me")

        assert agent._skill_hint == ""

    def test_unreadable_config_leaves_the_turn_alone(self, monkeypatch):
        import agent.skill_routing as routing

        def _boom(_agent):
            raise RuntimeError("config is unreadable")

        monkeypatch.setattr(routing, "_routing_config", _boom)
        agent = Agent()
        begin_turn(agent, "please drive the browser through orbit for me")

        assert agent._skill_hint == ""

    def test_a_hint_only_ever_names_a_skill_in_the_rendered_index(self, routed):
        """The reason the catalogue is parsed from the rendered text: visibility
        rules (disabled, platform, toolset, project shadowing) live in the prompt
        builder, and a second implementation would drift out of step with them."""
        agent = routed({"enabled": True, "min_skills": 2})
        begin_turn(agent, "please drive the browser through orbit and write some company copy")

        visible = {e.name for e in catalogue_entries(RENDERED_INDEX)}
        for name in agent._skill_hint.rstrip(".").split(": ", 1)[1].split(", "):
            assert name in visible


class TestTheHintText:
    def test_nothing_picked_is_no_line_at_all(self):
        assert format_hint([]) == ""
        assert format_hint(["", "  "]) == ""

    def test_the_line_names_what_was_picked(self):
        assert format_hint(["orbit-usage", "sketch"]) == (
            "Likely relevant skills for this request: orbit-usage, sketch."
        )

    def test_the_callers_context_comes_first_and_is_never_trimmed(self):
        agent = Agent()
        agent._skill_hint = "Likely relevant skills for this request: orbit-usage."
        merged = merge_into_context(agent, "A gateway note the user actually sent.")

        assert merged.startswith("A gateway note the user actually sent.")
        assert "orbit-usage" in merged

    def test_no_hint_leaves_the_context_byte_for_byte_unchanged(self):
        agent = Agent()
        agent._skill_hint = ""

        assert merge_into_context(agent, "A gateway note.") == "A gateway note."
        assert merge_into_context(agent, "") == ""

    def test_a_hint_with_no_other_context_stands_alone(self):
        agent = Agent()
        agent._skill_hint = "Likely relevant skills for this request: orbit-usage."

        assert merge_into_context(agent, "") == agent._skill_hint

    def test_an_agent_that_never_saw_the_router_is_handled(self):
        """Subagents and replayed turns can reach the merge without a turn boundary."""

        class Bare:
            pass

        assert merge_into_context(Bare(), "A gateway note.") == "A gateway note."


class TestTheCachedPromptIsNotTouched:
    """The design rests entirely on the hint riding the ephemeral channel.

    `build_system_prompt_parts` assembles three cache tiers once per session and
    is documented "never re-rendered mid-session"; a per-turn string reaching any
    of them would re-prefill the volatile tier on every turn and cost far more
    than the hint could ever be worth. These two tests are what stands between
    that and a future edit that "simplifies" the hint into the skills block.
    """

    def test_no_prompt_builder_reads_the_per_turn_hint(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        for module in ("agent/system_prompt.py", "agent/prompt_builder.py"):
            assert "_skill_hint" not in (root / module).read_text(), (
                f"{module} reads the per-turn skill hint; it belongs on the ephemeral "
                "channel (turn_context), never in a cached prompt tier"
            )

    def test_the_turn_boundary_writes_nothing_but_the_hint(self, routed):
        """A router that also stamped, say, a cache key or a model field would
        change the prompt indirectly."""
        agent = routed({"enabled": True, "min_skills": 2})
        before = set(vars(agent))
        begin_turn(agent, "please drive the browser through orbit for me")

        assert set(vars(agent)) - before == set()


class TestTheEphemeralChannel:
    """The hint has to arrive where `build_api_messages` injects per-turn context,
    beside the plugin context and the gateway notes."""

    def test_the_hint_joins_the_ephemeral_context(self):
        from agent.turn_context import _merge_skill_hint

        agent = Agent()
        agent._skill_hint = "Likely relevant skills for this request: orbit-usage."

        assert "orbit-usage" in _merge_skill_hint(agent, "A gateway note.")

    def test_a_failing_merge_returns_the_context_it_was_given(self, monkeypatch):
        from agent.turn_context import _merge_skill_hint

        class Exploding:
            @property
            def _skill_hint(self):
                raise RuntimeError("attribute access is down")

        assert _merge_skill_hint(Exploding(), "A gateway note.") == "A gateway note."
