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

import json
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


def _parse_array(source: str, name: str) -> set[str]:
    """Read one ``const NAME: readonly string[] = [ ... ]`` as a set.

    Parsed rather than executed, and the entries are read as JSON: the file is
    generated from these very constants, so every entry is a plain
    double-quoted string with JSON escaping.  A hand-edited entry that uses a
    template literal or single quotes will not parse — which is the correct
    failure, since it also means the string is no longer verbatim.
    """
    match = re.search(
        rf"const {re.escape(name)}: readonly string\[\] = \[(.*?)\n\]",
        source,
        re.S,
    )

    assert match, f"{REGISTRY.name} has no `{name}` array — did the file move?"

    return {
        json.loads(line.strip().rstrip(","))
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
