"""A model OpenRouter serves must be reachable from the picker.

The picker shows CURATED ∩ LIVE, iterating the curated list — so a model the
live catalog serves but nobody curated could never appear, however good it is.
`deepseek/deepseek-v4-flash-vision-exp` was invisible for exactly that reason.

The trap underneath: the remote manifest used to REPLACE the in-repo snapshot,
so adding a model to the snapshot changed nothing whenever the manifest was
reachable. Every test here keeps a non-empty remote manifest in play, because a
test that stubs the remote away passes against that bug.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from hermes_cli import models as M

REMOTE = [("anthropic/claude-fable-5.1", ""), ("z-ai/glm-5.3-flash", "")]
LIVE_IDS = [
    "anthropic/claude-fable-5.1",
    "z-ai/glm-5.3-flash",
    "deepseek/deepseek-v4-flash-vision-exp",
    "someone/no-tools-model",
]


@pytest.fixture(autouse=True)
def _isolate_module_caches():
    """Restore every process-lifetime cache this module touches.

    `fetch_openrouter_models` also SEEDS `_openrouter_reasoning_caps_cache` from
    the live payload. Left behind, this file's synthetic payload becomes the
    reasoning-capability answer for the rest of the session, and unrelated
    reasoning tests fail depending on collection order.
    """
    saved = (M._openrouter_catalog_cache, M._openrouter_reasoning_caps_cache)
    M._openrouter_catalog_cache = None
    M._openrouter_reasoning_caps_cache = None
    try:
        yield
    finally:
        M._openrouter_catalog_cache, M._openrouter_reasoning_caps_cache = saved


def _live_index():
    items = [
        {
            "id": mid,
            "pricing": {"prompt": "0.1", "completion": "0.2"},
            "supported_parameters": [] if mid == "someone/no-tools-model" else ["tools"],
        }
        for mid in LIVE_IDS
    ]

    return items, {item["id"]: item for item in items}


def _fetch(static_catalog, extra=()):
    with patch.object(M, "_fetch_live_catalog_index", return_value=_live_index()), patch(
        "hermes_cli.model_catalog.get_curated_openrouter_models", return_value=list(REMOTE)
    ), patch.object(M, "OPENROUTER_MODELS", list(static_catalog)), patch.object(
        M, "_configured_openrouter_extra_models", return_value=[(mid, "") for mid in extra]
    ):
        return [mid for mid, _ in M.fetch_openrouter_models(force_refresh=True)]


class TestTheInRepoSnapshotIsNotDeadCode:
    def test_a_snapshot_only_model_reaches_the_picker(self):
        # The regression this file exists for: the remote manifest is reachable
        # and does NOT carry the model, so the pre-fix code dropped it.
        ids = _fetch([("deepseek/deepseek-v4-flash-vision-exp", "")])

        assert "deepseek/deepseek-v4-flash-vision-exp" in ids

    def test_the_manifest_still_leads_so_the_recommended_badge_does_not_move(self):
        # fetch_openrouter_models badges curated[0]; a merge that reordered the
        # front would silently re-label a different model as recommended.
        ids = _fetch([("deepseek/deepseek-v4-flash-vision-exp", "")])

        assert ids[0] == "anthropic/claude-fable-5.1"
        assert ids.index("deepseek/deepseek-v4-flash-vision-exp") > ids.index("z-ai/glm-5.3-flash")

    def test_a_model_in_both_sources_appears_once(self):
        ids = _fetch([("z-ai/glm-5.3-flash", ""), ("deepseek/deepseek-v4-flash-vision-exp", "")])

        assert ids.count("z-ai/glm-5.3-flash") == 1


class TestTheUserEscapeHatch:
    def test_a_configured_extra_model_appears(self):
        ids = _fetch([], extra=["deepseek/deepseek-v4-flash-vision-exp"])

        assert "deepseek/deepseek-v4-flash-vision-exp" in ids

    def test_an_extra_model_still_obeys_the_live_and_tool_filters(self):
        # Appearing and then failing at the first tool call is worse than not
        # appearing, so the escape hatch does not bypass the existing gates.
        ids = _fetch([], extra=["someone/no-tools-model", "someone/not-served-at-all"])

        assert "someone/no-tools-model" not in ids
        assert "someone/not-served-at-all" not in ids


class TestReadingTheConfiguredExtras:
    @pytest.mark.parametrize(
        ("configured", "expected"),
        [
            (["a/b", "c/d"], ["a/b", "c/d"]),
            ("a/b", ["a/b"]),  # a bare string is the obvious way to write one
            ([" a/b ", ""], ["a/b"]),
            (None, []),
            ({"a": "b"}, []),  # wrong shape must not raise into the picker
        ],
    )
    def test_shapes(self, configured, expected):
        with patch("hermes_cli.config.load_config", return_value={"model": {"extra_openrouter_models": configured}}):
            assert [mid for mid, _ in M._configured_openrouter_extra_models()] == expected

    def test_an_unreadable_config_is_not_fatal(self):
        with patch("hermes_cli.config.load_config", side_effect=RuntimeError("no config")):
            assert M._configured_openrouter_extra_models() == []


class TestTheShippedCatalog:
    def test_the_vision_model_is_curated(self):
        # The user's actual ask; guards against a future snapshot edit dropping it.
        assert "deepseek/deepseek-v4-flash-vision-exp" in [mid for mid, _ in M.OPENROUTER_MODELS]
