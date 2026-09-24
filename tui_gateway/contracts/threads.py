"""Threads: delegated subagent sessions read as durable work items.

A thread IS a session. ``tools/delegate_tool.py`` stamps every delegated child
with ``model_config.$._delegate_from``, the child writes its own transcript,
and the session list deliberately hides those rows. These methods are the read
that lifts that one filter (:mod:`hermes_state_threads`,
:mod:`tui_gateway.methods_threads`).

Live control is NOT here: steering and stopping stay on the existing
``subagent.*`` methods so there is one steering runtime, not two. These methods
answer only what a live roster cannot, which is everything that outlived the
turn that spawned it.
"""

from __future__ import annotations

from pydantic import Field

from .base import JsonValue, Params, Result, WireEnum
from .registry import method


class ThreadState(WireEnum):
    """Derived from the session row, never stored.

    ``failed`` is a session the supervisor reaped rather than one the child
    closed itself: rendering that as ``resolved`` would tell the user work
    landed that never did.
    """

    WORKING = "working"
    RESOLVED = "resolved"
    FAILED = "failed"


class ThreadSummary(Result):
    """One thread's header row, shaped by ``hermes_state_threads._shape_thread_row``."""

    session_id: str
    coordinator_session_id: str | None = None
    # The single field a client renders: the title when one exists, else the
    # goal preview. Most delegate children carry no title, so the fallback is
    # the label that actually ships, and it is never empty.
    label: str
    title: str | None = None
    preview: str = ""
    state: ThreadState
    started_at: float | None = None
    ended_at: float | None = None
    end_reason: str | None = None
    message_count: int = 0
    tool_call_count: int = 0
    model: str | None = None
    cwd: str | None = None
    profile_name: str | None = None


class ThreadStateCounts(Result):
    """Inbox headers. Every state is present even at zero: a header that
    vanishes at zero reads as a missing feature."""

    working: int = 0
    resolved: int = 0
    failed: int = 0


class ThreadListParams(Params):
    """``states`` filters the returned rows only; ``counts`` always describe the
    whole scope, so a section header does not move as the client pages."""

    coordinator_session_id: str | None = None
    states: list[ThreadState] | None = None
    min_message_count: int = 0
    limit: int = 50
    offset: int = 0


class ThreadListResult(Result):
    threads: list[ThreadSummary] = Field(default_factory=list)
    counts: ThreadStateCounts
    total: int = 0
    coordinator_session_id: str | None = None


method("thread.list", params=ThreadListParams, result=ThreadListResult,
       doc="Durable delegated threads, newest first, with whole-scope inbox counts.")


class ThreadIdParams(Params):
    session_id: str


class ThreadGetResult(Result):
    thread: ThreadSummary


method("thread.get", params=ThreadIdParams, result=ThreadGetResult,
       doc="One thread's header; a session with no delegate marker is not found.")


class ThreadTranscriptParams(ThreadIdParams):
    limit: int = 200


class ThreadTranscriptResult(Result):
    """``messages`` is the tail in chronological order; ``truncated`` says the
    thread holds more than this page."""

    thread: ThreadSummary
    messages: list[dict[str, JsonValue]] = Field(default_factory=list)
    truncated: bool = False


method("thread.transcript", params=ThreadTranscriptParams, result=ThreadTranscriptResult,
       doc="A thread's own messages from the durable store, tail-paged.")
