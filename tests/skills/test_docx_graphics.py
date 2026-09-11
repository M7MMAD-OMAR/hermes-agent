"""Contracts for the graphics the docx skill puts in a Word document.

A chart, a picture and a shape are the three places a generated report
stops being text, and each of them fails in a way a text test cannot
see: a chart that is a picture of a chart, a picture squashed out of its
aspect, a shape whose Arabic runs the wrong way. So the tests pin the
package itself: the parts, the relationships, the colors that came from
the house theme, and the direction marks.

The last test is the other half of the contract: a spec with no
graphics in it must build exactly the package it built before this
module existed.
"""

from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

docx = pytest.importorskip("docx")
PIL = pytest.importorskip("PIL.Image")

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "skills" / "productivity" / "docx" / "scripts"
SCRIPT = SCRIPTS / "docx_create.py"
HOUSE = REPO / "skills" / "productivity" / "house-style" / "scripts"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"

PIC_SIZE = (400, 250)


@pytest.fixture(scope="module")
def house():
    if str(HOUSE) not in sys.path:
        sys.path.insert(0, str(HOUSE))
    import house_style  # noqa: PLC0415

    return house_style


@pytest.fixture(scope="module")
def picture(tmp_path_factory) -> Path:
    """A small PNG with a known, un-square aspect ratio."""
    from PIL import Image

    path = tmp_path_factory.mktemp("media") / "swatch.png"
    Image.new("RGB", PIC_SIZE, (180, 70, 46)).save(path)
    return path


def build(tmp_path, spec: dict, *args, name: str = "out") -> tuple:
    """Run the create script on a spec and return (report dict, path)."""
    spec_path = tmp_path / f"{name}.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    out = tmp_path / f"{name}.docx"
    run = subprocess.run(
        [sys.executable, str(SCRIPT), str(spec_path), str(out), *args],
        capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout), out


def part(path: Path, name: str) -> str:
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode("utf-8")


def names(path: Path) -> list:
    with zipfile.ZipFile(path) as z:
        return z.namelist()


def chart_spec(**over) -> dict:
    spec = {"type": "chart", "chart": "column", "title": "Revenue by quarter",
            "categories": ["Q1", "Q2", "Q3"], "series": {"2025": [12, 18, 9]},
            "height_mm": 60}
    spec.update(over)
    return spec


# ---------------------------------------------------------------------------
# The chart is a real part
# ---------------------------------------------------------------------------


def test_chart_part_exists_and_is_referenced(tmp_path):
    """A chart part, an Override for it, and an r:id that resolves.

    docx_validate.py only follows references out of document.xml, so the
    chart part's own relationship to its workbook is checked here.
    """
    _, out = build(tmp_path, {"blocks": [chart_spec()]})
    present = names(out)
    assert "word/charts/chart1.xml" in present
    assert "word/charts/_rels/chart1.xml.rels" in present
    assert any(n.startswith("word/embeddings/") and n.endswith(".xlsx")
               for n in present), "the chart carries no embedded workbook"

    types = part(out, "[Content_Types].xml")
    assert "/word/charts/chart1.xml" in types
    assert "drawingml.chart+xml" in types

    body = part(out, "word/document.xml")
    assert f'uri="{C}"' in body, "no chart graphicData in the body"
    rid = body.split('<c:chart ')[1].split('r:id="')[1].split('"')[0]
    rels = part(out, "word/_rels/document.xml.rels")
    assert f'Id="{rid}"' in rels and "charts/chart1.xml" in rels

    chart_rels = part(out, "word/charts/_rels/chart1.xml.rels")
    assert "/relationships/package" in chart_rels
    target = chart_rels.split('Target="')[1].split('"')[0]
    assert target.replace("../", "word/") in present


def test_chart_caches_the_numbers_and_the_workbook_agrees(tmp_path):
    """The cached values are what Word draws, so they must be the data."""
    _, out = build(tmp_path, {"blocks": [chart_spec()]})
    chart = part(out, "word/charts/chart1.xml")
    for value in ("12", "18", "9"):
        assert f"<c:v>{value}</c:v>" in chart
    assert "Sheet1!$A$2:$A$4" in chart and "Sheet1!$B$2:$B$4" in chart


@pytest.mark.parametrize("kind", ["bar", "column", "line", "pie"])
def test_every_chart_kind_builds_its_own_plot(tmp_path, kind):
    _, out = build(tmp_path, {"blocks": [chart_spec(chart=kind)]},
                   name=f"kind-{kind}")
    chart = part(out, "word/charts/chart1.xml")
    group = {"bar": "c:barChart", "column": "c:barChart",
             "line": "c:lineChart", "pie": "c:pieChart"}[kind]
    assert f"<{group}>" in chart
    if kind == "bar":
        assert '<c:barDir val="bar"/>' in chart
    if kind == "column":
        assert '<c:barDir val="col"/>' in chart
    # A pie has no axes at all, and emitting one is a repair prompt.
    assert ("<c:catAx>" in chart) is (kind != "pie")


def test_series_colors_come_from_the_theme(tmp_path, house):
    """One series takes the accent, several take palette.series in order."""
    theme = house.load_theme()
    _, single = build(tmp_path, {"blocks": [chart_spec()]}, name="single")
    chart = part(single, "word/charts/chart1.xml")
    assert f'<a:srgbClr val="{theme.palette.accent}"/>' in chart

    _, multi = build(tmp_path, {"blocks": [chart_spec(
        series={"2024": [8, 5, 11], "2025": [12, 9, 7]})]}, name="multi")
    chart = part(multi, "word/charts/chart1.xml")
    for color in theme.palette.series[:2]:
        assert f'<a:srgbClr val="{color}"/>' in chart, color


def test_a_single_series_gets_no_legend(tmp_path):
    """One series is already named by the title, so a legend is noise."""
    _, single = build(tmp_path, {"blocks": [chart_spec()]}, name="one")
    assert "<c:legend>" not in part(single, "word/charts/chart1.xml")

    _, multi = build(tmp_path, {"blocks": [chart_spec(
        series={"2024": [8, 5, 11], "2025": [12, 9, 7]})]}, name="two")
    chart = part(multi, "word/charts/chart1.xml")
    assert "<c:legend>" in chart and '<c:legendPos val="b"/>' in chart


def test_bars_carry_their_numbers_and_no_gridlines(tmp_path):
    _, out = build(tmp_path, {"blocks": [chart_spec()]})
    chart = part(out, "word/charts/chart1.xml")
    assert '<c:showVal val="1"/>' in chart
    assert "majorGridlines" not in chart
    # With the numbers on the bars the value axis has nothing left to say.
    assert '<c:delete val="1"/>' in chart


def test_an_arabic_chart_title_is_marked_right_to_left(tmp_path):
    """Nothing outside the chart part can reach its title later."""
    _, out = build(tmp_path, {"blocks": [chart_spec(
        title="الإيرادات حسب الربع", categories=["الأول", "الثاني", "الثالث"])]})
    chart = part(out, "word/charts/chart1.xml")
    assert 'rtlCol="1"' in chart
    assert 'rtl="1"' in chart
    assert "الإيرادات حسب الربع" in chart


def test_no_theme_leaves_the_house_palette_out(tmp_path, house):
    """--no-theme means the stock template, charts included."""
    _, out = build(tmp_path, {"blocks": [chart_spec()]}, "--no-theme",
                   name="stock")
    chart = part(out, "word/charts/chart1.xml")
    assert f'val="{house.load_theme().palette.accent}"' not in chart


# ---------------------------------------------------------------------------
# Pictures
# ---------------------------------------------------------------------------


def test_picture_keeps_its_aspect_and_carries_alt_text(tmp_path, picture):
    _, out = build(tmp_path, {"blocks": [
        {"type": "image", "path": str(picture), "width_mm": 60,
         "alt": "A flat colour swatch"}]})
    body = part(out, "word/document.xml")
    extent = body.split("<wp:extent ")[1].split("/>")[0]
    cx = int(extent.split('cx="')[1].split('"')[0])
    cy = int(extent.split('cy="')[1].split('"')[0])
    want = PIC_SIZE[1] / PIC_SIZE[0]
    assert abs((cy / cx) - want) < 0.01, f"aspect {cy / cx} wanted {want}"
    assert 'descr="A flat colour swatch"' in body


def test_image_caption_shares_the_figure_numbering(tmp_path, picture):
    """A caption on an image and a caption block count as one sequence."""
    report, out = build(tmp_path, {"blocks": [
        {"type": "caption", "text": "First", "kind": "figure"},
        {"type": "image", "path": str(picture), "width_mm": 40,
         "caption": "Second"}]})
    body = part(out, "word/document.xml")
    assert "Figure 1. First" in body
    assert "Figure 2. Second" in body
    assert report["captions"]["figure"] == 2
    assert report["images"] == 1


def test_an_arabic_caption_is_marked_right_to_left(tmp_path, picture):
    from docx import Document

    _, out = build(tmp_path, {"blocks": [
        {"type": "image", "path": str(picture), "width_mm": 40,
         "caption": "مخطط الموقع عند الفجر"}]})
    doc = Document(str(out))
    captions = [p for p in doc.paragraphs if "شكل" in p.text]
    assert captions, "the Arabic caption is missing its Arabic label"
    p_pr = captions[0]._p.find(f"{W}pPr")
    assert p_pr is not None and p_pr.find(f"{W}bidi") is not None


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------


def test_shape_carries_its_text_and_the_house_fill(tmp_path, house):
    theme = house.load_theme()
    _, out = build(tmp_path, {"blocks": [
        {"type": "shape", "text": "Key point", "shape": "rounded",
         "width_mm": 120, "height_mm": 24}]})
    body = part(out, "word/document.xml")
    assert "wordprocessingShape" in body
    assert '<a:prstGeom prst="roundRect">' in body
    assert f'<a:srgbClr val="{theme.palette.surface}"/>' in body
    assert "<w:txbxContent>" in body
    assert "Key point" in body
    # No accent stripe and no shadow: a callout is a box with words in it.
    assert "<a:effectLst>" not in body and "outerShdw" not in body


def test_arabic_shape_text_is_right_to_left(tmp_path):
    """The document-wide pass cannot see inside a drawing, so this is baked in."""
    _, out = build(tmp_path, {"blocks": [
        {"type": "shape", "text": "النقطة الأساسية", "width_mm": 100}]})
    box = part(out, "word/document.xml").split("<w:txbxContent>")[1]
    box = box.split("</w:txbxContent>")[0]
    assert "<w:bidi/>" in box
    assert '<w:jc w:val="right"/>' in box
    assert "<w:rtl/>" in box


def test_an_anchored_shape_floats_with_square_wrap(tmp_path):
    _, out = build(tmp_path, {"blocks": [
        {"type": "shape", "text": "Aside", "anchored": True,
         "width_mm": 50, "height_mm": 30, "offset_x_mm": 100}]})
    body = part(out, "word/document.xml")
    assert "<wp:anchor " in body and "<wp:wrapSquare " in body


# ---------------------------------------------------------------------------
# The other half: a spec with no graphics
# ---------------------------------------------------------------------------


def test_a_spec_without_graphics_is_unchanged(tmp_path):
    """No chart parts, no drawings, and the same report keys as before."""
    report, out = build(tmp_path, {"blocks": [
        {"type": "heading", "text": "Plain", "level": 1},
        {"type": "paragraph", "text": "Nothing but text."},
        {"type": "table", "header": ["Item", "Count"], "rows": [["a", "3"]]}]})
    present = names(out)
    assert not [n for n in present if n.startswith("word/charts/")]
    assert not [n for n in present if n.startswith("word/embeddings/")]
    body = part(out, "word/document.xml")
    assert "<w:drawing>" not in body and "<w:drawing " not in body
    for key in ("charts", "images", "shapes"):
        assert key not in report
    assert report["ok"] and report["blocks"] == 3


def test_the_package_still_validates_with_every_graphic_in_it(tmp_path, picture):
    """The health check is the floor: a repair prompt is a failed build."""
    _, out = build(tmp_path, {"blocks": [
        chart_spec(),
        {"type": "image", "path": str(picture), "width_mm": 50,
         "caption": "Swatch", "alt": "A flat colour swatch"},
        {"type": "shape", "text": "Key point", "width_mm": 110}]},
        name="everything")
    validate = subprocess.run(
        [sys.executable, str(SCRIPTS / "docx_validate.py"), str(out)],
        capture_output=True, text=True)
    assert validate.returncode == 0, validate.stdout
    assert json.loads(validate.stdout)["ok"]
