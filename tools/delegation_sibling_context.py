"""What a thread knows about its siblings and its project.

In the recording this plan is drawn from, a thread's status line reads "Read
the sibling threads and project context". Threads are not isolated workers:
one that is tracing a style's history should know that another is already
drawing the figures, so the two do not converge on the same answer twice or
contradict each other.

Two rules shape everything here.

**Summaries, never transcripts.** A sibling contributes its NAME and one line,
not its messages. The measured reality on a live machine is 24 threads under a
single coordinator, averaging 96 messages each; pasting even a fraction of that
into every sibling is how a context budget dies at four threads.

**Bounded by tokens, not characters.** A character budget passes every test
written with English fixtures and then blows the real budget on Arabic or CJK,
where a character costs two to four times what an ASCII character costs.
:func:`agent.model_metadata.estimate_tokens_rough` is the same estimator the
compaction preflight uses, so this budget and that one speak one language.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Small on purpose. This rides on EVERY child's system prompt, so it is charged
# once per sibling per spawn; a generous budget here is a bill multiplied by
# the fan-out width.
DEFAULT_SIBLING_TOKEN_BUDGET = 400

# One sibling's line is truncated before the budget is even consulted, so a
# single thread with a runaway label cannot consume the whole allowance.
MAX_SIBLING_LINE_CHARS = 160

# Beyond this the list stops being context and starts being a directory.
MAX_SIBLINGS = 12

_HEADER = "Sibling threads already running for this conversation:"
_FOOTER = (
    "Do not redo work a sibling owns. If your goal overlaps one, say so in your "
    "result rather than duplicating it."
)


def _estimate(text: str) -> int:
    from agent.model_metadata import estimate_tokens_rough

    return estimate_tokens_rough(text)


def _clip(text: str, limit: int = MAX_SIBLING_LINE_CHARS) -> str:
    body = " ".join(str(text or "").split())

    return body if len(body) <= limit else body[: limit - 1].rstrip() + "…"


def sibling_lines(siblings: List[Dict[str, Any]]) -> List[str]:
    """One line per sibling: its label, its state, and what it is doing.

    A sibling with no activity line still gets its name and state, because
    knowing a thread EXISTS is most of the value.
    """
    lines: List[str] = []
    for sibling in siblings[:MAX_SIBLINGS]:
        label = _clip(sibling.get("label") or sibling.get("session_id") or "")
        if not label:
            continue
        state = str(sibling.get("state") or "").strip()
        activity = _clip(sibling.get("activity") or "", 80)
        suffix = f", {activity}" if activity else ""
        lines.append(f"- {label} ({state}{suffix})" if state else f"- {label}{suffix}")
    return lines


def build_sibling_context(
    siblings: List[Dict[str, Any]],
    *,
    token_budget: int = DEFAULT_SIBLING_TOKEN_BUDGET,
) -> Optional[str]:
    """A bounded sibling block, or None when there is nothing worth saying.

    Lines are added while they fit and the first one that does not ends the
    list: a thread that learns about three of its siblings is far better off
    than one whose prompt was silently truncated mid-sentence by a downstream
    budget it never saw.
    """
    lines = sibling_lines(siblings)
    if not lines:
        return None

    budget = max(0, int(token_budget or 0))
    if budget <= 0:
        return None

    # The frame is charged first: a block whose header and footer alone exceed
    # the budget is not worth sending at all.
    frame_cost = _estimate(_HEADER) + _estimate(_FOOTER)
    if frame_cost >= budget:
        return None

    kept: List[str] = []
    spent = frame_cost
    for line in lines:
        cost = _estimate(line)
        if spent + cost > budget:
            break
        kept.append(line)
        spent += cost

    if not kept:
        return None

    omitted = len(lines) - len(kept)
    tail = f"- ...and {omitted} more" if omitted > 0 else ""

    return "\n".join([_HEADER, *kept, *( [tail] if tail else [] ), "", _FOOTER])


def merge_context(base: Optional[str], sibling_block: Optional[str]) -> Optional[str]:
    """The caller's context with the sibling block appended.

    The caller's own text comes FIRST and is never trimmed: it is the
    instruction, and sibling awareness is background. Returning ``base``
    unchanged when there is no block keeps the no-siblings path byte for byte
    what it was before this module existed.
    """
    if not sibling_block:
        return base
    if not base:
        return sibling_block

    return f"{base}\n\n{sibling_block}"


def siblings_from_registry(parent_agent: Any, exclude_subagent_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Live siblings owned by this parent, shaped for :func:`build_sibling_context`.

    Reads the live registry rather than the database: a sibling spawned in the
    same batch has no durable row yet, and those are exactly the siblings whose
    overlap matters most. Never raises, because a context nicety must not be
    able to fail a spawn.
    """
    try:
        from tools.delegate_tool_registry import _list_payload

        payload = _list_payload(parent_agent) or {}
        records = payload.get("subagents") or []
    except Exception:  # noqa: BLE001 - context is a nicety, never a spawn blocker
        logger.debug("sibling context: could not read the live registry", exc_info=True)
        return []

    siblings: List[Dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        if exclude_subagent_id and record.get("subagent_id") == exclude_subagent_id:
            continue
        siblings.append({
            "activity": record.get("last_tool") or "",
            "label": record.get("goal") or "",
            "session_id": record.get("subagent_id") or "",
            "state": "working" if record.get("status") in (None, "running", "queued") else str(record.get("status")),
        })
    return siblings
