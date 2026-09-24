"""Threads: delegated subagent sessions read as first class work items.

A thread IS a session. ``tools/delegate_tool.py`` stamps every delegated child
with ``model_config.$._delegate_from = <coordinator session id>``, the child
runs its own turns, and its transcript lands in ``messages`` like any other
session. The sidebar then deliberately hides those rows: ``exclude_children``
in :func:`hermes_state_sessions._session_filter_where` adds
``_delegate_from IS NULL`` so sub-agent runs stay out of session pickers.

This module is the read that lifts exactly that one filter. It introduces no
second store, no new ``source`` value and no new provenance marker, so every
guard that already protects delegate children (cascade delete, compression
child lookup, session reset, routing inheritance) keeps working untouched.

State is derived, not stored:

===========  ==========================================================
``working``  ``ended_at IS NULL``: the child never closed its session
``failed``   the session was reaped (``*_orphan_reap``), so nobody joined
``resolved`` anything else, normally ``end_reason='agent_close'``
===========  ==========================================================

``async_delegations`` is NOT the history table for threads: it prunes
delivered rows on a retention window (``_prune_durable_records``). It is the
live control record, and callers join it only to refine a running thread.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from hermes_state_common import _shape_preview

THREAD_STATE_WORKING = "working"
THREAD_STATE_RESOLVED = "resolved"
THREAD_STATE_FAILED = "failed"

THREAD_STATES: Tuple[str, ...] = (THREAD_STATE_WORKING, THREAD_STATE_RESOLVED, THREAD_STATE_FAILED)

# A session the supervisor reaped rather than one the child closed itself. Both
# reap reasons mean the same thing to a reader: the work did not finish on its
# own terms, so the row is a failure and not a resolution.
_REAP_END_REASONS: Tuple[str, ...] = ("startup_orphan_reap", "ws_orphan_reap")

# Derived state as SQL so filtering and ordering happen in one query rather
# than by loading every thread and partitioning in Python.
_THREAD_STATE_SQL = (
    "CASE WHEN s.ended_at IS NULL THEN '" + THREAD_STATE_WORKING + "' "
    "WHEN COALESCE(s.end_reason, '') IN ("
    + ", ".join(f"'{reason}'" for reason in _REAP_END_REASONS)
    + ") THEN '" + THREAD_STATE_FAILED + "' "
    "ELSE '" + THREAD_STATE_RESOLVED + "' END"
)


def _placeholders(values) -> str:
    return ", ".join("?" for _ in values)


class SessionThreadsMixin:
    """Thread reads: the delegate children the ordinary session list hides."""

    def _thread_where(
        self,
        *,
        coordinator_session_id: Optional[str],
        states: Optional[List[str]],
        profile_name: Optional[str],
        min_message_count: int,
    ) -> Tuple[List[str], List[Any]]:
        """WHERE clauses for the thread list. The delegate marker is always
        required: without it this would list ordinary chats."""
        from hermes_state_sessions import _delegate_from_json

        marker = _delegate_from_json("s.model_config")
        where: List[str] = [f"{marker} IS NOT NULL"]
        params: List[Any] = []

        if coordinator_session_id:
            where.append(f"{marker} = ?")
            params.append(coordinator_session_id)

        # Unknown state names would silently widen the result to everything, so
        # an unrecognised name filters nothing in rather than being dropped.
        wanted = [state for state in (states or ()) if state in THREAD_STATES]
        if wanted and len(wanted) < len(THREAD_STATES):
            where.append(f"{_THREAD_STATE_SQL} IN ({_placeholders(wanted)})")
            params.extend(wanted)
        elif states and not wanted:
            where.append("1 = 0")

        if profile_name:
            where.append("COALESCE(s.profile_name, 'default') = ?")
            params.append(profile_name)

        # A thread whose child never sent its goal turn is scaffolding, not work.
        if min_message_count > 0:
            where.append("s.message_count >= ?")
            params.append(min_message_count)

        return where, params

    def _shape_thread_row(self, row) -> Dict[str, Any]:
        """One thread as the gateway sends it.

        ``label`` is the single field a client renders. Most delegate children
        carry no title (8 of 297 on a real machine), but every one of them
        opens with the goal as its first user message, so the preview is a
        reliable fallback and the row is never nameless.
        """
        record = dict(row)
        preview = _shape_preview(record.pop("_preview_raw", ""))
        title = (record.get("title") or "").strip()
        return {
            "session_id": record["id"],
            "coordinator_session_id": record.get("_delegate_from") or None,
            "label": title or preview or record["id"],
            "title": title or None,
            "preview": preview,
            "state": record["_thread_state"],
            "started_at": record.get("started_at"),
            "ended_at": record.get("ended_at"),
            "end_reason": record.get("end_reason"),
            "message_count": record.get("message_count") or 0,
            "tool_call_count": record.get("tool_call_count") or 0,
            "model": record.get("model"),
            "cwd": record.get("cwd"),
            "profile_name": record.get("profile_name"),
        }

    def list_threads(
        self,
        coordinator_session_id: Optional[str] = None,
        *,
        states: Optional[List[str]] = None,
        profile_name: Optional[str] = None,
        min_message_count: int = 0,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Delegated threads, newest first.

        ``coordinator_session_id`` scopes to one conversation's threads; omit it
        for every thread this state.db holds. Ordering is by start time rather
        than by state so a client can group without a second query.
        """
        from hermes_state_common import _PREVIEW_ELIGIBLE_SQL, _PREVIEW_RAW_SELECT
        from hermes_state_sessions import _delegate_from_json

        where, params = self._thread_where(
            coordinator_session_id=coordinator_session_id,
            states=states,
            profile_name=profile_name,
            min_message_count=min_message_count,
        )
        limit = max(1, min(int(limit or 50), 500))
        offset = max(0, int(offset or 0))

        rows = self._read_all(
            f"""SELECT s.id, s.title, s.started_at, s.ended_at, s.end_reason,
                       s.message_count, s.tool_call_count, s.model, s.cwd, s.profile_name,
                       {_delegate_from_json('s.model_config')} AS _delegate_from,
                       {_THREAD_STATE_SQL} AS _thread_state,
                       COALESCE(
                           (SELECT {_PREVIEW_RAW_SELECT}
                            FROM messages m
                            WHERE m.session_id = s.id AND m.role = 'user' AND m.content IS NOT NULL
                              AND {_PREVIEW_ELIGIBLE_SQL}
                            ORDER BY m.timestamp, m.id LIMIT 1),
                           ''
                       ) AS _preview_raw
                  FROM sessions s
                 WHERE {' AND '.join(where)}
                 ORDER BY s.started_at DESC, s.id DESC
                 LIMIT ? OFFSET ?""",
            (*params, limit, offset),
        )
        return [self._shape_thread_row(row) for row in rows]

    def count_threads(
        self,
        coordinator_session_id: Optional[str] = None,
        *,
        states: Optional[List[str]] = None,
        profile_name: Optional[str] = None,
        min_message_count: int = 0,
    ) -> int:
        """Total matching threads, so a client can page without over-fetching."""
        where, params = self._thread_where(
            coordinator_session_id=coordinator_session_id,
            states=states,
            profile_name=profile_name,
            min_message_count=min_message_count,
        )
        row = self._read_one(
            f"SELECT COUNT(*) AS n FROM sessions s WHERE {' AND '.join(where)}", tuple(params)
        )
        return int(row["n"]) if row else 0

    def thread_state_counts(
        self,
        coordinator_session_id: Optional[str] = None,
        *,
        profile_name: Optional[str] = None,
    ) -> Dict[str, int]:
        """``{working, resolved, failed}`` in one query, for the inbox headers.

        Every state is present in the result even at zero: a section header that
        vanishes when its count is zero reads as a missing feature.
        """
        where, params = self._thread_where(
            coordinator_session_id=coordinator_session_id,
            states=None,
            profile_name=profile_name,
            min_message_count=0,
        )
        rows = self._read_all(
            f"""SELECT {_THREAD_STATE_SQL} AS _thread_state, COUNT(*) AS n
                  FROM sessions s
                 WHERE {' AND '.join(where)}
                 GROUP BY _thread_state""",
            tuple(params),
        )
        counts = {state: 0 for state in THREAD_STATES}
        for row in rows:
            counts[row["_thread_state"]] = int(row["n"])
        return counts

    def get_thread(self, session_id: str) -> Optional[Dict[str, Any]]:
        """One thread by its session id, or None when the row is not a thread.

        A session that exists but carries no delegate marker returns None
        rather than a row, so a stale client link cannot turn an ordinary
        conversation into a thread view.
        """
        if not session_id:
            return None

        from hermes_state_common import _PREVIEW_ELIGIBLE_SQL, _PREVIEW_RAW_SELECT
        from hermes_state_sessions import _delegate_from_json

        row = self._read_one(
            f"""SELECT s.id, s.title, s.started_at, s.ended_at, s.end_reason,
                       s.message_count, s.tool_call_count, s.model, s.cwd, s.profile_name,
                       {_delegate_from_json('s.model_config')} AS _delegate_from,
                       {_THREAD_STATE_SQL} AS _thread_state,
                       COALESCE(
                           (SELECT {_PREVIEW_RAW_SELECT}
                            FROM messages m
                            WHERE m.session_id = s.id AND m.role = 'user' AND m.content IS NOT NULL
                              AND {_PREVIEW_ELIGIBLE_SQL}
                            ORDER BY m.timestamp, m.id LIMIT 1),
                           ''
                       ) AS _preview_raw
                  FROM sessions s
                 WHERE s.id = ? AND {_delegate_from_json('s.model_config')} IS NOT NULL""",
            (session_id,),
        )
        return self._shape_thread_row(row) if row else None
