"""Attribution for who stopped a turn.

A turn that settles as the bare string ``Operation interrupted.`` tells nobody which of
the several independent stop paths fired. The reported symptom (#95327 class) is a user
sending a mid-turn follow-up and the turn dying, when the follow-up's own path
(``redirect`` -> ``steer``) provably cannot interrupt anything: the real caller was a
connection reaper, a watchdog or a Stop the user did not mean to press. Without
attribution every such report costs a full code trace to rule the innocent paths out.

So ``interrupt()`` takes an ``origin`` and the settlement carries it: into the placeholder
sentence the transcript keeps, into the turn result the gateway forwards, and into the log
line. The set is open: ``register_interrupt_origin`` adds one without touching any call
site, which is what keeps new stop paths from quietly regressing to ``unknown``.

Origin strings are a stable wire contract (turn results, gateway events, the desktop's
settlement note), so treat renaming one as a breaking change; add a new id instead.
"""

from __future__ import annotations

import logging
from typing import Dict, NamedTuple, Optional

logger = logging.getLogger(__name__)

# ── known origins ────────────────────────────────────────────────────────────
#: No caller said. Settles with the historical bare placeholder, so an unattributed
#: path is visibly indistinguishable from the pre-attribution behavior and shows up
#: in ``grep`` rather than masquerading as a known cause.
UNKNOWN = "unknown"
#: The person pressed Stop / Esc, or a client issued ``session.interrupt`` for them.
USER_STOP = "user_stop"
#: Busy-mode ``interrupt``: the person's next message deliberately replaces this turn.
USER_MESSAGE = "user_message"
#: The client socket went away and the orphan reaper ended the detached turn.
WS_ORPHAN_REAP = "ws_orphan_reap"
#: The turn-liveness watchdog found no progress for its configured timeout.
LIVENESS_WATCHDOG = "liveness_watchdog"
#: The turn's durable lease was lost, so another owner may already be running it.
LEASE_LOST = "lease_lost"
#: A compute host cancelled the turn over its control channel.
COMPUTE_HOST = "compute_host"
#: Session teardown: /new, shutdown, profile switch, agent cache invalidation.
SESSION_CLOSED = "session_closed"
#: Internal machinery that interrupts to rebuild the same turn (retries, compression).
#: These always supply their own ``final_response``, so their sentence is rarely seen.
INTERNAL_RETRY = "internal_retry"
#: The turn ran past its configured wall-clock budget.
TURN_TIMEOUT = "turn_timeout"


class InterruptOrigin(NamedTuple):
    """One stop path's attribution.

    ``sentence`` completes "Operation interrupted: ..." in the transcript placeholder and is
    read by the person, so it says what happened and what to do, not which function ran.
    ``label`` is the short form for logs and for the re-registration warning.
    """

    id: str
    label: str
    sentence: Optional[str]


_ORIGINS: Dict[str, InterruptOrigin] = {}


def register_interrupt_origin(origin_id: str, label: str, sentence: Optional[str]) -> InterruptOrigin:
    """Register (or replace) one origin and return it.

    Re-registration is allowed so a plugin can sharpen a built-in's wording, but it is
    logged: two owners fighting over one id is a bug worth seeing.
    """
    cleaned = (origin_id or "").strip()
    if not cleaned:
        raise ValueError("origin_id is required")
    if cleaned in _ORIGINS and _ORIGINS[cleaned].label != label:
        logger.info("Re-registering interrupt origin %r (was %r, now %r)", cleaned, _ORIGINS[cleaned].label, label)
    entry = InterruptOrigin(id=cleaned, label=label, sentence=sentence)
    _ORIGINS[cleaned] = entry
    return entry


for _id, _label, _sentence in (
    (UNKNOWN, "unknown", None),
    (USER_STOP, "user stop", "you stopped it"),
    (USER_MESSAGE, "user message", "your new message replaced it"),
    (
        WS_ORPHAN_REAP,
        "client disconnected",
        "the app lost its connection to the agent and the turn was reclaimed; the work was not lost, "
        "reopen the conversation to continue",
    ),
    (
        LIVENESS_WATCHDOG,
        "liveness watchdog",
        "it stopped making progress and the watchdog ended it so the session could be reused",
    ),
    (LEASE_LOST, "lease lost", "another process took over this session"),
    (COMPUTE_HOST, "compute host", "the compute host cancelled it"),
    (SESSION_CLOSED, "session closed", "the session was closed"),
    (INTERNAL_RETRY, "internal retry", "it is being retried"),
    (TURN_TIMEOUT, "turn timeout", "it ran past its time limit"),
):
    register_interrupt_origin(_id, _label, _sentence)
del _id, _label, _sentence


def get_interrupt_origin(origin_id: Optional[str]) -> InterruptOrigin:
    """Resolve ``origin_id`` to its entry, falling back to ``UNKNOWN`` for None/unregistered.

    Never raises: an unknown id reaching settlement must degrade to the historical
    placeholder, not take the turn's last moments down with it.
    """
    if not origin_id:
        return _ORIGINS[UNKNOWN]
    entry = _ORIGINS.get(str(origin_id).strip())
    if entry is None:
        logger.debug("Unregistered interrupt origin %r; treating as unknown", origin_id)
        return _ORIGINS[UNKNOWN]
    return entry


def known_interrupt_origins() -> tuple[str, ...]:
    """Every registered origin id, for validation and tests."""
    return tuple(sorted(_ORIGINS))


#: The transcript placeholder for a turn that settled with no assistant text at all.
BARE_PLACEHOLDER = "Operation interrupted."


def interrupt_placeholder(origin_id: Optional[str] = None) -> str:
    """The assistant-row text for an interrupted turn that produced nothing.

    Unknown / unattributed origins keep the historical bare string so nothing downstream
    that matches on it changes meaning.
    """
    sentence = get_interrupt_origin(origin_id).sentence
    return f"Operation interrupted: {sentence}." if sentence else BARE_PLACEHOLDER



# ── agent-side accessors ─────────────────────────────────────────────────────
# Settlement is split across two points that straddle ``clear_interrupt``: the abort site
# (still holding the live request) and the turn finalizer (running after it). Both go through
# these, so neither has to know that the slot outlives the clear.

def agent_interrupt_origin(agent: object) -> str:
    """The origin to attribute ``agent``'s settling turn to, ``UNKNOWN`` if unattributed.

    Tolerates ``__init__``-less test stubs and third-party agents that have no slot at all.
    """
    origin = getattr(agent, "_interrupt_origin", None)
    return str(origin) if origin else UNKNOWN


def reset_interrupt_origin(agent: object) -> None:
    """Drop the per-turn attribution at a turn boundary so one turn's never leaks onto the next.

    ``_last_correction_delivery`` rides along: it is the same class of fact (something that was
    true of the turn that just ended) and a stale one would have the next correction's RPC reply
    describe a delivery that already happened.
    """
    for slot in ("_interrupt_origin", "_last_correction_delivery"):
        try:
            setattr(agent, slot, None)
        except Exception:  # read-only stand-ins in other suites
            logger.debug("Could not reset %s on %r", slot, type(agent).__name__)
