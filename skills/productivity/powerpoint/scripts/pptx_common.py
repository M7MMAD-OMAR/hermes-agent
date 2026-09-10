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


def set_paragraph_rtl(para, rtl=True):
    """Flip one paragraph's base direction, and its alignment with it.

    ``a:pPr@rtl`` is what moves the punctuation and the bullet to the right.
    Alignment is set only when the paragraph does not already carry one, so an
    explicit centre or justify in the spec survives the pass.
    """
    p_pr = para._pPr
    if p_pr is None:
        p_pr = para._p.get_or_add_pPr()
    p_pr.set("rtl", "1" if rtl else "0")
    if p_pr.get("algn") in (None, "l", "r"):
        p_pr.set("algn", "r" if rtl else "l")


def apply_rtl(prs, mode="auto"):
    """Set direction across a whole deck.

    ``mode``: ``"auto"`` flips every paragraph that contains RTL letters,
    ``"on"`` flips everything, ``"off"`` leaves the deck as built. Returns
    counts for the caller's report. Idempotent.
    """
    if mode not in ("auto", "on", "off"):
        raise ValueError(f"unknown rtl mode: {mode}")
    counts = {"paragraphs": 0, "cells": 0}
    if mode == "off":
        return counts

    for slide in prs.slides:
        for shape in _iter_shapes(slide.shapes):
            for para in _iter_paragraphs(shape):
                text = "".join(run.text for run in para.runs)
                if mode == "on" or has_rtl_text(text):
                    set_paragraph_rtl(para, True)
                    counts["paragraphs"] += 1
            if getattr(shape, "has_table", False):
                counts["cells"] += _apply_table_rtl(shape.table, mode)
    return counts


def _apply_table_rtl(table, mode):
    flipped = 0
    for row in table.rows:
        for cell in row.cells:
            text = cell.text_frame.text
            if mode == "on" or has_rtl_text(text):
                for para in cell.text_frame.paragraphs:
                    set_paragraph_rtl(para, True)
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
