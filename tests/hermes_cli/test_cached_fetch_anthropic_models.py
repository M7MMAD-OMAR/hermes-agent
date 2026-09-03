"""Cache-contract tests for ``cached_fetch_anthropic_models()``.

Every `/model` switch onto a native Anthropic model called
``_fetch_anthropic_models()`` directly with no disk cache — a live,
unpooled HTTPS round trip to ``/v1/models`` on literally every switch,
measured at 330-1800ms on top of everything else ``switch_model()`` does
(the dominant cost, all other steps combined were single-digit ms once
``fetch_models_dev``'s own cache was warm). Every sibling model-list
lookup in this module (``cached_provider_model_ids``,
``cached_fetch_api_models``, #72762) already had this disk cache;
``validate_requested_model``'s Anthropic-native branch did not.

Mirrors ``test_cached_fetch_api_models.py``'s structure and the exact
cache contract (fresh/stale/rotation/refresh/fallback) — same
``provider_models_cache.json``, same primitives, different key prefix
(``anthropic-native:<base_url>`` instead of ``custom:<base_url>``) so the
two coexist without collision.
"""

from __future__ import annotations

import time
from unittest.mock import patch


class TestCachedFetchAnthropicModels:
    def _entry(self, models, age_seconds, fp="fp"):
        return {"fp": fp, "at": time.time() - age_seconds, "models": list(models)}

    def test_fresh_entry_served_without_live_fetch(self):
        import hermes_cli.models as mod

        cache = {"anthropic-native:https://api.anthropic.com": self._entry(["claude-opus-5", "claude-sonnet-5"], age_seconds=10)}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache") as save, \
             patch.object(mod, "_fetch_anthropic_models") as live:
            out = mod.cached_fetch_anthropic_models(base_url="https://api.anthropic.com")
        assert out == ["claude-opus-5", "claude-sonnet-5"]
        live.assert_not_called()
        save.assert_not_called()

    def test_cache_key_normalizes_missing_base_url_to_default(self):
        """The common case: no explicit base_url override, the account's
        default endpoint — must not collide with, or require, a literal
        'default' string from the caller."""
        import hermes_cli.models as mod

        cache = {"anthropic-native:default": self._entry(["claude-opus-5"], age_seconds=10)}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_fetch_anthropic_models") as live:
            out = mod.cached_fetch_anthropic_models(base_url=None)
        assert out == ["claude-opus-5"]
        live.assert_not_called()

    def test_expired_entry_triggers_live_fetch_and_is_persisted(self):
        import hermes_cli.models as mod

        too_old = mod._PROVIDER_MODELS_STALE_SERVE_MAX + 60
        cache = {"anthropic-native:default": self._entry(["old"], age_seconds=too_old)}
        saved = {}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache", side_effect=saved.update), \
             patch.object(mod, "_fetch_anthropic_models", return_value=["claude-opus-5", "claude-sonnet-5"]) as live:
            out = mod.cached_fetch_anthropic_models(ttl_seconds=3600)
        assert out == ["claude-opus-5", "claude-sonnet-5"]
        live.assert_called_once()
        assert saved["anthropic-native:default"]["models"] == ["claude-opus-5", "claude-sonnet-5"]
        assert saved["anthropic-native:default"]["fp"] == "fp"

    def test_rotated_api_key_busts_cache_even_when_fresh(self):
        import hermes_cli.models as mod

        cache = {"anthropic-native:default": self._entry(["old-key-models"], 10, fp="old-fp")}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="new-fp"), \
             patch.object(mod, "_save_provider_models_cache"), \
             patch.object(mod, "_fetch_anthropic_models", return_value=["new-key-models"]) as live:
            out = mod.cached_fetch_anthropic_models(api_key="sk-ant-rotated")
        assert out == ["new-key-models"]
        live.assert_called_once()

    def test_force_refresh_bypasses_fresh_cache(self):
        import hermes_cli.models as mod

        cache = {"anthropic-native:default": self._entry(["stale-but-fresh"], age_seconds=5)}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache"), \
             patch.object(mod, "_fetch_anthropic_models", return_value=["forced-live"]) as live:
            out = mod.cached_fetch_anthropic_models(force_refresh=True)
        assert out == ["forced-live"]
        live.assert_called_once()

    def test_live_failure_falls_back_to_stale_same_fingerprint_entry(self):
        """Stale data beats no data on a transient outage — the same
        fallback policy cached_fetch_api_models already has (#72762)."""
        import hermes_cli.models as mod

        cache = {"anthropic-native:default": self._entry(["last-known-good"], age_seconds=99999, fp="fp")}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache") as save, \
             patch.object(mod, "_fetch_anthropic_models", return_value=None):
            out = mod.cached_fetch_anthropic_models()
        assert out == ["last-known-good"]
        save.assert_not_called()

    def test_live_failure_with_no_matching_entry_returns_none(self):
        """The one case the caller's `if anthropic_models is not None`
        branch in validate_requested_model still needs: a genuine
        first-ever failure (no token, unreachable) must stay None, not an
        empty list, or the caller mis-reports 'not found in the listing'
        instead of falling through to the generic-probe warning."""
        import hermes_cli.models as mod

        with patch.object(mod, "_load_provider_models_cache", return_value={}), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache") as save, \
             patch.object(mod, "_fetch_anthropic_models", return_value=None):
            out = mod.cached_fetch_anthropic_models()
        assert out is None
        save.assert_not_called()

    def test_custom_base_url_gets_its_own_cache_entry(self):
        """A proxy/Bedrock-compatible base_url must not read or write the
        default endpoint's cached catalog."""
        import hermes_cli.models as mod

        cache = {"anthropic-native:default": self._entry(["default-endpoint-models"], age_seconds=10)}
        with patch.object(mod, "_load_provider_models_cache", return_value=cache), \
             patch.object(mod, "_custom_endpoint_fingerprint", return_value="fp"), \
             patch.object(mod, "_save_provider_models_cache") as save, \
             patch.object(mod, "_fetch_anthropic_models", return_value=["proxy-models"]) as live:
            out = mod.cached_fetch_anthropic_models(base_url="https://my-proxy.example.com/v1")
        assert out == ["proxy-models"]
        live.assert_called_once()
        save.assert_called_once()


class TestValidateRequestedModelUsesCache:
    """validate_requested_model() is the actual /model-switch hot path
    (see switch_model() in model_switch.py) — this pins that it goes
    through the cached wrapper, not the raw uncached fetcher, so a
    regression here cannot silently reintroduce the live round-trip."""

    def test_anthropic_branch_calls_the_cached_wrapper(self):
        import hermes_cli.models as mod

        with patch.object(mod, "cached_fetch_anthropic_models", return_value=["claude-opus-5"]) as cached, \
             patch.object(mod, "_fetch_anthropic_models") as raw:
            result = mod.validate_requested_model("claude-opus-5", "anthropic")

        cached.assert_called_once()
        raw.assert_not_called()
        assert result["accepted"] is True
        assert result["recognized"] is True

    def test_generic_probe_branch_calls_the_cached_wrapper(self):
        import hermes_cli.models as mod

        with patch.object(mod, "cached_fetch_api_models", return_value=["gpt-6"]) as cached, \
             patch.object(mod, "fetch_api_models") as raw:
            result = mod.validate_requested_model("gpt-6", "openai", api_key="sk-x")

        cached.assert_called_once()
        raw.assert_not_called()
        assert result["accepted"] is True
