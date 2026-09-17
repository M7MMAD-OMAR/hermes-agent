"""Compatibility helper for explicit agent stop producers."""

from __future__ import annotations

import inspect
from typing import Any


def _accepts_keyword(callable_obj: Any, name: str) -> bool:
    """Return whether a callable explicitly supports a keyword argument."""
    try:
        parameters = inspect.signature(callable_obj).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(
        p.kind is inspect.Parameter.VAR_KEYWORD
        or (p.name == name and p.kind is not inspect.Parameter.POSITIONAL_ONLY)
        for p in parameters
    )


def origin_kwargs(agent: Any, origin: str | None, *, interrupt: Any = None) -> dict:
    """``{"origin": origin}`` when this agent's ``interrupt`` accepts it, else ``{}``.

    The single place that decides how ``origin`` is feature-detected. Third-party agents and
    older test doubles implement ``interrupt(message=None)`` with no ``origin``, and passing one
    raises ``TypeError`` — which, at the call sites that matter, lands inside a broad ``except``
    and turns a missed keyword into a silently missed interrupt. Callers that already hold the
    bound callable pass it as ``interrupt`` to skip the lookup.
    """
    target = interrupt if interrupt is not None else getattr(agent, "interrupt", None)
    if origin is None or not callable(target) or not _accepts_keyword(target, "origin"):
        return {}
    return {"origin": origin}


def request_interrupt(agent: Any, message: str | None = None, *, origin: str | None = None) -> bool:
    """Request a SOFT interrupt, forwarding ``origin`` only when the callable accepts it.

    The soft sibling of ``request_hard_interrupt``, and it exists for the same reason: third-party
    agents and older test doubles implement ``interrupt(message=None)`` with no ``origin``, and
    passing one raises ``TypeError``. The gateway's busy paths call this from inside broad
    ``except`` blocks, where that TypeError would not surface as a bug — it would silently skip the
    interrupt, leaving a turn running that the user asked to replace.

    Returns ``False`` only when no ``interrupt`` callable is available.
    """
    interrupt = getattr(agent, "interrupt", None)
    if not callable(interrupt):
        return False
    kwargs = origin_kwargs(agent, origin, interrupt=interrupt)
    if message is None:
        interrupt(**kwargs)
    else:
        interrupt(message, **kwargs)
    return True


def request_hard_interrupt(
    agent: Any,
    message: str | None = None,
    *,
    tool_reason: str | None = None,
    origin: str | None = None,
) -> bool:
    """Request an explicit stop, falling back to the legacy interrupt ABI.

    New agents expose ``hard_interrupt(message=None)``; third-party agents and old test
    doubles may only expose ``interrupt(message=None)`` and must not receive keyword
    arguments they do not know. ``tool_reason`` is a trusted, fixed category that may be
    exposed in model-visible tool cancellation output, forwarded only when the callable
    explicitly supports it. ``origin`` (see ``agent.interrupt_origin``) names the stop path
    for the settled turn and is forwarded on the same terms, so an agent that predates
    attribution simply settles as ``unknown`` rather than raising.
    Returns ``False`` only when neither callable is available.
    """
    # Static lookup first: a dynamic ``__getattr__`` proxy (unspecced MagicMock, RPC
    # facade) must not be treated as genuinely implementing the new ABI.
    try:
        inspect.getattr_static(agent, "hard_interrupt")
    except AttributeError:
        interrupt = None
    else:
        interrupt = getattr(agent, "hard_interrupt", None)
    if not callable(interrupt):
        interrupt = getattr(agent, "interrupt", None)
    if not callable(interrupt):
        return False
    kwargs = {}
    if tool_reason is not None and _accepts_keyword(interrupt, "tool_reason"):
        kwargs["tool_reason"] = tool_reason
    kwargs.update(origin_kwargs(agent, origin, interrupt=interrupt))
    if message is None:
        interrupt(**kwargs)
    else:
        interrupt(message, **kwargs)
    return True
