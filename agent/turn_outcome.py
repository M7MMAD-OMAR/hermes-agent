"""Post-turn outcome: what a turn delivered, what failed, what is still open.

The desktop folds a settled turn's working under a tally ("Edited 12 files, ran
30 commands"). The tally says how much happened; it never says what the user
got, what broke, or what is left for them. This module produces that account,
three short lists, and the desktop pins it at the end of the turn, outside the
fold. Design: ``docs/design/herwork-workspace.md``, Part 4.

Same two-site architecture as :mod:`agent.next_moves`, for the same reasons:

- **Staging** runs in :func:`agent.turn_finalizer.finalize_turn`, where the
  turn's own message list is still in hand. LLM-free, side-effect-free, and
  silent on every gate.
- **Dispatch** runs from the gateway seam after ``message.complete``. It builds
  the outcome (auxiliary model first, the local rules when that is off or
  fails), persists it on the turn's final assistant row so a reload shows it,
  and emits ``session.outcome`` carrying the CLIENT turn id the desktop sent
  with ``prompt.submit``.

One producer. The renderer never computes its own outcome tally: with the model
off the ``source: "rules"`` text is what it shows, so the two can never drift.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import threading
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from agent.next_moves import (
    MIN_RESPONSE_CHARS,
    NO_NEXT_MOVES_PLATFORMS,
    TurnEvidence,
    _clip as _clip_text,
    _main_runtime,
    auxiliary_block,
    auxiliary_flag,
    extract_evidence,
)
from tools.todo_tool import _ACTIVE_STATUSES

logger = logging.getLogger(__name__)

# Three lists, each 0 to 3 one-sentence items. Same numbers both ends:
# ``lib/turn-outcome.ts`` refuses anything longer from an older backend.
MAX_ITEMS = 3
ITEM_LIMIT = 140

OUTCOME_KEYS = ("delivered", "failed", "open")

# The display_metadata key on the final assistant row. Read by
# ``lib/chat-messages/hydration.ts`` when history is rehydrated.
DISPLAY_METADATA_KEY = "turn_outcome"



@dataclass
class TurnOutcome:
    delivered: List[str] = field(default_factory=list)
    failed: List[str] = field(default_factory=list)
    open: List[str] = field(default_factory=list)
    source: str = "rules"

    def is_empty(self) -> bool:
        return not (self.delivered or self.failed or self.open)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "delivered": list(self.delivered),
            "failed": list(self.failed),
            "open": list(self.open),
            "source": self.source,
        }


@dataclass
class OutcomeEvidence:
    """The turn's facts, extracted once while the messages are in hand."""

    turn: TurnEvidence
    todos: List[Mapping[str, Any]] = field(default_factory=list)
    errored: bool = False

    @property
    def open_todos(self) -> List[str]:
        items = []

        for todo in self.todos:
            status = str(todo.get("status") or "").strip().lower()
            content = str(todo.get("content") or "").strip()

            if content and status in _ACTIVE_STATUSES:
                items.append(content)

        return items


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def _outcome_config() -> Dict[str, Any]:
    """The ``auxiliary.turn_outcome`` block, or an empty dict."""
    return auxiliary_block("turn_outcome")


def turn_outcome_enabled(config: Optional[Mapping[str, Any]] = None) -> bool:
    return auxiliary_flag(config, "enabled", default=True, name="turn_outcome")


def turn_outcome_use_model(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Default ON, unlike next moves: the rules can only count, and counting is
    what the fold header already does."""
    return auxiliary_flag(config, "use_model", default=True, name="turn_outcome")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _clip(text: Any, limit: int = ITEM_LIMIT) -> str:
    return _clip_text(text, limit)


def validate_items(raw: Any) -> List[str]:
    """Coerce one list from the wire: strings only, blanks dropped, capped."""
    if not isinstance(raw, (list, tuple)):
        return []

    items: List[str] = []

    for entry in raw:
        if not isinstance(entry, str):
            continue

        text = _clip(entry)

        if text and text not in items:
            items.append(text)

        if len(items) >= MAX_ITEMS:
            break

    return items


def validate_outcome(raw: Any, source: str) -> Optional[TurnOutcome]:
    """A whole outcome or nothing. A shape that is not the contract is
    discarded, never partially trusted."""
    if not isinstance(raw, Mapping):
        return None

    outcome = TurnOutcome(source=source)

    for key in OUTCOME_KEYS:
        value = raw.get(key)

        if value is None:
            continue

        if not isinstance(value, (list, tuple)):
            return None

        setattr(outcome, key, validate_items(value))

    return outcome


# ---------------------------------------------------------------------------
# The local rules
# ---------------------------------------------------------------------------


def rules_outcome(evidence: OutcomeEvidence) -> TurnOutcome:
    """What can be said without a model: files edited, tools that failed,
    todos still open. Never invents; an empty list means nothing to say."""
    turn = evidence.turn
    outcome = TurnOutcome(source="rules")

    if turn.edited_files:
        shown = ", ".join(turn.edited_files[:MAX_ITEMS])
        more = len(turn.edited_files) - MAX_ITEMS
        suffix = f" and {more} more" if more > 0 else ""
        noun = "file" if len(turn.edited_files) == 1 else "files"
        outcome.delivered = [_clip(f"Edited {len(turn.edited_files)} {noun}: {shown}{suffix}")]

    outcome.failed = [_clip(f"{name} reported an error") for name in turn.failed_tools[:MAX_ITEMS]]

    if evidence.errored and not outcome.failed:
        outcome.failed = ["The turn ended in an error"]

    outcome.open = [_clip(item) for item in evidence.open_todos[:MAX_ITEMS]]

    return outcome


# ---------------------------------------------------------------------------
# The model
# ---------------------------------------------------------------------------


_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "turn_outcome",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                key: {"type": "array", "maxItems": MAX_ITEMS, "items": {"type": "string"}} for key in OUTCOME_KEYS
            },
            "required": list(OUTCOME_KEYS),
            "additionalProperties": False,
        },
    },
}

_SYSTEM_PROMPT = """You write the outcome line under a finished turn of a coding agent, for the \
person who asked for the work. Three lists, as JSON:
- `delivered`: what they now have. Name the thing (a file, a fix, an answer), never the count of \
edits that produced it.
- `failed`: what did not happen, or was skipped, and why, in a few words.
- `open`: what is still theirs to do or decide.
Rules:
- 0 to 3 items per list. One plain sentence each, under 140 characters, no markdown, no bullets.
- Only what the evidence shows. An empty list is the right answer when there is nothing to say.
- Write in the language the user wrote in, unless told otherwise.
- Never address the agent and never propose next work; that is a different surface."""


def _evidence_prompt(evidence: OutcomeEvidence) -> str:
    turn = evidence.turn
    lines = [f"User request: {_clip(turn.user_message, 600) or '(none)'}", ""]

    if turn.tool_calls:
        counts: Dict[str, int] = {}

        for name, _args in turn.tool_calls:
            counts[name] = counts.get(name, 0) + 1

        lines.append("Tools run: " + ", ".join(f"{name} x{count}" for name, count in counts.items()))

    if turn.edited_files:
        lines.append("Files edited: " + ", ".join(turn.edited_files[:12]))

    if turn.failed_tools:
        lines.append("Tools that reported an error: " + ", ".join(turn.failed_tools))

    if evidence.errored:
        lines.append("The turn itself ended in an error.")

    todos = evidence.open_todos

    if todos:
        lines.append("Todo items still open: " + "; ".join(_clip(item, 120) for item in todos[:8]))

    lines.extend(["", "Final reply:", _clip(turn.final_response, 2400) or "(empty)"])

    return "\n".join(lines)


def model_outcome(
    evidence: OutcomeEvidence,
    main_runtime: Optional[Dict[str, Any]] = None,
    config: Optional[Mapping[str, Any]] = None,
) -> Optional[TurnOutcome]:
    """One auxiliary call. Never raises: ``None`` means "use the rules"."""
    try:
        from agent.auxiliary_client import call_llm
        from utils import safe_json_loads

        if config is None:
            config = _outcome_config()

        language = str(config.get("language") or "").strip()
        system = _SYSTEM_PROMPT

        if language:
            system += f"\n- Write every item in {language}."

        response = call_llm(
            task="turn_outcome",
            main_runtime=main_runtime,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _evidence_prompt(evidence)},
            ],
            max_tokens=500,
            temperature=0.2,
            extra_body={"response_format": _RESPONSE_FORMAT},
        )
        parsed = safe_json_loads(response.choices[0].message.content or "")
    except Exception as exc:
        logger.debug("Turn-outcome model call failed: %s", exc)

        return None

    return validate_outcome(parsed, source="model")


def build_outcome(
    agent: Any, evidence: OutcomeEvidence, config: Optional[Mapping[str, Any]] = None
) -> TurnOutcome:
    """The model when it is on and answers in shape, the rules otherwise. The
    config block is read once per turn and handed down: every read takes the
    config lock and stats the file."""
    if config is None:
        config = _outcome_config()

    if turn_outcome_use_model(config):
        outcome = model_outcome(evidence, main_runtime=_main_runtime(agent), config=config)

        if outcome is not None and not outcome.is_empty():
            return outcome

    return rules_outcome(evidence)


# ---------------------------------------------------------------------------
# Staging (turn_finalizer) and dispatch (gateway seam)
# ---------------------------------------------------------------------------


def stage_turn_outcome(
    agent: Any,
    *,
    messages_snapshot: Sequence[Any],
    final_response: str,
    interrupted: bool,
    errored: bool = False,
) -> None:
    """Park this turn's evidence on the agent. Silent on every gate.

    Reuses the ``TurnEvidence`` next moves already extracted from this same
    snapshot when it left one, which saves a second walk over every message and
    tool call of the turn. Read here rather than passed in by the finalizer: a
    caller cannot then break the reuse by reordering the two stagers, and this
    stays a pure optimisation, extraction runs when the evidence is absent.
    """
    agent._turn_outcome_evidence = None

    # Only the surface that dispatches may stage (the desktop/TUI gateway sets
    # this on the agent it owns). Without the gate every CLI, cron and
    # delegated turn extracts evidence for a consumer that does not exist.
    if not getattr(agent, "_turn_outcome_dispatch", False):
        return

    # A stopped turn has no outcome to report; an errored one does, and that is
    # when `failed` matters most.
    if interrupted:
        return

    platform = str(getattr(agent, "platform", "") or "").lower()

    if platform in NO_NEXT_MOVES_PLATFORMS:
        return

    if not turn_outcome_enabled():
        return

    try:
        shared = getattr(agent, "_next_moves_evidence", None)
        turn = shared if isinstance(shared, TurnEvidence) else extract_evidence(agent, messages_snapshot, final_response)
    except Exception:
        logger.debug("Turn-outcome evidence extraction failed", exc_info=True)

        return

    # Triviality gate, shared with next moves: a turn that ran no tools and
    # answered briefly is conversation, and conversation has no outcome row.
    if not turn.tool_calls and len(turn.final_response) < MIN_RESPONSE_CHARS and not errored:
        return

    todos: List[Mapping[str, Any]] = []
    store = getattr(agent, "_todo_store", None)

    try:
        if store is not None and hasattr(store, "read"):
            todos = [item for item in store.read() if isinstance(item, Mapping)]
    except Exception:
        logger.debug("Todo store unreadable for turn outcome", exc_info=True)

    agent._turn_outcome_evidence = OutcomeEvidence(turn=turn, todos=todos, errored=bool(errored))


def cancel_turn_outcome(agent: Any) -> None:
    """Fence off an in-flight generation. Called when a fresh turn is admitted."""
    try:
        agent._turn_outcome_generation = int(getattr(agent, "_turn_outcome_generation", 0)) + 1
    except Exception:
        pass


def persist_outcome(agent: Any, evidence: OutcomeEvidence, outcome: TurnOutcome, turn_id: str) -> bool:
    """Write the outcome onto the turn's final assistant row so history carries
    it. Best effort: a failed write costs the reload, never the live event."""
    db = getattr(agent, "_session_db", None)
    session_id = getattr(agent, "session_id", None)
    merge = getattr(db, "merge_latest_matching_message_display_metadata", None)

    if db is None or not session_id or not callable(merge) or not evidence.turn.final_response:
        return False

    try:
        return bool(merge(
            session_id, role="assistant", content=evidence.turn.final_response,
            patch={DISPLAY_METADATA_KEY: {**outcome.as_dict(), "turn_id": turn_id}}))
    except Exception:
        logger.debug("Turn-outcome persistence failed", exc_info=True)

        return False


def dispatch_turn_outcome(
    agent: Any,
    *,
    session_id: str,
    status: str,
    emit: Callable[[str, str, Dict[str, Any]], Any],
    turn_id: str = "",
    agent_continued: bool = False,
) -> None:
    """Emit ``session.outcome`` for the turn that just completed.

    Called directly after ``message.complete``. An agent-driven continuation
    (/goal, /loop, crash resume) is skipped the way next moves skips it: the
    user asked once and should read one outcome, at the end of their turn, not
    one per hop. Unlike next moves an ERRORED turn still dispatches.
    """
    evidence = getattr(agent, "_turn_outcome_evidence", None)
    agent._turn_outcome_evidence = None

    if evidence is None or not session_id:
        return

    if agent_continued or status not in ("complete", "error"):
        return

    if status == "error":
        evidence.errored = True

    client_turn_id = str(turn_id or "")
    config = _outcome_config()

    def run() -> None:
        generation = int(getattr(agent, "_turn_outcome_generation", 0))

        try:
            outcome = build_outcome(agent, evidence, config=config)
        except Exception:
            logger.debug("Turn-outcome generation failed", exc_info=True)

            return

        if outcome.is_empty() or int(getattr(agent, "_turn_outcome_generation", 0)) != generation:
            return

        persist_outcome(agent, evidence, outcome, client_turn_id)
        emit(
            "session.outcome",
            session_id,
            {"session_id": session_id, "turn_id": client_turn_id, "outcome": outcome.as_dict()},
        )

    # The rules are string work and run inline; the model is a network round
    # trip and must never sit on the turn thread ahead of the /goal judge.
    if turn_outcome_use_model(config):
        threading.Thread(target=run, daemon=True, name="turn-outcome").start()
    else:
        run()
