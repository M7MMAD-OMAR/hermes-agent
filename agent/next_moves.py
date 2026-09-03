"""Post-turn "next moves" — what the user could do next, offered as draft edits.

After a turn settles, this produces 1-3 typed moves derived from what that turn
actually did, and the desktop paints them as pills above the composer
(``store/suggestion-providers/next-move.ts``). Design doc:
``docs/design/next-moves.md``.

Two halves, deliberately split across two sites:

- **Staging** runs in :func:`agent.turn_finalizer.finalize_turn`, beside the
  background-review gate, because that is where the turn's own message list is
  still in hand. It is LLM-free and side-effect-free: it extracts evidence and
  parks it on the agent.
- **Dispatch** runs from the gateway seam that fires *after*
  ``message.complete``. Staging cannot dispatch — ``finalize_turn`` returns
  before the desktop is told the turn ended, so an offer emitted there would
  arrive describing a turn the client has not settled yet.

Every move is a **draft edit**. Nothing here sends, spawns, or calls the
gateway: the pill strip has no dismiss affordance, so the user's only way to
decline is not to click, and that is only safe while a click is reversible.

The local rule table below is the floor, not a placeholder. With
``auxiliary.next_moves.use_model`` off it is the whole feature: no model call,
no latency, no spend — and it stays the fallback when the auxiliary model is
unreachable or answers with nonsense.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import re
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# The bus caps the strip well below this; the ceiling is here so a malformed
# model answer cannot flood the wire.
MAX_MOVES = 3

# What a move can be. `followup` and `action` insert prose, `skill` inserts a
# slash command, `delegate` inserts a delegation prompt — all four end up as
# text in the composer, and the user still presses Enter.
MOVE_KINDS = frozenset({"action", "delegate", "followup", "skill"})

# Pills are `max-w-56` with a truncating label. Anything longer is clipped by
# the strip, so cut it at the producer where the meaning is still known.
LABEL_LIMIT = 48
PAYLOAD_LIMIT = 400

# Surfaces with no strip to paint on. A verbatim mirror of
# `_UNTITLED_PLATFORMS` (agent/turn_context.py) and for the same reason:
# `finalize_turn` is shared by every surface, so without this every delegated
# child stages a snapshot nobody will ever read.
NO_NEXT_MOVES_PLATFORMS = frozenset({"cron", "subagent"})

# A turn that ran no tools and answered briefly is conversation, not work.
# Offering "what next" after it is the nagging failure mode.
MIN_RESPONSE_CHARS = 200

_SKILLS_BLOCK_RE = re.compile(r"<available_skills>(.*?)</available_skills>", re.DOTALL)

# Skill names as the prompt index renders them. Kept loose on purpose — the
# block's exact layout is the prompt builder's business, and a name we fail to
# parse simply means one fewer candidate.
_SKILL_NAME_RE = re.compile(r"^\s*[-*]?\s*`?([a-z0-9][a-z0-9_-]{2,})`?\s*[:—-]", re.MULTILINE)

# Tool output that reads like a failure. Deliberately narrow: a tool reporting
# its own semantics ("no matches found") is not a failed step, and proposing a
# retry for it is worse than proposing nothing. Same discipline as the MCP
# repair provider's matcher on the renderer side.
_TOOL_FAILURE_RE = re.compile(
    r"^\s*(?:error|traceback|exception|failed|fatal)\b"
    r"|\b(?:command (?:not found|failed)|permission denied|no such file or directory"
    r"|exit(?:ed with)? (?:code|status) [1-9]|non-zero exit)\b",
    re.IGNORECASE,
)

# A command that already ran the tests. Used only to NOT propose running them
# again — never to claim which runner a project uses.
_TEST_RUN_RE = re.compile(
    r"\b(?:pytest|vitest|jest|go test|cargo test|npm (?:run )?test|yarn test|pnpm test|tox|nox|ctest)\b",
    re.IGNORECASE,
)

_FILE_EDIT_TOOL_ARGS: Mapping[str, str] = {
    "patch": "path",
    "skill_manage": "file_path",
    "write_file": "path",
}


@dataclass
class NextMove:
    """One offer. `payload` is the text that lands in the draft."""

    kind: str
    label: str
    tip: str
    payload: str

    def as_dict(self) -> Dict[str, str]:
        return {"kind": self.kind, "label": self.label, "payload": self.payload, "tip": self.tip}


@dataclass
class TurnEvidence:
    """What the finished turn did, extracted once while the messages are here."""

    turn_id: str = ""
    user_message: str = ""
    final_response: str = ""
    tool_calls: List[Tuple[str, Mapping[str, Any]]] = field(default_factory=list)
    failed_tools: List[str] = field(default_factory=list)
    edited_files: List[str] = field(default_factory=list)
    skills: List[str] = field(default_factory=list)
    can_delegate: bool = False

    @property
    def ran_tests(self) -> bool:
        return any(_TEST_RUN_RE.search(_command_text(name, args)) for name, args in self.tool_calls)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def _next_moves_config() -> Dict[str, Any]:
    """The ``auxiliary.next_moves`` block, or an empty dict.

    Lazy import and the read-only loader, matching ``title_generator``: this
    module is imported from agent paths where a module-level ``hermes_cli``
    import risks circularity, and a post-turn read must never trigger a config
    migration write.
    """
    try:
        from hermes_cli.config import load_config_readonly

        config = load_config_readonly()
        block = (config.get("auxiliary") or {}).get("next_moves")

        return block if isinstance(block, dict) else {}
    except Exception:
        logger.debug("Failed to read auxiliary.next_moves", exc_info=True)

        return {}


def next_moves_enabled(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Whether the feature runs at all. Off means nothing is staged."""
    try:
        from utils import is_truthy_value

        block = _next_moves_config() if config is None else config

        return is_truthy_value(block.get("enabled"), default=True)
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------


def _text_of(value: Any) -> str:
    """Flatten a message ``content`` into plain text."""
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts = []

        for block in value:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, Mapping) and isinstance(block.get("text"), str):
                parts.append(block["text"])

        return "\n".join(parts)

    return ""


def _tool_call_name_and_args(call: Any) -> Tuple[str, Mapping[str, Any]]:
    if not isinstance(call, Mapping):
        return "", {}

    function = call.get("function")

    if isinstance(function, Mapping):
        name = str(function.get("name") or "")
        raw_args = function.get("arguments")
    else:
        name = str(call.get("name") or "")
        raw_args = call.get("arguments") or call.get("args")

    if isinstance(raw_args, Mapping):
        return name, raw_args

    if isinstance(raw_args, str) and raw_args.strip():
        try:
            from utils import safe_json_loads

            parsed = safe_json_loads(raw_args)

            if isinstance(parsed, Mapping):
                return name, parsed
        except Exception:
            pass

    return name, {}


def _turn_slice(messages: Sequence[Any]) -> List[Mapping[str, Any]]:
    """The messages belonging to the turn that just ended.

    Everything from the last user message onward. The whole conversation is
    the wrong window: a suggestion about a file touched twenty turns ago reads
    as the app having lost the thread.
    """
    rows = [m for m in messages if isinstance(m, Mapping)]

    for index in range(len(rows) - 1, -1, -1):
        if rows[index].get("role") == "user":
            return rows[index:]

    return rows


def _skill_names(agent: Any) -> List[str]:
    """The skills the MAIN model was told about, read out of its own prompt.

    Never a fresh scan. The block was built with this agent's own
    ``skills_dir_override``, so it is already scoped to this session's profile
    and project; ``find_project_root`` resolves against the process cwd, so a
    re-scan on a multi-session gateway can name another workspace's skills.
    """
    try:
        from agent.context_breakdown import build_system_prompt_parts

        stable = (build_system_prompt_parts(agent) or {}).get("stable") or ""
    except Exception:
        logger.debug("Skill index unavailable for next moves", exc_info=True)

        return []

    match = _SKILLS_BLOCK_RE.search(stable)

    if not match:
        return []

    seen: List[str] = []

    for name in _SKILL_NAME_RE.findall(match.group(1)):
        if name not in seen:
            seen.append(name)

    return seen


def _command_text(name: str, args: Mapping[str, Any]) -> str:
    """A tool call flattened enough to pattern-match against."""
    for key in ("command", "cmd", "script", "query"):
        value = args.get(key)

        if isinstance(value, str) and value:
            return f"{name} {value}"

    return name


def extract_evidence(agent: Any, messages: Sequence[Any], final_response: str) -> TurnEvidence:
    """Everything the rules and (later) the model prompt are allowed to see."""
    window = _turn_slice(messages)
    evidence = TurnEvidence(final_response=(final_response or "").strip())

    if window and window[0].get("role") == "user":
        evidence.user_message = _text_of(window[0].get("content"))

    pending: Dict[str, str] = {}

    for message in window:
        role = message.get("role")

        if role == "assistant":
            for call in message.get("tool_calls") or []:
                name, args = _tool_call_name_and_args(call)

                if not name:
                    continue

                evidence.tool_calls.append((name, args))

                call_id = str(message.get("id") or "") if not isinstance(call, Mapping) else str(call.get("id") or "")

                if call_id:
                    pending[call_id] = name

                arg_key = _FILE_EDIT_TOOL_ARGS.get(name)
                path = args.get(arg_key) if arg_key else None

                if isinstance(path, str) and path and path not in evidence.edited_files:
                    evidence.edited_files.append(path)

        elif role == "tool":
            text = _text_of(message.get("content"))

            if not _TOOL_FAILURE_RE.search(text[:400]):
                continue

            name = pending.get(str(message.get("tool_call_id") or "")) or str(message.get("name") or "")

            if name and name not in evidence.failed_tools:
                evidence.failed_tools.append(name)

    evidence.skills = _skill_names(agent)
    evidence.can_delegate = "delegate_task" in (getattr(agent, "valid_tool_names", None) or ())

    return evidence


# ---------------------------------------------------------------------------
# The local rule table
# ---------------------------------------------------------------------------


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())

    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def heuristic_moves(evidence: TurnEvidence) -> List[NextMove]:
    """At most one move, from evidence already in hand. No model, no network.

    One and not three on purpose: a rule cannot tell which of its own outputs
    is the interesting one, and three mechanical offers read as noise where a
    single well-aimed one reads as attention.
    """
    if evidence.failed_tools:
        tool = evidence.failed_tools[0]

        return [
            NextMove(
                kind="action",
                label=_clip(f"Retry the {tool} step", LABEL_LIMIT),
                tip=f"{tool} failed during this turn.",
                payload=f"The `{tool}` step failed. Work out why and try a different approach.",
            )
        ]

    if evidence.edited_files and not evidence.ran_tests:
        return [
            NextMove(
                kind="action",
                label="Run the tests",
                tip=f"{len(evidence.edited_files)} file(s) changed and nothing ran the tests.",
                # Deliberately does not name a runner: the agent knows the
                # project's, and a wrong command is worse than a prompt.
                payload="Run the tests that cover what we just changed, and fix anything that fails.",
            )
        ]

    hinted = _skill_hint(evidence)

    if hinted:
        return [
            NextMove(
                kind="skill",
                label=_clip(f"Use /{hinted}", LABEL_LIMIT),
                tip=f"You mentioned {hinted}, and it is installed.",
                payload=f"/{hinted} ",
            )
        ]

    return []


def _skill_hint(evidence: TurnEvidence) -> str:
    """A skill the user named and the turn did not already use."""
    message = evidence.user_message.lower()

    if not message:
        return ""

    used = {name for name, _ in evidence.tool_calls}

    for skill in evidence.skills:
        if skill in used:
            continue

        # Whole-word only. Without this a skill named `read` matches "already".
        if re.search(rf"(?<![a-z0-9]){re.escape(skill)}(?![a-z0-9-])", message):
            return skill

    return ""


def validate_moves(raw: Any) -> List[NextMove]:
    """Coerce an untrusted move list. Anything malformed yields nothing.

    Zero rather than a partial strip: a half-valid pack renders as a confident
    offer that happens to be missing the useful half.
    """
    if not isinstance(raw, list) or not raw:
        return []

    moves: List[NextMove] = []

    for entry in raw[:MAX_MOVES]:
        if not isinstance(entry, Mapping):
            return []

        kind = str(entry.get("kind") or "").strip()
        label = _clip(entry.get("label"), LABEL_LIMIT)
        payload = _clip(entry.get("payload"), PAYLOAD_LIMIT)

        if kind not in MOVE_KINDS or not label or not payload:
            return []

        moves.append(NextMove(kind=kind, label=label, tip=_clip(entry.get("tip"), PAYLOAD_LIMIT), payload=payload))

    return moves


# ---------------------------------------------------------------------------
# Staging (turn_finalizer) and dispatch (gateway seam)
# ---------------------------------------------------------------------------


def stage_next_moves(
    agent: Any,
    *,
    messages_snapshot: Sequence[Any],
    final_response: str,
    interrupted: bool,
    turn_id: str = "",
) -> None:
    """Park this turn's evidence on the agent. LLM-free and side-effect-free.

    Silent on every gate: a surface with no strip, a turn with nothing in it,
    or a feature switch that is off must cost nothing here, because this runs
    on every turn of every surface.
    """
    agent._next_moves_evidence = None

    if interrupted or not final_response:
        return

    platform = str(getattr(agent, "platform", "") or "").lower()

    if platform in NO_NEXT_MOVES_PLATFORMS:
        return

    if not next_moves_enabled():
        return

    try:
        evidence = extract_evidence(agent, messages_snapshot, final_response)
    except Exception:
        logger.debug("Next-moves evidence extraction failed", exc_info=True)

        return

    # Triviality gate. A turn that ran no tools and answered briefly did not do
    # work there is a next move for.
    if not evidence.tool_calls and len(evidence.final_response) < MIN_RESPONSE_CHARS:
        return

    evidence.turn_id = str(turn_id or "")
    agent._next_moves_evidence = evidence


def build_moves(agent: Any, evidence: TurnEvidence) -> Tuple[List[NextMove], str]:
    """Return ``(moves, source)``. Local rules today; the model lands here."""
    return heuristic_moves(evidence), "heuristic"


def dispatch_next_moves(
    agent: Any,
    *,
    session_id: str,
    status: str,
    emit: Callable[[str, str, Dict[str, Any]], Any],
    agent_continued: bool = False,
    billing_blocked: bool = False,
) -> None:
    """Emit ``next_moves.offer`` for the turn that just completed.

    Called from the gateway seam directly after ``message.complete``. Every
    condition below is a hard gate, and an empty result emits NOTHING — no
    event, no empty strip.
    """
    evidence = getattr(agent, "_next_moves_evidence", None)
    agent._next_moves_evidence = None

    if evidence is None or not session_id:
        return

    # A turn nobody drove. `/goal` continuations, `/loop` ticks and
    # compression-recovery resubmits all produce their own message.complete,
    # so one user prompt yields N of them; offering after each is the app
    # talking to itself.
    if agent_continued or billing_blocked or status != "complete":
        return

    try:
        moves, source = build_moves(agent, evidence)
    except Exception:
        logger.debug("Next-moves generation failed", exc_info=True)

        return

    if not moves:
        return

    emit(
        "next_moves.offer",
        session_id,
        {
            "moves": [move.as_dict() for move in moves[:MAX_MOVES]],
            "session_id": session_id,
            "source": source,
            "turn_id": evidence.turn_id,
        },
    )
