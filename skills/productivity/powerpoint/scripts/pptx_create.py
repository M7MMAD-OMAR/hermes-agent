#!/usr/bin/env python3
"""Create a .pptx presentation from a JSON deck spec.

Spec format (all positions/sizes in inches, colors as RRGGBB hex):
{
  "slide_size": "16:9",              // or "4:3" (default "16:9")
  "rtl": "auto",                     // "auto" (default) | "on" | "off"
  "slides": [
    {"layout": "title", "title": "My Deck", "subtitle": "Q3 review"},
    {"layout": "title_content", "title": "Agenda",
     "bullets": ["Top item",
                 {"text": "Sub item", "level": 1, "bold": true,
                  "size": 18, "color": "CC0000", "font": "Arial",
                  "italic": false,
                  "link": "https://example.com/agenda"}],
     "background": "1F2937",           // solid slide background (hex)
     "footer": "Confidential",         // footer placeholder text
     "slide_number": true,             // enable slide-number placeholder
     "notes": "Speaker notes for this slide"},
    {"layout": "blank", "title": "Widgets",
     "images":  [{"path": "logo.png", "left": 1, "top": 1, "width": 3}],
     "tables":  [{"left": 1, "top": 2, "width": 6, "height": 2,
                  "rows": [["H1", "H2"], ["a", "b"]]}],
     "shapes":  [{"type": "rounded_rectangle", "left": 8, "top": 1,
                  "width": 3, "height": 1, "fill": "4472C4",
                  "text": "Callout", "text_color": "FFFFFF"}],
     "charts":  [{"type": "bar", "left": 1, "top": 3, "width": 6,
                  "height": 3.5, "title": "Sales",
                  "categories": ["Q1", "Q2"],
                  "series": {"North": [10, 20], "South": [7, 13]}}]},

    // Composed layouts. These are drawn on the house grid rather than
    // poured into placeholders, so they read their own keys and ignore
    // "bullets". Everything else (images, tables, shapes, charts, notes,
    // footer, background, slide_number) works on them as usual.
    {"layout": "statement", "kicker": "Where we are",
     "text": "Two products carry the quarter."},
    {"layout": "stat", "title": "The quarter in three numbers",
     "stats": [{"value": "34%", "label": "Revenue growth",
                "source": "Finance, Q3 close"},
               {"value": "1.2M", "label": "Active accounts"}]},
    {"layout": "cards", "title": "What changed",
     "cards": [{"label": "Pricing", "body": "One plan, billed yearly."},
               {"label": "Onboarding", "body": "Two steps, not nine."}]},
    {"layout": "comparison", "title": "Before and after",
     "divider": true,
     "columns": [{"heading": "Before", "body": "Nine screens to first value."},
                 {"heading": "After", "body": "Two screens, same value."}]},
    {"layout": "timeline", "title": "How it lands",
     "steps": [{"label": "October", "text": "Pricing ships."},
               {"label": "November", "text": "Onboarding ships."},
               {"label": "December", "text": "Migration closes."}]},
    {"layout": "quote", "text": "We stopped asking for the form.",
     "attribution": "Head of Support"},
    {"layout": "closing", "text": "Ship the pricing change in October.",
     "contact": "finance@example.com"}
  ]
}
House style: every deck is type-set to the house design system (type
scale, neutral palette, styled tables and charts) unless the spec says
`"theme": false` or the command line says `--no-theme`. Pick another with
`"theme": "slate"` or `"theme": {"name": "editorial", "accent": "1F4E79"}`.
Anything the spec sets explicitly, such as a bullet size or color, wins.

Layouts: title, title_content, section, two_content, title_only, blank
Composed layouts: statement, stat, cards, comparison, timeline, quote,
closing. An unknown name still falls back to title_content.
Chart types: bar, bar_h, line, pie   Shape types: rectangle,
rounded_rectangle, oval, diamond, right_arrow, chevron
"""
import argparse
import copy
import json
import math
import re
import sys

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Inches, Pt

from house_common import load_house_style
from pptx_common import apply_rtl, strip_typed_bullet

LAYOUTS = {"title": 0, "title_content": 1, "section": 2,
           "two_content": 3, "title_only": 5, "blank": 6}
CHART_TYPES = {"bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
               "bar_h": XL_CHART_TYPE.BAR_CLUSTERED,
               "line": XL_CHART_TYPE.LINE_MARKERS,
               "pie": XL_CHART_TYPE.PIE}
SHAPE_TYPES = {"rectangle": MSO_SHAPE.RECTANGLE,
               "rounded_rectangle": MSO_SHAPE.ROUNDED_RECTANGLE,
               "oval": MSO_SHAPE.OVAL, "diamond": MSO_SHAPE.DIAMOND,
               "right_arrow": MSO_SHAPE.RIGHT_ARROW,
               "chevron": MSO_SHAPE.CHEVRON}


# ---------------------------------------------------------------------------
# Composed layouts.
#
# The six stock placeholder layouts give a title and a bullet list and
# nothing else, which is the single loudest tell that a deck was generated.
# These seven are drawn onto the blank layout at coordinates taken from the
# house grid: 960 x 540 pt, a 48 pt outer margin, 12 columns at a 24 pt
# gutter. When the house style is not installed the literals below stand in,
# so the skill still composes when it is installed alone.
# ---------------------------------------------------------------------------

_FALLBACK_GEOMETRY = {
    "margin_x": 0.667, "margin_top": 0.667, "margin_bottom": 0.389,
    "gutter": 0.333, "title_height": 0.778,
}
_FALLBACK_DECK_TYPE = {
    "cover_title": 56, "kicker": 14, "title": 42, "section": 32, "lead": 24,
    "body": 18, "body_sm": 16, "body_xs": 14, "caption": 14,
}
_FALLBACK_PALETTE = {
    "ink": "1B1A18", "paper": "FFFFFF", "surface": "F6F3EE",
    "muted": "6E685F", "line": "D9D2C7", "accent": "B4482E",
    "accent_text": "8E3823",
}
_FALLBACK_FONTS = {"heading": "Arial", "body": "Arial"}

_ARABIC_RANGE = re.compile(r"[؀-ۿݐ-ݿﭐ-﻿]")

# The gap between stacked blocks, and the gap between a title band and the
# content under it. One value, used everywhere, is what reads as designed.
_GAP = 0.222
_GAP_LG = 0.333
_BAND_GAP = 0.444

# Keys whose string values are machinery, not prose, so they must not vote
# on whether a slide is Arabic.
_NON_PROSE_KEYS = {"layout", "path", "background", "color", "text_color",
                   "fill", "font", "link", "theme", "type", "notes"}


def _local_is_arabic(text):
    """The house rule, kept locally for an install without house-style."""
    letters = [c for c in (text or "") if c.isalpha()]
    if not letters:
        return False
    arabic = sum(1 for c in letters if _ARABIC_RANGE.match(c))
    return arabic * 2 >= len(letters)


def _spec_prose(value, key=None, out=None):
    """Every string on a slide spec that a reader would actually read."""
    if out is None:
        out = []
    if isinstance(value, str):
        if key not in _NON_PROSE_KEYS:
            out.append(value)
    elif isinstance(value, dict):
        for k, item in value.items():
            _spec_prose(item, k, out)
    elif isinstance(value, list):
        for item in value:
            _spec_prose(item, key, out)
    return out


def _first(spec, *keys):
    for key in keys:
        value = spec.get(key)
        if value not in (None, "", []):
            return value
    return None


class DeckStyle:
    """The grid, the type scale and the palette a composed layout draws on.

    Sizes and colors come from the loaded theme when there is one. The
    grid itself is recomputed from the live canvas rather than read from
    ``geometry``, because the geometry constants describe the 13.333 in
    canvas and a 4:3 deck is 10 in wide.
    """

    def __init__(self, prs, theme=None, house=None):
        geometry = dict(_FALLBACK_GEOMETRY)
        self.type = dict(_FALLBACK_DECK_TYPE)
        self.color = dict(_FALLBACK_PALETTE)
        self.fonts = dict(_FALLBACK_FONTS)
        if theme is not None:
            geometry.update(theme.geometry)
            self.type.update(theme.deck)
            self.color.update(vars(theme.palette))
            self.fonts.update(theme.fonts)
        self.is_arabic = getattr(house, "is_arabic", None) or _local_is_arabic

        self.width = prs.slide_width / 914400
        self.height = prs.slide_height / 914400
        self.margin_x = geometry["margin_x"]
        self.margin_top = geometry["margin_top"]
        self.margin_bottom = geometry["margin_bottom"]
        self.gutter = geometry["gutter"]
        self.content_w = self.width - 2 * self.margin_x
        self.title_h = geometry.get("title_height", 0.778)
        self.body_top = self.margin_top + self.title_h + _BAND_GAP
        self.body_bottom = self.height - self.margin_bottom

    def rtl(self, spec):
        return self.is_arabic(" ".join(_spec_prose(spec)))

    def columns(self, count, rtl, left=None, width=None):
        """Equal columns across the content box, reversed for Arabic.

        Mirroring is geometry, not alignment: right-aligning text inside
        left-hand boxes leaves an Arabic reader starting at the far side
        of the slide and reading the last card first.
        """
        left = self.margin_x if left is None else left
        width = self.content_w if width is None else width
        col_w = (width - (count - 1) * self.gutter) / count
        xs = [left + i * (col_w + self.gutter) for i in range(count)]
        if rtl:
            xs.reverse()
        return [(x, col_w) for x in xs]


def _start_align(rtl):
    return PP_ALIGN.RIGHT if rtl else PP_ALIGN.LEFT


def _leading(style, text, latin, arabic):
    """Arabic needs more room between lines than Latin at the same size.

    The house body rule is 1.7, which is right for a paragraph and far too
    loose for display type, so every composed layout carries its own pair.
    """
    return arabic if style.is_arabic(str(text or "")) else latin


def _text_height(text, size_pt, width_in, spacing, lines_min=1, widen=1.0):
    """Wrapped height in inches, from the 0.5 * size average character width.

    A bounding-box test cannot see text spilling out of its box, so the
    boxes are sized from an estimate rather than from a guessed constant.
    """
    per_line = max(1, int((width_in * 72) / (0.5 * widen * max(size_pt, 1))))
    lines = max(lines_min, math.ceil(len(text or "") / per_line))
    return lines * size_pt * spacing / 72


def _fill_frame(frame, style, lines, align=None):
    """Write paragraphs with every font property pinned.

    The house pass fills in only what is unset, and its body rule puts
    Arabic on 1.7 leading. A 72 pt number set that loose is 122 pt tall
    and leaves its box, so leading and spacing are set here too.
    """
    frame.clear()
    for i, line in enumerate(lines):
        para = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        run = para.add_run()
        run.text = line["text"]
        font = run.font
        font.size = Pt(line["size"])
        font.bold = bool(line.get("bold", False))
        # A Latin family name on Arabic text leaves the renderer to pick a
        # substitute, so one deck came back with three different Arabic
        # faces on three slides. Name the resolved Arabic family instead.
        face = line.get("font") or style.fonts["body"]
        if style.is_arabic(run.text) and style.fonts.get("arabic"):
            face = style.fonts["arabic"]
        font.name = face
        font.color.rgb = RGBColor.from_string(
            line.get("color") or style.color["ink"])
        if align is not None:
            para.alignment = align
        para.line_spacing = line.get("spacing", 1.2)
        para.space_after = Pt(line.get("space_after", 0))


def _add_text(slide, style, box, lines, align=None, anchor=MSO_ANCHOR.TOP,
              pad=0.0):
    left, top, width, height = box
    shape = slide.shapes.add_textbox(Inches(left), Inches(top),
                                     Inches(width), Inches(height))
    frame = shape.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(frame, side, Inches(pad))
    _fill_frame(frame, style, lines, align)
    return shape


def _strip_theme_style(shape):
    """Drop the ``p:style`` reference python-pptx gives a new shape.

    It points at the Office theme's line and effect refs, and LibreOffice
    honours the effect ref even when ``effectLst`` is empty: every card,
    dot and hairline came back from the renderer with a drop shadow and a
    grey keyline nobody asked for.
    """
    element = shape._element
    for child in element.findall(
            "{http://schemas.openxmlformats.org/presentationml/2006/main}"
            "style"):
        element.remove(child)


def _add_rule(slide, style, x1, y1, x2, y2, width_pt=0.75):
    """A hairline. A connector carries no fill and no text frame, so it
    cannot pick up body type from the house pass, and its zero thickness
    keeps it out of any overlap check."""
    line = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1),
                                      Inches(y1), Inches(x2), Inches(y2))
    line.line.color.rgb = RGBColor.from_string(style.color["line"])
    line.line.width = Pt(width_pt)
    line.shadow.inherit = False
    _strip_theme_style(line)
    line.name = "house rule"
    return line


def _add_surface(slide, style, box, fill=None):
    """A filled card. No border and no accent stripe: both are named
    anti-patterns, and a stripe on one edge is the loudest of them."""
    left, top, width, height = box
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left),
                                   Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(
        fill or style.color["surface"])
    shape.line.fill.background()
    shape.shadow.inherit = False
    _strip_theme_style(shape)
    shape.name = "house card"
    return shape


def _slide_title(slide, style, spec, rtl):
    """The title band, when a composed layout carries a title."""
    text = spec.get("title")
    if not text:
        return
    _add_text(slide, style, (style.margin_x, style.margin_top,
                             style.content_w, style.title_h),
              [{"text": text, "size": style.type["title"], "bold": True,
                "color": style.color["ink"], "font": style.fonts["heading"],
                "spacing": 1.1}],
              align=_start_align(rtl), anchor=MSO_ANCHOR.TOP)


def _content_band(style, spec):
    """Where the content starts, given whether a title took its band."""
    top = style.body_top if spec.get("title") else style.margin_top
    return top, style.body_bottom - top


def _compose_statement(slide, spec, style, rtl):
    text = str(_first(spec, "text", "statement", "title") or "")
    kicker = _first(spec, "kicker")
    size = style.type["section"]
    spacing = _leading(style, text, 1.15, 1.4)
    text_h = _text_height(text, size, style.content_w, spacing)
    kicker_h = style.type["kicker"] * 1.2 / 72
    total = text_h + (kicker_h + _GAP if kicker else 0)
    top = max(style.margin_top, (style.height - total) / 2)
    align = _start_align(rtl)

    if kicker:
        # accent_text is the accent darkened until it reads on paper. The
        # raw accent is a keyline color and fails contrast as type.
        _add_text(slide, style,
                  (style.margin_x, top, style.content_w, kicker_h),
                  [{"text": str(kicker).upper(), "size": style.type["kicker"],
                    "bold": True, "color": style.color["accent_text"],
                    "font": style.fonts["heading"], "spacing": 1.2}],
                  align=align)
        top += kicker_h + _GAP
    _add_text(slide, style, (style.margin_x, top, style.content_w, text_h),
              [{"text": text, "size": size, "bold": False,
                "color": style.color["ink"], "font": style.fonts["heading"],
                "spacing": spacing}],
              align=align, anchor=MSO_ANCHOR.TOP)


def _compose_stat(slide, spec, style, rtl):
    stats = spec.get("stats")
    if not stats:
        stats = [{"value": _first(spec, "value", "stat", "number") or "",
                  "label": _first(spec, "label", "subtitle") or "",
                  "source": _first(spec, "source", "caption") or ""}]
    stats = [s if isinstance(s, dict) else {"value": str(s)} for s in stats]
    count = max(1, len(stats))

    _slide_title(slide, style, spec, rtl)
    band_top, band_h = _content_band(style, spec)
    align = _start_align(rtl)
    boxes = style.columns(count, rtl)

    # One number per column, so the number shrinks as the columns do. 60 pt
    # is the floor: below it a hero number stops being the slide.
    value_size = max(60, min(72, round(style.type["cover_title"] * 1.28))
                     - (count - 1) * 4)
    label_size = style.type["body"] if count < 4 else style.type["body_sm"]
    col_w = boxes[0][1]
    # A number that wraps ("1.2 million") needs the second line, and every
    # column takes the tallest so the labels stay on one baseline.
    value_lead = {}
    value_h = 0.0
    for stat in stats:
        text = str(stat.get("value", ""))
        lead = _leading(style, text, 1.05, 1.3)
        value_lead[id(stat)] = lead
        # The 0.5 average character width is a regular-weight figure and a
        # 60 pt bold number is wider, so the value alone takes headroom.
        value_h = max(value_h, _text_height(text, value_size, col_w, lead,
                                            widen=1.16) + 0.12)
    label_lead = 1.25
    label_h = 0.0
    for stat in stats:
        text = str(stat.get("label", ""))
        label_h = max(label_h, _text_height(
            text, label_size, col_w, _leading(style, text, 1.25, 1.5)))
    source_h = style.type["caption"] * 1.3 / 72
    has_source = any(s.get("source") for s in stats)
    block = value_h + _GAP / 2 + label_h + ((_GAP + source_h) if has_source
                                            else 0)
    top = band_top + max(0.0, (band_h - block) / 2)

    for (left, width), stat in zip(boxes, stats):
        _add_text(slide, style, (left, top, width, value_h),
                  [{"text": str(stat.get("value", "")), "size": value_size,
                    "bold": True, "color": style.color["ink"],
                    "font": style.fonts["heading"],
                    "spacing": value_lead[id(stat)]}],
                  align=align, anchor=MSO_ANCHOR.BOTTOM)
        _add_text(slide, style,
                  (left, top + value_h + _GAP / 2, width, label_h),
                  [{"text": str(stat.get("label", "")), "size": label_size,
                    "color": style.color["ink"], "font": style.fonts["body"],
                    "spacing": _leading(style, stat.get("label", ""),
                                        label_lead, 1.5)}],
                  align=align)
        if stat.get("source"):
            _add_text(slide, style,
                      (left, top + value_h + _GAP / 2 + label_h + _GAP,
                       width, source_h),
                      [{"text": str(stat["source"]),
                        "size": style.type["caption"],
                        "color": style.color["muted"],
                        "font": style.fonts["body"], "spacing": 1.2}],
                      align=align)


def _compose_cards(slide, spec, style, rtl):
    cards = [c if isinstance(c, dict) else {"label": str(c)}
             for c in (spec.get("cards") or [])]
    # The title goes down before the guard, so a spec that forgot its
    # content degrades to a title rather than to a hole in the deck.
    _slide_title(slide, style, spec, rtl)
    if not cards:
        return
    band_top, band_h = _content_band(style, spec)
    align = _start_align(rtl)
    pad = 0.333

    # Four cards go two by two: four in a row leaves a measure too narrow
    # for a line of body text at 16 pt.
    rows = 2 if len(cards) == 4 else 1
    per_row = math.ceil(len(cards) / rows)
    row_h = (band_h - (rows - 1) * style.gutter) / rows

    label_size = style.type["body"]
    body_size = style.type["body_sm"]
    col_w = style.columns(per_row, rtl)[0][1]
    inner_w = col_w - 2 * pad
    needed = 0.0
    for card in cards:
        label_h = _text_height(str(card.get("label", "")), label_size,
                               inner_w, _leading(style, card.get("label"),
                                                 1.2, 1.45))
        body = str(_first(card, "body", "text") or "")
        body_h = _text_height(body, body_size, inner_w,
                              _leading(style, body, 1.3, 1.55))
        needed = max(needed, label_h + _GAP / 2 + body_h + 2 * pad)
    # A card sized exactly to its text is a caption with a fill behind it.
    # 2.2 in gives the row presence without stranding the text at the top.
    card_h = min(row_h, max(needed, 2.2))
    # Cards hang from the top of the band, not from its middle. Centring
    # them leaves a hole under the title that reads as a missing element.
    top0 = band_top

    for row in range(rows):
        chunk = cards[row * per_row:(row + 1) * per_row]
        if not chunk:
            continue
        boxes = style.columns(per_row, rtl)[:len(chunk)]
        if rtl and len(chunk) < per_row:
            boxes = style.columns(per_row, rtl)[-len(chunk):]
        top = top0 + row * (card_h + style.gutter)
        for (left, width), card in zip(boxes, chunk):
            shape = _add_surface(slide, style, (left, top, width, card_h))
            frame = shape.text_frame
            frame.word_wrap = True
            frame.auto_size = MSO_AUTO_SIZE.NONE
            # Top anchored so every card's label sits on the same line.
            # Middle anchoring evens the padding per card and in exchange
            # staggers the labels across the row, which is the thing a
            # reader notices.
            frame.vertical_anchor = MSO_ANCHOR.TOP
            for side in ("margin_left", "margin_right", "margin_top",
                         "margin_bottom"):
                setattr(frame, side, Inches(pad))
            label = str(card.get("label", ""))
            lines = [{"text": label, "size": label_size, "bold": True,
                      "color": style.color["ink"],
                      "font": style.fonts["heading"],
                      "spacing": _leading(style, label, 1.2, 1.45),
                      "space_after": 8}]
            body = _first(card, "body", "text")
            if body:
                lines.append({"text": str(body), "size": body_size,
                              "color": style.color["ink"],
                              "font": style.fonts["body"],
                              "spacing": _leading(style, body, 1.3, 1.55)})
            _fill_frame(frame, style, lines, align)


def _compose_comparison(slide, spec, style, rtl):
    columns = spec.get("columns")
    if not columns:
        columns = [c for c in (spec.get("left"), spec.get("right")) if c]
    columns = [c if isinstance(c, dict) else {"body": str(c)}
               for c in (columns or [])][:2]
    _slide_title(slide, style, spec, rtl)
    if not columns:
        return
    band_top, band_h = _content_band(style, spec)
    align = _start_align(rtl)
    boxes = style.columns(max(2, len(columns)), rtl)[:len(columns)]

    head_size = style.type["lead"]
    body_size = style.type["body_sm"]
    head_h = max(_text_height(str(_first(c, "heading", "title") or ""),
                              head_size, boxes[0][1],
                              _leading(style, _first(c, "heading", "title"),
                                       1.15, 1.4))
                 for c in columns)

    used = band_top
    for (left, width), column in zip(boxes, columns):
        heading = _first(column, "heading", "title")
        top = band_top
        if heading:
            _add_text(slide, style, (left, top, width, head_h),
                      [{"text": str(heading), "size": head_size, "bold": True,
                        "color": style.color["ink"],
                        "font": style.fonts["heading"],
                        "spacing": _leading(style, heading, 1.15, 1.4)}],
                      align=align)
            top += head_h + _GAP
        items = column.get("bullets") or []
        if not items:
            body = _first(column, "body", "text")
            items = [body] if body else []
        if items:
            item_lead = _leading(style, " ".join(str(i) for i in items),
                                 1.35, 1.6)
            body_h = sum(_text_height(str(item), body_size, width, item_lead)
                         + 8 / 72 for item in items)
            body_h = min(max(0.4, body_h), band_top + band_h - top)
            lines = [{"text": strip_typed_bullet(str(item)),
                      "size": body_size, "color": style.color["ink"],
                      "font": style.fonts["body"], "spacing": item_lead,
                      "space_after": 8} for item in items]
            _add_text(slide, style, (left, top, width, body_h), lines,
                      align=align)
            top += body_h
        used = max(used, top)

    # The divider runs the height of the columns it separates. Run it to
    # the bottom margin instead and it dangles under two short columns.
    if spec.get("divider", True) and len(columns) == 2:
        near, far = sorted(boxes)  # boxes come back reversed on an Arabic slide
        mid = (near[0] + near[1] + far[0]) / 2
        _add_rule(slide, style, mid, band_top, mid,
                  min(band_top + band_h, max(used, band_top + 0.5)))


def _compose_timeline(slide, spec, style, rtl):
    steps = [s if isinstance(s, dict) else {"label": str(s)}
             for s in (spec.get("steps") or [])]
    _slide_title(slide, style, spec, rtl)
    if not steps:
        return
    band_top, band_h = _content_band(style, spec)
    boxes = style.columns(len(steps), rtl)
    # The row of steps sits near the top of the band. Half way down the
    # band leaves the same hole under the title that the cards had.
    label_band = 0.95
    rule_y = band_top + min(label_band, band_h * 0.45)
    dot = 0.14
    clear = 0.222

    _add_rule(slide, style, style.margin_x, rule_y,
              style.margin_x + style.content_w, rule_y)

    label_size = style.type["body_sm"] if len(steps) < 5 \
        else style.type["body_xs"]
    body_size = style.type["body_xs"]
    for (left, width), step in zip(boxes, steps):
        label_h = max(0.3, rule_y - clear - band_top)
        _add_text(slide, style, (left, band_top, width, label_h),
                  [{"text": str(_first(step, "label", "title") or ""),
                    "size": label_size, "bold": True,
                    "color": style.color["ink"],
                    "font": style.fonts["heading"],
                    "spacing": _leading(style, _first(step, "label", "title"),
                                        1.2, 1.45)}],
                  align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.BOTTOM)
        text = _first(step, "text", "body")
        if text:
            top = rule_y + clear
            _add_text(slide, style,
                      (left, top, width, max(0.3, band_top + band_h - top)),
                      [{"text": str(text), "size": body_size,
                        "color": style.color["muted"],
                        "font": style.fonts["body"],
                        "spacing": _leading(style, text, 1.3, 1.55)}],
                      align=PP_ALIGN.CENTER)
        marker = slide.shapes.add_shape(
            MSO_SHAPE.OVAL, Inches(left + width / 2 - dot / 2),
            Inches(rule_y - dot / 2), Inches(dot), Inches(dot))
        marker.fill.solid()
        marker.fill.fore_color.rgb = RGBColor.from_string(
            style.color["accent"])
        marker.line.fill.background()
        marker.shadow.inherit = False
        _strip_theme_style(marker)
        marker.name = "house step dot"


def _compose_quote(slide, spec, style, rtl):
    text = str(_first(spec, "text", "quote", "title") or "")
    who = _first(spec, "attribution", "author", "source")
    size = style.type["lead"]
    spacing = _leading(style, text, 1.35, 1.6)
    # A 24 pt quote across the full 12 in measure runs past 90 characters.
    width = min(style.content_w, 10.0)
    left = (style.width - style.margin_x - width) if rtl else style.margin_x
    quote_h = _text_height(text, size, width, spacing)
    who_h = style.type["body_sm"] * 1.3 / 72
    total = quote_h + ((_GAP_LG + who_h) if who else 0)
    top = max(style.margin_top, (style.height - total) / 2)
    align = _start_align(rtl)

    _add_text(slide, style, (left, top, width, quote_h),
              [{"text": text, "size": size, "color": style.color["ink"],
                "font": style.fonts["heading"], "spacing": spacing}],
              align=align)
    if who:
        _add_text(slide, style,
                  (left, top + quote_h + _GAP_LG, width, who_h),
                  [{"text": str(who), "size": style.type["body_sm"],
                    "color": style.color["muted"],
                    "font": style.fonts["body"],
                    "spacing": _leading(style, who, 1.3, 1.55)}],
                  align=align)


def _compose_closing(slide, spec, style, rtl):
    text = str(_first(spec, "text", "title", "headline") or "")
    tail = _first(spec, "contact", "next_step", "subtitle")
    size = style.type["section"]
    spacing = _leading(style, text, 1.15, 1.4)
    text_h = _text_height(text, size, style.content_w, spacing)
    tail_lead = _leading(style, tail, 1.3, 1.55)
    tail_h = _text_height(str(tail or ""), style.type["body"],
                          style.content_w, tail_lead) if tail else 0.0
    total = text_h + ((_GAP_LG + tail_h) if tail else 0)
    top = max(style.margin_top, (style.height - total) / 2)
    align = _start_align(rtl)

    _add_text(slide, style, (style.margin_x, top, style.content_w, text_h),
              [{"text": text, "size": size, "bold": True,
                "color": style.color["ink"], "font": style.fonts["heading"],
                "spacing": spacing}],
              align=align)
    if tail:
        _add_text(slide, style,
                  (style.margin_x, top + text_h + _GAP_LG, style.content_w,
                   tail_h),
                  [{"text": str(tail), "size": style.type["body"],
                    "color": style.color["muted"],
                    "font": style.fonts["body"], "spacing": tail_lead}],
                  align=align)


COMPOSED_LAYOUTS = {
    "statement": _compose_statement,
    "stat": _compose_stat,
    "cards": _compose_cards,
    "comparison": _compose_comparison,
    "timeline": _compose_timeline,
    "quote": _compose_quote,
    "closing": _compose_closing,
}



# ---------------------------------------------------------------------------
# Planning: what layout the content wants, and how much of it fits
# ---------------------------------------------------------------------------

# What each composed layout can actually hold. A spec that names a layout
# its content cannot fill is not built broken: it is either split across
# slides or degraded to a layout that reads.
ITEM_BOUNDS = {
    "cards": (2, 4),
    "comparison": (2, 2),
    "timeline": (3, 6),
    "stat": (1, 4),
}

# The key each layout reads its items from.
ITEM_KEYS = {
    "cards": "cards",
    "comparison": "columns",
    "timeline": "steps",
    "stat": "stats",
}

# Words past which a one sentence layout stops being one sentence.
STATEMENT_WORDS = 20
QUOTE_WORDS = 40


def _items_of(spec: dict, layout: str) -> list:
    key = ITEM_KEYS.get(layout)
    if key is None:
        return []
    items = spec.get(key)
    if items is None and layout == "comparison":
        items = [c for c in (spec.get("left"), spec.get("right")) if c]
    return list(items or [])


def _word_count(value) -> int:
    return len(str(value or "").split())


def choose_layout(spec: dict) -> str:
    """Pick a layout from what the content actually is.

    Only consulted for "auto". The order is deliberate: the most
    specific shape wins, and a bullet list is the last resort rather
    than the default, because a deck that is a title over a bullet list
    on every slide is the clearest tell there is.
    """
    if spec.get("stats"):
        return "stat"
    if spec.get("steps"):
        return "timeline"
    if spec.get("columns") or (spec.get("left") and spec.get("right")):
        return "comparison"
    if spec.get("cards"):
        return "cards"
    if spec.get("quote") or (spec.get("attribution") and spec.get("text")):
        return "quote"
    if spec.get("charts") or spec.get("tables") or spec.get("images"):
        return "title_content"
    text = spec.get("text") or spec.get("statement")
    if text and not spec.get("bullets"):
        return "statement" if _word_count(text) <= STATEMENT_WORDS \
            else "title_content"
    bullets = spec.get("bullets") or []
    # Short parallel items read better as cards than as a bullet list,
    # and the deck gets a second shape on the page.
    if 2 <= len(bullets) <= 4 and all(_word_count(b if isinstance(b, str)
                                                  else b.get("text")) <= 12
                                      for b in bullets):
        return "cards"
    return "title_content"


def fit_kind(layout: str, spec: dict):
    """Can this layout hold this content, and if not, what should.

    Returns (layout, reason). The reason is carried into the output so a
    degraded slide is visible in the report rather than a silent
    surprise in the file.
    """
    if layout == "statement" and _word_count(
            spec.get("text") or spec.get("statement")) > STATEMENT_WORDS:
        return "title_content", (f"a statement is one sentence, this is "
                                 f"{_word_count(spec.get('text'))} words")
    if layout == "quote" and _word_count(spec.get("text")) > QUOTE_WORDS:
        return "title_content", "a pull quote past forty words stops pulling"
    low, high = ITEM_BOUNDS.get(layout, (0, 0))
    if not low:
        return layout, ""
    count = len(_items_of(spec, layout))
    if count == 0:
        return "title_content", f"a {layout} slide with no items"
    if count < low:
        if layout == "comparison":
            return "statement" if count == 1 else "title_content", \
                "a comparison needs two columns"
        if layout == "timeline":
            return "cards", f"a timeline of {count} steps is a set of cards"
    if layout == "comparison" and count > high:
        # Splitting would put one option on a slide of its own, which
        # reads as an afterthought rather than as a comparison. Three
        # options side by side are a set of cards.
        return "cards", f"{count} options are cards, not a comparison"
    return layout, ""


def _recast(spec: dict, old: str, new: str) -> dict:
    """Carry the content across when a layout is degraded.

    Each layout reads its items from its own key under its own field
    names, so a degraded slide that does not translate them arrives
    empty, which is worse than the layout it was rescued from.
    """
    if old == new:
        return spec
    out = dict(spec)
    items = _items_of(spec, old)
    if new == "cards" and items and not spec.get("cards"):
        out["cards"] = [{"label": item.get("heading") or item.get("label", ""),
                         "body": item.get("body") or item.get("text", "")}
                        if isinstance(item, dict) else {"label": str(item)}
                        for item in items]
    if new == "title_content" and items and not spec.get("bullets"):
        out["bullets"] = [
            f"{item.get('heading') or item.get('label', '')}: "
            f"{item.get('body') or item.get('text', '')}".strip(": ")
            if isinstance(item, dict) else str(item) for item in items]
    return out


def _fits_per_page(layout: str, spec: dict, style) -> int:
    """How many items of this layout go on one slide."""
    _, high = ITEM_BOUNDS.get(layout, (0, 0))
    return high or len(_items_of(spec, layout))


def _chunk_balanced(items: list, per_page: int) -> list:
    """Split so the last page is never left with a single lonely item."""
    if per_page <= 0 or len(items) <= per_page:
        return [items]
    pages = -(-len(items) // per_page)
    size = -(-len(items) // pages)
    out = [items[i:i + size] for i in range(0, len(items), size)]
    if len(out) > 1 and len(out[-1]) == 1 and len(out[-2]) > 2:
        out[-1].insert(0, out[-2].pop())
    return out


def _continued(title, rtl: bool):
    if not title:
        return title
    return f"{title} (تتمة)" if rtl else f"{title} (continued)"


def _paginate_bullets(spec: dict, style, house) -> list:
    """Split a bullet list over as many slides as it actually needs."""
    bullets = spec.get("bullets") or []
    if not bullets or house is None:
        return [bullets]
    band_top, band_h = _content_band(style, spec)
    width = min(7.5, style.content_w)
    texts = [b if isinstance(b, str) else str(b.get("text", ""))
             for b in bullets]
    pages = house.paginate_items(texts, width, band_h, style.type["body"],
                                 leading=1.35,
                                 family=style.fonts.get("body"))
    # paginate_items works on the text, so map back to the original items.
    out, index = [], 0
    for page in pages:
        out.append(bullets[index:index + len(page)])
        index += len(page)
    out = [p for p in out if p] or [bullets]
    return [page for chunk in out for page in _budget_split(chunk, house)]


def _budget_split(bullets: list, house) -> list:
    """Fitting is geometry, reading is a budget, and both decide.

    Seven long bullets can sit inside the body box and still be a wall
    of text nobody reads from the back of the room, so the house limits
    on bullets and words cut the page again after the measurement has.
    """
    limits = getattr(house, "LIMITS", None) or {}
    max_items = limits.get("slide_bullets", 5)
    max_words = limits.get("slide_words_max", 85)
    pages, current, words = [], [], 0
    for item in bullets:
        text = item if isinstance(item, str) else str(item.get("text", ""))
        count = len(text.split())
        if current and (len(current) >= max_items
                        or words + count > max_words):
            pages.append(current)
            current, words = [], 0
        current.append(item)
        words += count
    if current:
        pages.append(current)
    return pages or [bullets]


def plan_slides(spec: dict, style, house) -> tuple:
    """Turn one section of a spec into the slides it really needs.

    Three jobs, in order: pick a layout when the spec says "auto",
    validate that the layout can hold the content and degrade it when it
    cannot, and split what does not fit onto continuation slides. A
    builder that returns exactly one slide per section is a builder that
    clips.
    """
    layout = str(spec.get("layout", "title_content"))
    notes = []
    if layout == "auto":
        layout = choose_layout(spec)
        notes.append({"from": "auto", "to": layout,
                      "why": "chosen from the content"})
    resolved, reason = fit_kind(layout, spec)
    if resolved != layout:
        notes.append({"from": layout, "to": resolved, "why": reason})
        spec = _recast(spec, layout, resolved)
        layout = resolved

    rtl = style.rtl(spec)
    items = _items_of(spec, layout)
    per_page = _fits_per_page(layout, spec, style)
    pages = []
    if items and per_page and len(items) > per_page:
        key = ITEM_KEYS[layout]
        for n, chunk in enumerate(_chunk_balanced(items, per_page)):
            page = dict(spec)
            page["layout"] = layout
            page[key] = chunk
            if n:
                page["title"] = _continued(spec.get("title"), rtl)
                page.pop("left", None)
                page.pop("right", None)
            pages.append(page)
    elif layout == "title_content" and spec.get("bullets"):
        for n, chunk in enumerate(_paginate_bullets(spec, style, house)):
            page = dict(spec)
            page["layout"] = layout
            page["bullets"] = chunk
            if n:
                page["title"] = _continued(spec.get("title"), rtl)
                # The chart or the table belongs with the first page, not
                # repeated behind every continuation of the list.
                for once in ("charts", "tables", "images", "shapes"):
                    page.pop(once, None)
            pages.append(page)
    else:
        page = dict(spec)
        page["layout"] = layout
        pages = [page]

    if len(pages) > 1:
        notes.append({"from": layout, "to": layout,
                      "why": f"split across {len(pages)} slides"})
    return pages, notes


def style_run(run, spec):
    """Apply font styling from a bullet/text spec dict to a run."""
    font = run.font
    if spec.get("size"):
        font.size = Pt(spec["size"])
    if spec.get("bold") is not None:
        font.bold = spec["bold"]
    if spec.get("italic") is not None:
        font.italic = spec["italic"]
    if spec.get("font"):
        font.name = spec["font"]
    if spec.get("color"):
        font.color.rgb = RGBColor.from_string(spec["color"])
    if spec.get("link"):
        run.hyperlink.address = spec["link"]


def add_bullets(text_frame, bullets):
    text_frame.clear()
    for i, item in enumerate(bullets):
        if isinstance(item, str):
            item = {"text": item}
        para = text_frame.paragraphs[0] if i == 0 else text_frame.add_paragraph()
        para.level = int(item.get("level", 0))
        run = para.add_run()
        # The placeholder draws the bullet. A glyph typed into the text as well
        # renders twice, which is how "• • Overview" reached a delivered deck.
        run.text = strip_typed_bullet(item.get("text", ""))
        style_run(run, item)


def copy_layout_placeholder(slide, ph_idx):
    """Copy a layout placeholder (footer=11, slide number=12) onto the
    slide so it actually renders; returns the shape or None if the layout
    does not provide it."""
    for ph in slide.slide_layout.placeholders:
        if ph.placeholder_format.idx == ph_idx:
            slide.shapes._spTree.append(copy.deepcopy(ph._element))
            for shape in slide.placeholders:
                if shape.placeholder_format.idx == ph_idx:
                    return shape
    return None


def build_slide(prs, spec, style=None):
    name = spec.get("layout", "title_content")
    composer = COMPOSED_LAYOUTS.get(name)
    # An unknown layout name keeps the old fallback, a title and a body.
    layout_idx = LAYOUTS["blank"] if composer else LAYOUTS.get(name, 1)
    slide = prs.slides.add_slide(prs.slide_layouts[layout_idx])

    if spec.get("background"):
        fill = slide.background.fill
        fill.solid()
        fill.fore_color.rgb = RGBColor.from_string(spec["background"])
    if spec.get("slide_number"):
        copy_layout_placeholder(slide, 12)
    if spec.get("footer"):
        shape = copy_layout_placeholder(slide, 11)
        if shape is not None:
            shape.text_frame.text = spec["footer"]

    if composer is not None:
        if style is None:
            style = DeckStyle(prs)
        composer(slide, spec, style, style.rtl(spec))

    if composer is None and spec.get("title") is not None \
            and slide.shapes.title is not None:
        slide.shapes.title.text = spec["title"]
    if composer is None and spec.get("subtitle") is not None:
        for ph in slide.placeholders:
            if ph.placeholder_format.idx == 1:
                ph.text = spec["subtitle"]
                break
    # A composed layout owns its own text, so a stray bullet box would land
    # on top of it. Bullets stay a placeholder-layout key.
    if composer is None and spec.get("bullets"):
        body = next((ph for ph in slide.placeholders
                     if ph.placeholder_format.idx != 0), None)
        if body is None:
            body = slide.shapes.add_textbox(Inches(0.5), Inches(1.5),
                                            Inches(9), Inches(5))
        add_bullets(body.text_frame, spec["bullets"])

    for img in spec.get("images", []):
        kwargs = {}
        if img.get("width"):
            kwargs["width"] = Inches(img["width"])
        if img.get("height"):
            kwargs["height"] = Inches(img["height"])
        slide.shapes.add_picture(img["path"], Inches(img.get("left", 1)),
                                 Inches(img.get("top", 1)), **kwargs)

    for tbl in spec.get("tables", []):
        rows = tbl["rows"]
        shape = slide.shapes.add_table(
            len(rows), len(rows[0]), Inches(tbl.get("left", 1)),
            Inches(tbl.get("top", 2)), Inches(tbl.get("width", 6)),
            Inches(tbl.get("height", 2)))
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                shape.table.cell(r, c).text = str(val)

    for shp in spec.get("shapes", []):
        shape = slide.shapes.add_shape(
            SHAPE_TYPES.get(shp.get("type", "rectangle"), MSO_SHAPE.RECTANGLE),
            Inches(shp.get("left", 1)), Inches(shp.get("top", 1)),
            Inches(shp.get("width", 2)), Inches(shp.get("height", 1)))
        if shp.get("fill"):
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor.from_string(shp["fill"])
        if shp.get("text"):
            shape.text_frame.text = shp["text"]
            if shp.get("text_color"):
                run = shape.text_frame.paragraphs[0].runs[0]
                run.font.color.rgb = RGBColor.from_string(shp["text_color"])

    for cht in spec.get("charts", []):
        data = CategoryChartData()
        data.categories = cht["categories"]
        for name, values in cht["series"].items():
            data.add_series(name, values)
        frame = slide.shapes.add_chart(
            CHART_TYPES.get(cht.get("type", "bar"),
                            XL_CHART_TYPE.COLUMN_CLUSTERED),
            Inches(cht.get("left", 1)), Inches(cht.get("top", 2)),
            Inches(cht.get("width", 6)), Inches(cht.get("height", 4)), data)
        if cht.get("title"):
            frame.chart.has_title = True
            frame.chart.chart_title.text_frame.text = cht["title"]

    if spec.get("notes"):
        slide.notes_slide.notes_text_frame.text = spec["notes"]
    return slide


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description="Create a .pptx deck from a JSON spec.",
        epilog=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("spec", help="path to JSON deck spec")
    parser.add_argument("output", help="output .pptx path")
    parser.add_argument("--rtl", choices=("auto", "on", "off"),
                        help="right-to-left pass; default auto, or the spec's "
                             "\"rtl\" key")
    parser.add_argument("--no-theme", action="store_true",
                        help="build on the stock Office template instead of "
                             "the house design system")
    args = parser.parse_args(argv)

    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)

    prs = Presentation()
    if spec.get("slide_size", "16:9") == "16:9":
        prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    else:
        prs.slide_width, prs.slide_height = Inches(10), Inches(7.5)

    # The theme is resolved once, before the slides are built, because the
    # composed layouts draw on its grid and font resolution shells out.
    house = None if args.no_theme else load_house_style()
    theme = house.theme_from_spec(spec) if house is not None else None
    style = DeckStyle(prs, theme, house)

    planned = []
    for index, slide_spec in enumerate(spec.get("slides", [])):
        pages, notes = plan_slides(slide_spec, style, house)
        for note in notes:
            planned.append({"section": index, **note})
        for page in pages:
            build_slide(prs, page, style)

    # Type, color and chart styling, applied to the finished deck. It
    # fills in only what the spec left unset, and it runs before the
    # direction pass and before any Arabic font pass.
    themed = None
    if house is not None and theme is not None:
        house.theme_pptx(prs, theme)
        themed = theme.name
    rtl_counts = apply_rtl(prs, args.rtl or spec.get("rtl", "auto"))

    prs.save(args.output)
    report = {"ok": True, "output": args.output,
              "slides": len(prs.slides._sldIdLst), "theme": themed,
              "rtl_paragraphs": rtl_counts["paragraphs"],
              "rtl_cells": rtl_counts["cells"]}
    if planned:
        # A layout that was chosen, degraded or split is reported. A
        # silent change to somebody's deck is a surprise, not a service.
        report["plan"] = planned
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
