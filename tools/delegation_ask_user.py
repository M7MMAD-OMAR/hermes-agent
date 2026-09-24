"""Let a thread ask the person a question. Off by default.

A delegated child installs a NON-interactive approval callback
(:func:`tools.delegate_tool_config._get_subagent_approval_callback`): it auto
denies, or auto approves when ``delegation.subagent_auto_approve`` is set. That
is a deliberate safety boundary, and it is also why the Threads dock has no
"Waiting on you" section: nothing can currently ask.

This module adds the third option, and it is **opt in and default off**
(``delegation.subagent_ask_user``). Turning it on is the operator's decision,
not the agent's, because it converts a bounded automatic refusal into a
blocking request for a human.

Nothing here is new machinery. ``tools/approval_gateway_wait.py`` already
enqueues an approval, notifies the user and blocks on a per request
``threading.Event``, and its own docstring already anticipates this case:
"Multiple threads (parallel subagents, execute_code RPC handlers) can block
concurrently". A child already carries the owner session it was spawned from,
for steering. This joins the two.

Three properties matter more than the feature:

1. **A thread can never wedge forever.** Every wait is bounded, and a timeout
   falls back to the SAME auto policy that would have answered without this
   module. The worst case is the old behaviour, arriving late.
2. **Unattended runs never block.** A cron job, a one shot worker or any
   session with no owner to ask falls back immediately rather than waiting for
   a person who is not there.
3. **The default is unchanged.** With the flag off, this module is not reached
   and the callback is byte for byte the one that shipped before.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# A thread is background work. Someone may be at lunch, and a child holding a
# delegation slot for an hour is worse than a denied command it can recover
# from and report. Ten minutes is long enough to notice a notification.
DEFAULT_ASK_TIMEOUT_SECONDS = 600

# The surface name the approval carries, so a client can tell a thread's
# question apart from the conversation's own.
ASK_SURFACE = "thread"


def ask_user_enabled(cfg: dict) -> bool:
    """``delegation.subagent_ask_user``, default False.

    Read from the same config block as the rest of delegation so an operator
    turns it on in one place.
    """
    from utils import is_truthy_value

    return is_truthy_value(cfg.get("subagent_ask_user", False))


def ask_timeout_seconds(cfg: dict) -> float:
    """``delegation.subagent_ask_timeout_seconds``, clamped to something sane.

    Zero or a negative value disables waiting entirely, which is the same as
    the flag being off: it falls straight through to the auto policy.
    """
    raw = cfg.get("subagent_ask_timeout_seconds", DEFAULT_ASK_TIMEOUT_SECONDS)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning("delegation.subagent_ask_timeout_seconds is not a number (%r); using the default", raw)
        return float(DEFAULT_ASK_TIMEOUT_SECONDS)

    # An hour is already far past the point where a slot should be held.
    return max(0.0, min(value, 3600.0))


def can_ask(owner_session_key: Optional[str]) -> bool:
    """Whether there is anyone to ask.

    False for a child with no owner session (cron, one shot workers, stateless
    channels). Those must fall back rather than wait for a person who is not
    there, which is the same rule ``async_delivery_supported`` applies to
    detached results.
    """
    if not owner_session_key:
        return False

    try:
        from gateway.session_context import async_delivery_supported
        from tools.approval import _gateway_notify_cb

        # A session with no registered notify callback cannot be shown a prompt,
        # so blocking on it would wait out the whole timeout for nothing.
        return bool(async_delivery_supported()) and _gateway_notify_cb(owner_session_key) is not None
    except Exception:  # noqa: BLE001 - an unreadable session context means "do not block"
        logger.debug("thread ask: session context unreadable; falling back to the auto policy", exc_info=True)
        return False


def build_ask_callback(
    owner_session_key: Optional[str],
    fallback: Callable[..., str],
    *,
    timeout_seconds: float = DEFAULT_ASK_TIMEOUT_SECONDS,
    thread_label: str = "",
) -> Callable[..., str]:
    """Wrap *fallback* so the person is asked first, with *fallback* as the answer
    when they cannot be, or do not answer in time.

    *fallback* is the auto policy the child would otherwise have used, so every
    path out of this function is a path the child already knew how to handle.
    """

    def _ask(command: str, description: str, **kwargs: Any) -> str:
        if not can_ask(owner_session_key) or timeout_seconds <= 0:
            return fallback(command, description, **kwargs)

        try:
            from tools.approval_gateway_wait import _await_gateway_decision

            # The question names the thread: an approval popup that does not say
            # WHICH background worker is asking is unanswerable.
            prefix = f"[{thread_label}] " if thread_label else "[thread] "
            from tools.approval import _gateway_notify_cb

            outcome = _await_gateway_decision(
                owner_session_key,
                _gateway_notify_cb(owner_session_key),
                {
                    "command": command,
                    "description": f"{prefix}{description}",
                    "pattern_key": kwargs.get("pattern_key", ""),
                    "pattern_keys": kwargs.get("pattern_keys", []),
                    "timeout": timeout_seconds,
                },
                surface=ASK_SURFACE,
            )
        except Exception:  # noqa: BLE001 - asking must never be able to fail the child
            logger.warning(
                "Thread question could not reach the owner session; falling back to the auto policy.",
                exc_info=True,
            )
            return fallback(command, description, **kwargs)

        if isinstance(outcome, dict) and outcome.get("resolved") and outcome.get("choice"):
            return str(outcome["choice"])

        # Not resolved: nobody answered, or the notify failed. The auto policy
        # answers, so the thread proceeds on the terms it would have had anyway.
        logger.info(
            "Thread question went unanswered (%s); using the auto policy.",
            (outcome or {}).get("reason") if isinstance(outcome, dict) else "unknown",
        )
        return fallback(command, description, **kwargs)

    return _ask
