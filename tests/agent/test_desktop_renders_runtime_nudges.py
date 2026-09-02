"""The desktop must know every runtime nudge the backend can inject.

Message-role alternation forbids a synthetic ``system`` row mid-loop, so every
scaffolding message the runtime needs the model to react to rides in on the
``user`` role.  The backend already keeps the authoritative list — 
``_is_synthetic_compression_user_turn`` uses it so compaction never attributes
these to the human.  The DESKTOP needs the same list for a different job: a
nudge rendered as a user bubble tells the user they said something they did not,
and puts a fake entry in the conversation's timeline rail.

Before this guard the desktop knew exactly one of them (the background-process
regex, duplicated in two files) and rendered the rest as human prompts.  A list
duplicated across a language boundary drifts silently, so this test is what
keeps them together: add a nudge on either side and it names the other.

Sibling of ``test_desktop_capabilities_are_advertised.py`` — same shape, same
reason: parse the renderer, compare against the Python truth.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.context_compressor import (
    COMPRESSION_CONTINUATION_USER_CONTENT,
    MAX_ITERATIONS_SUMMARY_REQUEST,
    _BACKGROUND_PROCESS_NOTIFICATION_PREFIX,
    _LEGACY_COMPRESSION_CONTINUATION_USER_CONTENT,
)
from agent.conversation_loop import (
    _CODEX_ACK_CONTINUATION_NUDGE,
    _CODEX_INCOMPLETE_NUDGE,
    _DROPPED_TOOLCALL_NUDGE_CONTENT,
    _EMPTY_TOOL_RESPONSE_NUDGE,
    _LENGTH_CONTINUATION_DROPPED_TOOLS_PREFIX,
    _LENGTH_CONTINUATION_NETWORK_STUB,
    _LENGTH_CONTINUATION_OUTPUT_LIMIT,
)
from tools.todo_tool import TODO_INJECTION_HEADER

REGISTRY = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "desktop"
    / "src"
    / "lib"
    / "runtime-nudges.ts"
)

EXPECTED_EXACT = {
    COMPRESSION_CONTINUATION_USER_CONTENT,
    _LEGACY_COMPRESSION_CONTINUATION_USER_CONTENT,
    MAX_ITERATIONS_SUMMARY_REQUEST,
    _CODEX_INCOMPLETE_NUDGE,
    _CODEX_ACK_CONTINUATION_NUDGE,
    _DROPPED_TOOLCALL_NUDGE_CONTENT,
    _EMPTY_TOOL_RESPONSE_NUDGE,
    _LENGTH_CONTINUATION_NETWORK_STUB,
    _LENGTH_CONTINUATION_OUTPUT_LIMIT,
}

EXPECTED_PREFIXES = {
    _BACKGROUND_PROCESS_NOTIFICATION_PREFIX,
    TODO_INJECTION_HEADER + "\n",
    _LENGTH_CONTINUATION_DROPPED_TOOLS_PREFIX,
}


_JS_ESCAPES = {
    "\\": "\\",
    "'": "'",
    '"': '"',
    "n": "\n",
    "t": "\t",
    "r": "\r",
    "0": "\0",
}


def _unquote_js(literal: str) -> str:
    """One single- or double-quoted JS string literal, as its value.

    Both quote styles have to be handled: the file is GENERATED with double
    quotes, and then the repo formatter rewrites each one to single quotes
    unless the text contains an apostrophe.  Anchoring the test on either style
    would make ``npm run fix`` break it, which is how a guard test teaches people
    to delete guard tests.
    """
    literal = literal.strip().rstrip(",").strip()

    assert literal[:1] in "\"'" and literal[-1:] == literal[:1], (
        f"not a plain string literal (template literal? concatenation?): {literal!r} — "
        "these entries must stay verbatim so they can be compared byte-for-byte"
    )

    body = literal[1:-1]
    out: list[str] = []
    index = 0

    while index < len(body):
        char = body[index]

        if char == "\\" and index + 1 < len(body):
            nxt = body[index + 1]
            out.append(_JS_ESCAPES.get(nxt, nxt))
            index += 2
            continue

        out.append(char)
        index += 1

    return "".join(out)


def _resolve_entry(entry: str, source: str) -> str:
    """One array entry, as its value — a literal, or a const naming one.

    An entry may be a bare identifier when the same string is also needed by a
    predicate in the file, which is the only way to keep ONE copy of it there.
    Resolving it here preserves what matters: the comparison below is still
    byte-for-byte against the backend's own constant.
    """
    entry = entry.strip().rstrip(",").strip()

    if entry[:1] not in "\"'":
        declaration = re.search(
            rf"^const {re.escape(entry)} = (.+)$", source, re.M
        )
        assert declaration, (
            f"array entry {entry!r} is neither a string literal nor a `const "
            f"{entry} = '...'` in the same file"
        )
        entry = declaration.group(1)

    return _unquote_js(entry)


def _parse_array(source: str, name: str) -> set[str]:
    """Read one ``const NAME: readonly string[] = [ ... ]`` as a set."""
    match = re.search(
        rf"const {re.escape(name)}: readonly string\[\] = \[(.*?)\n\]",
        source,
        re.S,
    )

    assert match, f"{REGISTRY.name} has no `{name}` array — did the file move?"

    return {
        _resolve_entry(line, source)
        for line in match.group(1).strip().splitlines()
        if line.strip()
    }


@pytest.fixture(scope="module")
def source() -> str:
    assert REGISTRY.exists(), f"missing {REGISTRY}"
    return REGISTRY.read_text(encoding="utf-8")


def test_desktop_knows_every_exact_nudge(source: str) -> None:
    shipped = _parse_array(source, "EXACT")

    missing = EXPECTED_EXACT - shipped
    extra = shipped - EXPECTED_EXACT

    assert not missing, (
        "the runtime injects these on the user role and the desktop would render "
        f"them as things the human typed: {sorted(missing)}"
    )
    assert not extra, (
        "the desktop hides text the backend no longer injects; a real user turn "
        f"that happens to match would vanish from the transcript: {sorted(extra)}"
    )


def test_desktop_knows_every_nudge_prefix(source: str) -> None:
    shipped = _parse_array(source, "PREFIXES")

    assert shipped == EXPECTED_PREFIXES, (
        "prefix nudges carry a variable tail (process id, tool name, task list) "
        "so they cannot be matched whole; desktop and backend disagree: "
        f"missing={sorted(EXPECTED_PREFIXES - shipped)} "
        f"extra={sorted(shipped - EXPECTED_PREFIXES)}"
    )


def test_backend_recognizer_covers_the_same_set() -> None:
    """The two lists exist for different jobs, so neither may quietly shrink.

    Compaction uses its recognizer to avoid attributing a nudge to the human;
    the desktop uses its copy to avoid DRAWING it as the human.  A string that
    one treats as synthetic and the other does not is a bug in whichever side
    forgot, so pin that they agree at the source too.
    """
    from agent.context_compressor import ContextCompressor

    for text in EXPECTED_EXACT:
        assert ContextCompressor._is_synthetic_compression_user_turn(
            {"role": "user", "content": text}
        ), f"backend compaction no longer treats this as scaffolding: {text!r}"
