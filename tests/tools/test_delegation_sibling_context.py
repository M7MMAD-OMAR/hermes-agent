"""Sibling context for a delegated thread, and the budget that keeps it small.

The trap this file exists to catch: a bound asserted in CHARACTERS passes every
test written with English fixtures and then blows the real context budget on
Arabic or CJK, where one character costs two to four times an ASCII one. Every
budget assertion below is in tokens, measured with the same estimator the
compaction preflight uses.

Measured scale this has to survive: 24 threads under one coordinator, averaging
96 messages each, on a live machine.
"""

import pytest

from agent.model_metadata import estimate_tokens_rough
from tools.delegation_sibling_context import (
    DEFAULT_SIBLING_TOKEN_BUDGET,
    MAX_SIBLINGS,
    build_sibling_context,
    merge_context,
    sibling_lines,
    siblings_from_registry,
)


def sibling(label, state="working", activity=""):
    return {"activity": activity, "label": label, "session_id": "t-x", "state": state}


class TestSiblingLines:
    def test_one_line_per_sibling_with_its_state(self):
        lines = sibling_lines([sibling("Trace the cyanotype lineage", activity="read_file")])

        assert lines == ["- Trace the cyanotype lineage (working, read_file)"]

    def test_a_sibling_with_no_activity_still_gets_its_name(self):
        """Knowing a thread EXISTS is most of the value."""
        lines = sibling_lines([sibling("Build the deck")])

        assert lines == ["- Build the deck (working)"]

    def test_a_nameless_sibling_is_skipped(self):
        assert sibling_lines([{"label": "", "session_id": ""}]) == []

    def test_a_runaway_label_is_clipped_before_the_budget_is_consulted(self):
        lines = sibling_lines([sibling("x" * 5000)])

        assert len(lines[0]) < 200

    def test_the_list_stops_being_a_directory(self):
        lines = sibling_lines([sibling(f"Thread number {i}") for i in range(40)])

        assert len(lines) == MAX_SIBLINGS


class TestTokenBudget:
    def test_nothing_to_say_produces_nothing(self):
        assert build_sibling_context([]) is None

    def test_a_small_set_fits_whole(self):
        block = build_sibling_context([sibling("Trace the cyanotype lineage"), sibling("Build the deck")])

        assert "cyanotype" in block
        assert "Build the deck" in block

    def test_the_block_stays_inside_the_token_budget(self):
        block = build_sibling_context([sibling(f"Thread number {i} doing a thing") for i in range(MAX_SIBLINGS)])

        assert estimate_tokens_rough(block) <= DEFAULT_SIBLING_TOKEN_BUDGET * 1.2

    @pytest.mark.parametrize("label", [
        "تتبع نسب التصوير الأزرق عبر ثلاثة مسارات متوازية وتقرير النتائج",
        "三つの系統を並行してたどり、結果を報告する長いスレッドのラベル",
    ])
    def test_the_budget_holds_for_non_ascii_labels(self, label):
        """The regression a character bound would miss entirely: these labels
        cost two to four times what their character count suggests."""
        block = build_sibling_context([sibling(f"{label} {i}") for i in range(MAX_SIBLINGS)])

        assert block is not None
        assert estimate_tokens_rough(block) <= DEFAULT_SIBLING_TOKEN_BUDGET * 1.2

    def test_a_tiny_budget_drops_the_block_rather_than_truncating_it(self):
        """A prompt cut mid-sentence by a downstream budget it never saw is
        worse than no sibling context at all."""
        assert build_sibling_context([sibling("Trace the lineage")], token_budget=5) is None

    def test_a_zero_budget_produces_nothing(self):
        assert build_sibling_context([sibling("Trace the lineage")], token_budget=0) is None

    def test_omitted_siblings_are_counted_rather_than_hidden(self):
        block = build_sibling_context(
            [sibling(f"A reasonably long sibling thread label number {i}") for i in range(MAX_SIBLINGS)],
            token_budget=120,
        )

        assert block is not None
        assert "more" in block

    def test_the_frame_alone_never_ships_without_content(self):
        block = build_sibling_context([sibling("Trace the lineage")], token_budget=40)

        assert block is None or "- Trace the lineage" in block


class TestMergeContext:
    def test_the_callers_instruction_comes_first(self):
        merged = merge_context("Do the thing.", "Sibling threads: ...")

        assert merged.startswith("Do the thing.")

    def test_no_block_leaves_the_context_byte_for_byte_unchanged(self):
        """The no-siblings path must be what it was before this module existed."""
        assert merge_context("Do the thing.", None) == "Do the thing."
        assert merge_context(None, None) is None

    def test_a_block_with_no_base_stands_alone(self):
        assert merge_context(None, "Sibling threads: ...") == "Sibling threads: ..."

    def test_an_empty_base_does_not_produce_leading_blank_lines(self):
        assert merge_context("", "Sibling threads: ...") == "Sibling threads: ..."


class TestRegistryReadIsNeverFatal:
    def test_a_broken_registry_yields_no_siblings_rather_than_raising(self):
        """Context is a nicety. It must never be able to fail a spawn."""

        class Exploding:
            def __getattr__(self, name):
                raise RuntimeError("registry is down")

        assert siblings_from_registry(Exploding()) == []

    def test_the_spawning_child_is_excluded_from_its_own_siblings(self, monkeypatch):
        import tools.delegate_tool_registry as registry

        monkeypatch.setattr(
            registry, "_list_payload",
            lambda parent: {"subagents": [
                {"subagent_id": "sa-me", "goal": "my own goal", "status": "running"},
                {"subagent_id": "sa-other", "goal": "someone else's goal", "status": "running"},
            ]},
        )

        siblings = siblings_from_registry(object(), exclude_subagent_id="sa-me")

        assert [s["label"] for s in siblings] == ["someone else's goal"]

    def test_a_finished_sibling_reports_its_real_state(self, monkeypatch):
        import tools.delegate_tool_registry as registry

        monkeypatch.setattr(
            registry, "_list_payload",
            lambda parent: {"subagents": [{"subagent_id": "sa-1", "goal": "done work", "status": "completed"}]},
        )

        assert siblings_from_registry(object())[0]["state"] == "completed"
