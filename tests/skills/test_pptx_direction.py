"""Direction in a deck that carries two scripts.

A paragraph has one base direction. Its runs do not. Getting that wrong is
not a styling complaint, it changes what the slide says: an Arabic line with
no base direction puts its full stop at the start, and a Latin brand name
marked right to left inside an Arabic sentence comes out reversed.

In presentation markup the marks are ``a:pPr@rtl`` and ``a:rPr@rtl``, in the
``a`` namespace. An absent attribute there means inherit, not false, so every
run is marked explicitly and these tests pin all three cases: Arabic, Latin,
and a run of digits that has no script of its own.
"""

from __future__ import annotations

import importlib.util
import sys
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("pptx")

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "skills" / "productivity" / "powerpoint" / "scripts"

AR = "البند الجزائي يحتاج مراجعة قبل التوقيع."
EN = "The notice period is now sixty days for either party."


@pytest.fixture(scope="module")
def common():
    spec = importlib.util.spec_from_file_location(
        "pptx_common_under_test", SCRIPTS / "pptx_common.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def qn(tag):
    from pptx.oxml.ns import qn as _qn  # noqa: PLC0415

    return _qn(tag)


def para_rtl(para):
    """The paragraph's own base direction mark, or None when it has none."""
    p_pr = para._p.find(qn("a:pPr"))
    return None if p_pr is None else p_pr.get("rtl")


def run_rtl_flags(para):
    out = []
    for run in para.runs:
        r_pr = run._r.find(qn("a:rPr"))
        out.append(None if r_pr is None else r_pr.get("rtl"))
    return out


def blank_deck():
    from pptx import Presentation  # noqa: PLC0415

    prs = Presentation()
    return prs, prs.slides.add_slide(prs.slide_layouts[6])


def textbox_paragraph(slide, *texts):
    from pptx.util import Inches  # noqa: PLC0415

    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1))
    para = box.text_frame.paragraphs[0]
    for text in texts:
        para.add_run().text = text
    return para


def test_an_arabic_sentence_keeps_its_latin_run_left_to_right(common):
    """The case that reverses a brand name if you mark every run."""
    _, slide = blank_deck()
    para = textbox_paragraph(slide, "تم توريد ", "IBM Plex Sans Arabic",
                             " بتاريخ ", "2026")
    common.set_paragraph_rtl(para, True)

    assert para_rtl(para) == "1", "the paragraph's base direction is Arabic"
    assert run_rtl_flags(para) == ["1", "0", "1", "1"], \
        "the Latin run must not be marked, the digits follow the paragraph"


def test_an_english_sentence_marks_only_the_arabic_it_quotes(common):
    _, slide = blank_deck()
    para = textbox_paragraph(slide, "The clause is titled ", "البند الجزائي",
                             " in the Arabic copy.")
    common.mark_runs_by_script(para, base_rtl=False)

    assert para_rtl(para) is None, "an English line stays left to right"
    assert run_rtl_flags(para) == ["0", "1", "0"]


def test_a_run_of_digits_alone_follows_its_paragraph(common):
    """A version number in an Arabic line is not a direction of its own."""
    _, slide = blank_deck()
    arabic = textbox_paragraph(slide, "النسخة ", "2.4.1")
    common.set_paragraph_rtl(arabic, True)
    assert run_rtl_flags(arabic) == ["1", "1"]

    latin = textbox_paragraph(slide, "Version ", "2.4.1")
    common.mark_runs_by_script(latin, base_rtl=False)
    assert run_rtl_flags(latin) == ["0", "0"]


def test_the_auto_pass_separates_arabic_paragraphs_from_mixed_ones(common):
    prs, slide = blank_deck()
    arabic = textbox_paragraph(slide, AR)
    english = textbox_paragraph(slide, EN)
    mixed = textbox_paragraph(slide, "The clause reads ", "البند الجزائي",
                              " in Arabic.")

    counts = common.apply_rtl(prs, "auto")

    assert para_rtl(arabic) == "1"
    assert para_rtl(english) is None, "a Latin line is left alone"
    assert para_rtl(mixed) is None, "mostly Latin keeps its own base direction"
    assert counts["paragraphs"] == 1
    assert counts["mixed_paragraphs"] == 1
    assert run_rtl_flags(mixed) == ["0", "1", "0"]


def test_the_mixed_branch_leaves_the_paragraph_properties_alone(common):
    """A centred title that quotes Arabic keeps the alignment it inherited."""
    prs, slide = blank_deck()
    mixed = textbox_paragraph(slide, "Sprint ", "مراجعة", " report")

    common.apply_rtl(prs, "auto")

    assert mixed._p.find(qn("a:pPr")) is None, \
        "the mixed branch must not touch a:pPr"


def test_table_cells_are_covered(common):
    from pptx.util import Inches  # noqa: PLC0415

    prs, slide = blank_deck()
    frame = slide.shapes.add_table(2, 2, Inches(1), Inches(1),
                                   Inches(8), Inches(2))
    table = frame.table
    table.cell(0, 0).text = "المنتج"
    table.cell(0, 1).text = "الهامش"
    table.cell(1, 0).text = "المقابض"
    table.cell(1, 1).text = "41%"

    counts = common.apply_rtl(prs, "auto")

    assert counts["cells"] == 3, "three cells carry Arabic letters"
    arabic_cell = table.cell(0, 0).text_frame.paragraphs[0]
    assert para_rtl(arabic_cell) == "1"
    assert run_rtl_flags(arabic_cell) == ["1"]


def test_a_table_inside_a_group_is_reached(common):
    from pptx.util import Inches  # noqa: PLC0415

    prs, slide = blank_deck()
    inner = slide.shapes.add_textbox(Inches(1), Inches(1),
                                     Inches(3), Inches(1))
    inner.text_frame.paragraphs[0].add_run().text = AR
    other = slide.shapes.add_textbox(Inches(5), Inches(1),
                                     Inches(3), Inches(1))
    other.text_frame.paragraphs[0].add_run().text = "التسليم"
    group = slide.shapes.add_group_shape([inner, other])
    assert len(group.shapes) == 2

    counts = common.apply_rtl(prs, "auto")

    assert counts["paragraphs"] == 2, "both group members were reached"
    assert para_rtl(inner.text_frame.paragraphs[0]) == "1"


def test_speaker_notes_are_covered(common):
    prs, slide = blank_deck()
    notes = slide.notes_slide.notes_text_frame
    para = notes.paragraphs[0]
    for text in ("قدّم ", "Hermes", " أولاً"):
        para.add_run().text = text

    common.apply_rtl(prs, "auto")

    assert para_rtl(para) == "1"
    assert run_rtl_flags(para) == ["1", "0", "1"]


def test_a_slide_without_notes_does_not_grow_one(common):
    prs, slide = blank_deck()
    textbox_paragraph(slide, AR)

    common.apply_rtl(prs, "auto")

    assert not slide.has_notes_slide, \
        "the pass must not materialise a notes part"


def test_the_pass_is_idempotent_to_the_byte(common, tmp_path):
    from pptx import Presentation  # noqa: PLC0415

    prs, slide = blank_deck()
    textbox_paragraph(slide, "تم توريد ", "IBM Plex Sans Arabic",
                      " بالنسخة ", "2.4.1")
    textbox_paragraph(slide, "The clause reads ", "البند الجزائي",
                      " in Arabic.")
    textbox_paragraph(slide, EN)
    first = tmp_path / "first.pptx"
    prs.save(str(first))

    # Reopen between passes, so re-serialisation is not what is being
    # compared. Only the second and third files are measured against
    # each other, and only the slide part they both carry.
    once = tmp_path / "once.pptx"
    deck = Presentation(str(first))
    common.apply_rtl(deck, "auto")
    deck.save(str(once))

    twice = tmp_path / "twice.pptx"
    deck = Presentation(str(once))
    common.apply_rtl(deck, "auto")
    deck.save(str(twice))

    def slide_xml(path):
        with zipfile.ZipFile(path) as zf:
            return zf.read("ppt/slides/slide1.xml")

    assert slide_xml(once) == slide_xml(twice), \
        "running the pass twice must not keep changing the markup"


def test_mode_on_flips_a_latin_deck_and_mode_off_touches_nothing(common):
    prs, slide = blank_deck()
    para = textbox_paragraph(slide, "Version ", "2.4.1")

    counts = common.apply_rtl(prs, "on")
    assert counts["paragraphs"] == 1
    assert para_rtl(para) == "1"
    assert run_rtl_flags(para) == ["0", "1"], \
        "mode on flips the base direction, it does not reverse a Latin word"

    prs, slide = blank_deck()
    untouched = textbox_paragraph(slide, AR)
    counts = common.apply_rtl(prs, "off")
    assert counts == {"paragraphs": 0, "cells": 0, "mixed_paragraphs": 0}
    assert para_rtl(untouched) is None
    assert run_rtl_flags(untouched) == [None]


def test_an_unknown_mode_is_refused(common):
    prs, _ = blank_deck()
    with pytest.raises(ValueError):
        common.apply_rtl(prs, "sideways")
