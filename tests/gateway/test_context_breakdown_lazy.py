"""``session.context_breakdown`` for a session whose agent is not built yet.

Before: the lazy branch answered ``categories: []`` with whatever the metadata
mirror held, which for a fresh desktop tile is nothing, so the gauge read
"~0 / 0" and "No context data yet" until the first turn ended.
"""

from __future__ import annotations

import threading
from unittest.mock import patch

from tui_gateway import methods_session, server

# ``bind_module`` publishes the split module's functions onto ``server``, rebound
# to its globals, so the callable and the names it reads both live there.
methods_session.register(server)
_lazy = server._lazy_context_breakdown


def _session(history, **extra):
    return {"agent": None, "history": history, "history_lock": threading.Lock(), **extra}


def test_lazy_breakdown_resolves_window_from_model_metadata():
    session = _session(
        [{"role": "user", "content": "hello " * 400}],
        model_override={"model": "kimi-k3", "provider": "kimi-coding"},
    )
    with patch("hermes_cli.model_switch.resolve_display_context_length", return_value=1_048_576) as resolve, \
            patch.object(server, "_metadata_mirror", return_value={}), \
            patch.object(server, "_resolve_model", return_value="unused"):
        out = _lazy(session, {})
    resolve.assert_called_once_with("kimi-k3", "kimi-coding")
    assert out["model"] == "kimi-k3"
    assert out["context_max"] == 1_048_576
    assert out["context_used"] > 0
    assert out["estimated_total"] == out["context_used"]
    assert [c["id"] for c in out["categories"]] == ["conversation"]
    assert out["categories"][0]["tokens"] == out["context_used"]


def test_lazy_breakdown_prefers_measured_usage_when_present():
    session = _session([], model_override=None)
    with patch.object(server, "_metadata_mirror", return_value={"model": "m"}), \
            patch("hermes_cli.model_switch.resolve_display_context_length", return_value=0):
        out = _lazy(session, {"context_max": 200_000, "context_used": 50_000})
    assert out == {
        "categories": [], "context_max": 200_000, "context_percent": 25, "context_used": 50_000,
        "estimated_total": 50_000, "model": "m",
        "context_estimated": False, "context_source": "provider_usage"}


def test_lazy_breakdown_survives_metadata_failure():
    session = _session([{"role": "user", "content": "x"}])
    with patch.object(server, "_metadata_mirror", return_value={}), \
            patch.object(server, "_resolve_model", return_value="m"), \
            patch("hermes_cli.model_switch.resolve_display_context_length", side_effect=RuntimeError("boom")):
        out = _lazy(session, {})
    assert out["context_max"] == 0 and out["context_percent"] == 0 and out["model"] == "m"
