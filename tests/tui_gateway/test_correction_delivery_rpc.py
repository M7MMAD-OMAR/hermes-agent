"""``session.redirect`` / ``session.steer`` report HOW the correction reaches the model.

``status: redirected`` only ever said the correction was accepted. But ``redirect()`` degrades to
a steer whenever there is no live model request to cancel, and that steer can sit behind a
foreground command the backend cannot hand to the background — so "accepted" covered both
"already in the rebuilt turn" and "waiting, possibly for minutes". A client that cannot tell
those apart can only draw a bubble and hope, which is exactly what made a normal wait feel like
the message had been swallowed.
"""

import types

import pytest

from agent import interrupt_control as ic
# The suite's own session factory, so this file cannot drift from its siblings.
from tests.tui_gateway.test_tui_gateway_server import _session
from tui_gateway import server


def _redirecting_agent(delivery, *, accepted=True):
    """An agent that accepts a correction and reports ``delivery`` for it."""
    return types.SimpleNamespace(
        _supports_active_turn_redirect=True,
        last_correction_delivery=lambda: delivery,
        redirect=lambda text: accepted,
        steer=lambda text: accepted,
    )


def _call(agent, method="session.redirect", text="use Postgres"):
    session = server._sessions["sid"] = _session(agent=agent)
    session["inflight_turn"] = {"assistant": "partial", "user": "original"}
    try:
        return server.handle_request(
            {"id": "1", "method": method, "params": {"session_id": "sid", "text": text}}
        )
    finally:
        server._sessions.pop("sid", None)



@pytest.mark.parametrize(
    "delivery",
    [ic.DELIVERY_MODEL_CANCELLED, ic.DELIVERY_TOOL_BOUNDARY, ic.DELIVERY_TOOL_BLOCKED],
)
def test_redirect_reports_every_delivery_mode(delivery):
    resp = _call(_redirecting_agent(delivery))

    assert resp["result"]["status"] == "redirected"
    assert resp["result"]["delivery"] == delivery


def test_steer_reports_its_delivery_too():
    """/steer is the other correction verb and has the same waiting problem."""
    resp = _call(_redirecting_agent(ic.DELIVERY_TOOL_BLOCKED), method="session.steer")

    assert resp["result"]["status"] == "queued"
    assert resp["result"]["delivery"] == ic.DELIVERY_TOOL_BLOCKED


def test_an_agent_without_delivery_reporting_still_works():
    """Third-party agents predate the field; the reply omits it rather than inventing one."""
    agent = types.SimpleNamespace(_supports_active_turn_redirect=True, redirect=lambda text: True)

    resp = _call(agent)

    assert resp["result"]["status"] == "redirected"
    assert "delivery" not in resp["result"]


def test_a_raising_delivery_reader_never_breaks_the_correction():
    """Attribution is a nicety; losing the correction to it would be the real failure."""

    def _boom():
        raise RuntimeError("reader exploded")

    agent = types.SimpleNamespace(
        _supports_active_turn_redirect=True,
        last_correction_delivery=_boom,
        redirect=lambda text: True,
    )

    resp = _call(agent)

    assert resp["result"]["status"] == "redirected"
    assert "delivery" not in resp["result"]


def test_a_rejected_correction_carries_no_delivery():
    """Nothing was accepted, so there is no delivery to describe — and a stale mode left over
    from an earlier correction must not be reported as this one's."""
    resp = _call(_redirecting_agent(ic.DELIVERY_TOOL_BOUNDARY, accepted=False))

    assert resp["result"]["status"] == "rejected"
    assert "delivery" not in resp["result"]


def test_a_none_delivery_is_omitted_rather_than_sent_as_null():
    resp = _call(_redirecting_agent(None))

    assert resp["result"]["status"] == "redirected"
    assert "delivery" not in resp["result"]
