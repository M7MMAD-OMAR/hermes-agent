#!/usr/bin/env python3
"""One design system for every office deliverable Hermes produces.

The office scripts used to hand python-docx and python-pptx their stock
templates, so every report shipped Calibri 11 with Word's default blue
headings and every deck shipped the Office accent 4472C4. That is the
look a reader recognises as "generated", and no amount of good writing
survives it.

This module is the single source of truth for the other direction: a
palette, a type scale, a spacing grid and slide geometry, plus one
applier per format that walks a finished document and fills in whatever
the author left unset.

    from house_style import load_theme, theme_pptx
    theme = load_theme()            # editorial, the house default
    theme_pptx(prs, theme)          # after the deck is built

Two rules the appliers keep, and the reason they are safe to run by
default:

1. **They never overwrite an explicit choice.** A run whose size the
   spec set keeps that size; only ``None`` is filled in. So a spec can
   always win.
2. **They do not touch the Arabic font slot.** ``arabic_style.style_*``
   owns that, and it runs AFTER this pass. This module sets sizes,
   colors, spacing and the Latin face; the Arabic pass sets the complex
   script face over the top. Reverse the order and the Arabic text
   silently returns to the fallback face.

Themes ship as named presets (``editorial``, ``slate``, ``mono``), and any
of them can be re-tinted from a single brand hue::

    load_theme("slate", accent="B4482E")

Re-tinting keeps the neutrals neutral and rebuilds only the accent, its
soft tint, its readable text shade and the first data series, so the
result stays a designed palette rather than a hue sprayed over a page.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "Theme", "load_theme", "THEMES", "LIMITS",
    "text_width_pt", "wrap_lines", "estimate_lines", "text_height_in",
    "fit_size", "fill_factor", "paginate_items", "fit_title",
    "theme_docx", "theme_pptx", "theme_xlsx", "pdf_styles",
    "resolve_font", "contrast_ratio", "derive_accent",
]

# ---------------------------------------------------------------------------
# Color math. Everything is RRGGBB without a leading '#'.
# ---------------------------------------------------------------------------


def _norm(h: str) -> str:
    h = str(h).strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        raise ValueError(f"not a RRGGBB hex color: {h!r}")
    return h.upper()


def _to_rgb(h: str) -> tuple[float, float, float]:
    h = _norm(h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore


def _to_hex(rgb) -> str:
    return "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb)


def mix(a: str, b: str, t: float) -> str:
    """Blend a towards b. t=0 gives a, t=1 gives b."""
    ra, rb = _to_rgb(a), _to_rgb(b)
    return _to_hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def luminance(h: str) -> float:
    def chan(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in _to_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: str, b: str) -> float:
    """WCAG contrast ratio. 4.5 is the AA floor for body text."""
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def readable_on(background: str, ink: str, paper: str) -> str:
    """Pick whichever of ink/paper reads on the given background."""
    return ink if contrast_ratio(background, ink) >= contrast_ratio(background, paper) else paper


def darken_until_readable(color: str, background: str, target: float = 4.5) -> str:
    """Walk a color towards black until it clears the contrast target.

    An accent chosen because it looks right as a 3pt rule is usually too
    light as 11pt text on paper. This gives the text shade of the same
    hue rather than dropping the accent from the text palette.
    """
    if contrast_ratio(color, background) >= target:
        return _norm(color)
    for step in range(1, 21):
        candidate = mix(color, "000000", step / 20)
        if contrast_ratio(candidate, background) >= target:
            return candidate
    return "000000"


def derive_accent(base: "Palette", accent: str) -> "Palette":
    """Rebuild the accent-dependent entries of a palette from one hue."""
    accent = _norm(accent)
    soft = mix(accent, base.paper, 0.88)
    text = darken_until_readable(accent, base.paper)
    h, l, s = colorsys.rgb_to_hls(*_to_rgb(accent))
    # A second and third data color a quarter and half turn away, at the
    # accent's own lightness, so a chart reads as one family.
    def turn(frac):
        return _to_hex(colorsys.hls_to_rgb((h + frac) % 1.0, l, s * 0.75))
    series = [accent, turn(0.55), turn(0.12), base.muted, soft]
    return Palette(**{**base.__dict__, "accent": accent, "accent_soft": soft,
                      "accent_text": text, "series": series})


# ---------------------------------------------------------------------------
# Palettes. Neutral-dominant: ink and paper carry the page, the accent is
# the 10% in 60-30-10 and never the background of a whole slide.
# ---------------------------------------------------------------------------


@dataclass
class Palette:
    ink: str            # body text, headings
    paper: str          # page and slide background
    surface: str        # cards, table header bands, callouts
    muted: str          # captions, sources, secondary text
    line: str           # hairlines, chart gridlines
    grid: str           # table rules, both directions
    band: str           # the quieter of two alternating table rows
    accent: str         # rules, keylines, the first data series
    accent_soft: str    # accent at background strength
    accent_text: str    # accent dark enough to set text in
    positive: str
    negative: str
    series: list[str]   # data series order


_EDITORIAL = Palette(
    ink="1B1A18", paper="FFFFFF", surface="F6F3EE", muted="6E685F",
    line="D9D2C7", grid="CFC9C0", band="F8F6F3", accent="B4482E", accent_soft="F6E7E2", accent_text="8E3823",
    positive="3F6B4F", negative="9B3226",
    series=["B4482E", "27566B", "C9922B", "6E685F", "9BB0A5"],
)

_SLATE = Palette(
    ink="15181D", paper="FFFFFF", surface="F3F5F8", muted="5B6675",
    line="D5DBE3", grid="C9D0DA", band="F7F9FB", accent="27566B", accent_soft="E4EBF0", accent_text="1E4354",
    positive="2F6B57", negative="A33B33",
    series=["27566B", "C08A3E", "5E7B8C", "3F6B4F", "9AA7B4"],
)

_MONO = Palette(
    ink="111111", paper="FFFFFF", surface="F4F4F4", muted="6B6B6B",
    line="D8D8D8", grid="CCCCCC", band="F7F7F7", accent="111111", accent_soft="EDEDED", accent_text="111111",
    positive="3F6B4F", negative="9B3226",
    series=["111111", "5A5A5A", "8C8C8C", "B5B5B5", "D8D8D8"],
)

# ---------------------------------------------------------------------------
# Type. One modular scale at 1.25, rounded to whole points, expressed once
# per medium because a slide is read from three metres and a report from
# thirty centimetres.
# ---------------------------------------------------------------------------

DECK_TYPE = {
    # Base 18 pt, ratio 1.333 (perfect fourth), rounded to even points. A
    # projected slide's body floor is 18: below that the back of the room
    # stops reading and starts waiting.
    "cover_title": 56, "cover_subtitle": 24,
    "kicker": 14, "title": 42, "section": 32, "lead": 24,
    "body": 18, "body_sm": 16, "body_xs": 14,
    "table": 14, "table_head": 14, "chart": 14,
    "caption": 14, "footer": 10, "slide_number": 10,
}

DOC_TYPE = {
    # Base 11 pt, ratio 1.25. Three heading levels carry a report; a
    # fourth is a run-in. Size and space separate them, never color: a
    # colored heading in a business report is a template tell.
    "title": 28, "h1": 22, "h2": 17, "h3": 14, "h4": 11,
    "body": 11, "lead": 12, "quote": 11,
    "table": 10, "table_head": 10,
    # A hanging label on an aside is 80 percent of body, the size Tufte
    # sets a margin note at. It is a role of the system, not an
    # improvised size, which is why the lint knows about it.
    "caption": 9, "kicker": 8, "footer": 9,
}

SHEET_TYPE = {"body": 11, "head": 11, "title": 14, "note": 9}

# Slide geometry for the 13.333 x 7.5 in canvas, in inches. Derived on the
# 4 pt atom: 960 x 540 pt, 48 pt outer margin, a 12 column grid at a 24 pt
# gutter. 540 is not divisible by 8, which is why the atom is 4 and not 8.
DECK_GEOMETRY = {
    "width": 13.333, "height": 7.5,
    "margin_x": 0.667, "margin_top": 0.667, "margin_bottom": 0.389,
    "title_top": 0.667, "title_height": 0.778,
    "body_top": 1.889, "body_height": 4.944,
    "source_top": 6.833, "gutter": 0.333, "column": 0.694,
    "half": 5.833, "third": 3.778, "two_thirds": 7.889,
}

# A4 at 11 pt with 3.2 cm side margins measures about 75 characters a
# line, which is inside the 60 to 85 band a typeset report sits in. Word's
# own default (2.54 cm, 11 pt) measures 82 and reads untypeset.
DOC_GEOMETRY = {
    "margin_top_cm": 2.5, "margin_bottom_cm": 2.5,
    "margin_left_cm": 3.2, "margin_right_cm": 3.2,
    "line_spacing": 1.27, "line_spacing_arabic": 1.45,
    "space_after_pt": 8, "space_before_heading_pt": 18,
}

# The spacing atom and its permitted steps, in points. Every gap in a
# generated layout comes from this list or it is not on the grid.
SPACING = [4, 8, 12, 16, 24, 32, 48, 64, 96]

# Budgets the writing works to and the lint checks against. A slide that
# breaks these is a slide nobody reads from the back of a room.
LIMITS = {
    "slide_words": 60,          # target
    "slide_words_max": 85,      # split the slide, do not shrink the type
    "slide_bullets": 5,
    "bullet_words": 12,
    "title_words": 10,
    "title_to_body_ratio": 2.0,
    "doc_paragraph_words": 120,
    "doc_chars_per_line": (60, 85),
    "deck_chars_per_line": (40, 65),
    "deck_font_sizes": 6,       # distinct sizes across one deck
    "doc_font_sizes": 7,
    "font_families": 2,         # plus one mono
    "chart_series": 8,
    "conditional_formats_per_sheet": 2,
}

_ARABIC_RANGE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFEFF]")


def is_arabic(text: str) -> bool:
    """True when a string is mostly Arabic.

    Line height, italics and justification all follow the script, not the
    document, because one deck routinely carries both.
    """
    if not text:
        return False
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    arabic = sum(1 for c in letters if _ARABIC_RANGE.match(c))
    return arabic * 2 >= len(letters)


def line_spacing_for(text: str, *, latin: float = 1.20,
                     arabic: float = 1.45) -> float:
    """Arabic body sits on about 1.45, Latin body on about 1.25.

    Arabic ascenders and descenders need more room than Latin, but the
    1.7 that undotted, tashkeel-heavy text wants reads as a hole in
    ordinary business Arabic. Display sizes want less again, which is why
    the caller passes a tighter pair for a title.
    """
    return arabic if is_arabic(text) else latin


# How a table is ruled. "grid" rules every column and row in a quiet grey,
# which is what most readers of a business document expect and ask for.
# "rules" is the booktabs convention: three horizontal rules, nothing
# vertical. Both keep the header band and the banding.
TABLE_STYLES = ("grid", "rules")


@dataclass
class Theme:
    name: str
    palette: Palette
    fonts: dict
    table_style: str = "grid"
    deck: dict = field(default_factory=lambda: dict(DECK_TYPE))
    doc: dict = field(default_factory=lambda: dict(DOC_TYPE))
    sheet: dict = field(default_factory=lambda: dict(SHEET_TYPE))
    geometry: dict = field(default_factory=lambda: dict(DECK_GEOMETRY))
    page: dict = field(default_factory=lambda: dict(DOC_GEOMETRY))

    # Convenience so callers read theme.color("ink") instead of reaching
    # into the dataclass from four different scripts.
    def color(self, key: str) -> str:
        return getattr(self.palette, key)

    def as_dict(self) -> dict:
        return {
            "name": self.name, "palette": self.palette.__dict__,
            "table_style": self.table_style,
            "fonts": self.fonts, "deck_type": self.deck, "doc_type": self.doc,
            "sheet_type": self.sheet, "geometry": self.geometry,
            "page": self.page, "limits": LIMITS,
        }


THEMES = {"editorial": _EDITORIAL, "slate": _SLATE, "mono": _MONO}

# Face candidates, most wanted first. Aptos is deliberately absent: Office's
# post-2023 default has no metric-compatible substitute in headless
# renderers, so a fit check against it is wrong in both directions.
_LATIN_TEXT = ["Source Serif 4", "Charter", "Cambria", "Century Schoolbook",
               "Georgia", "Times New Roman"]
_LATIN_SANS = ["IBM Plex Sans", "Inter", "Source Sans 3", "Calibri", "Arial"]
_MONO_FACES = ["JetBrains Mono", "IBM Plex Mono", "DejaVu Sans Mono",
               "Consolas", "Courier New"]
# IBM Plex Sans Arabic first: it was drawn alongside a Latin companion, so a
# bilingual paragraph keeps one color instead of two. Cairo stays next in
# line for anything that wants a more geometric display face.
_ARABIC = ["IBM Plex Sans Arabic", "Cairo", "Tajawal", "Noto Sans Arabic"]

_font_cache: dict[str, bool] = {}


def _installed_families() -> set[str]:
    """Family names fontconfig knows about, lowercased. Empty elsewhere."""
    key = "__families__"
    if key in _font_cache:
        return _font_cache[key]  # type: ignore[return-value]
    families: set[str] = set()
    exe = shutil.which("fc-list")
    if exe:
        try:
            out = subprocess.run([exe, ":", "family"], capture_output=True,
                                 text=True, timeout=15).stdout
            for line in out.splitlines():
                for name in line.split(","):
                    families.add(name.strip().lower())
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        for root in (Path("C:/Windows/Fonts"), Path.home() / "Library/Fonts",
                     Path("/Library/Fonts"), Path("/System/Library/Fonts")):
            if root.is_dir():
                for f in root.glob("*.*"):
                    families.add(f.stem.replace("-", " ").lower())
    _font_cache[key] = families  # type: ignore[assignment]
    return families


def resolve_font(candidates, fallback: str | None = None) -> str:
    """First installed family from candidates, else the last candidate.

    Word and PowerPoint embed only a family NAME, so a name the reader's
    machine does not have is silently substituted by something we did not
    choose. Resolving here at least means the file names a face that
    exists on the machine that built it.
    """
    families = _installed_families()
    for name in candidates:
        if name.lower() in families:
            return name
    return fallback or candidates[-1]


def load_theme(name: str | None = None, accent: str | None = None,
               fonts: dict | None = None, table_style: str | None = None) -> Theme:
    """Build a theme. ``HERMES_HOUSE_THEME``/``HERMES_HOUSE_ACCENT`` win
    when the caller passes nothing, so a user can set the house look once
    for every deliverable the desk produces."""
    name = name or os.environ.get("HERMES_HOUSE_THEME") or "editorial"
    accent = accent or os.environ.get("HERMES_HOUSE_ACCENT") or None
    base = THEMES.get(str(name).lower())
    if base is None:
        raise ValueError(f"unknown theme {name!r}; have {sorted(THEMES)}")
    palette = derive_accent(base, accent) if accent else Palette(**base.__dict__)
    resolved = {
        "heading": resolve_font(_LATIN_SANS),
        "body": resolve_font(_LATIN_SANS),
        "serif": resolve_font(_LATIN_TEXT),
        "mono": resolve_font(_MONO_FACES),
        "arabic": resolve_font(_ARABIC),
    }
    if fonts:
        resolved.update({k: v for k, v in fonts.items() if v})
    style = (table_style or os.environ.get("HERMES_HOUSE_TABLE")
             or "grid").lower()
    if style not in TABLE_STYLES:
        raise ValueError(f"unknown table style {style!r}; "
                         f"have {list(TABLE_STYLES)}")
    return Theme(name=str(name).lower(), palette=palette, fonts=resolved,
                 table_style=style)


def theme_from_spec(spec: dict | None) -> Theme | None:
    """Read a ``theme`` key out of a JSON document spec.

    ``false`` opts out entirely and returns None; a string names a preset;
    an object takes ``name``, ``accent`` and ``fonts``.
    """
    if spec is None:
        return load_theme()
    value = spec.get("theme", True)
    if value is False:
        return None
    if value is True or value is None:
        return load_theme()
    if isinstance(value, str):
        return load_theme(value)
    if isinstance(value, dict):
        return load_theme(value.get("name"), value.get("accent"),
                          value.get("fonts"), value.get("table_style"))
    raise ValueError('"theme" must be false, a preset name, or an object')


# ---------------------------------------------------------------------------
# python-docx
# ---------------------------------------------------------------------------


def _docx_style(doc, name):
    try:
        return doc.styles[name]
    except KeyError:
        return None


def theme_docx(doc, theme: Theme | None = None, *, set_page: bool = True) -> dict:
    """Type-set a python-docx Document to the house system.

    Sets the named styles rather than the runs, so text added afterwards
    still lands in the system; direct run formatting from the spec keeps
    winning, which is the point.
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
    from docx.shared import Cm, Pt, RGBColor

    theme = theme or load_theme()
    p, t = theme.palette, theme.doc
    ink = RGBColor.from_string(p.ink)
    muted = RGBColor.from_string(p.muted)
    touched = {"styles": 0, "tables": 0, "arabic_paragraphs": 0}
    # Leading follows the script of the document, not the locale of the
    # machine: 1.27 sets Latin, 1.7 keeps Arabic descenders off the line
    # below.
    sample = "\n".join(par.text for par in doc.paragraphs[:80])
    body_spacing = (theme.page["line_spacing_arabic"] if is_arabic(sample)
                    else theme.page["line_spacing"])

    def clear_paragraph_border(style):
        """Drop the rule the stock Title and Heading styles carry.

        Word's own template underlines the title with a blue rule, which
        is both the Office accent and the "accent line under a title"
        anti-pattern. Whitespace separates a heading here.
        """
        from docx.oxml.ns import qn

        pr = style.element.find(qn("w:pPr"))
        if pr is None:
            return
        borders = pr.find(qn("w:pBdr"))
        if borders is not None:
            pr.remove(borders)

    def set_style(name, size, *, color=ink, bold=False, italic=False,
                  space_before=0, space_after=None, font=None,
                  keep_with_next=False, spacing=None):
        style = _docx_style(doc, name)
        if style is None:
            return
        style.font.name = font or theme.fonts["body"]
        style.font.size = Pt(size)
        style.font.bold = bold
        style.font.italic = italic
        style.font.color.rgb = color
        fmt = style.paragraph_format
        fmt.space_before = Pt(space_before)
        fmt.space_after = Pt(theme.page["space_after_pt"] if space_after is None
                             else space_after)
        fmt.line_spacing = spacing or body_spacing
        fmt.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        fmt.keep_with_next = keep_with_next
        clear_paragraph_border(style)
        touched["styles"] += 1

    head = theme.fonts["heading"]
    set_style("Normal", t["body"])
    set_style("Body Text", t["body"])
    set_style("Title", t["title"], bold=True, font=head, space_after=10,
              spacing=1.1)
    set_style("Subtitle", t["lead"], color=muted, font=head, space_after=18,
              spacing=1.2)
    set_style("Heading 1", t["h1"], bold=True, font=head, spacing=1.15,
              space_before=theme.page["space_before_heading_pt"], space_after=6,
              keep_with_next=True)
    set_style("Heading 2", t["h2"], bold=True, font=head, spacing=1.2,
              space_before=14, space_after=5, keep_with_next=True)
    set_style("Heading 3", t["h3"], bold=True, font=head,
              spacing=1.25, space_before=12, space_after=4, keep_with_next=True)
    set_style("Heading 4", t["h4"], bold=True, font=head, color=muted,
              spacing=1.25, space_before=10, space_after=3, keep_with_next=True)
    set_style("Caption", t["caption"], color=muted, italic=False, space_after=12)
    set_style("Quote", t["quote"], color=muted, italic=True, space_before=6,
              space_after=10, font=theme.fonts["serif"])
    for bullet in ("List Bullet", "List Number", "List Bullet 2",
                   "List Number 2"):
        set_style(bullet, t["body"], space_after=4)

    if set_page:
        for section in doc.sections:
            section.top_margin = Cm(theme.page["margin_top_cm"])
            section.bottom_margin = Cm(theme.page["margin_bottom_cm"])
            section.left_margin = Cm(theme.page["margin_left_cm"])
            section.right_margin = Cm(theme.page["margin_right_cm"])

    for table in doc.tables:
        _docx_table(table, theme)
        touched["tables"] += 1

    for para in doc.paragraphs:
        para.paragraph_format.widow_control = True
        text = para.text
        if not is_arabic(text):
            continue
        touched["arabic_paragraphs"] += 1
        para.paragraph_format.line_spacing = theme.page["line_spacing_arabic"]
        # Arabic has no italic tradition and justification without kashida
        # opens rivers of white down the column. Weight carries emphasis.
        if para.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY:
            para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        for run in para.runs:
            if run.font.italic:
                run.font.italic = False
                run.font.bold = True
    return touched


def _docx_borders(element, edges: dict):
    """Write w:tcBorders / w:tblBorders. python-docx has no border API."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    pr = element
    tag = "w:tcBorders" if pr.tag.endswith("tcPr") else "w:tblBorders"
    borders = pr.find(qn(tag))
    if borders is None:
        borders = OxmlElement(tag)
        pr.append(borders)
    for edge, spec in edges.items():
        node = borders.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            borders.append(node)
        for key, value in spec.items():
            node.set(qn(f"w:{key}"), str(value))


_NUMERIC = re.compile(r"^[\s(]*[-+]?[\d,.\u0660-\u0669]+\s*[%x]?\s*\)?$")


def _docx_shade(cell, hex_color: str):
    """Cell shading. python-docx exposes no fill API, so write w:shd."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    pr = cell._tc.get_or_add_tcPr()
    shd = pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        pr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)


def _docx_table(table, theme: Theme):
    """Three rules, a tinted header, and banding once the table is long.

    Word's "Table Grid" boxes every cell, which reads as a spreadsheet
    pasted into a report. Horizontal rules carry a typeset table, but a
    reader still needs to tell one column from the next: the header tint
    and the first column's weight do that without a single vertical rule,
    and numbers right aligned under a right aligned header make the
    column edge visible by itself.
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    p, t = theme.palette, theme.doc
    tbl_pr = table._tbl.tblPr
    if theme.table_style == "grid":
        # Every column and row ruled, in a grey light enough to sit under
        # the text rather than compete with it. sz is eighths of a point,
        # so 4 is a half point hairline and 8 is a full point.
        hair = {"val": "single", "sz": 4, "color": p.grid}
        _docx_borders(tbl_pr, {
            "top": {"val": "single", "sz": 8, "color": p.grid},
            "bottom": {"val": "single", "sz": 8, "color": p.grid},
            "left": {"val": "single", "sz": 8, "color": p.grid},
            "right": {"val": "single", "sz": 8, "color": p.grid},
            "insideH": hair,
            "insideV": hair,
        })
    else:
        _docx_borders(tbl_pr, {
            "top": {"val": "single", "sz": 8, "color": p.ink},
            "bottom": {"val": "single", "sz": 8, "color": p.ink},
            "left": {"val": "none", "sz": 0, "color": "auto"},
            "right": {"val": "none", "sz": 0, "color": "auto"},
            # Booktabs: three rules and nothing else.
            "insideH": {"val": "none", "sz": 0, "color": "auto"},
            "insideV": {"val": "none", "sz": 0, "color": "auto"},
        })
    rows = table.rows
    banded = len(rows) > 5
    # In an RTL table w:jc "right" means the logical end, so a right
    # aligned number column lands on the left while its Arabic header
    # stays on the right, and the column reads as two columns. Leave an
    # Arabic table on its own start edge.
    arabic_table = is_arabic(" ".join(c.text for r in rows for c in r.cells))
    numeric_cols = set() if arabic_table else _docx_numeric_columns(table)
    for r, row in enumerate(rows):
        header = r == 0
        for c, cell in enumerate(row.cells):
            if header:
                _docx_shade(cell, p.accent_soft)
                _docx_borders(cell._tc.get_or_add_tcPr(), {
                    "bottom": {"val": "single", "sz": 8,
                               "color": p.grid if theme.table_style == "grid"
                               else p.ink}})
            elif banded and r % 2 == 0:
                # The band is a whisper under a ruled grid; two loud
                # separations doing one job is what makes a table shout.
                _docx_shade(cell, p.band if theme.table_style == "grid"
                            else p.surface)
            for para in cell.paragraphs:
                para.paragraph_format.space_before = Pt(4)
                para.paragraph_format.space_after = Pt(4)
                if c in numeric_cols and para.alignment is None:
                    para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                for run in para.runs:
                    if run.font.size is None:
                        run.font.size = Pt(t["table_head"] if header
                                           else t["table"])
                    if run.font.bold is None and (header or c == 0):
                        run.font.bold = True
                    if run.font.color.rgb is None:
                        run.font.color.rgb = RGBColor.from_string(
                            p.accent_text if header else p.ink)


def _docx_numeric_columns(table) -> set:
    """Columns whose body cells are all numbers, percentages or money."""
    if len(table.rows) < 2:
        return set()
    numeric = set()
    for c in range(len(table.columns)):
        values = []
        for row in table.rows[1:]:
            try:
                values.append(row.cells[c].text.strip())
            except IndexError:
                continue
        cells = [v for v in values if v]
        if cells and all(_NUMERIC.match(v) for v in cells):
            numeric.add(c)
    return numeric


# ---------------------------------------------------------------------------
# python-pptx
# ---------------------------------------------------------------------------


def _pptx_set(run, size=None, bold=None, color=None, font=None):
    """Fill in only what the spec left unset."""
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    f = run.font
    if size is not None and f.size is None:
        f.size = Pt(size)
    if bold is not None and f.bold is None:
        f.bold = bold
    if font and f.name is None:
        f.name = font
    if color is not None:
        try:
            unset = f.color.type is None
        except AttributeError:
            unset = True
        if unset:
            f.color.rgb = RGBColor.from_string(color)


def _pptx_runs(text_frame):
    for para in text_frame.paragraphs:
        for run in para.runs:
            yield para, run


def theme_pptx(prs, theme: Theme | None = None, *, background: bool = True,
               layout: bool = True) -> dict:
    """Type-set a built python-pptx Presentation to the house system.

    Runs after the deck is built and before the Arabic pass. Sizes come
    from the deck scale by role: a title placeholder gets the title size,
    body text steps down one level per indent, everything else lands on
    body.
    """
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    theme = theme or load_theme()
    p, t = theme.palette, theme.deck
    counts = {"slides": 0, "runs": 0, "tables": 0, "charts": 0}
    level_sizes = [t["body"], t["body_sm"], t["body_xs"], t["body_xs"]]

    for slide in prs.slides:
        counts["slides"] += 1
        if layout:
            _pptx_layout(slide, prs, theme)
        if background:
            try:
                if slide.background.fill.type is None:
                    slide.background.fill.solid()
                    slide.background.fill.fore_color.rgb = \
                        RGBColor.from_string(p.paper)
            except (AttributeError, ValueError, TypeError):
                pass
        for shape in slide.shapes:
            _pptx_shape(shape, slide, theme, level_sizes, counts)
        if slide.has_notes_slide:
            for _, run in _pptx_runs(slide.notes_slide.notes_text_frame):
                _pptx_set(run, size=t["caption"], color=p.ink,
                          font=theme.fonts["body"])
    return counts


def _pptx_layout(slide, prs, theme: Theme):
    """Put the stock placeholders where the house grid says they go.

    python-pptx builds every deck from a 10 x 7.5 in template, so on a
    16:9 canvas the title and body keep 4:3 coordinates and the slide
    reads as a narrow column adrift in the middle. Only placeholders move
    here; a shape the spec positioned itself is never touched.
    """
    from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
    from pptx.util import Inches, Pt

    g = theme.geometry
    width_in = prs.slide_width / 914400
    height_in = prs.slide_height / 914400
    content_w = width_in - 2 * g["margin_x"]
    cover = is_cover(slide)

    # An Arabic slide reads from the right, so its body column hugs the
    # right margin. Right-aligning the text inside a left-hand box leaves
    # the column stranded in the middle of the slide, which is what the
    # first Arabic decks looked like.
    slide_text = " ".join(sh.text_frame.text for sh in slide.shapes
                          if sh.has_text_frame)
    rtl = is_arabic(slide_text)

    # The first thing the spec placed itself decides how much room the
    # body column has: text that runs under a chart is the single most
    # common defect in a generated deck.
    obstacle = None
    for shape in slide.shapes:
        if shape.is_placeholder or shape.left is None:
            continue
        left_in = shape.left / 914400
        right_in = left_in + (shape.width or 0) / 914400
        if rtl:
            if right_in < width_in - 3.0 and (obstacle is None
                                              or right_in > obstacle):
                obstacle = right_in
        elif left_in > 3.0 and (obstacle is None or left_in < obstacle):
            obstacle = left_in

    # The title decides where the body starts. Fixing the band at one line
    # and hoping is how a two line title ends up printed over the first
    # bullet.
    title_shape = next((sh for sh in slide.shapes
                        if _is_title(sh) and sh.has_text_frame), None)
    title_size = theme.deck["cover_title" if cover else "title"]
    body_top = g["body_top"]
    if title_shape is not None and not cover:
        title_size, lines = fit_title(title_shape.text_frame.text, content_w,
                                      theme.deck,
                                      family=theme.fonts["heading"])
        leading = 1.25 if is_arabic(title_shape.text_frame.text) else 1.12
        title_h = (title_size * leading * lines) / 72 + 0.12
        body_top = max(body_top, g["margin_top"] + title_h + 0.30)

    for shape in slide.shapes:
        if not shape.is_placeholder or not shape.has_text_frame:
            continue
        frame = shape.text_frame
        try:
            frame.auto_size = MSO_AUTO_SIZE.NONE
            frame.word_wrap = True
        except (AttributeError, ValueError):
            pass
        idx = shape.placeholder_format.idx
        is_title = _is_title(shape)
        if is_title:
            shape.left = Inches(g["margin_x"])
            shape.width = Inches(content_w)
            if cover:
                shape.top = Inches(2.4)
                shape.height = Inches(1.7)
            else:
                shape.top = Inches(g["margin_top"])
                shape.height = Inches(body_top - g["margin_top"] - 0.22)
            # Anchored to the top: a two line title grows down into the
            # gap under the title band, not up off the top of the slide.
            frame.vertical_anchor = MSO_ANCHOR.TOP
        elif idx is not None:
            shape.left = Inches(g["margin_x"])
            if cover:
                shape.top = Inches(4.25)
                shape.height = Inches(1.0)
                shape.width = Inches(content_w)
            else:
                shape.top = Inches(body_top)
                shape.height = Inches(height_in - body_top
                                      - g["margin_bottom"])
                # A 60 character measure at 18 pt is 7.5 in. Full width
                # body text on a 16:9 slide runs to 96 characters.
                limit = min(7.5, content_w)
                if obstacle is not None:
                    room = (width_in - g["margin_x"] - obstacle - g["gutter"]
                            if rtl else obstacle - g["margin_x"] - g["gutter"])
                    limit = min(limit, room)
                limit = max(2.5, limit)
                shape.width = Inches(limit)
                if rtl:
                    shape.left = Inches(width_in - g["margin_x"] - limit)
            frame.vertical_anchor = MSO_ANCHOR.TOP
        for para in frame.paragraphs:
            if para.alignment is None and not is_arabic(para.text):
                para.alignment = PP_ALIGN.LEFT
            if is_title:
                for run in para.runs:
                    if run.font.size is None:
                        run.font.size = Pt(title_size)


def _pptx_shape(shape, slide, theme, level_sizes, counts):
    from pptx.util import Pt

    p, t = theme.palette, theme.deck
    if shape.has_table:
        _pptx_table(shape.table, theme)
        counts["tables"] += 1
        return
    if getattr(shape, "has_chart", False):
        _pptx_chart(shape.chart, theme)
        counts["charts"] += 1
        return
    if shape.shape_type is not None and str(shape.shape_type).startswith("GROUP"):
        for child in shape.shapes:
            _pptx_shape(child, slide, theme, level_sizes, counts)
        return
    if not shape.has_text_frame:
        return

    idx = None
    if shape.is_placeholder:
        idx = shape.placeholder_format.idx
    is_title = _is_title(shape)
    # A subtitle is placeholder 1 on a cover, where nothing else on the
    # slide carries text. The same index is the body on a content layout,
    # and the two want very different sizes.
    is_subtitle = idx == 1 and is_cover(slide)
    frame = shape.text_frame
    try:
        frame.word_wrap = True
    except (AttributeError, ValueError):
        pass

    for para, run in _pptx_runs(frame):
        counts["runs"] += 1
        if is_title:
            size = t["cover_title"] if is_cover(slide) else t["title"]
            _pptx_set(run, size=size, bold=True, color=p.ink,
                      font=theme.fonts["heading"])
        elif is_subtitle:
            _pptx_set(run, size=t["cover_subtitle"], color=p.muted,
                      font=theme.fonts["body"])
        else:
            _pptx_set(run, size=level_sizes[min(para.level, len(level_sizes) - 1)],
                      color=p.ink, font=theme.fonts["body"])
        if is_arabic(run.text):
            # Arabic carries emphasis in weight. Italic is a Latin habit
            # and tracking breaks the joins between letters.
            if run.font.italic:
                run.font.italic = False
                run.font.bold = True
        if para.space_after is None:
            para.space_after = Pt(8)
        if para.line_spacing is None:
            para.line_spacing = line_spacing_for(
                para.text,
                latin=1.10 if is_title else 1.25,
                arabic=1.25 if is_title else 1.45)
        if para.alignment is not None and str(para.alignment).startswith("JUSTIFY"):
            para.alignment = None


_COVER_LAYOUTS = ("title slide", "section header", "title only")


# ---------------------------------------------------------------------------
# Measuring text, which is the difference between a fitted slide and a
# clipped one.
# ---------------------------------------------------------------------------

_FONT_FILES: dict[str, str | None] = {}
_FONT_OBJECTS: dict[tuple[str, int], object] = {}
_MEASURE_PT = 100          # measure once at this size, scale the answer


def font_file(family: str) -> str | None:
    """The file fontconfig would hand a renderer for this family.

    Measuring against the real file is the only way to know that a line
    fits. A character count says an Arabic line and a Latin line of the
    same length are the same width, and they are not.
    """
    if family in _FONT_FILES:
        return _FONT_FILES[family]
    path = None
    exe = shutil.which("fc-match")
    if exe:
        try:
            out = subprocess.run([exe, "-f", "%{file}", family],
                                 capture_output=True, text=True, timeout=10)
            candidate = out.stdout.strip()
            # fc-match always answers, with a substitute when it must, so
            # a reply naming a different family is a miss, not a match.
            if candidate and Path(candidate).is_file():
                name = subprocess.run([exe, "-f", "%{family}", family],
                                      capture_output=True, text=True,
                                      timeout=10).stdout.lower()
                if family.lower().split()[0] in name:
                    path = candidate
        except (OSError, subprocess.SubprocessError):
            path = None
    _FONT_FILES[family] = path
    return path


def _measurer(family: str):
    key = (family, _MEASURE_PT)
    if key in _FONT_OBJECTS:
        return _FONT_OBJECTS[key]
    obj = None
    path = font_file(family)
    if path:
        try:
            from PIL import ImageFont  # noqa: PLC0415
            obj = ImageFont.truetype(path, _MEASURE_PT)
        except Exception:  # noqa: BLE001  a measurement is not worth a crash
            obj = None
    _FONT_OBJECTS[key] = obj
    return obj


def text_width_pt(text: str, size_pt: float, family: str | None = None) -> float:
    """Width of a string set in that family at that size, in points.

    Falls back to half the point size per character, the old heuristic,
    when the face cannot be measured. Arabic is shaped when the imaging
    library has raqm, so the answer is the shaped width and not the sum
    of isolated letters.
    """
    if not text:
        return 0.0
    face = _measurer(family) if family else None
    if face is None:
        return 0.5 * size_pt * len(text)
    try:
        return face.getlength(text) * size_pt / _MEASURE_PT
    except Exception:  # noqa: BLE001
        return 0.5 * size_pt * len(text)


def wrap_lines(text: str, width_in: float, size_pt: float,
               family: str | None = None) -> list[str]:
    """Break text the way a renderer would, measuring each candidate line."""
    limit = max(1.0, width_in * 72)
    lines: list[str] = []
    for paragraph in (text or "").splitlines() or [""]:
        current = ""
        for word in paragraph.split():
            candidate = f"{current} {word}".strip()
            if current and text_width_pt(candidate, size_pt, family) > limit:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
    return lines or [""]


def estimate_lines(text: str, width_in: float, size_pt: float,
                   family: str | None = None) -> int:
    """How many lines this text takes in a box of that width.

    Measured against the real face when one is installed, which is what
    makes the answer trustworthy for Arabic as well as Latin. Without a
    face it falls back to half the point size per character, which is
    good to about five percent for a humanist sans and wrong for
    anything else.
    """
    if not text:
        return 1
    return len(wrap_lines(text, width_in, size_pt, family))


def text_height_in(text: str, width_in: float, size_pt: float,
                   leading: float = 1.25, family: str | None = None) -> float:
    """Height the text needs in that column, in inches."""
    lines = estimate_lines(text, width_in, size_pt, family)
    return lines * size_pt * leading / 72


def fit_size(text: str, width_in: float, height_in: float, size_pt: float,
             *, leading: float = 1.25, family: str | None = None,
             floor_factor: float = 0.7, step: float = 0.93) -> float:
    """Shrink type until it fits the box, down to a floor.

    Resolved here rather than left to PowerPoint's own shrink on
    overflow, because that recomputes its own scale factor at open time
    and the file then renders differently from the one that was checked.
    """
    size = float(size_pt)
    floor = size_pt * floor_factor
    while size > floor:
        if text_height_in(text, width_in, size, leading, family) <= height_in:
            return round(size, 1)
        size *= step
    return round(max(size, floor), 1)


def fill_factor(text: str, width_in: float, height_in: float, size_pt: float,
                *, leading: float = 1.25, family: str | None = None,
                target: float = 0.92, ceiling: float = 1.35) -> float:
    """How much to grow sparse content so a big frame is not mostly air.

    Binary search on the scale factor, the same idea as shrinking, in
    the other direction. Capped, because a two word bullet blown up to
    fill a slide is its own kind of wrong.
    """
    if not text or height_in <= 0:
        return 1.0
    low, high = 1.0, ceiling
    for _ in range(18):
        mid = (low + high) / 2
        used = text_height_in(text, width_in, size_pt * mid, leading, family)
        if used <= height_in * target:
            low = mid
        else:
            high = mid
    return round(low, 3)


def paginate_items(items: list, width_in: float, height_in: float,
                   size_pt: float, *, leading: float = 1.35,
                   family: str | None = None, gap_pt: float = 8,
                   min_per_page: int = 2) -> list[list]:
    """Split a list of paragraphs into pages that actually fit.

    A builder that returns one slide per section is a builder that
    clips. Returning pages lets the caller emit a continuation slide,
    which is what a person would do with the same content.
    """
    pages: list[list] = []
    current: list = []
    used = 0.0
    for item in items:
        text = item if isinstance(item, str) else str(item.get("text", ""))
        need = text_height_in(text, width_in, size_pt, leading, family) \
            + gap_pt / 72
        if current and used + need > height_in and len(current) >= min_per_page:
            pages.append(current)
            current, used = [], 0.0
        current.append(item)
        used += need
    if current:
        pages.append(current)
    return pages or [[]]


def fit_title(text: str, width_in: float, scale: dict, *,
              max_lines: int = 2, family: str | None = None):
    """Step a title down the scale until it fits in max_lines.

    A 42 pt title is right for eight words and wrong for twenty. Rather
    than let it overflow into the body, take the next size down, which is
    still a title and still twice the body.
    """
    for size in (scale["title"], scale["section"], scale["lead"]):
        lines = estimate_lines(text, width_in, size, family)
        if lines <= max_lines:
            return size, lines
    size = scale["lead"]
    return size, estimate_lines(text, width_in, size, family)


def _is_title(shape) -> bool:
    """Identity against ``slide.shapes.title`` does not work.

    python-pptx builds a fresh proxy object for every placeholder lookup,
    so ``shape is slide.shapes.title`` is False for the shape that IS the
    title, and the title quietly took body sizing. Compare the
    placeholder index instead.
    """
    if not shape.is_placeholder:
        return False
    return shape.placeholder_format.idx == 0


def is_cover(slide) -> bool:
    """True on a cover or a section divider, where the title is the slide.

    Read from the layout rather than guessed from the shape count: a
    content slide with a chart also carries exactly two text frames, and
    guessing gave it a 56 pt title.
    """
    name = (slide.slide_layout.name or "").strip().lower()
    return name in _COVER_LAYOUTS[:2]


def _pptx_cell_borders(cell, hex_color, width_pt=0.75):
    """Rule a table cell on all four sides.

    python-pptx exposes no border API, so the line elements go in by
    hand. They must sit in schema order inside a:tcPr, which is why each
    one is inserted at the front in reverse: lnL, lnR, lnT, lnB.
    """
    from pptx.oxml.ns import qn
    from pptx.util import Pt

    tc_pr = cell._tc.get_or_add_tcPr()
    for tag in ("a:lnB", "a:lnT", "a:lnR", "a:lnL"):
        existing = tc_pr.find(qn(tag))
        if existing is not None:
            tc_pr.remove(existing)
        line = tc_pr.makeelement(qn(tag), {"w": str(Pt(width_pt)),
                                           "cap": "flat", "cmpd": "sng",
                                           "algn": "ctr"})
        fill = tc_pr.makeelement(qn("a:solidFill"), {})
        color = tc_pr.makeelement(qn("a:srgbClr"), {"val": hex_color})
        fill.append(color)
        line.append(fill)
        tc_pr.insert(0, line)


def _pptx_cell_fill(cell, hex_color):
    from pptx.dml.color import RGBColor
    cell.fill.solid()
    cell.fill.fore_color.rgb = RGBColor.from_string(hex_color)


def _pptx_table(table, theme: Theme):
    """A header band in the accent, banded rows, no boxed grid.

    On a slide a table is read from three metres, so the header has to
    separate itself by weight and color rather than by a hairline. The
    band carries paper-colored text; the rows alternate paper and surface
    so the eye tracks across a row without a vertical rule to help it.
    """
    from pptx.util import Pt

    p, t = theme.palette, theme.deck
    head_text = readable_on(p.accent, p.paper, p.ink)
    arabic_table = is_arabic(" ".join(c.text for r in table.rows
                                      for c in r.cells))
    numeric = set() if arabic_table else _pptx_numeric_columns(table)
    for r, row in enumerate(table.rows):
        header = r == 0
        for c, cell in enumerate(row.cells):
            if header:
                _pptx_cell_fill(cell, p.accent)
            elif theme.table_style == "grid":
                _pptx_cell_fill(cell, p.paper if r % 2 else p.band)
            else:
                _pptx_cell_fill(cell, p.paper if r % 2 else p.surface)
            if theme.table_style == "grid":
                _pptx_cell_borders(cell, p.grid)
            cell.margin_left = cell.margin_right = Pt(12)
            cell.margin_top = cell.margin_bottom = Pt(7)
            for para, run in _pptx_runs(cell.text_frame):
                _pptx_set(run,
                          size=t["table_head"] if header else t["table"],
                          bold=True if header or c == 0 else None,
                          color=head_text if header else p.ink,
                          font=theme.fonts["body"])
                if para.line_spacing is None:
                    para.line_spacing = line_spacing_for(para.text, latin=1.15,
                                                         arabic=1.35)
                if c in numeric and para.alignment is None:
                    from pptx.enum.text import PP_ALIGN
                    para.alignment = PP_ALIGN.RIGHT


def _pptx_numeric_columns(table) -> set:
    """Columns whose body cells are all numbers. Same rule as the docx
    pass: a right aligned number column shows its own edge, which is what
    a vertical rule was being asked to do."""
    rows = list(table.rows)
    if len(rows) < 2:
        return set()
    numeric = set()
    for c in range(len(rows[0].cells)):
        values = [r.cells[c].text.strip() for r in rows[1:]]
        cells = [v for v in values if v]
        if cells and all(_NUMERIC.match(v) for v in cells):
            numeric.add(c)
    return numeric


def _pptx_chart(chart, theme: Theme):
    """Strip the chart junk and put the palette on the series.

    python-pptx charts arrive with the Office palette, a legend the eye
    has to travel to, and gridlines heavier than the data. A single
    series needs no legend at all; its name is already the title.
    """
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    p, t = theme.palette, theme.deck
    series = list(chart.plots[0].series) if chart.plots else []
    try:
        chart.font.size = Pt(t["chart"])
        chart.font.color.rgb = RGBColor.from_string(p.muted)
        chart.font.name = theme.fonts["body"]
    except (AttributeError, ValueError):
        pass

    multi = len(series) > 1
    chart.has_legend = multi
    if multi:
        from pptx.enum.chart import XL_LEGEND_POSITION
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False

    is_pie = "PIE" in str(chart.chart_type) or "DOUGHNUT" in str(chart.chart_type)
    for i, s in enumerate(series):
        color = p.series[i % len(p.series)]
        if is_pie:
            for j, point in enumerate(s.points):
                point.format.fill.solid()
                point.format.fill.fore_color.rgb = RGBColor.from_string(
                    p.series[j % len(p.series)])
        else:
            try:
                s.format.fill.solid()
                s.format.fill.fore_color.rgb = RGBColor.from_string(color)
                s.format.line.color.rgb = RGBColor.from_string(color)
            except (AttributeError, ValueError, TypeError):
                pass

    for axis in _chart_axes(chart):
        try:
            axis.has_major_gridlines = False
            axis.format.line.color.rgb = RGBColor.from_string(p.line)
            axis.tick_labels.font.size = Pt(t["chart"])
            axis.tick_labels.font.color.rgb = RGBColor.from_string(p.muted)
        except (AttributeError, ValueError, TypeError):
            pass
    # A bar chart with its numbers on the bars needs no value axis at all.
    kind = str(chart.chart_type)
    if not is_pie and ("COLUMN" in kind or "BAR" in kind):
        try:
            plot = chart.plots[0]
            # Leave air between the bars: a bar wider than about a third of
            # its band reads as a block, not a measurement.
            plot.gap_width = max(plot.gap_width or 0, 150)
            plot.has_data_labels = True
            plot.data_labels.font.size = Pt(t["chart"])
            plot.data_labels.font.color.rgb = RGBColor.from_string(p.muted)
            chart.value_axis.has_major_gridlines = False
            chart.value_axis.visible = False
        except (AttributeError, ValueError, TypeError):
            pass
    if chart.has_title:
        try:
            for run in chart.chart_title.text_frame.paragraphs[0].runs:
                _pptx_set(run, size=t["body_sm"], bold=True, color=p.ink,
                          font=theme.fonts["heading"])
        except (AttributeError, ValueError, IndexError):
            pass


def _chart_axes(chart):
    for name in ("category_axis", "value_axis"):
        try:
            yield getattr(chart, name)
        except (AttributeError, ValueError, TypeError):
            continue


# ---------------------------------------------------------------------------
# openpyxl
# ---------------------------------------------------------------------------


def theme_xlsx(wb, theme: Theme | None = None, *, header_rows: int = 1,
               zebra_from: int = 20) -> dict:
    """Quiet a workbook down: no gridline noise, one header treatment.

    A designed sheet carries its structure in the type and in two rules,
    not in Excel's grey grid behind every empty cell. Borders appear only
    where they separate structural regions, which is why nothing here
    draws a line between body rows until the sheet is long enough that
    the eye needs help tracking across it.
    """
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    theme = theme or load_theme()
    p, t = theme.palette, theme.sheet
    body_font = theme.fonts["body"]
    head_rule = Side(style="thin", color=f"FF{p.ink}")
    head_fill = PatternFill("solid", fgColor=f"FF{p.accent_soft}")
    zebra = PatternFill("solid", fgColor=f"FF{p.band}")
    hair = Side(style="thin", color=f"FF{p.grid}")
    grid_border = Border(left=hair, right=hair, top=hair, bottom=hair)
    grid = theme.table_style == "grid"
    counts = {"sheets": 0, "header_cells": 0, "cells": 0, "rtl_sheets": 0}

    for ws in wb.worksheets:
        counts["sheets"] += 1
        ws.sheet_view.showGridLines = False
        arabic_hits = 0
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                counts["cells"] += 1
                if isinstance(cell.value, str) and is_arabic(cell.value):
                    arabic_hits += 1
                header = bool(header_rows) and cell.row <= header_rows
                current = cell.font
                # openpyxl hands back a fully populated default Font, so
                # "unset" here means "still the default", not None. A size
                # or a color the spec chose is kept, header row included.
                chosen_size = (current.size
                               if current.size not in (None, _XLSX_DEFAULT_PT)
                               else (t["head"] if header else t["body"]))
                cell.font = Font(
                    name=body_font,
                    size=chosen_size,
                    bold=True if header else current.bold,
                    italic=False if is_arabic(str(cell.value)) else current.italic,
                    color=current.color or f"FF{p.ink}",
                )
                if header:
                    counts["header_cells"] += 1
                    # A border the spec drew is a decision. Only an
                    # untouched header row gets the house rule.
                    if not _xlsx_has_border(cell):
                        cell.border = (Border(left=hair, right=hair, top=hair,
                                              bottom=head_rule) if grid
                                       else Border(bottom=head_rule))
                    if cell.fill.fgColor.rgb in (None, "00000000"):
                        cell.fill = head_fill
                    cell.alignment = Alignment(
                        horizontal=cell.alignment.horizontal or "left",
                        vertical="center", wrap_text=True)
                else:
                    if grid and not _xlsx_has_border(cell):
                        cell.border = grid_border
                    if (zebra_from and ws.max_row >= zebra_from
                            and cell.row % 2 == 0
                            and cell.fill.fgColor.rgb in (None, "00000000")):
                        cell.fill = zebra
        if header_rows and ws.freeze_panes is None and ws.max_row > header_rows:
            ws.freeze_panes = ws.cell(row=header_rows + 1, column=1).coordinate
        # An Arabic sheet reads from the right, column A included. This is
        # a view flag, not an alignment hack, so formulas are untouched.
        if arabic_hits and arabic_hits * 3 >= counts["cells"]:
            ws.sheet_view.rightToLeft = True
            counts["rtl_sheets"] += 1
    return counts


# openpyxl's own default point size. Anything else in a cell was chosen.
_XLSX_DEFAULT_PT = 11.0

def _xlsx_has_border(cell) -> bool:
    border = cell.border
    return any(getattr(getattr(border, side, None), "style", None)
               for side in ("left", "right", "top", "bottom"))


NUMBER_FORMATS = {
    # Negatives in parentheses, zeros as a dash, the unit named once in the
    # column header. This is the convention a finance reader expects and
    # the reason a default-formatted sheet reads as a data dump.
    "currency": '#,##0;(#,##0);"-"',
    "currency_cents": '#,##0.00;(#,##0.00);"-"',
    "count": '#,##0;(#,##0);"-"',
    "percent": '0.0%;(0.0%);"-"',
    "multiple": '0.0"x"',
    "thousands": '#,##0,;(#,##0,);"-"',
    "date": "dd-mmm-yy",
}


# ---------------------------------------------------------------------------
# reportlab
# ---------------------------------------------------------------------------


def pdf_styles(theme: Theme | None = None, *, arabic_font: str | None = None):
    """A reportlab stylesheet and table style in the house system.

    Returns ``(styles, table_style_factory)``. The factory takes a row
    count so the header rule and the body hairlines land on real rows.
    """
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.platypus import TableStyle

    theme = theme or load_theme()
    p, t = theme.palette, theme.doc
    ink = colors.HexColor(f"#{p.ink}")
    muted = colors.HexColor(f"#{p.muted}")
    line = colors.HexColor(f"#{p.line}")
    accent = colors.HexColor(f"#{p.accent_text}")
    body_face = arabic_font or "Helvetica"
    bold_face = arabic_font or "Helvetica-Bold"

    styles = getSampleStyleSheet()

    def style(name, size, *, leading_ratio=1.35, color=ink, face=body_face,
              space_before=0, space_after=8, **kw):
        s = ParagraphStyle(name, fontName=face, fontSize=size,
                           leading=round(size * leading_ratio, 1),
                           textColor=color, spaceBefore=space_before,
                           spaceAfter=space_after, alignment=TA_LEFT, **kw)
        if name in styles:
            styles[name].__dict__.update(s.__dict__)
        else:
            styles.add(s)
        return styles[name]

    style("Normal", t["body"])
    style("BodyText", t["body"])
    style("Title", t["title"], face=bold_face, leading_ratio=1.15,
          space_after=14)
    style("Heading1", t["h1"], face=bold_face, leading_ratio=1.2,
          space_before=16, space_after=6)
    style("Heading2", t["h2"], face=bold_face, leading_ratio=1.25,
          space_before=14, space_after=5)
    style("Heading3", t["h3"], face=bold_face, color=accent,
          leading_ratio=1.3, space_before=12, space_after=4)
    style("Caption", t["caption"], color=muted, space_after=12)

    def table_style(rows: int) -> TableStyle:
        cmds = [
            ("FONTNAME", (0, 0), (-1, -1), body_face),
            ("FONTNAME", (0, 0), (-1, 0), bold_face),
            ("FONTSIZE", (0, 0), (-1, -1), t["table"]),
            ("TEXTCOLOR", (0, 0), (-1, -1), ink),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(f"#{p.surface}")),
            ("LINEABOVE", (0, 0), (-1, 0), 0.9, ink),
            ("LINEBELOW", (0, 0), (-1, 0), 0.9, ink),
            ("LINEBELOW", (0, -1), (-1, -1), 0.9, ink),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]
        if rows > 2:
            cmds.append(("LINEBELOW", (0, 1), (-1, -2), 0.4, line))
        return TableStyle(cmds)

    return styles, table_style


# ---------------------------------------------------------------------------
# CLI: inspect the system without opening Python.
# ---------------------------------------------------------------------------


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description="Print the house design system as JSON.")
    parser.add_argument("--theme", default=None, help="editorial | slate | mono")
    parser.add_argument("--accent", default=None, help="brand hue, RRGGBB")
    parser.add_argument("--check-contrast", action="store_true",
                        help="report the contrast ratios that matter")
    args = parser.parse_args(argv)

    theme = load_theme(args.theme, args.accent)
    out = theme.as_dict()
    if args.check_contrast:
        p = theme.palette
        pairs = {
            "ink_on_paper": (p.ink, p.paper),
            "muted_on_paper": (p.muted, p.paper),
            "ink_on_surface": (p.ink, p.surface),
            "accent_text_on_paper": (p.accent_text, p.paper),
        }
        out["contrast"] = {k: round(contrast_ratio(*v), 2)
                           for k, v in pairs.items()}
        out["contrast_ok"] = all(v >= 4.5 for v in out["contrast"].values())
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
