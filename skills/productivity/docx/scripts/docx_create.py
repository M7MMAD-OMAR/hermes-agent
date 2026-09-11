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
    {"type": "image", "path": "pic.png", "width_mm": 60},
    {"type": "page_break"},
    {"type": "toc"}
  ]
}

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
import sys

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_BREAK
from docx.shared import Mm, Pt, RGBColor

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from docx_common import apply_rtl, set_paragraph_rtl, set_table_rtl  # noqa: E402
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


def add_block(doc, block: dict) -> None:
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
        made.append(table)
    elif btype == "image":
        width = Mm(block["width_mm"]) if block.get("width_mm") else None
        doc.add_picture(block["path"], width=width)
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

    doc = Document()
    if spec.get("page"):
        apply_page(doc, spec["page"])
    if spec.get("styles"):
        add_styles(doc, spec["styles"])
    if spec.get("header"):
        doc.sections[0].header.paragraphs[0].text = spec["header"]
    if spec.get("footer"):
        doc.sections[0].footer.paragraphs[0].text = spec["footer"]
    for block in spec.get("blocks", []):
        add_block(doc, block)
    # The house pass sets the named styles, the page and the tables. It
    # runs before the direction pass and before any Arabic font pass, and
    # it fills in only what the spec left unset, so a spec always wins.
    themed = None
    house = None if args.no_theme else load_house_style()
    if house is not None:
        theme = house.theme_from_spec(spec)
        if theme is not None:
            house.theme_docx(doc, theme, set_page=not spec.get("page"))
            themed = theme.name
    direction = apply_rtl(doc, args.rtl or spec.get("rtl", "auto"))
    _replay_rtl_overrides()
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
                      "theme": themed, **direction}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
