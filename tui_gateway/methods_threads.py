"""Threads RPC surface: the delegated subagent sessions the sidebar hides.

A thread is a session (see :mod:`hermes_state_threads`). These handlers read
the same durable rows the session list filters out, so nothing here owns
storage, a lifecycle or a second copy of anything.

Live control stays where it already is: ``subagent.list`` for the in-flight
roster, ``subagent.steer`` to steer, ``subagent.interrupt`` to stop. This
module adds only what those cannot answer, which is everything that outlived
the turn that spawned it.

Bodies are rebound onto server.py's globals at install (method_ctx.bind_module).
"""

from __future__ import annotations

import contextlib

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method

# JSON-RPC error codes: generic failure / no such thread / invalid argument.
_E_THREADS, _E_NO_THREAD, _E_THREAD_ARG = 5071, 5072, 5073

# A transcript page a client can render without paging on the common case, and
# small enough that a 520 message thread cannot stall the socket.
_THREAD_MESSAGE_LIMIT = 200


@contextlib.contextmanager
def _thread_db(params: dict):
    """The state.db for the profile this call names, released on the way out.

    ``@profile_scoped`` binds HERMES_HOME for config, secrets and terminal
    policy, but it does NOT redirect the session store: ``server._get_db`` is
    pinned to the import-time LAUNCH home on purpose (#102526), process wide.
    Reading through it would answer every profile's thread list from the launch
    profile's database, which both leaks threads into a profile that has none
    and hides a secondary profile's own.

    So a named profile gets a dedicated handle, exactly as
    ``methods_session._profile_session_db`` does, and the launch profile keeps
    the shared one. ``owns`` decides who closes it: releasing the shared handle
    would take the session store out from under every other method.
    """
    profile = params.get("profile") if isinstance(params, dict) else None
    home = _profile_home(profile)
    database, owns = _profile_session_db(home)
    try:
        yield database
    finally:
        if owns:
            _release_db(database)


def _states_param(params: dict):
    """``states`` as a clean list, or None for every state.

    A bare string is accepted alongside a list because a client filtering on
    one state naturally sends one, and the wire contract declares that union.

    An unknown name is passed through to the state layer rather than dropped:
    it filters the result to nothing, which is the honest answer to a filter
    nobody can satisfy.
    """
    raw = params.get("states")
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return None
    states = [str(value).strip().lower() for value in raw if str(value).strip()]
    return states or None


@method("thread.list")
@_registry.profile_scoped
def _thread_list(rid, params):
    """Durable threads, newest first, with the inbox counts alongside.

    ``coordinator_session_id`` scopes to one conversation. Counts are always
    for the whole scope, never for the returned page, so a section header does
    not change as the client pages.
    """
    coordinator = _str_param(params, "coordinator_session_id") or None
    limit = params.get("limit")
    offset = params.get("offset")
    with _thread_db(params) as db:
        if db is None:
            return _err(rid, _E_THREADS, "session storage unavailable")
        try:
            threads = db.list_threads(
                coordinator,
                states=_states_param(params),
                min_message_count=int(params.get("min_message_count") or 0),
                limit=int(limit) if limit is not None else 50,
                offset=int(offset) if offset is not None else 0,
            )
            counts = db.thread_state_counts(coordinator)
        except (TypeError, ValueError) as exc:
            return _err(rid, _E_THREAD_ARG, f"invalid thread list argument: {exc}")
        except Exception as exc:  # noqa: BLE001 - a read must not take the gateway down
            logger.debug("thread.list failed", exc_info=True)
            return _err(rid, _E_THREADS, f"could not list threads: {exc}")

    return _ok(rid, {
        "threads": threads,
        "counts": counts,
        "total": sum(counts.values()),
        "coordinator_session_id": coordinator,
    })


@method("thread.get")
@_registry.profile_scoped
def _thread_get(rid, params):
    """One thread's header row.

    A session id that is not a delegated child resolves to nothing rather than
    to that session, so a stale link cannot open an ordinary conversation in
    the thread view.
    """
    session_id = _str_param(params, "session_id")
    if not session_id:
        return _err(rid, _E_THREAD_ARG, "session_id required")
    with _thread_db(params) as db:
        if db is None:
            return _err(rid, _E_THREADS, "session storage unavailable")
        try:
            thread = db.get_thread(session_id)
        except Exception as exc:  # noqa: BLE001
            logger.debug("thread.get failed", exc_info=True)
            return _err(rid, _E_THREADS, f"could not read thread: {exc}")
    if thread is None:
        return _err(rid, _E_NO_THREAD, f"no thread for session {session_id}")
    return _ok(rid, {"thread": thread})


@method("thread.transcript")
@_registry.profile_scoped
def _thread_transcript(rid, params):
    """The thread's own messages, newest page last.

    This is the ordinary message store, not the seven day live log under
    ``cache/delegation/live``: that log is a tailing convenience and expires,
    while these rows are the record and do not.
    """
    session_id = _str_param(params, "session_id")
    if not session_id:
        return _err(rid, _E_THREAD_ARG, "session_id required")

    limit = params.get("limit")
    with _thread_db(params) as db:
        if db is None:
            return _err(rid, _E_THREADS, "session storage unavailable")
        try:
            thread = db.get_thread(session_id)
        except Exception as exc:  # noqa: BLE001
            logger.debug("thread.transcript header read failed", exc_info=True)
            return _err(rid, _E_THREADS, f"could not read thread: {exc}")
        if thread is None:
            return _err(rid, _E_NO_THREAD, f"no thread for session {session_id}")

        try:
            limit = max(1, min(int(limit) if limit is not None else _THREAD_MESSAGE_LIMIT, _THREAD_MESSAGE_LIMIT))
            # ``latest`` pages back from the newest and still returns chronological
            # order, which is the tail a transcript view opens on. A 520 message
            # thread must not arrive whole.
            messages = db.get_messages(session_id, limit=limit, latest=True)
        except (TypeError, ValueError) as exc:
            return _err(rid, _E_THREAD_ARG, f"invalid transcript argument: {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.debug("thread.transcript failed", exc_info=True)
            return _err(rid, _E_THREADS, f"could not read transcript: {exc}")

    return _ok(rid, {
        "thread": thread,
        "messages": messages,
        "truncated": int(thread.get("message_count") or 0) > len(messages),
    })


def register(server):
    bind_module(globals(), server)
