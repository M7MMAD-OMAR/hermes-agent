"""A skill shadowed by a same-named bundle is not offered as a second completion.

Slash dispatch resolves a shared slug to the bundle on purpose (agent/skill_bundles.py: "the bundle
wins"; gateway/run_inbound.py mirrors it). The completer used to list both, so the palette showed
two `/herwork` rows of which only one did anything. The completer now offers what dispatch runs.
"""

from prompt_toolkit.document import Document
from prompt_toolkit.formatted_text import to_plain_text

from hermes_cli.commands_completion import SlashCommandCompleter


def _completer(skills: dict, bundles: dict) -> SlashCommandCompleter:
    return SlashCommandCompleter(skill_commands_provider=lambda: skills, skill_bundles_provider=lambda: bundles)


def _rows(completer: SlashCommandCompleter, text: str) -> list[tuple[str, str]]:
    return [
        (item.text.strip(), to_plain_text(item.display_meta) if item.display_meta else "")
        for item in completer.get_completions(Document(text, len(text)), None)
    ]


def test_same_slug_offers_the_bundle_once_and_hides_the_skill():
    completer = _completer(
        {"/herwork": {"description": "the skill"}},
        {"/herwork": {"description": "the mode", "skills": ["herwork"]}},
    )

    rows = _rows(completer, "/herw")

    assert [text for text, _ in rows] == ["herwork"]
    assert "▣" in rows[0][1] and "the mode" in rows[0][1]
    assert not any("⚡" in meta for _, meta in rows)


def test_unshadowed_skills_and_bundles_are_still_offered():
    completer = _completer(
        {"/docx": {"description": "word files"}, "/herwork": {"description": "the skill"}},
        {"/herwork": {"description": "the mode", "skills": ["herwork"]}, "/research": {"description": "r", "skills": ["a"]}},
    )

    texts = {text for text, _ in _rows(completer, "/")}

    assert {"docx", "herwork", "research"} <= texts
    assert [text for text, _ in _rows(completer, "/")].count("herwork") == 1


def test_no_bundles_leaves_skill_completion_unchanged():
    completer = _completer({"/herwork": {"description": "the skill"}}, {})

    rows = _rows(completer, "/herw")

    assert [text for text, _ in rows] == ["herwork"]
    assert "⚡" in rows[0][1]
