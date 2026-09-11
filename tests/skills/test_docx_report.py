"""Contracts for the report front matter the docx skill composes.

A generated report is judged on the parts nobody writes by hand: a cover,
a table of contents, page numbers, a running head, numbered captions and
columns of figures that line up. Every one of them is opt in, so the
tests that matter are the ones that pin both halves: the document is
finished when the "report" key is there, and unchanged when it is not.
"""

from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

docx = pytest.importorskip("docx")
from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "skills" / "productivity" / "docx" / "scripts" / "docx_create.py"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def build(tmp_path, spec: dict, *args, name: str = "out") -> tuple:
    """Run the create script on a spec and return (Document, report dict)."""
    spec_path = tmp_path / f"{name}.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    out = tmp_path / f"{name}.docx"
    run = subprocess.run(
        [sys.executable, str(SCRIPT), str(spec_path), str(out), *args],
        capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return Document(str(out)), json.loads(run.stdout), out


def part(path: Path, name: str) -> str:
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode("utf-8")


def body_xml(path: Path) -> str:
    return part(path, "word/document.xml")


REPORT = {
    "title": "Quarterly Operations Review",
    "subtitle": "Logistics network, Q3 2026",
    "author": "Planning and Analysis",
    "date": "11 September 2026",
    "cover": True, "toc": True, "page_numbers": True,
    "running_head": "Operations, Q3", "toc_depth": 2,
}

BLOCKS = [
    {"type": "heading", "text": "Summary", "level": 1},
    {"type": "paragraph", "text": "Throughput rose on every corridor."},
]


# ---------------------------------------------------------------------------
# The cover
# ---------------------------------------------------------------------------


def test_cover_carries_the_four_lines_and_ends_in_a_page_break(tmp_path):
    doc, out, path = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    texts = [p.text for p in doc.paragraphs]
    assert texts[:4] == [REPORT["title"], REPORT["subtitle"],
                         REPORT["author"], REPORT["date"]]
    # A cover is four to six lines: the four above plus the break that
    # closes the page, before anything the contents page adds.
    breaker = doc.paragraphs[4]
    assert breaker._p.findall(f".//{W}br"), "no page break after the cover"
    assert breaker._p.find(f".//{W}br").get(f"{W}type") == "page"
    assert out["cover"] is True


def test_cover_is_placed_with_space_and_not_with_empty_paragraphs(tmp_path):
    doc, _, _ = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    title = doc.paragraphs[0]
    assert title.paragraph_format.space_before is not None
    assert title.paragraph_format.space_before.pt >= 48
    assert all(p.text.strip() for p in doc.paragraphs[:4])


def test_cover_sizes_the_title_above_the_author_from_the_type_scale(tmp_path):
    doc, _, _ = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    title_size = doc.paragraphs[0].runs[0].font.size
    author_size = doc.paragraphs[2].runs[0].font.size
    if title_size is None or author_size is None:
        pytest.skip("house style is not installed, the styles carry the size")
    assert title_size > author_size


def test_cover_alone_needs_no_contents(tmp_path):
    spec = {"report": {"title": "Note", "cover": True}, "blocks": BLOCKS}
    doc, out, path = build(tmp_path, spec)
    assert out.get("toc") is None
    assert "TOC" not in body_xml(path)


# ---------------------------------------------------------------------------
# Contents
# ---------------------------------------------------------------------------


def test_contents_page_holds_a_toc_field_at_the_requested_depth(tmp_path):
    doc, out, path = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    xml = body_xml(path)
    assert r'TOC \o "1-2"' in xml, "no TOC field at the spec's depth"
    assert "Contents" in [p.text for p in doc.paragraphs]
    assert out["toc"] is True


def test_contents_page_ends_in_a_page_break(tmp_path):
    doc, _, _ = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    heading = [i for i, p in enumerate(doc.paragraphs) if p.text == "Contents"][0]
    after = doc.paragraphs[heading + 2]
    assert after._p.find(f".//{W}br") is not None
    assert doc.paragraphs[heading + 3].text == "Summary"


def test_the_document_asks_the_reader_to_update_its_fields(tmp_path):
    """Word and LibreOffice compute a TOC on open, but only if asked."""
    _, out, path = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    assert out["update_fields"] is True
    settings = part(path, "word/settings.xml")
    from lxml import etree
    root = etree.fromstring(settings.encode("utf-8"))
    tags = [child.tag for child in root]
    assert f"{W}updateFields" in tags
    assert root.find(f"{W}updateFields").get(f"{W}val") == "true"
    # Schema order: updateFields sits before compat, and a settings part
    # out of order is a part Word repairs on open.
    if f"{W}compat" in tags:
        assert tags.index(f"{W}updateFields") < tags.index(f"{W}compat")


def test_the_file_still_converts_with_the_update_flag_set(tmp_path):
    """The flag is only worth setting if a real renderer accepts the file."""
    soffice = None
    for candidate in ("/usr/bin/soffice", "/usr/bin/libreoffice"):
        if Path(candidate).exists():
            soffice = candidate
            break
    if soffice is None:
        pytest.skip("no LibreOffice on this host")
    _, _, path = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    run = subprocess.run(
        [soffice, "--headless", "-env:UserInstallation=file://" +
         str(tmp_path / "lo"), "--convert-to", "pdf", "--outdir",
         str(tmp_path), str(path)], capture_output=True, text=True, timeout=180)
    assert run.returncode == 0, run.stderr
    assert (tmp_path / f"{path.stem}.pdf").exists()


# ---------------------------------------------------------------------------
# Running head and page numbers
# ---------------------------------------------------------------------------


def test_the_header_carries_the_running_head_from_page_two(tmp_path):
    doc, out, _ = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    section = doc.sections[0]
    assert section.different_first_page_header_footer is True
    assert section.header.paragraphs[0].text == "Operations, Q3"
    assert section.first_page_header.paragraphs[0].text == ""
    assert out["running_head"] == "Operations, Q3"


def test_the_running_head_falls_back_to_the_title(tmp_path):
    report = dict(REPORT)
    report.pop("running_head")
    doc, _, _ = build(tmp_path, {"report": report, "blocks": BLOCKS})
    assert doc.sections[0].header.paragraphs[0].text == REPORT["title"]


def test_page_numbers_land_in_the_footer_and_not_on_the_cover(tmp_path):
    doc, out, path = build(tmp_path, {"report": REPORT, "blocks": BLOCKS})
    section = doc.sections[0]
    footer = section.footer.paragraphs[0]
    assert "Page" in footer.text
    assert footer.alignment == WD_ALIGN_PARAGRAPH.CENTER
    xml = "".join(part(path, n) for n in zipfile.ZipFile(path).namelist()
                  if n.startswith("word/footer"))
    assert " PAGE " in xml and " NUMPAGES " in xml
    assert section.first_page_footer.paragraphs[0].text == ""
    assert out["page_numbers"] is True


def test_an_arabic_report_says_page_in_arabic_and_mirrors_its_head(tmp_path):
    report = {"title": "مراجعة العمليات الفصلية",
              "subtitle": "شبكة الإمداد، الربع الثالث",
              "cover": True, "toc": True, "page_numbers": True}
    doc, _, path = build(tmp_path, {"report": report, "blocks": [
        {"type": "paragraph", "text": "ارتفع حجم الشحن هذا الربع."}]})
    section = doc.sections[0]
    assert "صفحة" in section.footer.paragraphs[0].text
    assert section.header.paragraphs[0].text == report["title"]
    # The direction pass runs last and must still see the header it did
    # not build, or the running head reads left to right on every page.
    headers = [n for n in zipfile.ZipFile(path).namelist()
               if n.startswith("word/header")]
    assert any("bidi" in part(path, n) and report["title"] in part(path, n)
               for n in headers), "the running head was not mirrored"
    assert "المحتويات" in [p.text for p in doc.paragraphs]


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------


def test_captions_number_sequentially_per_kind(tmp_path):
    blocks = [
        {"type": "caption", "text": "First table", "kind": "table"},
        {"type": "caption", "text": "First figure", "kind": "figure"},
        {"type": "caption", "text": "Second figure", "kind": "figure"},
        {"type": "caption", "text": "Second table", "kind": "table"},
        {"type": "caption", "text": "Third figure", "kind": "figure"},
    ]
    doc, out, _ = build(tmp_path, {"blocks": blocks})
    assert [p.text for p in doc.paragraphs] == [
        "Table 1. First table", "Figure 1. First figure",
        "Figure 2. Second figure", "Table 2. Second table",
        "Figure 3. Third figure"]
    assert out["captions"] == {"figure": 3, "table": 2}


def test_an_arabic_caption_is_labelled_in_arabic(tmp_path):
    blocks = [
        {"type": "caption", "text": "الشحنات حسب الممر", "kind": "table"},
        {"type": "caption", "text": "التكلفة لكل وحدة", "kind": "figure"},
        {"type": "caption", "text": "Cost per unit", "kind": "figure"},
    ]
    doc, _, _ = build(tmp_path, {"blocks": blocks})
    texts = [p.text for p in doc.paragraphs]
    assert texts[0] == "جدول 1. الشحنات حسب الممر"
    assert texts[1] == "شكل 1. التكلفة لكل وحدة"
    # One Latin caption in an Arabic document keeps the Latin word, and
    # keeps counting with its own kind.
    assert texts[2] == "Figure 2. Cost per unit"


def test_a_caption_takes_the_caption_style(tmp_path):
    doc, _, _ = build(tmp_path, {"blocks": [
        {"type": "caption", "text": "Shipments", "kind": "table"}]})
    assert doc.paragraphs[0].style.name == "Caption"


def test_an_unknown_caption_kind_is_refused(tmp_path):
    spec_path = tmp_path / "bad.json"
    spec_path.write_text(json.dumps({"blocks": [
        {"type": "caption", "text": "x", "kind": "diagram"}]}),
        encoding="utf-8")
    run = subprocess.run(
        [sys.executable, str(SCRIPT), str(spec_path), str(tmp_path / "bad.docx")],
        capture_output=True, text=True)
    assert run.returncode != 0
    assert "diagram" in run.stderr


# ---------------------------------------------------------------------------
# Numeric table columns
# ---------------------------------------------------------------------------


NUMERIC_TABLE = {
    "type": "table",
    "header": ["Corridor", "Shipments", "Cost", "Change", "Owner"],
    "rows": [["North", "12,480", "$4.10", "-6%", "Ops"],
             ["East", "9,310", "$3.95", "-2%", "Ops"],
             ["South", "14,002", "$4.62", "+1%", "Field"]],
}


def test_a_numeric_column_is_aligned_and_a_text_column_is_not(tmp_path):
    doc, _, _ = build(tmp_path, {"blocks": [NUMERIC_TABLE]})
    table = doc.tables[0]
    right = WD_ALIGN_PARAGRAPH.RIGHT
    for col in (1, 2, 3):
        for row in range(len(table.rows)):
            para = table.cell(row, col).paragraphs[0]
            assert para.alignment == right, f"cell {row},{col} is not aligned"
    for col in (0, 4):
        for row in range(len(table.rows)):
            assert table.cell(row, col).paragraphs[0].alignment != right


def test_the_header_of_a_numeric_column_follows_its_figures(tmp_path):
    doc, _, _ = build(tmp_path, {"blocks": [NUMERIC_TABLE]})
    table = doc.tables[0]
    assert table.cell(0, 1).text == "Shipments"
    assert table.cell(0, 1).paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.RIGHT
    # A header of words never makes a column numeric on its own.
    doc2, _, _ = build(tmp_path, {"blocks": [{
        "type": "table", "header": ["2026", "Notes"],
        "rows": [["open", "a"], ["closed", "b"]]}]}, name="words")
    assert doc2.tables[0].cell(0, 0).paragraphs[0].alignment != \
        WD_ALIGN_PARAGRAPH.RIGHT


def test_a_gap_in_a_column_of_figures_does_not_cost_it_the_alignment(tmp_path):
    doc, _, _ = build(tmp_path, {"blocks": [{
        "type": "table", "header": ["Site", "Units"],
        "rows": [["A", "12"], ["B", ""], ["C", "-"], ["D", "9"]]}]})
    table = doc.tables[0]
    assert table.cell(0, 1).paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.RIGHT
    assert table.cell(0, 0).paragraphs[0].alignment != WD_ALIGN_PARAGRAPH.RIGHT


def test_arabic_indic_digits_count_as_figures(tmp_path):
    doc, _, _ = build(tmp_path, {"blocks": [{
        "type": "table", "header": ["الممر", "الشحنات"],
        "rows": [["الشمال", "١٢٤٨٠"], ["الشرق", "٩٣١٠"]]}]})
    table = doc.tables[0]
    # An Arabic table runs the other way, so the outer edge of a column is
    # the start edge. The render is the authority here: with RIGHT the
    # figures came out flush against the next column and the units digits
    # did not line up.
    assert table.cell(1, 1).paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.LEFT
    assert table.cell(1, 0).paragraphs[0].alignment is None


def test_an_arabic_table_gets_the_mirror_of_the_latin_alignment(tmp_path):
    latin, _, _ = build(tmp_path, {"blocks": [NUMERIC_TABLE]}, name="latin")
    arabic, _, _ = build(tmp_path, {"blocks": [{
        "type": "table", "header": ["الممر", "الشحنات"],
        "rows": [["الشمال", "12,480"], ["الشرق", "9,310"]]}]}, name="arabic")
    assert latin.tables[0].cell(1, 1).paragraphs[0].alignment == \
        WD_ALIGN_PARAGRAPH.RIGHT
    assert arabic.tables[0].cell(1, 1).paragraphs[0].alignment == \
        WD_ALIGN_PARAGRAPH.LEFT


# ---------------------------------------------------------------------------
# Opt in: a spec that asks for none of this gets none of it
# ---------------------------------------------------------------------------


def test_a_spec_without_a_report_gets_no_cover_no_contents_no_head(tmp_path):
    spec = {"blocks": [
        {"type": "heading", "text": "Summary", "level": 1},
        {"type": "paragraph", "text": "One paragraph."},
        {"type": "table", "header": ["Name", "Note"],
         "rows": [["A", "ok"], ["B", "ok"]]}]}
    doc, out, path = build(tmp_path, spec)
    section = doc.sections[0]
    assert [p.text for p in doc.paragraphs] == ["Summary", "One paragraph."]
    assert "TOC" not in body_xml(path)
    assert "updateFields" not in part(path, "word/settings.xml")
    assert section.different_first_page_header_footer in (False, None)
    assert section.header.paragraphs[0].text == ""
    assert section.footer.paragraphs[0].text == ""
    for key in ("cover", "toc", "captions", "running_head", "page_numbers"):
        assert key not in out
    assert doc.tables[0].cell(0, 0).paragraphs[0].alignment is None


def test_the_untouched_path_still_builds_the_same_bytes(tmp_path):
    """The file a spec built before the report key must not have moved.

    The comparison runs with --no-theme: the house pass reads the fonts
    installed on the host, so a themed run is only comparable against
    itself on the same machine at the same moment.
    """
    # The baseline is the last commit before the report key landed, not
    # HEAD. Against HEAD this test skipped itself the moment the feature
    # merged, and a test that can never run again guards nothing.
    baseline = "cca1068126"
    old_dir = tmp_path / "old"
    old_dir.mkdir()
    scripts = SCRIPT.parent
    for name in ("docx_create.py", "docx_common.py", "house_common.py",
                 "docx_edit.py"):
        blob = subprocess.run(
            ["git", "show",
             f"{baseline}:skills/productivity/docx/scripts/{name}"],
            cwd=str(REPO), capture_output=True, text=True)
        if blob.returncode != 0:
            pytest.skip(f"{name} is not in {baseline}; shallow clone?")
        (old_dir / name).write_text(blob.stdout, encoding="utf-8")
    assert "\"report\"" not in (old_dir / "docx_create.py").read_text(
        encoding="utf-8"), "the baseline commit already has the report key"
    spec = {"header": "H", "footer": "F", "footer_page_numbers": True,
            "blocks": [
                {"type": "heading", "text": "Title", "level": 1},
                {"type": "paragraph", "text": "Body."},
                {"type": "table", "header": ["A", "B"],
                 "rows": [["p", "x"], ["q", "y"]]},
                {"type": "toc"}, {"type": "page_break"},
                {"type": "paragraph", "text": "نص عربي."}]}
    spec_path = tmp_path / "same.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    outs = {}
    for label, script in (("old", old_dir / "docx_create.py"), ("new", SCRIPT)):
        target = tmp_path / f"{label}.docx"
        run = subprocess.run(
            [sys.executable, str(script), str(spec_path), str(target),
             "--no-theme"], capture_output=True, text=True)
        assert run.returncode == 0, run.stderr
        with zipfile.ZipFile(target) as z:
            outs[label] = {n: z.read(n) for n in sorted(z.namelist())}
    assert outs["old"].keys() == outs["new"].keys()
    for name in outs["old"]:
        assert outs["old"][name] == outs["new"][name], f"{name} changed"
    assert scripts.exists()
