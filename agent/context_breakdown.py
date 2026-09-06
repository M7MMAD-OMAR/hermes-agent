"""Live session context-window breakdown for UI surfaces.

Estimates how the next provider request is composed: system prompt tiers,
tool schemas, and conversation history. Uses the same rough char/4 heuristic
as ``agent.model_metadata.estimate_request_tokens_rough`` so numbers align
with compression thresholds — not exact tokenizer counts.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from utils import safe_json_loads

_SKILLS_BLOCK_RE = re.compile(r"<available_skills>.*?</available_skills>", re.DOTALL)
_SUBAGENT_TOOL_NAMES = frozenset({"delegate_task"})

# Files carved out of the conversation blob. Names are resolved from the
# canonical "file" toolset at runtime, never hand-copied — see _file_tool_names.
_FILE_TOOLSET = "file"

# The subset whose ``path`` argument names ONE file, so it can be counted.
# ``search_files`` takes a directory (and ``patch`` in V4A mode takes no path
# at all) — both still cost file tokens, neither is a countable file. The same
# distinction is drawn in ``agent/context_compressor.py``'s per-tool result
# summariser; if a file tool gains or loses a path argument, both need editing.
_FILE_PATH_TOOL_NAMES = frozenset({"read_file", "write_file", "patch"})

# id -> (label, dashboard color, /context glyph); declaration order is display order.
_CATEGORIES = {
    "system_prompt": ("System prompt", "var(--context-usage-system)", "■"),
    "tool_definitions": ("Tool definitions", "var(--context-usage-tools)", "▣"),
    "rules": ("Rules", "var(--context-usage-rules)", "▩"),
    "skills": ("Skills", "var(--context-usage-skills)", "▤"),
    "mcp": ("MCP", "var(--context-usage-mcp)", "▥"),
    "subagent_definitions": ("Subagent definitions", "var(--context-usage-subagents)", "▦"),
    "memory": ("Memory", "var(--context-usage-memory)", "▧"),
    "files": ("Files", "var(--context-usage-files)", "◧"),
    "conversation": ("Conversation", "var(--context-usage-conversation)", "▨"),
}
_FREE_GLYPH = "·"
_GRID_COLUMNS = 20
_GRID_ROWS = 5  # 100 cells → 1 cell per percent of the context window
_DETAILS_TABLE_LIMIT = 15  # display cap only; the underlying data keeps everything


def _chars_to_tokens(text: str) -> int:
    return (len(text) + 3) // 4


def _json_tokens(value: Any) -> int:
    return _chars_to_tokens(json.dumps(value, ensure_ascii=False)) if value else 0


def _bytes_to_tokens(size: Optional[int]) -> Optional[int]:
    return None if size is None else (int(size) + 3) // 4


def _skills_block(stable: str) -> str:
    """The live ``<available_skills>`` block inside the stable tier, or ''."""
    m = _SKILLS_BLOCK_RE.search(stable)
    return m.group(0) if m else ""


def _split_tools(tools: Sequence[dict]) -> Tuple[List[dict], List[dict], List[dict]]:
    builtin: List[dict] = []
    mcp: List[dict] = []
    subagent: List[dict] = []
    for tool in tools:
        fn = tool.get("function") if isinstance(tool, dict) else None
        name = str((fn if isinstance(fn, dict) else tool).get("name") or "")
        bucket = mcp if name.startswith("mcp_") else subagent if name in _SUBAGENT_TOOL_NAMES else builtin
        bucket.append(tool)
    return builtin, mcp, subagent


def _memory_blocks(agent: Any) -> Tuple[str, str]:
    memory_block = user_block = ""
    store = getattr(agent, "_memory_store", None)
    try:
        if store is not None and getattr(agent, "_memory_enabled", True):
            memory_block = store.format_for_system_prompt("memory") or ""
        if store is not None and getattr(agent, "_user_profile_enabled", True):
            user_block = store.format_for_system_prompt("user") or ""
    except Exception:
        pass
    return memory_block, user_block


def _file_tool_names() -> frozenset:
    """The live "file" toolset's tool names.

    Resolved from the registry — never from a hand-copied literal, which is
    what actually goes stale when a file tool is added or renamed.
    ``include_registry=False`` already expands the toolset's static definition
    and its nested includes, so there is nothing weaker to fall back to.
    """
    try:
        from toolsets import resolve_toolset

        return frozenset(resolve_toolset(_FILE_TOOLSET, include_registry=False) or ())
    except Exception:
        return frozenset()


def _tool_name(call: Any) -> str:
    """A tool call's function name (``function.name``, or a flat ``name``).

    Restored: the 2 Sept 2026 simplify pass (7a9e36f226) dropped this helper
    but kept its caller in ``_file_context_stats``, so every breakdown over a
    transcript with tool calls raised ``NameError`` and the desktop context
    panel showed "No context data yet" for the whole session.
    """
    fn = call.get("function") if isinstance(call, dict) else None
    if isinstance(fn, dict):
        return str(fn.get("name") or "")
    return str(call.get("name") or "") if isinstance(call, dict) else ""


def _raw_arguments(call: Any) -> str:
    """A tool call's ``arguments`` as text, for sizing without re-encoding."""
    fn = call.get("function") if isinstance(call, dict) else None
    raw = (fn or {}).get("arguments") if isinstance(fn, dict) else None
    if isinstance(raw, str):
        return raw
    return json.dumps(raw, ensure_ascii=False) if raw else ""


def _call_arguments(call: Any) -> Dict[str, Any]:
    """Best-effort decode of a tool call's ``arguments`` (a JSON string)."""
    fn = call.get("function") if isinstance(call, dict) else None
    raw = (fn or {}).get("arguments") if isinstance(fn, dict) else None
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    decoded = safe_json_loads(raw, {})
    return decoded if isinstance(decoded, dict) else {}


def _file_context_stats(messages: Sequence[dict]) -> Tuple[int, int]:
    """Split file I/O out of the conversation blob.

    Returns ``(tokens, distinct_file_count)``. Both halves of a file round-trip
    are counted: the assistant's ``tool_calls`` entry (which for ``write_file``
    and ``patch`` carries the whole payload) and the tool result it is answered
    with.

    A result is identified by its own ``name`` / ``tool_name`` — every producer
    stamps one (``tool_dispatch_helpers._build_tool_message`` and the four
    synthetic paths in ``conversation_loop``). That matters: pairing a result to
    its call by ``tool_call_id`` breaks the moment compaction drops the
    assistant turn but keeps the result, which is exactly when the window is
    full and someone opens the panel. ``tool_call_id`` stays as the fallback for
    transcripts whose results carry no name.

    Estimated with the same memoized per-message pass the conversation total
    uses, so the two are directly comparable and the caller can subtract.
    """
    from agent.model_metadata import estimate_messages_tokens_rough

    names = _file_tool_names()
    tokens = 0
    paths: set = set()
    file_call_ids: set = set()

    for msg in messages or ():
        if not isinstance(msg, dict):
            continue

        if msg.get("role") == "tool":
            result_name = str(msg.get("name") or msg.get("tool_name") or "").strip()
            call_id = str(msg.get("tool_call_id") or "")
            claimed = result_name in names if result_name else call_id in file_call_ids
            if claimed:
                tokens += estimate_messages_tokens_rough([msg])
            continue

        for call in msg.get("tool_calls") or ():
            if not isinstance(call, dict):
                continue
            name = _tool_name(call)
            if name not in names:
                continue

            call_id = str(call.get("id") or "")
            if call_id:
                file_call_ids.add(call_id)

            # Size from the raw argument text rather than re-serialising the
            # call: json.dumps would re-escape the whole payload (a write_file
            # body can be 100KB) purely to measure it.
            tokens += _chars_to_tokens(name) + _chars_to_tokens(_raw_arguments(call))

            if name in _FILE_PATH_TOOL_NAMES:
                path = str(_call_arguments(call).get("path") or "").strip()
                if path:
                    paths.add(path)

    return tokens, len(paths)


def _strip_blocks(text: str, *blocks: str) -> str:
    for block in blocks:
        if block:
            text = text.replace(block, "")
    return text.strip()


def _join(*parts: str) -> str:
    return "\n\n".join(part for part in parts if part).strip()


def _glyph(cat: Dict[str, Any]) -> str:
    return _CATEGORIES.get(str(cat.get("id") or ""), (None, None, "▪"))[2]


def compute_session_context_breakdown(agent: Any, messages: Optional[List[dict]] = None) -> Dict[str, Any]:
    """Return a Cursor-style context usage breakdown for one live agent."""
    from agent.model_metadata import anchored_context_tokens, estimate_messages_tokens_rough
    from agent.system_prompt import build_system_prompt_parts

    messages = messages or []
    parts = build_system_prompt_parts(agent)
    stable = parts.get("stable", "") or ""
    skills_index = _skills_block(stable)
    memory_block, user_block = _memory_blocks(agent)
    system_prompt_text = _join(
        _strip_blocks(stable, skills_index), _strip_blocks(parts.get("volatile", "") or "", memory_block, user_block)
    )
    builtin_tools, mcp_tools, subagent_tools = _split_tools(list(getattr(agent, "tools", None) or []))

    # File I/O is the single biggest thing people want broken out of
    # "Conversation" — it answers "how much of my window is files, and how
    # many". Clamped so the two halves can never sum past the transcript: the
    # file figure adds a per-call JSON estimate to per-message estimates, which
    # is close but not identical arithmetic.
    conversation_tokens = estimate_messages_tokens_rough(messages)
    file_tokens, file_count = _file_context_stats(messages or [])
    file_tokens = max(0, min(file_tokens, conversation_tokens))
    conversation_tokens -= file_tokens

    tokens_by_id = {
        "system_prompt": _chars_to_tokens(system_prompt_text),
        "tool_definitions": _json_tokens(builtin_tools),
        "rules": _chars_to_tokens(parts.get("context", "") or ""),
        "skills": _chars_to_tokens(skills_index),
        "mcp": _json_tokens(mcp_tools),
        "subagent_definitions": _json_tokens(subagent_tools),
        "memory": _chars_to_tokens(_join(memory_block, user_block)),
        "files": file_tokens,
        "conversation": conversation_tokens,
    }
    estimated_total = sum(tokens_by_id.values())

    comp = getattr(agent, "context_compressor", None)
    context_max = int(getattr(comp, "context_length", 0) or 0) if comp else 0
    # Usage-anchored figure (provider-exact tokens of a response + delta of what was
    # appended since) beats last_prompt_tokens (lags) and the heuristic. Prefer the
    # turn-base anchor: on reasoning models later same-turn responses inflate
    # prompt_tokens with replayed thinking that evaporates at the turn boundary, so
    # anchoring on the LAST response makes the meter sawtooth. Fall back to the
    # last-response anchor, then measured, then estimated.
    context_used = anchored_context_tokens(
        messages, getattr(agent, "_turn_base_usage_anchor", None), charge_stale_thinking=False
    )
    if context_used is None:
        context_used = anchored_context_tokens(messages, getattr(agent, "_usage_anchor", None))
    if context_used is None:
        measured_used = int(getattr(comp, "last_prompt_tokens", 0) or 0) if comp else 0
        context_used = measured_used if measured_used > 0 else estimated_total

    return {
        "categories": [
            {
                "color": color,
                "id": category_id,
                "label": label,
                "tokens": tokens_by_id[category_id],
                # Optional per-category extra, so surfaces that don't know
                # about it keep rendering the category unchanged.
                **({"count": file_count} if category_id == "files" else {}),
            }
            for category_id, (label, color, _glyph_) in _CATEGORIES.items()
            if tokens_by_id[category_id] > 0
        ],
        "context_max": context_max,
        "context_percent": max(0, min(100, round(context_used / context_max * 100))) if context_max else 0,
        "context_used": context_used,
        "estimated_total": estimated_total,
        "model": getattr(agent, "model", "") or "",
    }


def compute_context_details(agent: Any) -> Dict[str, Any]:
    """Expanded per-skill / per-toolset cost listing for ``/context all``.

    Reuses the ``hermes prompt-size`` attribution (index-line bytes from the
    live skills block; schema bytes via the registry's tool→toolset map).
    """
    from hermes_cli.prompt_size import _compute_skills_breakdown, _compute_toolsets_breakdown
    from agent.system_prompt import build_system_prompt_parts

    skills_block = _skills_block(build_system_prompt_parts(agent).get("stable", "") or "")
    tools = list(getattr(agent, "tools", None) or [])
    return {
        "skills": [
            {
                "name": entry.get("name", ""),
                "index_tokens": _bytes_to_tokens(entry.get("index_line_bytes")) or 0,
                "skill_md_tokens": _bytes_to_tokens(entry.get("skill_md_bytes")),
            }
            for entry in (_compute_skills_breakdown(skills_block) if skills_block else [])
        ],
        "toolsets": [
            {
                "toolset": group.get("toolset", ""),
                "tool_count": int(group.get("tool_count", 0) or 0),
                "schema_tokens": _bytes_to_tokens(group.get("json_bytes")) or 0,
            }
            for group in (_compute_toolsets_breakdown(tools) if tools else [])
        ],
    }


# ── /context rendering (CLI + gateway) ──────────────────────────────────────
# Pure text renderers over the payload above. The gateway skips the glyph grid
# (monospace is not guaranteed on messaging platforms).


def render_context_grid(payload: Dict[str, Any]) -> List[str]:
    """Glyph grid: 100 cells, one per percent of the context window; categories
    fill in declaration order, the remainder is free space."""
    context_max = int(payload.get("context_max") or 0)
    total_cells = _GRID_COLUMNS * _GRID_ROWS
    cells: List[str] = []
    if context_max > 0:
        for cat in payload.get("categories") or []:
            tokens = int(cat.get("tokens") or 0)
            # never render a nonzero category as invisible
            n = round(tokens / context_max * total_cells) or (1 if tokens > 0 else 0)
            cells.extend([_glyph(cat)] * n)
        cells = cells[:total_cells]
    cells.extend([_FREE_GLYPH] * (total_cells - len(cells)))
    return [" ".join(cells[row * _GRID_COLUMNS:(row + 1) * _GRID_COLUMNS]) for row in range(_GRID_ROWS)]


def render_context_category_lines(payload: Dict[str, Any]) -> List[str]:
    """Render the 'Estimated usage by category' table as plain-text lines."""
    categories = payload.get("categories") or []
    context_max = int(payload.get("context_max") or 0)
    estimated_total = int(payload.get("estimated_total") or 0)
    denom = context_max or estimated_total

    lines = ["Estimated usage by category"]
    if not categories:
        return [*lines, "  (no data yet — send a message first)"]
    width = max(len("Free space"), *(len(str(cat.get("label") or "")) for cat in categories))
    for cat in categories:
        tokens, label = int(cat.get("tokens") or 0), str(cat.get("label") or cat.get("id") or "")
        lines.append(f"{_glyph(cat)} {label:<{width}} {tokens:>9,} tokens {tokens / denom * 100 if denom else 0.0:>5.1f}%")
    if context_max > 0:
        free = max(0, context_max - estimated_total)
        lines.append(f"{_FREE_GLYPH} {'Free space':<{width}} {free:>9,} tokens {free / context_max * 100:>5.1f}%")
    return lines


def _toolset_row(group: Dict[str, Any]) -> str:
    return f"  {group['toolset']:<24} {group['tool_count']:>3} tools {group['schema_tokens']:>8,} tokens"


def _skill_row(entry: Dict[str, Any]) -> str:
    name = str(entry.get("name") or "")
    if len(name) > 28:
        name = name[:27] + "…"
    md = entry.get("skill_md_tokens")
    md_str = f"{md:>8,}" if md is not None else f"{'n/a':>8}"
    return f"  {name:<28} index {entry['index_tokens']:>6,}  SKILL.md {md_str} tokens"


def _table(lines: List[str], title: str, rows: List[Dict[str, Any]], fmt) -> None:
    """Append a titled, display-capped table (blank-separated from a preceding one)."""
    if not rows:
        return
    if lines:
        lines.append("")
    lines.append(title)
    lines.extend(fmt(row) for row in rows[:_DETAILS_TABLE_LIMIT])
    if len(rows) > _DETAILS_TABLE_LIMIT:
        lines.append(f"  … and {len(rows) - _DETAILS_TABLE_LIMIT} more")


def render_context_details_lines(details: Dict[str, Any]) -> List[str]:
    """Render the expanded ``/context all`` per-skill / per-toolset tables."""
    lines: List[str] = []
    _table(lines, "Toolsets by schema cost (largest first)", details.get("toolsets") or [], _toolset_row)
    _table(lines, "Skills by cost (index = always-on; SKILL.md = cost when loaded)", details.get("skills") or [], _skill_row)
    return lines


def render_context_breakdown_lines(
    payload: Dict[str, Any],
    *,
    details: Optional[Dict[str, Any]] = None,
    grid: bool = True,
) -> List[str]:
    """Full /context view. ``grid`` prepends the glyph grid (CLI; the gateway
    keeps its own gauge); ``details`` appends the expanded listings."""
    lines: List[str] = [*render_context_grid(payload), ""] if grid else []
    lines.extend(render_context_category_lines(payload))

    context_max = int(payload.get("context_max") or 0)
    if context_max > 0:
        used, pct = int(payload.get("context_used") or 0), int(payload.get("context_percent") or 0)
        lines.extend(["", f"Context window: {used:,} / {context_max:,} tokens ({pct}%)"])

    if details is None:
        lines.extend(["", "Use /context all for per-skill and per-toolset costs."])
    elif detail_lines := render_context_details_lines(details):
        lines.extend(["", *detail_lines])
    return lines
