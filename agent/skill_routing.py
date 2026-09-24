"""Raise the two or three skills a turn is actually about above the other fifty.

Sixty skills render about 5,000 tokens of one-line entries into the system
prompt's volatile tier, built once per session and never revisited. On a
caching provider that is a cached read, so this is not a cost problem. It is a
**discovery** problem: a list that long is a list the right entry does not
stand out in, and a skill nobody reaches for is a skill that was never
installed.

So this adds one short line to the turn, naming the likeliest few. It does not
touch the catalogue, which stays complete and cached, and it does not touch
the system prompt at all: the hint rides the ephemeral channel
(``_collect_pre_llm_call_context`` -> ``build_api_messages``) that is injected
per turn and never cached. ``build_system_prompt_parts`` builds three cache
tiers once per session and is documented as "never re-rendered mid-session";
making the skills index per turn would invalidate the volatile tier every
turn and cost more than it could ever save.

**The picker is local, and that is the point.** The hint has to exist before
``build_api_messages`` runs, so unlike ``_maybe_title_session_at_turn_start``
(which the conversation loop deliberately runs in a daemon thread so the turn
does not wait on it) it cannot be backgrounded. An LLM picker would therefore
put a blocking call and a bill on every single user turn, to buy something
nobody has measured. A lexical match costs nothing, adds no latency, needs no
key, has no injection surface, and tests deterministically. ``pick_skills`` is
one pure function, so an LLM backend can replace it later against evidence.

The catalogue is parsed out of the **rendered index the model is already
looking at**, not re-derived from disk. That is not laziness: visibility rules
(disabled skills, platform gates, tool and toolset conditions, project
shadowing) live in ``agent/prompt_builder.py``, and a second implementation
would eventually hint at a skill the model cannot see. Reading the rendered
text makes that impossible by construction.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

#: Below this many visible skills the model can already read the whole list and
#: a hint is noise.
DEFAULT_MIN_SKILLS = 12

#: "ok", "go on", "continue" are not skill-selection problems.
DEFAULT_MIN_CHARS = 24

#: More than a few names stops being a hint and becomes a second catalogue.
DEFAULT_MAX_SKILLS = 3

#: A turn that matches nothing gets no hint. Without a floor the picker always
#: returns its three least-bad guesses, which is worse than silence: it teaches
#: the reader to ignore the line.
DEFAULT_MIN_SCORE = 3.0

#: Only the head of a long message is scored. This bounds the work, not the
#: relevance: a long paste that genuinely is about another skill should rank
#: that skill, because then it is what the turn is about.
MAX_SCORED_CHARS = 2000

# A skill line in the rendered index: `    - name: description [tag, tag]`.
# Category lines carry no dash and so cannot match.
_CATALOGUE_LINE_RE = re.compile(r"^\s+-\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s*:\s*(.+)$")

# Trailing `[tag, tag]` on a skill line.
_TAGS_RE = re.compile(r"\[([^\[\]]+)\]\s*$")

# Unicode-aware by default for str patterns, so Arabic and CJK both survive.
_WORD_RE = re.compile(r"\w+", re.UNICODE)

# CJK has no spaces, so a run of ideographs tokenises as one giant word that
# only ever matches itself. Character bigrams give those runs something to
# match on.
_CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿]")

#: Words that appear in most requests and in most descriptions, so they score
#: everything equally and rank nothing. English only on purpose: the Arabic and
#: CJK equivalents cannot collide with an English catalogue anyway.
_STOPWORDS = frozenset("""
a an and are as at be by can do does for from get have how i if in into is it
its me my need of on or please should so that the their them then there these
this to up use used uses using want was what when where which who why will with
would you your
""".split())

#: A token shorter than this is almost always noise ("a", "to", "id").
_MIN_TOKEN_CHARS = 3

_NAME_WEIGHT = 3.0
_TAG_WEIGHT = 2.0
_DESCRIPTION_WEIGHT = 1.0


@dataclass(frozen=True)
class SkillEntry:
    """One visible skill, as the model sees it in the rendered index."""

    name: str
    description: str
    tags: Tuple[str, ...] = ()


def catalogue_entries(skills_prompt: str) -> List[SkillEntry]:
    """Parse the rendered skills index into its entries.

    Returns ``[]`` for anything unparseable rather than raising: a hint is a
    nicety and must never be able to fail a turn.
    """
    entries: List[SkillEntry] = []
    seen: set[str] = set()
    for line in (skills_prompt or "").split("\n"):
        match = _CATALOGUE_LINE_RE.match(line)
        if not match:
            continue
        name = match.group(1)
        if name in seen:
            continue
        body = match.group(2).strip()
        tags: Tuple[str, ...] = ()
        tag_match = _TAGS_RE.search(body)
        if tag_match:
            tags = tuple(part.strip() for part in tag_match.group(1).split(",") if part.strip())
            body = body[: tag_match.start()].strip()
        seen.add(name)
        entries.append(SkillEntry(name=name, description=body, tags=tags))
    return entries


def _tokens(text: str) -> set[str]:
    """Content words, plus character bigrams for any CJK run."""
    out: set[str] = set()
    for word in _WORD_RE.findall((text or "").casefold()):
        if _CJK_RE.search(word):
            # The run itself stays (an exact repeat should still match) alongside
            # its bigrams.
            out.add(word)
            out.update(word[i:i + 2] for i in range(len(word) - 1))
            continue
        if len(word) >= _MIN_TOKEN_CHARS and word not in _STOPWORDS:
            out.add(word)
    return out


def _name_tokens(name: str) -> set[str]:
    """A skill name contributes its parts as well as itself: ``artifact-design``
    should be reachable from "artifact" and from "design"."""
    parts = {part for part in re.split(r"[._-]+", name.casefold()) if len(part) >= _MIN_TOKEN_CHARS}
    parts.add(name.casefold())
    return parts


def score_skill(message_tokens: set[str], entry: SkillEntry) -> float:
    """How well one skill matches the turn.

    The name outweighs the tags and the tags outweigh the description, because a
    request that says "orbit" means the skill called orbit, while a word shared
    with a description is much weaker evidence.
    """
    if not message_tokens:
        return 0.0
    score = _NAME_WEIGHT * len(message_tokens & _name_tokens(entry.name))
    tag_tokens: set[str] = set()
    for tag in entry.tags:
        tag_tokens |= _tokens(tag)
    score += _TAG_WEIGHT * len(message_tokens & tag_tokens)
    score += _DESCRIPTION_WEIGHT * len(message_tokens & _tokens(entry.description))
    return score


def pick_skills(
    message: str,
    entries: Sequence[SkillEntry],
    *,
    max_skills: int = DEFAULT_MAX_SKILLS,
    min_score: float = DEFAULT_MIN_SCORE,
) -> List[str]:
    """The likeliest few skill names for *message*, best first; ``[]`` when nothing
    scores well enough.

    Pure: message in, names out. Ties break by name so the hint does not flicker
    between two equally-scored skills from one turn to the next.
    """
    if not entries:
        return []
    tokens = _tokens(str(message or "")[:MAX_SCORED_CHARS])
    if not tokens:
        return []
    scored = [(score_skill(tokens, entry), entry.name) for entry in entries]
    ranked = sorted(
        ((score, name) for score, name in scored if score >= min_score),
        key=lambda pair: (-pair[0], pair[1]),
    )
    return [name for _score, name in ranked[: max(0, int(max_skills))]]


def format_hint(names: Iterable[str]) -> str:
    """The one line that rides the ephemeral channel, or ``""``.

    Deliberately a pointer, not an instruction: the catalogue already tells the
    model what to do with a skill, and a second imperative here would fight it.
    """
    listed = [str(name) for name in names if str(name).strip()]
    if not listed:
        return ""
    return f"Likely relevant skills for this request: {', '.join(listed)}."


def _routing_config(agent: Any) -> dict:
    try:
        from hermes_cli.config import load_config_readonly

        skills = load_config_readonly().get("skills")
        auto = skills.get("auto_select") if isinstance(skills, dict) else None
        return auto if isinstance(auto, dict) else {}
    except Exception:
        logger.debug("skill routing: config unreadable", exc_info=True)
        return {}


def _int_setting(config: dict, key: str, default: int) -> int:
    raw = config.get(key, default)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return default
    return max(0, int(raw))


def _mode(config: dict) -> str:
    """``off`` (default), ``shadow`` (decide and log only), or ``on``."""
    from utils import is_truthy_value

    raw = config.get("mode")
    if isinstance(raw, str) and raw.strip().lower() in {"off", "shadow", "on"}:
        return raw.strip().lower()
    return "on" if is_truthy_value(config.get("enabled", False)) else "off"


def _message_text(user_message: Any) -> str:
    """The text of a turn whose message may be a multimodal content-part list."""
    if isinstance(user_message, str):
        return user_message
    if isinstance(user_message, list):
        parts = [
            part.get("text", "")
            for part in user_message
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "\n".join(str(text) for text in parts if text)
    return ""


def _skills_prompt_for(agent: Any) -> str:
    """The rendered index this agent's system prompt carries."""
    from agent.system_prompt import _skills_prompt

    return _skills_prompt(agent) or ""


def begin_turn(agent: Any, user_message: Any) -> None:
    """Set ``agent._skill_hint`` for this turn. Never raises.

    Called from the per-turn band at the top of ``_run_conversation_turn``, so
    one call site covers the CLI, the gateway, the desktop, subagents and kanban
    workers with no per-surface branch.
    """
    agent._skill_hint = ""
    try:
        config = _routing_config(agent)
        mode = _mode(config)
        if mode == "off":
            return

        message = _message_text(user_message)
        if len(message.strip()) < _int_setting(config, "min_chars", DEFAULT_MIN_CHARS):
            return

        entries = catalogue_entries(_skills_prompt_for(agent))
        if len(entries) < _int_setting(config, "min_skills", DEFAULT_MIN_SKILLS):
            return

        names = pick_skills(
            message,
            entries,
            max_skills=_int_setting(config, "max_skills", DEFAULT_MAX_SKILLS),
            min_score=float(config.get("min_score", DEFAULT_MIN_SCORE) or DEFAULT_MIN_SCORE),
        )
        if not names:
            return

        if mode == "shadow":
            logger.info("skill routing (shadow): would hint %s", ", ".join(names))
            return

        agent._skill_hint = format_hint(names)
    except Exception:
        # A hint is a nicety. It must never be able to fail a turn.
        logger.debug("skill routing failed; continuing without a hint", exc_info=True)
        agent._skill_hint = ""


def hint_for(agent: Any) -> str:
    """This turn's hint, or ``""``. Read by the turn-context assembler."""
    hint = getattr(agent, "_skill_hint", "")
    return hint if isinstance(hint, str) else ""


def merge_into_context(agent: Any, existing: Optional[str]) -> str:
    """Append this turn's hint to the ephemeral context.

    The caller's context comes first and is never trimmed: plugin context and
    gateway notes are the substance, and a skill pointer is background.
    """
    hint = hint_for(agent)
    if not hint:
        return existing or ""
    if not existing:
        return hint
    return f"{existing}\n\n{hint}"
