#!/usr/bin/env python3
"""Shared helpers for the PowerPoint scripts.

Right-to-left decks are the reason this file exists. python-pptx writes every
paragraph left-aligned with a left-to-right base direction, so an Arabic slide
comes out with its punctuation on the wrong side, its bullets on the left, and
its text hugging the left edge of the placeholder. One pass over the deck after
it is built fixes all three, the same way ``docx_common.apply_rtl`` does for
Word.
"""
import re

# Arabic, Persian, Urdu and Hebrew letters, presentation forms included: text
# copied out of a PDF often arrives pre-shaped.
_RTL_CHARS = (
    "֐-׿"    # Hebrew
    "؀-ۿ"    # Arabic
    "ݐ-ݿ"    # Arabic Supplement
    "ࢠ-ࣿ"    # Arabic Extended-A
    "יִ-﷿"    # presentation forms A (also Hebrew)
    "ﹰ-﻿"    # presentation forms B
)

_RTL_RE = re.compile(f"[{_RTL_CHARS}]")
_LATIN_RE = re.compile(r"[A-Za-z]")

# Bullet glyphs a writer sometimes types into the text itself. The layout draws
# its own bullet, so a typed one shows up twice.
_TYPED_BULLETS = "•▪●◦‣⁃·"


def has_rtl_text(text):
    """True when the text contains at least one right-to-left letter."""
    return bool(_RTL_RE.search(text or ""))


def mostly_rtl(text):
    """More RTL letters than Latin ones. Digits and punctuation do not vote."""
    rtl = len(_RTL_RE.findall(text or ""))
    latin = len(_LATIN_RE.findall(text or ""))
    return rtl > 0 and rtl >= latin


def strip_typed_bullet(text):
    """Drop a bullet glyph typed at the start of a bullet's own text.

    The placeholder already draws one, so ``"• Overview"`` renders as
    ``"• • Overview"``. Only a leading glyph followed by a space is
    removed, so a line that genuinely starts with a dash keeps it.
    """
    if not text:
        return text
    stripped = text.lstrip()
    if len(stripped) > 1 and stripped[0] in _TYPED_BULLETS and stripped[1] in " \t ":
        return stripped[1:].lstrip()
    return text


def _has_latin_letters(text):
    return bool(_LATIN_RE.search(text or ""))


def set_paragraph_rtl(para, rtl=True):
    """Flip one paragraph's base direction, and its alignment with it.

    ``a:pPr@rtl`` is what moves the punctuation and the bullet to the right.
    Alignment is set only when the paragraph does not already carry one, so an
    explicit centre or justify in the spec survives the pass.

    The runs are then marked by their own script, because the base direction
    alone is not the whole answer. See ``mark_runs_by_script``.
    """
    p_pr = para._pPr
    if p_pr is None:
        p_pr = para._p.get_or_add_pPr()
    p_pr.set("rtl", "1" if rtl else "0")
    if p_pr.get("algn") in (None, "l", "r"):
        p_pr.set("algn", "r" if rtl else "l")
    mark_runs_by_script(para, base_rtl=rtl)


def mark_runs_by_script(para, base_rtl=None):
    """Give every run the direction its own script needs.

    A paragraph has one base direction, its runs do not. Letting every run
    of an Arabic paragraph read right to left, which is what a blanket pass
    does, tells the renderer that "IBM Plex Sans Arabic" and "2.4.1" are
    right to left too, and a Latin brand or a version number inside an
    Arabic sentence comes out reversed. The opposite case matters as much:
    an Arabic phrase quoted inside an English line needs the mark on that
    run alone while the paragraph keeps its left to right base.

    In presentation markup the mark is the ``rtl`` attribute on ``a:rPr``,
    in the ``a`` namespace. Unlike Word's ``w:rtl``, whose absence means
    false, an absent attribute here means inherit, so a Latin run inside an
    Arabic paragraph picks up ``rtl="1"`` from the paragraph unless it is
    told otherwise. Every case is therefore written down explicitly:
    ``rtl="1"`` for an RTL run, ``rtl="0"`` for a Latin one, and the
    paragraph's own value for a run of digits, spaces or punctuation, which
    has no script of its own and follows its paragraph.

    ``base_rtl`` is the paragraph's direction when the caller already knows
    it. Passing None reads it from the paragraph. Returns the number of runs
    marked right to left.
    """
    if base_rtl is None:
        p_pr = para._pPr
        base_rtl = p_pr is not None and p_pr.get("rtl") == "1"
    marked = 0
    for run in para.runs:
        text = run.text or ""
        if has_rtl_text(text):
            run_rtl = True
        elif _has_latin_letters(text):
            run_rtl = False
        else:
            run_rtl = bool(base_rtl)
        run._r.get_or_add_rPr().set("rtl", "1" if run_rtl else "0")
        if run_rtl:
            marked += 1
    return marked


def apply_rtl(prs, mode="auto"):
    """Set direction across a whole deck.

    ``mode``: ``"auto"`` flips every paragraph whose text is mostly RTL and
    marks the Arabic runs of a mostly Latin paragraph without moving its
    base direction, ``"on"`` flips everything, ``"off"`` leaves the deck as
    built. Covers shapes, groups at any depth, table cells and speaker
    notes. Returns counts for the caller's report. Idempotent: running it
    twice leaves the XML byte identical.
    """
    if mode not in ("auto", "on", "off"):
        raise ValueError(f"unknown rtl mode: {mode}")
    counts = {"paragraphs": 0, "cells": 0, "mixed_paragraphs": 0}
    if mode == "off":
        return counts

    for slide in prs.slides:
        _apply_shapes_rtl(slide.shapes, mode, counts)
        # Notes only when the slide already has a notes part. Asking for one
        # otherwise materialises it, which changes the package on first run.
        if getattr(slide, "has_notes_slide", False):
            _apply_shapes_rtl(slide.notes_slide.shapes, mode, counts)
    return counts


def _apply_shapes_rtl(shapes, mode, counts):
    for shape in _iter_shapes(shapes):
        for para in _iter_paragraphs(shape):
            _apply_paragraph_rtl(para, mode, counts)
        if getattr(shape, "has_table", False):
            counts["cells"] += _apply_table_rtl(shape.table, mode, counts)


def _apply_paragraph_rtl(para, mode, counts):
    """Direction for one paragraph. True when its base direction was flipped."""
    text = "".join(run.text for run in para.runs)
    if mode == "on" or mostly_rtl(text):
        set_paragraph_rtl(para, True)
        counts["paragraphs"] += 1
        return True
    if has_rtl_text(text):
        # Mostly Latin, but it quotes Arabic. The paragraph keeps its left to
        # right base and only the Arabic runs are marked, so the quote reads
        # correctly inside an English sentence. Nothing on a:pPr is touched
        # here, so a centred title keeps the alignment it inherited.
        mark_runs_by_script(para, base_rtl=False)
        counts["mixed_paragraphs"] += 1
    return False


def _apply_table_rtl(table, mode, counts):
    flipped = 0
    for row in table.rows:
        for cell in row.cells:
            cell_flipped = False
            for para in cell.text_frame.paragraphs:
                if _apply_paragraph_rtl(para, mode, counts):
                    cell_flipped = True
            if cell_flipped:
                flipped += 1
    return flipped


def _iter_shapes(shapes):
    """Every shape on a slide, group members included."""
    for shape in shapes:
        yield shape
        if getattr(shape, "shape_type", None) is not None and hasattr(shape, "shapes"):
            yield from _iter_shapes(shape.shapes)


def _iter_paragraphs(shape):
    if getattr(shape, "has_text_frame", False):
        yield from shape.text_frame.paragraphs
