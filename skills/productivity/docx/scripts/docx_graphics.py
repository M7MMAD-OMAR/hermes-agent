#!/usr/bin/env python3
# MIT License. Part of the Hermes docx skill.
"""Charts, pictures and shapes for a generated .docx, in the house style.

Three block types, one house theme, no extra dependencies: python-docx,
lxml and (for the chart's own workbook) openpyxl, all of which the skill
already ships with.

    add_chart(doc, spec, theme)     a real DrawingML chart part
    add_picture(doc, spec, theme)   a picture, caption and alt text
    add_shape(doc, spec, theme)     a text box or a callout

As a command it appends graphics to a document, which is the one job
docx_create.py cannot do because that script always starts a new file:

    docx_graphics.py graphics.json out.docx [--into report.docx]

``graphics.json`` is {"blocks": [...]} holding chart, image and shape
blocks in the shape docx_create.py documents, plus the same optional
``theme`` key. Without ``--into`` the graphics land in a new document.

The chart is a genuine ``c:chartSpace`` part with an embedded workbook,
not a picture of a chart: a reader can click it in Word and see the
numbers behind it. That is the whole point of the part, so nothing here
rasterises anything.

Every visual decision comes from the house theme rather than from the
caller: the accent hue for one series and ``palette.series`` in order for
several, label sizes from the document type scale, no gridlines, and no
legend when there is only one series, because a single series is already
named by the title.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Mm
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docx_common import _mostly_rtl, set_paragraph_rtl  # noqa: E402
from house_common import load_house_style  # noqa: E402

C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
CHART_NSMAP = {"c": C, "a": A, "r": R}

CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
CT_XLSX = ("application/vnd.openxmlformats-officedocument"
           ".spreadsheetml.sheet")
RT_CHART = R + "/chart"
RT_PACKAGE = R + "/package"

CHART_KINDS = ("bar", "column", "line", "pie")
# A shape is a rectangle or a rounded one. Anything more decorative is a
# thing a business document is better without.
SHAPE_GEOMETRY = {"rect": "rect", "rectangle": "rect",
                  "rounded": "roundRect", "round_rect": "roundRect",
                  "callout": "roundRect", "textbox": "rect"}


# Told apart from an explicit None, which is a caller saying "no theme,
# build on the stock template" the way ``docx_create.py --no-theme`` does.
_AUTO = object()


def _theme(theme):
    """The caller's theme, or the house default when it can be reached."""
    if theme is not _AUTO:
        return theme
    house = load_house_style()
    return house.load_theme() if house is not None else None


def _doc_size(theme, key: str, fallback: float) -> float:
    if theme is None:
        return fallback
    return float(theme.doc.get(key, fallback))


def _series_colors(theme, count: int) -> list[str]:
    """One accent for a single series, the series ramp for several.

    A chart with one series is a single measurement, so it is drawn in
    the one accent hue the rest of the document already uses. Several
    series need to be told apart, which is what palette.series is for.
    """
    if theme is None:
        return ["4472C4"] if count <= 1 else ["4472C4", "ED7D31", "A5A5A5"]
    palette = theme.palette
    if count <= 1:
        return [palette.accent]
    return [palette.series[i % len(palette.series)] for i in range(count)]


# ---------------------------------------------------------------------------
# Chart XML
# ---------------------------------------------------------------------------

def _q(name: str) -> str:
    prefix, local = name.split(":", 1)
    return "{%s}%s" % (CHART_NSMAP[prefix], local)


def _e(tag: str, attrs: dict | None = None, children=()):
    """One chart element. Children are written in the order given.

    The order matters more than the content here: a reader rejects a
    chart part whose children are out of schema sequence, and the repair
    dialog says nothing about which element was wrong. So every element
    is built in one place, in order, rather than appended ad hoc.
    """
    el = etree.Element(_q(tag), {k: str(v) for k, v in (attrs or {}).items()})
    for child in children:
        if child is not None:
            el.append(child)
    return el


def _val(tag: str, value) -> etree._Element:
    return _e(tag, {"val": str(value)})


def _srgb(tag: str, color: str, children=()):
    return _e(tag, None, [_e("a:srgbClr", {"val": str(color).lstrip("#").upper()},
                             children)])


def _solid_fill(color: str):
    return _srgb("a:solidFill", color)


def _line(color: str, width_pt: float = 1.0):
    return _e("a:ln", {"w": int(round(width_pt * 12700)), "cap": "rnd"},
              [_solid_fill(color)])


def _sp_pr(fill: str | None = None, line: str | None = None,
           line_pt: float = 1.0):
    kids = []
    kids.append(_solid_fill(fill) if fill else _e("a:noFill"))
    if line:
        kids.append(_line(line, line_pt))
    else:
        kids.append(_e("a:ln", None, [_e("a:noFill")]))
    return _e("c:spPr", None, kids)


def _text_props(tag: str, theme, size_pt: float, color: str, *,
                rtl: bool = False):
    """A ``c:txPr``-shaped block: body properties, then one styled paragraph."""
    font = theme.fonts["body"] if theme is not None else "Calibri"
    rpr = _e("a:defRPr", {"sz": int(round(size_pt * 100)), "b": "0"},
             [_solid_fill(color), _e("a:latin", {"typeface": font}),
              _e("a:cs", {"typeface": font})])
    ppr_attrs = {"rtl": "1"} if rtl else {}
    body = {"rtlCol": "1"} if rtl else {}
    return _e(tag, None, [
        _e("a:bodyPr", body),
        _e("a:lstStyle"),
        _e("a:p", None, [_e("a:pPr", ppr_attrs, [rpr])]),
    ])


def _title(text: str, theme, color: str, size_pt: float):
    """A chart title, laid out in the direction its own words run."""
    rtl = _mostly_rtl(text)
    font = theme.fonts["heading"] if theme is not None else "Calibri"
    rpr = _e("a:defRPr", {"sz": int(round(size_pt * 100)), "b": "1"},
             [_solid_fill(color), _e("a:latin", {"typeface": font}),
              _e("a:cs", {"typeface": font})])
    run_pr = _e("a:rPr", {"sz": int(round(size_pt * 100)), "b": "1",
                          "rtl": "1" if rtl else "0"},
                [_solid_fill(color), _e("a:latin", {"typeface": font}),
                 _e("a:cs", {"typeface": font})])
    run_text = _e("a:t")
    run_text.text = text
    para = _e("a:p", None, [
        _e("a:pPr", {"rtl": "1"} if rtl else {}, [rpr]),
        _e("a:r", None, [run_pr, run_text]),
    ])
    rich = _e("c:rich", None, [
        _e("a:bodyPr", {"rtlCol": "1"} if rtl else {}),
        _e("a:lstStyle"), para])
    return _e("c:title", None, [_e("c:tx", None, [rich]),
                                _val("c:overlay", 0)])


def _d_lbls(theme, color: str, size_pt: float, *, pie: bool, rtl: bool):
    """Numbers on the marks.

    A pie carries its category name and its percentage instead of a
    legend: with one series there is no legend to travel to, and an
    unlabelled slice is unidentifiable.
    """
    kids = [_text_props("c:txPr", theme, size_pt, color, rtl=rtl)]
    # Outside the mark in both cases. A label printed on top of a slice
    # is set in the label color against whatever hue that slice happens
    # to be, and the render showed exactly the unreadable pair that gives.
    kids.append(_val("c:dLblPos", "outEnd"))
    kids.append(_val("c:showLegendKey", 0))
    kids.append(_val("c:showVal", 0 if pie else 1))
    kids.append(_val("c:showCatName", 1 if pie else 0))
    kids.append(_val("c:showSerName", 0))
    kids.append(_val("c:showPercent", 1 if pie else 0))
    kids.append(_val("c:showBubbleSize", 0))
    return _e("c:dLbls", None, kids)


def _cat_ref(categories: list) -> etree._Element:
    last = len(categories) + 1
    pts = [_e("c:pt", {"idx": i}, [_text_node("c:v", str(c))])
           for i, c in enumerate(categories)]
    cache = _e("c:strCache", None, [_val("c:ptCount", len(categories)), *pts])
    return _e("c:cat", None, [
        _e("c:strRef", None, [_text_node("c:f", f"Sheet1!$A$2:$A${last}"),
                              cache])])


def _text_node(tag: str, text: str) -> etree._Element:
    el = _e(tag)
    el.text = text
    return el


def _col_letter(index: int) -> str:
    """Spreadsheet column for the (zero based) series index, B onwards."""
    n = index + 1  # column A holds the categories
    letters = ""
    while True:
        n, rest = divmod(n, 26)
        letters = chr(ord("A") + rest) + letters
        if n == 0:
            break
        n -= 1
    return letters


def _val_ref(values: list, index: int) -> etree._Element:
    col = _col_letter(index)
    last = len(values) + 1
    pts = [_e("c:pt", {"idx": i}, [_text_node("c:v", _number(v))])
           for i, v in enumerate(values)]
    cache = _e("c:numCache", None, [_text_node("c:formatCode", "General"),
                                    _val("c:ptCount", len(values)), *pts])
    return _e("c:val", None, [
        _e("c:numRef", None,
           [_text_node("c:f", f"Sheet1!${col}$2:${col}${last}"), cache])])


def _number(value) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "0"
    return str(int(number)) if number == int(number) else repr(number)


def _tx_ref(name: str, index: int) -> etree._Element:
    col = _col_letter(index)
    cache = _e("c:strCache", None, [_val("c:ptCount", 1),
                                    _e("c:pt", {"idx": 0},
                                       [_text_node("c:v", name)])])
    return _e("c:tx", None, [
        _e("c:strRef", None, [_text_node("c:f", f"Sheet1!${col}$1"), cache])])


def normalize_series(spec: dict) -> list[tuple[str, list]]:
    """Accept either {"name": [values]} or [{"name":..., "values": [...]}]."""
    raw = spec.get("series") or {}
    if isinstance(raw, dict):
        return [(str(name), list(values)) for name, values in raw.items()]
    out = []
    for i, item in enumerate(raw):
        if isinstance(item, dict):
            out.append((str(item.get("name", f"Series {i + 1}")),
                        list(item.get("values", []))))
        else:
            out.append((f"Series {i + 1}", list(item)))
    return out


def chart_xml(spec: dict, theme, *, data_rid: str | None = None) -> bytes:
    """The whole ``c:chartSpace`` part for one chart spec."""
    kind = str(spec.get("type", "column")).lower()
    if kind not in CHART_KINDS:
        raise ValueError(f"unknown chart type: {kind}; have {CHART_KINDS}")
    categories = [str(c) for c in spec.get("categories", [])]
    series = normalize_series(spec)
    if not series:
        raise ValueError("a chart needs at least one series")
    colors = _series_colors(theme, len(series))
    muted = theme.palette.muted if theme is not None else "595959"
    ink = theme.palette.ink if theme is not None else "000000"
    line_color = theme.palette.line if theme is not None else "D9D9D9"
    label_pt = _doc_size(theme, "caption", 9)
    title_pt = _doc_size(theme, "h3", 14)
    title_text = str(spec.get("title") or "")
    # The chart's own words decide its direction, exactly as a paragraph's
    # do. Nothing outside this part can reach the labels later.
    rtl = _mostly_rtl(" ".join([title_text, *categories,
                                *(name for name, _ in series)]))
    is_pie = kind == "pie"
    multi = len(series) > 1

    sers = []
    for i, (name, values) in enumerate(series):
        color = colors[i % len(colors)]
        kids = [_val("c:idx", i), _val("c:order", i), _tx_ref(name, i)]
        if kind == "line":
            # A line is drawn by its stroke, so the shape itself has no fill.
            kids.append(_e("c:spPr", None, [_e("a:noFill"),
                                            _line(color, 1.75)]))
            kids.append(_e("c:marker", None, [_val("c:symbol", "none")]))
        elif is_pie:
            kids.append(_sp_pr(fill=color, line=(theme.palette.paper
                                                 if theme else "FFFFFF"), ))
            # Each slice takes the next hue: a pie's points are its series.
            for j, _ in enumerate(values):
                slice_color = _series_colors(theme, max(len(values), 2))
                kids.append(_e("c:dPt", None, [
                    _val("c:idx", j), _val("c:bubble3D", 0),
                    _sp_pr(fill=slice_color[j % len(slice_color)],
                           line=(theme.palette.paper if theme else "FFFFFF"))]))
            kids.append(_d_lbls(theme, muted, label_pt, pie=True, rtl=rtl))
        else:
            kids.append(_sp_pr(fill=color))
            kids.append(_val("c:invertIfNegative", 0))
        kids.append(_cat_ref(categories))
        kids.append(_val_ref(values, i))
        if kind == "line":
            kids.append(_val("c:smooth", 0))
        sers.append(_e("c:ser", None, kids))

    ax_cat, ax_val = 111111111, 222222222
    if is_pie:
        plot_kids = [_e("c:pieChart", None,
                        [_val("c:varyColors", 1), *sers,
                         _val("c:firstSliceAng", 0)])]
    elif kind == "line":
        plot_kids = [_e("c:lineChart", None,
                        [_val("c:grouping", "standard"),
                         _val("c:varyColors", 0), *sers,
                         _val("c:marker", 1),
                         _val("c:axId", ax_cat), _val("c:axId", ax_val)])]
    else:
        plot_kids = [_e("c:barChart", None,
                        [_val("c:barDir", "bar" if kind == "bar" else "col"),
                         _val("c:grouping", "clustered"),
                         _val("c:varyColors", 0), *sers,
                         _d_lbls(theme, muted, label_pt, pie=False, rtl=rtl),
                         # Air between the bars: a bar wider than about a
                         # third of its band reads as a block, not a
                         # measurement.
                         _val("c:gapWidth", 150), _val("c:overlap", -20),
                         _val("c:axId", ax_cat), _val("c:axId", ax_val)])]
    if not is_pie:
        # No gridlines anywhere: the marks carry the data, and with the
        # numbers on the bars the value axis has nothing left to say.
        hide_values = kind in ("bar", "column")
        plot_kids.append(_e("c:catAx", None, [
            _val("c:axId", ax_cat),
            _e("c:scaling", None, [_val("c:orientation", "minMax")]),
            _val("c:delete", 0), _val("c:axPos", "b"),
            _val("c:majorTickMark", "none"), _val("c:minorTickMark", "none"),
            _val("c:tickLblPos", "nextTo"),
            _sp_pr(line=line_color),
            _text_props("c:txPr", theme, label_pt, muted, rtl=rtl),
            _val("c:crossAx", ax_val), _val("c:crosses", "autoZero"),
            _val("c:auto", 1), _val("c:lblAlgn", "ctr"),
            _val("c:lblOffset", 100), _val("c:noMultiLvlLbl", 0)]))
        plot_kids.append(_e("c:valAx", None, [
            _val("c:axId", ax_val), _e("c:scaling", None,
                                       [_val("c:orientation", "minMax")]),
            _val("c:delete", 1 if hide_values else 0),
            _val("c:axPos", "l"),
            _val("c:majorTickMark", "none"), _val("c:minorTickMark", "none"),
            _val("c:tickLblPos", "nextTo"),
            _sp_pr(line=line_color),
            _text_props("c:txPr", theme, label_pt, muted, rtl=rtl),
            _val("c:crossAx", ax_cat), _val("c:crosses", "autoZero"),
            _val("c:crossBetween", "between")]))
    plot_area = _e("c:plotArea", None, [_e("c:layout"), *plot_kids,
                                        _sp_pr()])

    chart_kids = []
    if title_text:
        chart_kids.append(_title(title_text, theme, ink, title_pt))
        chart_kids.append(_val("c:autoTitleDeleted", 0))
    else:
        # Without this Word invents a title out of the first series name.
        chart_kids.append(_val("c:autoTitleDeleted", 1))
    chart_kids.append(plot_area)
    if multi and not is_pie:
        chart_kids.append(_e("c:legend", None, [
            _val("c:legendPos", "b"), _val("c:overlay", 0),
            _sp_pr(),
            _text_props("c:txPr", theme, label_pt, muted, rtl=rtl)]))
    chart_kids.append(_val("c:plotVisOnly", 1))
    chart_kids.append(_val("c:dispBlanksAs", "gap"))

    space_kids = [_val("c:date1904", 0), _val("c:roundedCorners", 0),
                  _e("c:chart", None, chart_kids),
                  _sp_pr(fill=(theme.palette.paper if theme else "FFFFFF")),
                  _text_props("c:txPr", theme, label_pt, muted, rtl=rtl)]
    if data_rid:
        external = _e("c:externalData", None, [_val("c:autoUpdate", 0)])
        external.set(f"{{{R}}}id", data_rid)
        space_kids.append(external)

    root = etree.Element(_q("c:chartSpace"), nsmap=CHART_NSMAP)
    for child in space_kids:
        root.append(child)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8",
                          standalone=True)


def workbook_blob(categories: list, series: list) -> bytes | None:
    """The chart's numbers as a real .xlsx, or None without openpyxl.

    Word opens this workbook when the reader asks to edit the data, so
    the cells have to match the cached values in the chart part exactly.
    """
    try:
        from openpyxl import Workbook
    except ImportError:
        return None
    from io import BytesIO

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Sheet1"
    for i, (name, _values) in enumerate(series):
        sheet.cell(row=1, column=i + 2, value=name)
    for r, category in enumerate(categories):
        sheet.cell(row=r + 2, column=1, value=category)
        for i, (_name, values) in enumerate(series):
            if r < len(values):
                sheet.cell(row=r + 2, column=i + 2, value=values[r])
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


class _BlobPart(Part):
    """A package part whose bytes are settled after its rels exist.

    The chart part names the workbook by relationship id, and the id is
    only known once the relationship has been made, so the payload is
    written last.
    """

    def __init__(self, partname, content_type, package):
        super().__init__(partname, content_type, b"", package)
        self._payload = b""

    @property
    def blob(self) -> bytes:
        return self._payload

    def set_blob(self, payload: bytes) -> None:
        self._payload = payload


# ---------------------------------------------------------------------------
# Drawing wrappers
# ---------------------------------------------------------------------------

def _next_drawing_id(doc) -> int:
    """A document-wide unique id for wp:docPr."""
    ids = [int(el.get("id", "0"))
           for el in doc.element.body.iter(qn("wp:docPr"))
           if str(el.get("id", "")).isdigit()]
    return (max(ids) + 1) if ids else 1


def _usable_width_emu(doc) -> int:
    section = doc.sections[0]
    return int(section.page_width - section.left_margin - section.right_margin)


def _size_emu(doc, spec: dict, default_ratio: float = 0.62) -> tuple[int, int]:
    width = (Mm(spec["width_mm"]).emu if spec.get("width_mm")
             else _usable_width_emu(doc))
    height = (Mm(spec["height_mm"]).emu if spec.get("height_mm")
              else int(width * default_ratio))
    return width, height


def _inline_xml(cx: int, cy: int, doc_id: int, name: str, descr: str,
                payload: str) -> str:
    return (
        f'<w:drawing {nsdecls("w", "wp", "a", "r")} '
        f'xmlns:wps="{WPS}">'
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        f'<wp:docPr id="{doc_id}" name={quoteattr(name)} '
        f'descr={quoteattr(descr)}/>'
        '<wp:cNvGraphicFramePr/>'
        f'{payload}'
        '</wp:inline></w:drawing>')


def _anchor_xml(cx: int, cy: int, doc_id: int, name: str, descr: str,
                payload: str, spec: dict) -> str:
    """A floating shape with square wrap, offset from the text column."""
    dx = Mm(spec.get("offset_x_mm", 0)).emu
    dy = Mm(spec.get("offset_y_mm", 0)).emu
    return (
        f'<w:drawing {nsdecls("w", "wp", "a", "r")} '
        f'xmlns:wps="{WPS}">'
        '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" '
        'simplePos="0" relativeHeight="2" behindDoc="0" locked="0" '
        'layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        f'<wp:positionH relativeFrom="column"><wp:posOffset>{dx}'
        '</wp:posOffset></wp:positionH>'
        f'<wp:positionV relativeFrom="paragraph"><wp:posOffset>{dy}'
        '</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        '<wp:wrapSquare wrapText="bothSides"/>'
        f'<wp:docPr id="{doc_id}" name={quoteattr(name)} '
        f'descr={quoteattr(descr)}/>'
        '<wp:cNvGraphicFramePr/>'
        f'{payload}'
        '</wp:anchor></w:drawing>')


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def add_chart(doc, spec: dict, theme=_AUTO):
    """Insert a native chart, and return the paragraph holding it.

    The chart is a real part in the package: ``word/charts/chartN.xml``
    plus the workbook it was built from. Word draws it from the cached
    values and offers "Edit data" from the workbook, which is what a
    picture of a chart can never do.
    """
    theme = _theme(theme)
    categories = [str(c) for c in spec.get("categories", [])]
    series = normalize_series(spec)
    package = doc.part.package

    chart_part = _BlobPart(
        package.next_partname("/word/charts/chart%d.xml"), CT_CHART, package)
    data_rid = None
    blob = workbook_blob(categories, series)
    if blob is not None:
        data_part = Part(
            package.next_partname("/word/embeddings/chart-data%d.xlsx"),
            CT_XLSX, blob, package)
        data_rid = chart_part.relate_to(data_part, RT_PACKAGE)
    chart_part.set_blob(chart_xml(spec, theme, data_rid=data_rid))
    rid = doc.part.relate_to(chart_part, RT_CHART)

    cx, cy = _size_emu(doc, spec)
    payload = (
        '<a:graphic><a:graphicData '
        f'uri="{C}">'
        f'<c:chart xmlns:c="{C}" r:id="{rid}"/>'
        '</a:graphicData></a:graphic>')
    title = str(spec.get("title") or "Chart")
    alt = str(spec.get("alt") or title)
    para = doc.add_paragraph()
    para.alignment = _center()
    run = para.add_run()
    run._r.append(parse_xml(_inline_xml(cx, cy, _next_drawing_id(doc),
                                        title, alt, payload)))
    return para


def _center():
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    return WD_ALIGN_PARAGRAPH.CENTER


# ---------------------------------------------------------------------------
# Pictures
# ---------------------------------------------------------------------------

def add_picture(doc, spec: dict, theme=_AUTO, caption_text: str | None = None):
    """Place a picture, keep its aspect, and caption it.

    Only one dimension is ever given to python-docx, which is what keeps
    the aspect ratio: giving both is how a generated report ends up with
    a stretched logo.
    """
    theme = _theme(theme)
    width = Mm(spec["width_mm"]) if spec.get("width_mm") else None
    height = Mm(spec["height_mm"]) if spec.get("height_mm") else None
    # Only ever one dimension reaches python-docx, which is what keeps
    # the aspect. With neither given the picture comes in at its own
    # pixel size, exactly as it did before this module existed.
    if width is not None:
        height = None
    para = doc.add_paragraph()
    para.alignment = _center()
    run = para.add_run()
    run.add_picture(spec["path"], width=width, height=height)
    made = [para]

    alt = spec.get("alt")
    if alt:
        set_alt_text(para, str(alt))
    label = caption_text if caption_text is not None else spec.get("caption")
    if label:
        caption = doc.add_paragraph(str(label),
                                    style=spec.get("caption_style", "Caption"))
        caption.alignment = _center()
        if _mostly_rtl(str(label)):
            set_paragraph_rtl(caption, True)
        made.append(caption)
    return made


def set_alt_text(para, text: str) -> int:
    """Write the alt text onto every drawing in a paragraph.

    ``wp:docPr/@descr`` is the attribute a screen reader reads, and the
    one Word's own "Alt Text" pane edits. The title attribute is not a
    substitute: readers announce descr.
    """
    count = 0
    for doc_pr in para._p.iter(qn("wp:docPr")):
        doc_pr.set("descr", text)
        count += 1
    return count


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

def add_shape(doc, spec: dict, theme=_AUTO):
    """A floating text box, for the rare case that needs one.

    Prefer ``add_callout``: a callout that flows with the text moves
    with the paragraph it belongs to, and a floating box does not.

    The default look is a flat tinted rectangle with square corners and
    no outline. A rounded rectangle with a fill and a thin border around
    it is the single most recognisable shape in generated documents, so
    an outline here is opt in through ``"line"``.
    """
    theme = _theme(theme)
    geometry = SHAPE_GEOMETRY.get(str(spec.get("shape", "rectangle")).lower(),
                                  "rect")
    fill = spec.get("fill") or (theme.palette.surface if theme else "F2F2F2")
    ink = spec.get("color") or (theme.palette.ink if theme else "000000")
    outline = spec.get("line")
    size_pt = spec.get("size_pt") or _doc_size(theme, "body", 11)
    text = str(spec.get("text", ""))
    rtl = spec.get("rtl")
    rtl = _mostly_rtl(text) if rtl is None else bool(rtl)
    cx, cy = _size_emu(doc, spec, default_ratio=0.22)

    font = theme.fonts["body"] if theme is not None else "Calibri"
    arabic = theme.fonts["arabic"] if theme is not None else font
    rtl_col = 'rtlCol="1" ' if rtl else ""
    lines = text.split("\n") if text else [""]
    paragraphs = "".join(_shape_paragraph(line, ink, size_pt, font, arabic,
                                          rtl, spec)
                         for line in lines)
    payload = (
        f'<a:graphic><a:graphicData uri="{WPS}">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/>'
        '<wps:spPr>'
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="{geometry}"><a:avLst/></a:prstGeom>'
        f'<a:solidFill><a:srgbClr val="{_hex(fill)}"/></a:solidFill>'
        + (f'<a:ln w="9525"><a:solidFill>'
           f'<a:srgbClr val="{_hex(outline)}"/></a:solidFill></a:ln>'
           if outline else '<a:ln><a:noFill/></a:ln>') +
        '</wps:spPr>'
        f'<wps:txbx><w:txbxContent>{paragraphs}</w:txbxContent></wps:txbx>'
        '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="144000" '
        'tIns="108000" rIns="144000" bIns="108000" anchor="ctr" '
        f'{rtl_col}anchorCtr="0"/>'
        '</wps:wsp></a:graphicData></a:graphic>')
    name = str(spec.get("name") or "Text box")
    alt = str(spec.get("alt") or text or name)
    doc_id = _next_drawing_id(doc)
    xml = (_anchor_xml(cx, cy, doc_id, name, alt, payload, spec)
           if spec.get("anchored") else
           _inline_xml(cx, cy, doc_id, name, alt, payload))
    para = doc.add_paragraph()
    para.add_run()._r.append(parse_xml(xml))
    return para


def _shape_paragraph(text: str, ink: str, size_pt: float, font: str,
                     arabic: str, rtl: bool, spec: dict) -> str:
    """One ``w:p`` inside the text box.

    The direction is baked in here. Nothing later reaches it: the
    document-wide right-to-left pass walks body and table paragraphs,
    and a paragraph inside a ``wps:txbx`` is in neither.
    """
    half_points = int(round(size_pt * 2))
    align = "right" if rtl else spec.get("align", "left")
    bidi = "<w:bidi/>" if rtl else ""
    run_rtl = "<w:rtl/>" if rtl else ""
    bold = "<w:b/><w:bCs/>" if spec.get("bold") else ""
    return (
        f'<w:p {nsdecls("w")}><w:pPr>{bidi}<w:spacing w:after="0"/>'
        f'<w:jc w:val="{align}"/>'
        f'<w:rPr><w:rFonts w:ascii="{escape(font)}" w:hAnsi="{escape(font)}" '
        f'w:cs="{escape(arabic)}"/>{bold}'
        f'<w:color w:val="{_hex(ink)}"/>'
        f'<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>'
        f'{run_rtl}</w:rPr></w:pPr>'
        f'<w:r><w:rPr><w:rFonts w:ascii="{escape(font)}" '
        f'w:hAnsi="{escape(font)}" w:cs="{escape(arabic)}"/>{bold}'
        f'<w:color w:val="{_hex(ink)}"/>'
        f'<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>'
        f'{run_rtl}</w:rPr>'
        f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')


def _hex(color: str) -> str:
    return str(color).lstrip("#").upper()


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Callouts, which are paragraphs and not boxes
# ---------------------------------------------------------------------------

CALLOUT_STYLES = ("rules", "quote", "lead", "block", "edge")


def _pbdr(paragraph, side: str, eighths: int, color: str, space: int):
    """One paragraph border. python-docx has no API for these."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    pr = paragraph._p.get_or_add_pPr()
    borders = pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        pr.append(borders)
    node = borders.find(qn(f"w:{side}"))
    if node is None:
        node = OxmlElement(f"w:{side}")
        borders.append(node)
    node.set(qn("w:val"), "single")
    node.set(qn("w:sz"), str(eighths))
    node.set(qn("w:space"), str(space))
    node.set(qn("w:color"), _hex(color))


def _pshade(paragraph, color: str):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    pr = paragraph._p.get_or_add_pPr()
    shade = pr.find(qn("w:shd"))
    if shade is None:
        shade = OxmlElement("w:shd")
        pr.append(shade)
    shade.set(qn("w:val"), "clear")
    shade.set(qn("w:color"), "auto")
    shade.set(qn("w:fill"), _hex(color))


def _track(run, thousandths: int):
    """Letter spacing, in twentieths of a point. Latin only.

    Arabic is cursive and tracking breaks the joins between letters, so
    the caller must not reach this with Arabic text.
    """
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    rpr = run._r.get_or_add_rPr()
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:val"), str(thousandths))
    rpr.append(spacing)


def add_callout(doc, spec: dict, theme=_AUTO):
    """An aside that flows with the text it belongs to.

    Four treatments, all of them paragraph properties rather than a
    floating shape, because a shape stays where it was dropped while the
    text around it moves.

      rules   a rule above, a small caps label, the text, a hairline
              under it. This is how a report sets a named aside.
      quote   indented both sides and set larger, with no rule and no
              fill at all. The whitespace is the emphasis.
      lead    a bold lead in phrase and then the sentence, no decoration
              whatever. The most human of the four.
      block   a flat tint, square corners, no outline, for a note that
              has to be visibly separate from the argument.

    What none of them has: a rounded rectangle with a fill and a thin
    border around it, which is the shape a reader recognises as
    generated before reading a word of it.
    """
    from docx.shared import Cm, Pt, RGBColor

    theme = _theme(theme)
    style = str(spec.get("style", "rules")).lower()
    if style not in CALLOUT_STYLES:
        raise ValueError(f"unknown callout style {style!r}; "
                         f"have {list(CALLOUT_STYLES)}")
    text = str(spec.get("text", "")).strip()
    if not text:
        raise ValueError("a callout needs text")
    label = str(spec.get("kicker") or spec.get("label") or "").strip()
    rtl = spec.get("rtl")
    rtl = _mostly_rtl(text) if rtl is None else bool(rtl)

    palette = theme.palette if theme is not None else None
    ink = spec.get("color") or (palette.ink if palette else "000000")
    muted = palette.muted if palette else "666666"
    accent_text = palette.accent_text if palette else "000000"
    grid = palette.grid if palette else "CCCCCC"
    band = palette.band if palette else "F7F7F7"
    body_pt = spec.get("size_pt") or _doc_size(theme, "body", 11)
    face = theme.fonts["body"] if theme is not None else None

    def new_paragraph(text_value, size, *, bold=False, color=None,
                      spacing=None):
        para = doc.add_paragraph()
        run = para.add_run(text_value)
        run.font.size = Pt(size)
        run.font.bold = bold
        if face:
            run.font.name = face
        run.font.color.rgb = RGBColor.from_string(_hex(color or ink))
        if spacing:
            para.paragraph_format.line_spacing = spacing
        return para, run

    made = []
    if style == "rules":
        # With a label this is the hanging label on a hairline: one rule
        # above and none below. A second rule under a labelled aside is
        # the redundancy that reads as a template, which is why the
        # published examples carry one or the other and never both.
        if label:
            kicker, run = new_paragraph(label if rtl else label.upper(),
                                        _doc_size(theme, "caption", 9) - 1,
                                        bold=True, color=accent_text)
            if not rtl:
                _track(run, 12)
            _pbdr(kicker, "top", 4, grid, 4)
            kicker.paragraph_format.space_before = Pt(16)
            kicker.paragraph_format.space_after = Pt(3)
            kicker.paragraph_format.keep_with_next = True
            made.append(kicker)
            body, _ = new_paragraph(text, body_pt)
            body.paragraph_format.space_after = Pt(16)
        else:
            # No label: the extract band, a hairline above and below at
            # half a point, the quietest rule that still reads.
            body, _ = new_paragraph(text, body_pt)
            _pbdr(body, "top", 4, muted, 10)
            _pbdr(body, "bottom", 4, muted, 10)
            body.paragraph_format.space_before = Pt(12)
            body.paragraph_format.space_after = Pt(12)
        body.paragraph_format.keep_together = True
        made.append(body)
    elif style == "edge":
        # A rule on the leading edge, done the way a design system does
        # it: no fill behind it, a deep ink rather than a pastel, a real
        # gap, and the text genuinely indented. In Arabic the rule moves
        # to the right, because w:pBdr has no logical start side and the
        # left rule would land on the trailing edge of the line.
        body, _ = new_paragraph(text, body_pt)
        # The rule side is physical, because w:pBdr has no logical start
        # child. The indent is logical: under w:bidi, w:ind w:left is the
        # START side, so one line serves both directions.
        _pbdr(body, "right" if rtl else "left", 14,
              spec.get("rule") or ink, 14)
        fmt = body.paragraph_format
        fmt.left_indent = Cm(0.8)
        fmt.space_before = Pt(12)
        fmt.space_after = Pt(12)
        fmt.keep_together = True
        made.append(body)
    elif style == "quote":
        # A display quote changes the page's rhythm instead of adding an
        # object to it: about 1.6 times the body, tight leading, a short
        # measure, and no rule, fill, italic or quotation glyph.
        body, _ = new_paragraph(text, round(body_pt * 1.6), spacing=1.15)
        fmt = body.paragraph_format
        # The short measure is taken off the END of the line, so the
        # quote keeps the margin the body sits on. w:ind w:right is that
        # end under w:bidi as well, which is why this needs no branch.
        fmt.right_indent = Cm(3.8)
        fmt.space_before = Pt(24)
        fmt.space_after = Pt(8) if label else Pt(24)
        fmt.keep_together = True
        made.append(body)
        if label:
            source, _ = new_paragraph(label, body_pt - 1, color=muted)
            source.paragraph_format.right_indent = Cm(3.8)
            source.paragraph_format.space_after = Pt(24)
            made.append(source)
    elif style == "lead":
        body = doc.add_paragraph()
        if label:
            lead = body.add_run(label if label.endswith((".", "؟", "!", ":"))
                                else label + ".")
            lead.font.bold = True
            lead.font.size = Pt(body_pt)
            if face:
                lead.font.name = face
            lead.font.color.rgb = RGBColor.from_string(_hex(ink))
            body.add_run(" ")
        rest = body.add_run(text)
        rest.font.size = Pt(body_pt)
        if face:
            rest.font.name = face
        rest.font.color.rgb = RGBColor.from_string(_hex(ink))
        body.paragraph_format.space_before = Pt(10)
        body.paragraph_format.space_after = Pt(10)
        made.append(body)
    else:                                   # block
        body, _ = new_paragraph(text, body_pt)
        fill = spec.get("fill") or band
        _pshade(body, fill)
        # Word paints a paragraph fill tight against the glyphs, with no
        # padding on any side, and that is what makes a tinted block look
        # generated. A border in the fill's own color is invisible and
        # its w:space is the only padding a bordered paragraph gets.
        for side, space in (("left", 14), ("right", 14),
                            ("top", 10), ("bottom", 10)):
            _pbdr(body, side, 2, fill, space)
        fmt = body.paragraph_format
        fmt.space_before = Pt(12)
        fmt.space_after = Pt(12)
        fmt.keep_together = True
        made.append(body)

    for para in made:
        set_paragraph_rtl(para, rtl)
    return made[0]

BUILDERS = {"chart": add_chart, "image": add_picture,
            "shape": add_shape, "callout": add_callout}


def add_graphic(doc, block: dict, theme=_AUTO):
    """Dispatch one block onto a document.

    Charts, pictures and shapes are built here. Anything else is handed
    to the create script's own block builder, because appending a figure
    to somebody's report almost always means appending a heading and a
    caption with it, and splitting that across two commands is how the
    caption ends up on the wrong page.
    """
    kind = str(block.get("type", "")).lower()
    build = BUILDERS.get(kind)
    if build is None:
        try:
            from docx_create import add_block  # noqa: PLC0415  (cycle)
        except ImportError:
            raise ValueError(f"not a graphics block: {kind!r}; "
                             f"have {sorted(BUILDERS)}") from None
        return add_block(doc, block)
    spec = dict(block)
    if kind == "chart":
        spec["type"] = block.get("chart") or block.get("chart_type") or "column"
    return build(doc, spec, theme)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Append charts, pictures and shapes to a .docx.",
        epilog="See the module docstring for the block format.")
    ap.add_argument("spec", help="path to a JSON file of graphics blocks")
    ap.add_argument("output", help="path of the .docx to write")
    ap.add_argument("--into", help="an existing .docx to append to")
    ap.add_argument("--no-theme", action="store_true",
                    help="build on Word's stock template instead of the "
                         "house design system")
    args = ap.parse_args(argv)

    from docx import Document

    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)
    house = None if args.no_theme else load_house_style()
    theme = house.theme_from_spec(spec) if house is not None else None
    doc = Document(args.into) if args.into else Document()
    blocks = spec.get("blocks", [])
    for block in blocks:
        add_graphic(doc, block, theme)
    doc.save(args.output)
    print(json.dumps({"ok": True, "output": args.output,
                      "graphics": len(blocks),
                      "theme": theme.name if theme is not None else None},
                     ensure_ascii=False))
    return 0


__all__ = ["add_chart", "add_picture", "add_shape", "add_graphic", "chart_xml",
           "workbook_blob", "normalize_series", "set_alt_text",
           "CHART_KINDS", "main"]


if __name__ == "__main__":
    sys.exit(main())
