#!/usr/bin/env python3
# MIT License. Part of the Hermes docx skill.
"""Create a .docx document from a JSON spec.

Usage: docx_create.py spec.json output.docx
Run with --help for the spec format summary.

Spec (JSON object):
{
  "page": {"width_mm": 210, "height_mm": 297,
           "margins_mm": {"top": 25, "bottom": 25, "left": 20, "right": 20}},
  "header": "text shown in page header",
  "footer": "text shown in page footer",
  "styles": [{"name": "MyStyle", "base": "Normal", "font": "Arial",
              "size_pt": 12, "bold": true, "color": "1F4E79"}],
  "blocks": [
    {"type": "heading", "text": "Title", "level": 1},
    {"type": "paragraph", "style": "MyStyle", "runs": [
        {"text": "plain "}, {"text": "bold", "bold": true},
        {"text": " italic", "italic": true},
        {"text": " under", "underline": true}]},
    {"type": "paragraph", "text": "shortcut: single plain run"},
    {"type": "bullet_list", "items": ["a", "b"]},
    {"type": "numbered_list", "items": ["one", "two"]},
    {"type": "table", "header": ["Col1", "Col2"],
     "rows": [["1", "2"]], "style": "Light Grid Accent 1",
     "header_bold": true},
    {"type": "image", "path": "pic.png", "width_mm": 60,
     "caption": "The site at dawn", "alt": "A low building at dawn"},
    {"type": "chart", "chart": "column", "title": "Revenue by quarter",
     "categories": ["Q1", "Q2"], "series": {"2025": [12, 18]},
     "height_mm": 70},
    {"type": "shape", "text": "Key point", "shape": "rounded",
     "width_mm": 120, "height_mm": 24},
    {"type": "caption", "text": "Revenue by quarter", "kind": "figure"},
    {"type": "page_break"},
    {"type": "toc"}
  ]
}

Graphics: three blocks carry the pictures. All three read their colors,
fonts and sizes from the house theme, so a spec names data and not a
look.

  chart   a real DrawingML chart part plus the workbook behind it, so a
          reader can click it in Word and edit the numbers. `chart`
          (or `chart_type`) is bar, column, line or pie; `categories` is
          the axis; `series` is {"name": [values]} or a list of
          {"name", "values"}. One series takes the accent hue and no
          legend, several take theme.palette.series in order with a
          legend below. Bar and column carry their numbers on the marks
          and drop the value axis; nothing carries gridlines.
  image   `path` plus `width_mm` (the aspect follows), an optional `alt`
          written to wp:docPr/@descr where a screen reader finds it, and
          an optional `caption` which is numbered with the caption
          blocks, in one sequence.
  shape   a text box or callout: `text`, `shape` ("rect" or "rounded"),
          `width_mm`, `height_mm`, and `anchored` for a floating box
          with square wrap. House fill and ink, a hairline rule, no
          accent stripe and no shadow. Arabic text inside a shape is
          marked right-to-left as it is built, because the document-wide
          direction pass cannot reach inside a drawing.

Report front matter: a top-level `"report"` key turns the flat block list
into a finished document. Every part of it is opt in, and a spec without
the key builds exactly the file it built before.

{"report": {"title": "...", "subtitle": "...", "author": "...",
            "date": "...", "cover": true, "toc": true,
            "page_numbers": true, "running_head": "...", "toc_depth": 3}}

  cover         title, subtitle, author and date on the first page,
                sized from the house type scale, then a page break
  toc           a heading plus the TOC field on its own page, then a
                page break; the document is also marked to update its
                fields when Word or LibreOffice opens it
  page_numbers  "Page X of Y" in the footer
  running_head  header text from page 2 onward (defaults to the title);
                the cover carries neither header nor footer, because the
                section is set to a different first page

Captions: `{"type": "caption", "text": "...", "kind": "figure"}` renders
"Figure 3. text", numbered sequentially per kind. Put a table caption
above its table and a figure caption below its figure, which is the
convention print follows. A caption whose text is mostly Arabic is
labelled "شكل" or "جدول".

Numeric columns: in a `table` block, a column whose data cells are all
numbers, percentages or amounts is flushed against the outer edge of the
column, header included, so the units digits line up. That single rule is
what makes a table look typeset. An Arabic table gets the mirror of it.

Direction: `"rtl": "auto" | "on" | "off"` at the top level (default
"auto") marks every paragraph that contains Arabic, Persian, Urdu or Hebrew
letters as right-to-left, and lays out mostly-RTL tables from the right.
Without it Word and LibreOffice render Arabic as a left-to-right paragraph,
so the full stop lands at the START of the line and brackets face the wrong
way. A block may override with its own `"rtl": true|false`.

House style: the document is type-set to the house design system unless
the spec says `"theme": false` or the command line says `--no-theme`. A
preset name (`"theme": "slate"`) or an object
(`"theme": {"name": "editorial", "accent": "B4482E"}`) picks a different
one. The pass sets the named styles, the page margins (unless the spec
sets `page`), and table rules; anything the spec states explicitly keeps
winning.

Extras: `"footer_page_numbers": true` at the top level adds a
"Page X of Y" footer built from PAGE/NUMPAGES fields, and a `toc` block
inserts a Table of Contents field. Field results are computed by
Word/LibreOffice when the file is opened, not by python-docx.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Mm, Pt, RGBColor

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from docx_common import (  # noqa: E402
    _mostly_rtl, apply_rtl, set_paragraph_rtl, set_table_rtl,
)
from house_common import load_house_style  # noqa: E402


def apply_page(doc, page: dict) -> None:
    section = doc.sections[0]
    if "width_mm" in page:
        section.page_width = Mm(page["width_mm"])
    if "height_mm" in page:
        section.page_height = Mm(page["height_mm"])
    m = page.get("margins_mm", {})
    for side in ("top", "bottom", "left", "right"):
        if side in m:
            setattr(section, f"{side}_margin", Mm(m[side]))


def add_styles(doc, styles: list) -> None:
    for s in styles:
        style = doc.styles.add_style(s["name"], WD_STYLE_TYPE.PARAGRAPH)
        if s.get("base"):
            style.base_style = doc.styles[s["base"]]
        font = style.font
        if s.get("font"):
            font.name = s["font"]
        if s.get("size_pt"):
            font.size = Pt(s["size_pt"])
        if s.get("bold") is not None:
            font.bold = s["bold"]
        if s.get("italic") is not None:
            font.italic = s["italic"]
        if s.get("color"):
            font.color.rgb = RGBColor.from_string(s["color"])


def add_runs(para, block: dict) -> None:
    runs = block.get("runs")
    if runs is None:
        runs = [{"text": block.get("text", "")}]
    for r in runs:
        run = para.add_run(r.get("text", ""))
        if r.get("bold"):
            run.bold = True
        if r.get("italic"):
            run.italic = True
        if r.get("underline"):
            run.underline = True


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------

# "Figure 3." in the document's own script. A caption is numbered per kind,
# so figures and tables each count from one.
CAPTION_WORDS = {"figure": ("Figure", "شكل"), "table": ("Table", "جدول")}


def caption_label(kind: str, number: int, text: str) -> str:
    """The full caption line, labelled in the script the caption is written in."""
    latin, arabic = CAPTION_WORDS.get(kind, CAPTION_WORDS["figure"])
    word = arabic if _mostly_rtl(text) else latin
    return f"{word} {number}. {text}" if text else f"{word} {number}"


def new_caption_counts() -> dict:
    return {kind: 0 for kind in CAPTION_WORDS}


# ---------------------------------------------------------------------------
# Numeric table columns
# ---------------------------------------------------------------------------

# Western and Arabic-Indic digits, with the Arabic decimal and thousands
# separators. A column of figures typed in Arabic numerals must read as
# numeric too, or the Arabic report is the one that loses the alignment.
_DIGITS = "0-9\u0660-\u0669\u06f0-\u06f9"
_SEPARATORS = ",.\u066b\u066c\u00a0\u202f '"
_CURRENCY = "$\u20ac\u00a3\u00a5\u20b9"
_NUMERIC_CELL = re.compile(
    r"^[(\[]?"                                # a parenthesised negative
    r"[+\-\u2212]?\s*"
    r"[" + _CURRENCY + r"]?\s*"               # a leading currency symbol
    r"[" + _DIGITS + r"]"
    r"[" + _DIGITS + _SEPARATORS + r"]*"
    r"\s*[%\u066a]?"                          # percent, Western or Arabic
    r"\s*(?:[" + _CURRENCY + r"]|[A-Z]{3})?"  # a trailing symbol or code
    r"[)\]]?$"
)
# Cells that carry no figure and no contradiction: they neither qualify a
# column nor disqualify it.
_ABSTAINING_CELLS = {"", "-", "--", "\u2013", "\u2014", "n/a", "N/A", "na",
                     "\u0644\u0627 \u064a\u0648\u062c\u062f"}


def is_numeric_cell(text: str) -> bool:
    """True when a cell holds a number, a percentage or an amount."""
    return bool(_NUMERIC_CELL.match(str(text).strip()))


def numeric_columns(header: list, rows: list) -> list:
    """Indices of the columns whose data cells are all numeric.

    Only the data cells vote. A header is a word by nature, and an empty
    cell or a placeholder dash abstains, so one gap does not cost a column
    its alignment. A column needs at least one real figure to qualify.
    """
    width = len(header) if header else (len(rows[0]) if rows else 0)
    numeric = []
    for col in range(width):
        seen = False
        for row in rows:
            if col >= len(row):
                continue
            cell = str(row[col]).strip()
            if cell in _ABSTAINING_CELLS:
                continue
            if not is_numeric_cell(cell):
                seen = False
                break
            seen = True
        if seen:
            numeric.append(col)
    return numeric


def align_cell(cell, alignment) -> None:
    for para in cell.paragraphs:
        para.alignment = alignment


def add_block(doc, block: dict, counts: dict | None = None, theme=None) -> None:
    btype = block["type"]
    # A block's own `rtl` wins over the document mode. Applied to what the
    # block just added, AFTER the document-wide pass would otherwise run, so
    # the two never fight: main() runs apply_rtl first, then the overrides.
    made = []
    if btype == "heading":
        made.append(doc.add_heading(block.get("text", ""), level=block.get("level", 1)))
    elif btype == "paragraph":
        para = doc.add_paragraph(style=block.get("style"))
        add_runs(para, block)
        made.append(para)
    elif btype == "bullet_list":
        for item in block.get("items", []):
            made.append(doc.add_paragraph(item, style="List Bullet"))
    elif btype == "numbered_list":
        for item in block.get("items", []):
            made.append(doc.add_paragraph(item, style="List Number"))
    elif btype == "table":
        header = block.get("header", [])
        rows = block.get("rows", [])
        ncols = len(header) if header else (len(rows[0]) if rows else 1)
        table = doc.add_table(rows=0, cols=ncols)
        table.style = block.get("style", "Table Grid")
        if header:
            cells = table.add_row().cells
            for i, text in enumerate(header):
                cells[i].text = str(text)
                if block.get("header_bold", True):
                    for para in cells[i].paragraphs:
                        for run in para.runs:
                            run.bold = True
        for row in rows:
            cells = table.add_row().cells
            for i, text in enumerate(row):
                cells[i].text = str(text)
        # The alignment is applied after the direction pass has decided
        # which way the table runs, so it is recorded here and replayed.
        figures = numeric_columns(header, rows)
        if figures:
            _NUMERIC_COLUMNS.append((table, figures))
        made.append(table)
    elif btype == "image":
        from docx_graphics import add_picture
        label = None
        if block.get("caption"):
            # Figures are numbered in one sequence whether the caption
            # rides on the image block or stands as its own block.
            if counts is None:
                counts = new_caption_counts()
            counts["figure"] = counts.get("figure", 0) + 1
            label = caption_label("figure", counts["figure"],
                                  str(block["caption"]))
        made.extend(add_picture(doc, block, theme, caption_text=label))
    elif btype == "chart":
        from docx_graphics import add_chart
        spec = dict(block)
        # The block says "chart", the chart spec says "type", so the kind
        # is carried under its own key rather than fighting the block type.
        spec["type"] = block.get("chart") or block.get("chart_type") or "column"
        made.append(add_chart(doc, spec, theme))
    elif btype == "shape":
        from docx_graphics import add_shape
        made.append(add_shape(doc, block, theme))
    elif btype == "caption":
        kind = block.get("kind", "figure")
        if kind not in CAPTION_WORDS:
            raise ValueError(f"unknown caption kind: {kind}")
        if counts is None:
            counts = new_caption_counts()
        counts[kind] = counts.get(kind, 0) + 1
        text = caption_label(kind, counts[kind], block.get("text", ""))
        para = doc.add_paragraph(text, style=block.get("style", "Caption"))
        made.append(para)
    elif btype == "page_break":
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    elif btype == "toc":
        from docx_edit import _add_field
        para = doc.add_paragraph()
        _add_field(para, r' TOC \o "1-3" \h \z \u ',
                   "Table of contents - open in Word/LibreOffice and "
                   "update fields to populate.")
    else:
        raise ValueError(f"unknown block type: {btype}")
    if "rtl" in block:
        _RTL_OVERRIDES.append((made, bool(block["rtl"])))


# (objects a block produced, forced direction), replayed after apply_rtl.
_RTL_OVERRIDES: list = []

# (table, numeric column indices), aligned after the direction is settled.
_NUMERIC_COLUMNS: list = []


def _align_numeric_columns() -> int:
    """Flush every column of figures against the far edge of its column.

    A column of numbers is read down the units digit, so the digits have
    to line up on the outer edge of the cell. Which edge that is depends
    on the table: an Arabic table runs the other way, and the renders
    show that the same paragraph alignment lands on opposite sides in the
    two. So the physical side is chosen here, once the direction pass has
    marked the table.
    """
    from docx.oxml.ns import qn

    aligned = 0
    for table, columns in _NUMERIC_COLUMNS:
        rtl = table._tbl.tblPr.find(qn("w:bidiVisual")) is not None
        # "left" is the start edge, and in a right-to-left table the start
        # edge is the physical right. The two are mirror images.
        side = WD_ALIGN_PARAGRAPH.LEFT if rtl else WD_ALIGN_PARAGRAPH.RIGHT
        for row in table.rows:
            for col in columns:
                if col < len(row.cells):
                    align_cell(row.cells[col], side)
                    aligned += 1
    return aligned


def _replay_rtl_overrides() -> None:
    for made, rtl in _RTL_OVERRIDES:
        for obj in made:
            if hasattr(obj, "rows"):
                set_table_rtl(obj, rtl)
                for row in obj.rows:
                    for cell in row.cells:
                        for para in cell.paragraphs:
                            set_paragraph_rtl(para, rtl)
            else:
                set_paragraph_rtl(obj, rtl)


# ---------------------------------------------------------------------------
# Report front matter: cover, contents, running head, page numbers
# ---------------------------------------------------------------------------

# Steps of the house spacing scale, in points. The cover is placed with
# real space, not with a stack of empty paragraphs: an empty paragraph
# changes height the moment the theme changes the body size.
COVER_TOP_PT = 96
COVER_GAP_PT = 48

CONTENTS_TITLE = {"latin": "Contents", "arabic": "المحتويات"}
CONTENTS_PLACEHOLDER = {
    "latin": "Contents are filled in when the document is opened.",
    "arabic": "تُملأ المحتويات عند فتح المستند.",
}
PAGE_OF = {"latin": ("Page ", " of "), "arabic": ("صفحة ", " من ")}


def _script_of(report: dict) -> str:
    """Which script the report's own words are written in."""
    sample = " ".join(str(report.get(key, "")) for key in
                      ("title", "subtitle", "running_head"))
    return "arabic" if _mostly_rtl(sample) else "latin"


def _style_or_none(doc, name: str):
    try:
        return doc.styles[name]
    except KeyError:
        return None


def _set_complex_script(run, *, size_pt=None, upright: bool = True) -> None:
    """Carry a size and an upright face into the complex-script slot.

    Arabic is shaped from ``w:szCs`` and ``w:iCs``, not from ``w:sz`` and
    ``w:i``. A stock template leaves ``w:iCs`` on in the Subtitle and
    heading styles, which is how an Arabic cover ends up in a slanted
    face no Arabic typesetter would set, and how a heading comes out at
    the wrong size on a page where the Latin one is right.
    """
    from docx.oxml.ns import qn

    r_pr = run._r.get_or_add_rPr()
    if upright:
        r_pr.get_or_add_iCs().set(qn("w:val"), "0")
    if size_pt:
        for old in r_pr.findall(qn("w:szCs")):
            r_pr.remove(old)
        node = r_pr.makeelement(qn("w:szCs"),
                                {qn("w:val"): str(int(round(size_pt * 2)))})
        try:
            r_pr.insert_element_before(
                node, "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd",
                "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang",
                "w:eastAsianLayout", "w:specVanish", "w:oMath")
        except Exception:
            r_pr.append(node)


def _size_run(run, theme, key, *, muted: bool = False) -> None:
    """Size a run from the house type scale, or leave it to the styles."""
    if theme is None:
        _set_complex_script(run)
        return
    size = theme.doc.get(key)
    if size:
        run.font.size = Pt(size)
    _set_complex_script(run, size_pt=size)
    if muted:
        run.font.color.rgb = RGBColor.from_string(theme.palette.muted)


def _break_page(doc) -> None:
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_cover(doc, report: dict, theme) -> list:
    """Title, subtitle, author and date, then a page break.

    Four to six lines and nothing else. The distance from the top edge is
    paragraph space, so the block keeps its position whatever the theme
    does to the body size.
    """
    made = []

    def line(text, style_name, size_key, *, muted=False, space_before=0):
        if not text:
            return None
        style = _style_or_none(doc, style_name) if style_name else None
        para = doc.add_paragraph(style=style)
        _size_run(para.add_run(str(text)), theme, size_key, muted=muted)
        if space_before:
            para.paragraph_format.space_before = Pt(space_before)
        made.append(para)
        return para

    line(report.get("title"), "Title", "title", space_before=COVER_TOP_PT)
    line(report.get("subtitle"), "Subtitle", "lead")
    line(report.get("author"), None, "body", muted=True,
         space_before=COVER_GAP_PT)
    line(report.get("date"), None, "body", muted=True)
    if made:
        _break_page(doc)
    return made


def add_toc_page(doc, report: dict, theme) -> list:
    """A heading, the TOC field, and a page break.

    Word and LibreOffice compute the entries when the file is opened, so
    until then the field shows one short line of placeholder text.
    """
    from docx_edit import _add_field

    script = _script_of(report)
    depth = int(report.get("toc_depth") or 3)
    heading_text = report.get("toc_title") or CONTENTS_TITLE[script]
    style = _style_or_none(doc, "TOC Heading") or _style_or_none(doc, "Heading 1")
    heading = doc.add_paragraph(style=style)
    # "TOC Heading" is outside the house pass, so the size is set here.
    # Without it the contents heading is a stock template size, and on an
    # Arabic page a noticeably smaller one than the headings below it.
    _size_run(heading.add_run(heading_text), theme, "h1")
    para = doc.add_paragraph()
    _add_field(para, rf' TOC \o "1-{depth}" \h \z \u ',
               CONTENTS_PLACEHOLDER[script])
    _break_page(doc)
    return [heading, para]


def set_update_fields_on_open(doc) -> bool:
    """Mark the document so a reader's Word or LibreOffice fills the fields.

    ``w:updateFields`` belongs before ``w:compat`` in the settings part, so
    it is inserted ahead of the first element that follows it rather than
    appended. Returns False when the settings part cannot be reached.
    """
    from docx.oxml.ns import qn

    try:
        settings = doc.settings.element
    except Exception:
        return False
    for old in settings.findall(qn("w:updateFields")):
        settings.remove(old)
    node = settings.makeelement(qn("w:updateFields"), {qn("w:val"): "true"})
    successors = ("w:hdrShapeDefaults", "w:footnotePr", "w:endnotePr",
                  "w:compat", "w:docVars", "w:rsids", "m:mathPr",
                  "w:themeFontLang", "w:clrSchemeMapping", "w:shapeDefaults",
                  "w:decimalSymbol", "w:listSeparator")
    for tag in successors:
        found = settings.find(qn(tag))
        if found is not None:
            found.addprevious(node)
            return True
    settings.append(node)
    return True


def apply_report_frame(doc, report: dict, theme) -> dict:
    """Running head and page numbers from page 2 onward.

    The section is set to a different first page, which is what keeps the
    cover clean: the first page header and footer stay empty and Word
    stops drawing either on it.
    """
    section = doc.sections[0]
    frame = {"running_head": None, "page_numbers": False}
    script = _script_of(report)
    running = report.get("running_head", report.get("title"))
    wants_numbers = bool(report.get("page_numbers"))
    if not running and not wants_numbers:
        return frame
    section.different_first_page_header_footer = True
    if running:
        para = section.header.paragraphs[0]
        _size_run(para.add_run(str(running)), theme, "footer", muted=True)
        frame["running_head"] = str(running)
    if wants_numbers:
        from docx_edit import _add_field

        para = section.footer.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        before, between = PAGE_OF[script]
        para.add_run(before)
        _add_field(para, " PAGE ", "1")
        para.add_run(between)
        _add_field(para, " NUMPAGES ", "1")
        # The field's own runs are sized too, so the computed number does
        # not come back a body size larger than the words around it.
        for run in para.runs:
            _size_run(run, theme, "footer", muted=True)
        frame["page_numbers"] = True
    return frame


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create a .docx from a JSON spec.",
        epilog="See the module docstring (top of this file) for the spec format.")
    ap.add_argument("spec", help="path to JSON spec file")
    ap.add_argument("output", help="path of .docx to write")
    ap.add_argument("--rtl", choices=("auto", "on", "off"),
                    help="paragraph direction; overrides the spec's \"rtl\" (default auto)")
    ap.add_argument("--no-theme", action="store_true",
                    help="build on Word's stock template instead of the house "
                         "design system")
    args = ap.parse_args()

    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)

    _RTL_OVERRIDES.clear()
    _NUMERIC_COLUMNS.clear()
    doc = Document()
    if spec.get("page"):
        apply_page(doc, spec["page"])
    if spec.get("styles"):
        add_styles(doc, spec["styles"])
    if spec.get("header"):
        doc.sections[0].header.paragraphs[0].text = spec["header"]
    if spec.get("footer"):
        doc.sections[0].footer.paragraphs[0].text = spec["footer"]
    # The theme is resolved before the blocks because the cover reads its
    # sizes from the type scale. Applying it stays where it was, after the
    # blocks.
    house = None if args.no_theme else load_house_style()
    theme = house.theme_from_spec(spec) if house is not None else None
    report = spec.get("report") or {}
    extras: dict = {}
    if report:
        if report.get("cover", True):
            extras["cover"] = bool(add_cover(doc, report, theme))
        if report.get("toc"):
            add_toc_page(doc, report, theme)
            extras["toc"] = True
            extras["update_fields"] = set_update_fields_on_open(doc)
    counts = new_caption_counts()
    for block in spec.get("blocks", []):
        # The theme is handed to the blocks because a chart and a shape
        # carry their own colors inside a drawing, where the house pass
        # that runs after this loop can never reach them.
        add_block(doc, block, counts, theme)
    if any(counts.values()):
        extras["captions"] = {k: v for k, v in counts.items() if v}
    kinds = [b.get("type") for b in spec.get("blocks", [])]
    for kind in ("chart", "image", "shape"):
        if kinds.count(kind):
            extras[f"{kind}s"] = kinds.count(kind)
    # The house pass sets the named styles, the page and the tables. It
    # runs before the direction pass and before any Arabic font pass, and
    # it fills in only what the spec left unset, so a spec always wins.
    themed = None
    if theme is not None:
        house.theme_docx(doc, theme, set_page=not spec.get("page"))
        themed = theme.name
    # The header and the footer are built before the direction pass, so a
    # running head in Arabic is flipped with everything else.
    if report:
        extras.update(apply_report_frame(doc, report, theme))
    direction = apply_rtl(doc, args.rtl or spec.get("rtl", "auto"))
    _replay_rtl_overrides()
    _align_numeric_columns()
    if spec.get("footer_page_numbers"):
        from docx_edit import _add_field
        para = doc.sections[0].footer.paragraphs[0]
        para.add_run("Page ")
        _add_field(para, " PAGE ", "1")
        para.add_run(" of ")
        _add_field(para, " NUMPAGES ", "1")
    doc.save(args.output)
    print(json.dumps({"ok": True, "output": args.output,
                      "blocks": len(spec.get("blocks", [])),
                      "theme": themed, **direction, **extras},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
