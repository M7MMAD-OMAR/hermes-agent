#!/usr/bin/env python3
# MIT License. Shared helpers for the docx skill scripts.
"""Shared helpers: paragraph iteration and run-preserving text replacement."""
from __future__ import annotations


def iter_all_paragraphs(doc, include_headers_footers: bool = True):
    """Yield every paragraph in body, tables (recursively), headers, footers."""
    yield from _iter_container(doc)
    if include_headers_footers:
        for section in doc.sections:
            for part in (
                section.header, section.footer,
                section.first_page_header, section.first_page_footer,
                section.even_page_header, section.even_page_footer,
            ):
                if part is not None:
                    yield from _iter_container(part)


def _iter_container(container):
    for para in container.paragraphs:
        yield para
    for table in container.tables:
        yield from _iter_table(table)


def _iter_table(table):
    for row in table.rows:
        for cell in row.cells:
            for para in cell.paragraphs:
                yield para
            for nested in cell.tables:
                yield from _iter_table(nested)


def iter_part_roots(doc):
    """Yield the XML root of the body plus every header/footer part."""
    yield doc.element.body
    seen = set()
    for section in doc.sections:
        for part in (
            section.header, section.footer,
            section.first_page_header, section.first_page_footer,
            section.even_page_header, section.even_page_footer,
        ):
            if part is not None and id(part._element) not in seen:
                seen.add(id(part._element))
                yield part._element


def replace_in_paragraph(para, old: str, new: str) -> int:
    """Replace `old` with `new` in a paragraph, preserving run formatting.

    Strategy: first replace occurrences fully contained in a single run
    (formatting fully preserved). If the needle spans multiple runs, the
    matched runs are collapsed: the replacement inherits the formatting of
    the run where the match starts. Returns number of replacements made.
    """
    if not old or old not in para.text:
        return 0
    count = 0
    # Pass 1: within-run replacements.
    for run in para.runs:
        if old in run.text:
            count += run.text.count(old)
            run.text = run.text.replace(old, new)
    # Pass 2: cross-run occurrences.
    while old in para.text:
        runs = para.runs
        # Map paragraph text offsets to (run_index, offset_in_run).
        full = "".join(r.text for r in runs)
        start = full.find(old)
        if start < 0:
            break
        end = start + len(old)
        pos = 0
        spans = []  # (run_idx, cut_start, cut_end) portions inside the match
        for i, r in enumerate(runs):
            r_start, r_end = pos, pos + len(r.text)
            if r_end > start and r_start < end:
                spans.append((i, max(start, r_start) - r_start,
                              min(end, r_end) - r_start))
            pos = r_end
        first = True
        for i, cs, ce in spans:
            t = runs[i].text
            if first:
                runs[i].text = t[:cs] + new + t[ce:]
                first = False
            else:
                runs[i].text = t[:cs] + t[ce:]
        count += 1
    return count


# ---------------------------------------------------------------------------
# Right-to-left text
# ---------------------------------------------------------------------------

# Arabic, Persian, Urdu and Hebrew letters. Presentation forms are included:
# text copied out of a PDF often arrives pre-shaped.
_RTL_CHARS = (
    "\u0590-\u05ff"    # Hebrew
    "\u0600-\u06ff"    # Arabic
    "\u0750-\u077f"    # Arabic Supplement
    "\u08a0-\u08ff"    # Arabic Extended-A
    "\ufb1d-\ufdff"    # presentation forms A (also Hebrew)
    "\ufe70-\ufeff"    # presentation forms B
)


def has_rtl_text(text: str) -> bool:
    """True when the text contains at least one right-to-left letter."""
    import re
    return bool(re.search(f"[{_RTL_CHARS}]", text or ""))


def set_paragraph_rtl(para, rtl: bool = True) -> None:
    """Make one paragraph right-to-left (or back to left-to-right).

    Two marks are needed, not one. ``w:bidi`` on the paragraph flips the base
    direction, which is what puts the full stop at the END of an Arabic line
    instead of the start and keeps ``(Python)`` brackets facing the right way.
    ``w:rtl`` on each run tells the renderer the run's own script is RTL, so a
    bold Arabic label followed by a Latin value keeps its order. Without both,
    LibreOffice and Word render Arabic as a left-to-right paragraph and every
    punctuation mark lands on the wrong side.
    """
    from docx.oxml.ns import qn
    p_pr = para._p.get_or_add_pPr()
    for old in p_pr.findall(qn("w:bidi")):
        p_pr.remove(old)
    if rtl:
        bidi = p_pr.makeelement(qn("w:bidi"), {})
        # Schema order: bidi sits after jc/numPr etc. python-docx's helper knows
        # the sequence; fall back to append when the element has no successors.
        try:
            p_pr.insert_element_before(bidi, "w:adjustRightInd", "w:snapToGrid",
                                       "w:spacing", "w:ind", "w:contextualSpacing",
                                       "w:mirrorIndents", "w:suppressOverlap", "w:jc",
                                       "w:textDirection", "w:textAlignment",
                                       "w:textboxTightWrap", "w:outlineLvl", "w:divId",
                                       "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange")
        except Exception:
            p_pr.append(bidi)
    mark_runs_by_script(para, base_rtl=rtl)


def mark_runs_by_script(para, base_rtl: bool | None = None) -> int:
    """Give every run the direction its own script needs.

    A paragraph has one base direction, its runs do not. Marking every
    run of an Arabic paragraph w:rtl, which is what a blanket pass does,
    tells the renderer that "IBM 2026" is right to left too, and a Latin
    name or a version number inside an Arabic sentence comes out
    reversed. The opposite case is just as common: an Arabic phrase
    quoted inside an English sentence needs w:rtl on that run alone while
    the paragraph stays left to right.

    ``base_rtl`` is the paragraph's own direction when the caller already
    knows it. Passing None reads it from the paragraph. Returns the
    number of runs marked right to left.
    """
    from docx.oxml.ns import qn

    if base_rtl is None:
        p_pr = para._p.find(qn("w:pPr"))
        base_rtl = (p_pr is not None
                    and p_pr.find(qn("w:bidi")) is not None)
    marked = 0
    for run in para.runs:
        r_pr = run._r.get_or_add_rPr()
        for old in r_pr.findall(qn("w:rtl")):
            r_pr.remove(old)
        text = run.text or ""
        # A run of digits, spaces or punctuation has no script of its
        # own, so it follows the paragraph and gets no mark either way.
        if has_rtl_text(text):
            run_rtl = True
        elif _has_latin_letters(text):
            run_rtl = False
        else:
            run_rtl = bool(base_rtl)
        if run_rtl:
            r_pr.append(r_pr.makeelement(qn("w:rtl"), {}))
            marked += 1
    return marked


def set_table_rtl(table, rtl: bool = True) -> None:
    """Lay a table out right-to-left: first column on the right."""
    from docx.oxml.ns import qn
    tbl_pr = table._tbl.tblPr
    for old in tbl_pr.findall(qn("w:bidiVisual")):
        tbl_pr.remove(old)
    if rtl:
        tbl_pr.append(tbl_pr.makeelement(qn("w:bidiVisual"), {}))


def apply_rtl(doc, mode: str = "auto") -> dict:
    """Set paragraph direction across the whole document.

    ``mode``: ``"auto"`` flips every paragraph that contains RTL letters and
    every table whose text is mostly RTL; ``"on"`` flips everything; ``"off"``
    leaves the document as built. Returns counts for the caller's report.
    Idempotent: running it twice yields the same XML.
    """
    if mode not in ("auto", "on", "off"):
        raise ValueError(f"rtl must be auto, on or off, not {mode!r}")
    if mode == "off":
        return {"paragraphs_rtl": 0, "tables_rtl": 0}
    paragraphs = 0
    mixed = 0
    for para in iter_all_paragraphs(doc):
        if mode == "on" or _mostly_rtl(para.text):
            set_paragraph_rtl(para, True)
            paragraphs += 1
        elif has_rtl_text(para.text):
            # Mostly Latin, but it quotes Arabic. The paragraph keeps its
            # left to right base and only the Arabic runs are marked, so
            # the quote reads correctly inside an English sentence.
            mark_runs_by_script(para, base_rtl=False)
            mixed += 1
    tables = 0
    for table in _iter_all_tables(doc):
        text = " ".join(cell.text for row in table.rows for cell in row.cells)
        if mode == "on" or _mostly_rtl(text):
            set_table_rtl(table, True)
            tables += 1
            # A cell holding only a number or a Latin token has no RTL letter
            # of its own, yet inside an RTL table it must still align with its
            # neighbours; otherwise the version column reads left while the
            # rest of the row reads right.
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        if not has_rtl_text(para.text):
                            set_paragraph_rtl(para, True)
                            paragraphs += 1
    return {"paragraphs_rtl": paragraphs, "tables_rtl": tables,
            "mixed_paragraphs": mixed}


def _iter_all_tables(doc):
    def walk(tables):
        for table in tables:
            yield table
            for row in table.rows:
                for cell in row.cells:
                    yield from walk(cell.tables)
    yield from walk(doc.tables)
    for section in doc.sections:
        for part in (section.header, section.footer):
            if part is not None:
                yield from walk(part.tables)


def _has_latin_letters(text: str) -> bool:
    return any("a" <= c.lower() <= "z" for c in text)


def _mostly_rtl(text: str) -> bool:
    """More RTL letters than Latin ones. Digits and punctuation do not vote."""
    import re
    rtl = len(re.findall(f"[{_RTL_CHARS}]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return rtl > 0 and rtl >= latin
