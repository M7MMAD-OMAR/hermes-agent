"""Contracts for the geometry section of the house lint.

Every text check ever written passes text that runs past its box, a card
sitting on its neighbour, and pale type on a pale panel, because none of
them read a box. These tests hold one deliberately broken deck per rule
against the lint, and hold a deck built by our own create script against
it too: a geometry rule that cries on clean output is worse than no rule,
because it is the one people switch off.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
HOUSE = REPO / "skills" / "productivity" / "house-style" / "scripts"
PPTX_CREATE = REPO / "skills" / "productivity" / "powerpoint" / "scripts" / \
    "pptx_create.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def lint():
    if str(HOUSE) not in sys.path:
        sys.path.insert(0, str(HOUSE))
    return _load("style_lint_geometry_under_test", HOUSE / "style_lint.py")


# ---------------------------------------------------------------------------
# Fixture builders. Each deck breaks one rule and nothing else, so a test
# that fires twice is a rule reaching past its own subject.
# ---------------------------------------------------------------------------


def _deck():
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    return prs, prs.slides.add_slide(prs.slide_layouts[6])


def _textbox(slide, box, text, *, name, size=18, color="1A1A1A", spacing=1.2):
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx.util import Inches, Pt

    left, top, width, height = box
    shape = slide.shapes.add_textbox(Inches(left), Inches(top),
                                     Inches(width), Inches(height))
    frame = shape.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(frame, side, Inches(0))
    para = frame.paragraphs[0]
    para.line_spacing = spacing
    run = para.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    shape.name = name
    return shape


def _panel(slide, box, fill, *, name):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    left, top, width, height = box
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left),
                                   Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(fill)
    shape.line.fill.background()
    shape.name = name
    return shape


def _rules(findings, name):
    return [f for f in findings if f["rule"] == name]


@pytest.fixture(autouse=True)
def _needs_pptx():
    pytest.importorskip("pptx")


# ---------------------------------------------------------------------------
# 1. Off the slide, and inside the safe margin
# ---------------------------------------------------------------------------


def test_a_shape_off_the_slide_is_reported_with_its_overhang(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (-1.2, 3.0, 4.0, 0.5), "Pushed off the left edge",
             name="runaway title")
    path = tmp_path / "off.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "off_slide")
    assert len(hits) == 1
    assert "slide 1" in hits[0]["where"]
    assert "runaway title" in hits[0]["detail"]
    assert "1.20 in" in hits[0]["detail"]
    assert hits[0]["level"] == "warn"


def test_a_shape_inside_the_safe_margin_is_reported(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (0.2, 1.0, 3.0, 0.5), "Inside the safe margin",
             name="margin creeper")
    path = tmp_path / "margin.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "out_of_margin")
    assert len(hits) == 1
    assert "margin creeper" in hits[0]["detail"]
    # margin_x is 0.667 in, so a box at 0.2 in is 0.47 in inside it.
    assert "0.47 in" in hits[0]["detail"]


def test_a_full_bleed_background_is_not_a_margin_finding(lint, tmp_path):
    prs, slide = _deck()
    _panel(slide, (0, 0, 13.333, 7.5), "1F2937", name="full bleed")
    path = tmp_path / "bleed.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "out_of_margin") == []
    assert _rules(lint.geometry_findings(path), "off_slide") == []


# ---------------------------------------------------------------------------
# 2. Text that needs more height than its box has
# ---------------------------------------------------------------------------


def test_text_past_the_bottom_of_its_box_is_an_error(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (1.0, 1.0, 3.0, 0.4),
             "A paragraph of body copy that is far too long for the small "
             "box it was given, which is exactly the defect no text check "
             "can see, and it keeps going well past the bottom edge.",
             name="overflowing note")
    path = tmp_path / "overflow.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "text_overflow")
    assert len(hits) == 1
    # Visible damage, so it gates the delivery rather than budgeting it.
    assert hits[0]["level"] == "error"
    assert "overflowing note" in hits[0]["detail"]
    assert "estimate" in hits[0]["detail"]


def test_the_overflow_estimate_agrees_with_the_builder(lint, tmp_path):
    """A box sized from estimate_lines must never be called an overflow.

    The builder budgets height from the same line count, so anything
    inside the slack has to pass or every composed slide fails.
    """
    house = _load("house_style_for_geometry", HOUSE / "house_style.py")
    text = ("Two products carried the quarter, and the pricing change is "
            "what moved them both.")
    size, width = 18, 5.0
    lines = house.estimate_lines(text, width, size)
    height = lines * size * 1.35 / 72

    prs, slide = _deck()
    _textbox(slide, (1.0, 1.0, width, height), text, name="sized to fit",
             size=size, spacing=1.35)
    path = tmp_path / "fits.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "text_overflow") == []


def test_a_title_that_wraps_in_its_placeholder_is_not_an_overflow(
        lint, tmp_path):
    """The line count is a ceiling, and a two line title sits on the edge.

    An 81 character title in a 12 in band is 2.02 lines by the estimate
    and two lines on the page. Measuring across the box rather than
    inside its insets, and requiring the spill to exceed one line of its
    own type, is what keeps that from failing a delivery.
    """
    spec = tmp_path / "deck.json"
    spec.write_text(json.dumps({"slides": [{
        "layout": "title_content",
        "title": "A rather long title that will certainly wrap onto a "
                 "second line in the title band",
        "bullets": ["Pricing moved to a single plan billed yearly, which "
                    "removed four support tickets a week",
                    "Onboarding dropped from nine screens to two and first "
                    "value now lands in eleven days"]}]}), encoding="utf-8")
    deck = tmp_path / "deck.pptx"
    run = subprocess.run([sys.executable, str(PPTX_CREATE), str(spec),
                          str(deck)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr

    assert lint.geometry_findings(deck) == []


def test_a_frame_that_grows_to_its_text_is_not_an_overflow(lint, tmp_path):
    from pptx.enum.text import MSO_AUTO_SIZE

    prs, slide = _deck()
    shape = _textbox(slide, (1.0, 1.0, 3.0, 0.4),
                     "A long line of copy in a box that resizes itself to "
                     "hold whatever it is given, so nothing spills.",
                     name="growing note")
    shape.text_frame.auto_size = MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT
    path = tmp_path / "grows.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "text_overflow") == []


# ---------------------------------------------------------------------------
# 3. Two boxes on top of each other
# ---------------------------------------------------------------------------


def test_two_overlapping_cards_are_reported_as_a_pair(lint, tmp_path):
    prs, slide = _deck()
    _panel(slide, (1.0, 2.0, 4.0, 2.0), "EFEBE4", name="card one")
    _panel(slide, (3.0, 2.4, 4.0, 2.0), "E4E8EF", name="card two")
    path = tmp_path / "overlap.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "shape_overlap")
    assert len(hits) == 1
    assert "card one" in hits[0]["detail"] and "card two" in hits[0]["detail"]
    assert "2.00 x 1.60 in" in hits[0]["detail"]


def test_a_card_behind_its_own_text_is_not_an_overlap(lint, tmp_path):
    prs, slide = _deck()
    _panel(slide, (1.0, 2.0, 6.0, 2.0), "F2F0EB", name="house card")
    _textbox(slide, (1.3, 2.3, 5.4, 0.5), "One plan, billed yearly.",
             name="card body")
    path = tmp_path / "card.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "shape_overlap") == []


def test_a_hairline_rule_crossing_a_box_is_not_an_overlap(lint, tmp_path):
    from pptx.enum.shapes import MSO_CONNECTOR
    from pptx.util import Inches

    prs, slide = _deck()
    _textbox(slide, (1.0, 2.0, 4.0, 1.0), "October", name="step label")
    slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.7),
                               Inches(2.5), Inches(12.6), Inches(2.5))
    path = tmp_path / "rule.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "shape_overlap") == []


# ---------------------------------------------------------------------------
# 4. Contrast against what is actually behind the text
# ---------------------------------------------------------------------------


def test_pale_text_is_scored_against_the_card_under_it(lint, tmp_path):
    prs, slide = _deck()
    _panel(slide, (1.0, 2.0, 6.0, 2.0), "F2F0EB", name="house card")
    _textbox(slide, (1.3, 2.3, 5.4, 0.5), "Pale ink on a pale card",
             name="card body", size=18, color="C9C4BA")
    path = tmp_path / "contrast.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "low_contrast_in_place")
    assert len(hits) == 1
    # The backdrop is the card, not the white slide the card sits on.
    assert "F2F0EB" in hits[0]["detail"]
    assert "4.5" in hits[0]["detail"]


def test_large_type_is_held_to_the_lower_floor(lint, tmp_path):
    """4.5 below 24 pt, 3.0 at 24 and above."""
    prs, slide = _deck()
    # Contrast about 3.9: a pass at 32 pt, a failure at 18 pt.
    _textbox(slide, (1.0, 1.0, 6.0, 1.2), "A stat, set large",
             name="stat value", size=32, color="8A8A8A")
    _textbox(slide, (1.0, 3.0, 6.0, 0.5), "A caption, set small",
             name="stat label", size=18, color="8A8A8A")
    path = tmp_path / "floors.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "low_contrast_in_place")
    names = " ".join(f["detail"] for f in hits)
    assert "stat label" in names
    assert "stat value" not in names


def test_contrast_is_skipped_over_a_picture(lint, tmp_path):
    from pptx.util import Inches

    png = tmp_path / "backdrop.png"
    png.write_bytes(_one_pixel_png())
    prs, slide = _deck()
    slide.shapes.add_picture(str(png), Inches(0), Inches(0),
                             Inches(13.333), Inches(7.5))
    _textbox(slide, (1.0, 2.0, 6.0, 0.5), "Set over a photograph",
             name="caption", size=18, color="C9C4BA")
    path = tmp_path / "picture.pptx"
    prs.save(str(path))

    # A photograph has no single luminance, so the check has no backdrop
    # to score and says nothing rather than guessing.
    assert _rules(lint.geometry_findings(path), "low_contrast_in_place") == []


def _one_pixel_png() -> bytes:
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
        "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


# ---------------------------------------------------------------------------
# 5. Edges that are close but not equal
# ---------------------------------------------------------------------------


def test_near_aligned_edges_are_flagged(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (1.0, 1.0, 4.0, 0.5), "Aligned here", name="first line")
    _textbox(slide, (1.03, 2.0, 4.0, 0.5), "Nearly aligned",
             name="second line")
    path = tmp_path / "near.pptx"
    prs.save(str(path))

    hits = _rules(lint.geometry_findings(path), "near_alignment")
    assert hits, "a 2.2 pt difference reads as a miss, not a choice"
    assert "2.2 pt" in hits[0]["detail"]
    assert all(h["level"] == "warn" for h in hits)


def test_equal_edges_are_never_flagged(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (1.0, 1.0, 4.0, 0.5), "Aligned here", name="first line")
    _textbox(slide, (1.0, 2.0, 4.0, 0.5), "Aligned too", name="second line")
    path = tmp_path / "equal.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "near_alignment") == []


def test_edges_far_apart_are_a_choice_not_a_miss(lint, tmp_path):
    prs, slide = _deck()
    _textbox(slide, (1.0, 1.0, 4.0, 0.5), "One column", name="first line")
    _textbox(slide, (6.0, 1.0, 4.0, 0.5), "Another column", name="second line")
    path = tmp_path / "far.pptx"
    prs.save(str(path))

    assert _rules(lint.geometry_findings(path), "near_alignment") == []


# ---------------------------------------------------------------------------
# The deck our own script produces
# ---------------------------------------------------------------------------

CLEAN_SPEC = {"slides": [
    {"layout": "title", "title": "Third quarter review",
     "subtitle": "Finance, October"},
    {"layout": "title_content", "title": "Agenda",
     "bullets": ["Where the quarter landed", "What changed in pricing",
                 "What ships next"]},
    {"layout": "statement", "kicker": "Where we are",
     "text": "Two products carry the quarter."},
    {"layout": "stat", "title": "The quarter in three numbers",
     "stats": [{"value": "34%", "label": "Revenue growth",
                "source": "Finance, Q3 close"},
               {"value": "1.2M", "label": "Active accounts"},
               {"value": "11", "label": "Days to first value"}]},
    {"layout": "cards", "title": "What changed",
     "cards": [{"label": "Pricing", "body": "One plan, billed yearly."},
               {"label": "Onboarding", "body": "Two steps, not nine."},
               {"label": "Support", "body": "One queue, one owner."}]},
    {"layout": "comparison", "title": "Before and after", "divider": True,
     "columns": [{"heading": "Before", "body": "Nine screens to first value."},
                 {"heading": "After", "body": "Two screens, same value."}]},
    {"layout": "timeline", "title": "How it lands",
     "steps": [{"label": "October", "text": "Pricing ships."},
               {"label": "November", "text": "Onboarding ships."},
               {"label": "December", "text": "Migration closes."}]},
    {"layout": "quote", "text": "We stopped asking for the form.",
     "attribution": "Head of Support"},
    {"layout": "closing", "text": "Ship the pricing change in October.",
     "contact": "finance@example.com"},
]}


@pytest.fixture(scope="module")
def clean_deck(tmp_path_factory):
    pytest.importorskip("pptx")
    out_dir = tmp_path_factory.mktemp("clean")
    spec = out_dir / "deck.json"
    spec.write_text(json.dumps(CLEAN_SPEC), encoding="utf-8")
    deck = out_dir / "deck.pptx"
    run = subprocess.run([sys.executable, str(PPTX_CREATE), str(spec),
                          str(deck)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return deck


def test_a_house_deck_has_no_geometry_findings(lint, clean_deck):
    """The rule that decides whether any of this is usable.

    Nine slides, every composed layout, drawn on the house grid: not one
    margin, overflow, overlap, contrast or alignment finding. A single
    false positive here and the section gets switched off.
    """
    findings = lint.geometry_findings(clean_deck)
    assert findings == [], findings


def test_only_geometry_returns_geometry_alone(lint, clean_deck):
    every = lint.lint(clean_deck, "all")
    geometry = lint.lint(clean_deck, "geometry")
    design = lint.lint(clean_deck, "design")
    assert geometry == []
    # The older sections still run, and still run on their own.
    assert all(f["rule"] != "text_overflow" for f in design)
    for finding in every:
        assert {"level", "rule", "where", "detail"} <= set(finding)


def test_geometry_is_a_choice_on_the_command_line(tmp_path, clean_deck):
    run = subprocess.run(
        [sys.executable, str(HOUSE / "style_lint.py"), str(clean_deck),
         "--only", "geometry", "--json"], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    payload = json.loads(run.stdout)
    assert payload == {"ok": True, "errors": 0, "warnings": 0, "findings": []}


# ---------------------------------------------------------------------------
# The parts that carry over to a reflowing page
# ---------------------------------------------------------------------------


def test_docx_image_wider_than_the_column_is_out_of_margin(lint, tmp_path):
    pytest.importorskip("docx")
    from docx import Document
    from docx.shared import Inches

    png = tmp_path / "wide.png"
    png.write_bytes(_one_pixel_png())
    doc = Document()
    doc.add_picture(str(png), width=Inches(9))
    path = tmp_path / "image.docx"
    doc.save(str(path))

    hits = _rules(lint.geometry_findings(path), "out_of_margin")
    assert len(hits) == 1
    assert "image 1" in hits[0]["where"]
    assert "9.00 in" in hits[0]["detail"]


def test_docx_table_wider_than_the_column_is_out_of_margin(lint, tmp_path):
    pytest.importorskip("docx")
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document()
    table = doc.add_table(rows=1, cols=2)
    for col in table._tbl.find(qn("w:tblGrid")).findall(qn("w:gridCol")):
        col.set(qn("w:w"), str(int(4.5 * 1440)))
    table.rows[0].cells[0].text = "wide"
    path = tmp_path / "table.docx"
    doc.save(str(path))

    hits = _rules(lint.geometry_findings(path), "out_of_margin")
    assert len(hits) == 1
    assert "table 1" in hits[0]["where"]
    assert "9.00 in" in hits[0]["detail"]


def test_docx_contrast_reads_the_shading_behind_the_run(lint, tmp_path):
    pytest.importorskip("docx")
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    doc = Document()
    para = doc.add_paragraph()
    run = para.add_run("Pale grey ink on a shaded panel.")
    run.font.color.rgb = RGBColor.from_string("CFCFCF")
    run.font.size = Pt(11)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "E8E8E8")
    para._p.get_or_add_pPr().append(shd)
    path = tmp_path / "shaded.docx"
    doc.save(str(path))

    hits = _rules(lint.geometry_findings(path), "low_contrast_in_place")
    assert len(hits) == 1
    assert "E8E8E8" in hits[0]["detail"]
    assert "paragraph 1" in hits[0]["where"]


def test_a_house_report_has_no_geometry_findings(lint, tmp_path):
    pytest.importorskip("docx")
    create = REPO / "skills" / "productivity" / "docx" / "scripts" / \
        "docx_create.py"
    png = tmp_path / "figure.png"
    png.write_bytes(_one_pixel_png())
    spec = tmp_path / "report.json"
    spec.write_text(json.dumps({"blocks": [
        {"type": "heading", "text": "Third quarter review", "level": 1},
        {"type": "paragraph",
         "text": "Two products carried the quarter. Pricing moved to one "
                 "plan billed yearly in October."},
        {"type": "table", "header": ["Product", "Revenue"],
         "rows": [["Core", "4.1M"], ["Field", "2.8M"]]},
        {"type": "image", "path": str(png), "width_mm": 120},
    ]}), encoding="utf-8")
    out = tmp_path / "report.docx"
    run = subprocess.run([sys.executable, str(create), str(spec), str(out)],
                         capture_output=True, text=True)
    assert run.returncode == 0, run.stderr

    findings = lint.geometry_findings(out)
    assert findings == [], findings


def test_geometry_findings_carry_a_place_and_a_number(lint, tmp_path):
    """Every finding names where it is and what failed.

    A geometry warning nobody can act on is noise, and the number is what
    turns "this looks off" into a fix.
    """
    import re

    prs, slide = _deck()
    _textbox(slide, (-1.2, 3.0, 4.0, 0.5), "Off the edge", name="runaway")
    _textbox(slide, (0.2, 1.0, 3.0, 0.2),
             "A line of copy far too long for the box it was handed here.",
             name="creeper")
    path = tmp_path / "mixed.pptx"
    prs.save(str(path))

    findings = lint.geometry_findings(path)
    assert findings
    for finding in findings:
        assert re.search(r"slide \d+", finding["where"])
        assert re.search(r"\d", finding["detail"])
        assert finding["level"] in ("warn", "error")
