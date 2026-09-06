"""Unit tests for the Kimi/Moonshot provider profile's reasoning wiring.

Moonshot's OpenAI-compat endpoint (``api.moonshot.ai/v1``) treats
``extra_body.thinking`` and a top-level ``reasoning_effort`` as mutually
exclusive. The profile must send at most one of them — never both — so a
request can't trip "cannot specify both 'thinking' and 'reasoning_effort'".

This mirrors the kimi-k2 handling already shipped for the opencode-go relay
(see ``tests/plugins/model_providers/test_opencode_go_profile.py``).
"""

from __future__ import annotations

import pytest


@pytest.fixture
def kimi_profile():
    """Resolve the registered Kimi profile via the provider registry.

    Importing ``model_tools`` triggers plugin discovery, which registers the
    Kimi profile. Going through ``get_provider_profile`` keeps the test honest:
    if the registered class is ever swapped for a plain ``ProviderProfile`` the
    assertions below collapse.
    """
    import model_tools  # noqa: F401
    import providers

    profile = providers.get_provider_profile("kimi-coding")
    assert profile is not None, "kimi-coding provider profile must be registered"
    return profile


class TestKimiReasoningWireShape:
    """``build_api_kwargs_extras`` never emits thinking + reasoning_effort together."""

    def test_no_config_enables_thinking_without_effort(self, kimi_profile):
        """No reasoning_config → thinking on, server picks the depth.

        Regression guard: this path previously also sent
        ``reasoning_effort="medium"``, pairing thinking + effort on every
        default call.
        """
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(reasoning_config=None)
        assert extra_body == {"thinking": {"type": "enabled"}}
        assert top_level == {}

    @pytest.mark.parametrize(
        "effort,expected",
        [
            ("low", "low"),
            ("minimal", "low"),
            ("medium", "high"),
            ("high", "high"),
            ("xhigh", "max"),
            ("max", "max"),
            ("ultra", "max"),
        ],
    )
    def test_effort_mapped_to_k3_vocabulary(self, kimi_profile, effort, expected):
        """Hermes' wider effort vocabulary is mapped onto K3's low/high/max."""
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": effort}
        )
        assert top_level == {"reasoning_effort": expected}
        assert "thinking" not in extra_body

    def test_enabled_without_effort_falls_back_to_thinking(self, kimi_profile):
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True}
        )
        assert extra_body == {"thinking": {"type": "enabled"}}
        assert top_level == {}

    @pytest.mark.parametrize("effort", ["", "garbage"])
    def test_unrecognized_effort_falls_back_to_thinking(self, kimi_profile, effort):
        """Unknown efforts drop to the thinking toggle rather than sending
        an invalid effort."""
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": effort}
        )
        assert extra_body == {"thinking": {"type": "enabled"}}
        assert top_level == {}

    def test_disabled_sends_thinking_disabled_only(self, kimi_profile):
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": False}
        )
        assert extra_body == {"thinking": {"type": "disabled"}}
        assert top_level == {}


    @pytest.mark.parametrize(
        "reasoning_config",
        [
            None,
            {"enabled": True},
            {"enabled": True, "effort": "high"},
            {"enabled": True, "effort": "garbage"},
            {"enabled": False},
            {"enabled": False, "effort": "low"},
        ],
    )
    def test_never_emits_both(self, kimi_profile, reasoning_config):
        """The core invariant: thinking and reasoning_effort are never both set."""
        extra_body, top_level = kimi_profile.build_api_kwargs_extras(
            reasoning_config=reasoning_config
        )
        assert not ("thinking" in extra_body and "reasoning_effort" in top_level)


class TestKimiModelDiscovery:
    def test_malformed_base_url_is_unconfirmed_and_filters_k3(self, kimi_profile):
        """Malformed user URLs must fall through safely, never authorize K3."""
        from unittest.mock import patch

        from providers.base import ProviderProfile

        with patch.object(
            ProviderProfile,
            "fetch_models",
            return_value=["k3", "kimi-k2.6"],
        ):
            models = kimi_profile.fetch_models(
                api_key="test-key",
                base_url="https://[api.kimi.com/coding",
            )

        assert models == ["kimi-k2.6"]


class TestKimiFullKwargsIntegration:
    """The transport's full kwargs carry at most one reasoning knob."""

    def _build(self, kimi_profile, reasoning_config):
        from agent.transports.chat_completions import ChatCompletionsTransport

        return ChatCompletionsTransport().build_kwargs(
            model="kimi-k2-turbo-preview",
            messages=[{"role": "user", "content": "ping"}],
            tools=None,
            provider_profile=kimi_profile,
            reasoning_config=reasoning_config,
            base_url="https://api.moonshot.ai/v1",
            provider_name="kimi-coding",
        )




class TestKimiUsageWindows:
    """``fetch_usage`` reads what each window MEANS, not what it is labelled.

    The live payload (6 Sept 2026) carries ``limit``/``used``/``remaining``
    on every window. An older shape put the leftover amount under ``used`` on
    the rolling window with no ``remaining`` at all; the parser read ``used``
    as the remainder unconditionally, which on the current shape showed
    "30 left" for a period with 70 left.
    """

    _PAYLOAD = {
        "user": {"membership": {"level": "LEVEL_ADVANCED"}},
        "usage": {"limit": "100", "used": "30", "remaining": "70", "resetTime": "2026-09-11T11:01:47Z"},
        "limits": [
            {
                "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                "detail": {"limit": "100", "used": "93", "remaining": "7", "resetTime": "2026-09-06T04:01:47Z"},
            }
        ],
    }

    @staticmethod
    def _fetch(kimi_profile, payload, monkeypatch):
        import httpx

        class _Resp:
            def raise_for_status(self):
                return None

            def json(self):
                return payload

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, *a, **k):
                return _Resp()

        monkeypatch.setattr(httpx, "Client", _Client)
        cred = type("Cred", (), {"access_token": "tok", "base_url": "https://api.kimi.com/coding"})()
        return kimi_profile.fetch_usage(credential=cred)

    def test_current_shape_reads_remaining_not_used(self, kimi_profile, monkeypatch):
        usage = self._fetch(kimi_profile, self._PAYLOAD, monkeypatch)
        by_label = {w.label: w for w in usage.windows}
        assert usage.plan == "Advanced"
        assert str(by_label["period"].remaining) == "70"
        assert str(by_label["period"].used) == "30"
        assert by_label["period"].used_percent == 30.0
        assert str(by_label["5h"].remaining) == "7"
        assert by_label["5h"].used_percent == 93.0

    def test_legacy_shape_without_remaining_treats_used_as_remainder(self, kimi_profile, monkeypatch):
        legacy = {
            "user": {"membership": {"level": "LEVEL_ADVANCED"}},
            "usage": {"limit": "100", "used": "70", "resetTime": "2026-09-11T11:01:47Z"},
            "limits": [],
        }
        usage = self._fetch(kimi_profile, legacy, monkeypatch)
        (period,) = usage.windows
        assert str(period.remaining) == "70"
        assert period.used is None
        assert period.used_percent == 30.0
