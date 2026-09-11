#!/usr/bin/env python3
"""Read a finished deliverable back and say what gives it away.

Two kinds of finding, and the split is the whole point of the tool:

* **prose** catches the writing that reads as machine-made. Long dashes
  first, because that is the house rule most often broken and the one
  that lands in a file somebody else opens, then the vocabulary and the
  sentence rhythm that a reader feels before they can name.
* **design** catches the layout that reads as a template: stock Office
  fonts and the stock accent, eight type sizes on one slide, a wall of
  words nobody at the back of the room will read, a spreadsheet still
  wearing its grey grid.

Usage:
    python style_lint.py report.docx deck.pptx book.xlsx notes.md
    python style_lint.py deck.pptx --json
    python style_lint.py draft.md --only prose

Exit code is 1 when anything at error level is found, so the check can
gate a delivery. Warnings are budgets: they are worth a look and they do
not fail the run on their own.

A hit is a prompt to look, not a verdict. The word lists generalise badly
across industries, and a good writer can use any word on them well. The
one rule with no exception is the dash.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from house_style import LIMITS, is_arabic, load_theme, luminance  # noqa: E402

# ---------------------------------------------------------------------------
# Prose rules
# ---------------------------------------------------------------------------

# Written as escapes on purpose: this file is itself swept by the rule it
# enforces, and a literal dash here would make the sweep unusable.
LONG_DASHES = {
    "\u2014": "em dash", "\u2013": "en dash", "\u2012": "figure dash",
    "\u2015": "horizontal bar", "\u2e3a": "two-em dash",
    "\u2e3b": "three-em dash",
}

PROSE_PATTERNS = [
    ("llm_lexicon", re.compile(
        r"\b(delve[sd]?|delving|intricate|commendable|meticulous(ly)?|surpass(es|ed)?"
        r"|elevate[sd]?|foster(s|ed|ing)?|tapestry|realm|landscape of|pivotal"
        r"|resonate[sd]?|testament to|underscore[sd]?|showcasing|paramount"
        r"|unwavering)\b", re.I),
     "a word measured to spike in machine-written text"),
    ("corporate_lexicon", re.compile(
        r"\b(world.class|best.in.class|state.of.the.art|cutting.edge|seamless(ly)?"
        r"|holistic|bespoke|leverag(e|es|ing)|utili[sz]e[sd]?|empower(s|ed|ing)?"
        r"|unlock(s|ing)?|harness(es|ing)?|spearhead(s|ing)?)\b", re.I),
     "brochure vocabulary: say the thing instead"),
    ("intention_not_action", re.compile(
        r"\b(aims? to|seeks? to|strives? to|is committed to|are committed to"
        r"|is designed to|works? to)\b", re.I),
     "an intention cannot be checked; write what is done"),
    ("negative_parallelism", re.compile(
        r"\bnot (just|only|merely) [^.,;]{2,60}[,;]? but\b", re.I),
     "a reversal carrying no information"),
    ("stock_opener", re.compile(
        r"(\bIn today'?s [a-z\- ]{0,20}(world|landscape|environment|market|era)\b"
        r"|^\s*(Moreover|Furthermore|Additionally|In conclusion|It'?s worth noting)\b)",
        re.I | re.M),
     "an opener that announces instead of saying"),
    ("manufactured_suspense", re.compile(
        r"(Here'?s what sets .{2,40} apart|The result\?|But here'?s the thing)", re.I),
     "suspense manufactured where there is none"),
    ("pompous_copula", re.compile(
        r"\b(serves as|stands as|plays a (key|vital|pivotal|crucial) role"
        r"|positions itself as)\b", re.I),
     "plain 'is' was fine"),
    ("vague_attribution", re.compile(
        r"\b(industry experts|leading standards|international best practice"
        r"|studies show|research suggests)\b", re.I),
     "name the source or drop the claim"),
    # Arabic: the same faults, in the phrasing they actually arrive in.
    ("arabic_filler", re.compile(
        r"(في عالم اليوم|في ظل التطور|تجدر الإشارة|مما لا شك فيه"
        r"|يسعى إلى|تسعى إلى|نفخر بأن|نحرص على أن|بشكل فعال|بشكل كبير"
        r"|الجدير بالذكر|علاوة على ذلك)"),
     "حشو يقرأ كنص آلة: احذفه أو اكتب الفعل نفسه"),
    ("arabic_calque", re.compile(
        r"(يلعب دورا|تلعب دورا|في نهاية المطاف|من خلال الاستفادة من"
        r"|يعتبر واحدا من|تعتبر واحدة من)"),
     "ترجمة حرفية عن الإنجليزية: أعد صياغتها بالعربية"),
]

# Phrases a checker must not flag, so the fix for machine prose does not
# become its own machine prose. Kept here as documentation of intent.
NOT_A_TELL = (
    "a short page", "a repeated noun", "a sentence fragment",
    "a bare list with no descriptions", "a number with no adjective",
    "plain 'is'",
)

SENTENCE_SPLIT = re.compile(r"(?<=[.!?؟।])\s+|\n{2,}|؛\s*")
TRICOLON = re.compile(r"\b\w+, \w+,? (and|و)\s+\w+\b", re.I)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]


def _words(text: str) -> list[str]:
    return re.findall(r"[\w؀-ۿ']+", text)


def prose_findings(text: str, where: str) -> list[dict]:
    out: list[dict] = []
    for char, name in LONG_DASHES.items():
        count = text.count(char)
        if count:
            sample = next((line.strip() for line in text.splitlines()
                           if char in line), "")
            out.append(_f("error", "long_dash", where,
                          f"{count} x {name}; use a comma, a colon, or two "
                          f"sentences", sample[:120]))
    for rule, pattern, why in PROSE_PATTERNS:
        hits = pattern.findall(text)
        if hits:
            shown = [h if isinstance(h, str) else next((x for x in h if x), "")
                     for h in hits[:4]]
            out.append(_f("warn", rule, where,
                          f"{len(hits)} hit(s): {why}", ", ".join(shown)))

    sentences = _sentences(text)
    lengths = [len(_words(s)) for s in sentences if len(_words(s)) > 1]
    if len(lengths) >= 10:
        spread = statistics.pstdev(lengths)
        if spread < 6.0:
            out.append(_f("warn", "uniform_rhythm", where,
                          f"sentence length spread {spread:.1f} words, under 6: "
                          "put a five word sentence next to a twenty word one"))
    words = len(_words(text))
    tricolons = len(TRICOLON.findall(text))
    if words >= 200 and tricolons / (words / 400) > 1:
        out.append(_f("warn", "tricolon_reflex", where,
                      f"{tricolons} three item lists per {words} words"))
    return out


def sibling_openings(items: list[str], where: str) -> list[dict]:
    """Cards, bullets and list items that all start the same way."""
    starts: dict[str, int] = {}
    for item in items:
        w = _words(item)[:2]
        if len(w) == 2:
            key = " ".join(x.lower() for x in w)
            starts[key] = starts.get(key, 0) + 1
    repeats = {k: v for k, v in starts.items() if v >= 3}
    if repeats:
        worst = max(repeats.items(), key=lambda kv: kv[1])
        return [_f("warn", "repeated_opening", where,
                   f"{worst[1]} items open with \"{worst[0]}\"")]
    return []


def _f(level, rule, where, detail, sample=""):
    finding = {"level": level, "rule": rule, "where": where, "detail": detail}
    if sample:
        finding["sample"] = sample
    return finding


# ---------------------------------------------------------------------------
# Per format readers. Each returns (text, findings).
# ---------------------------------------------------------------------------

STOCK_FONTS = {"calibri", "calibri light", "aptos", "aptos display",
               "times new roman"}
STOCK_ACCENTS = {"4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"}


def read_text_file(path: Path):
    return path.read_text(encoding="utf-8", errors="replace"), []


def _docx_loud_rules(table) -> bool:
    """A ruled table is fine. A table ruled in near black is not.

    The house grid is a light grey hairline, which a reader takes as
    structure. Word's own "Table Grid" rules every cell in the automatic
    color, which lands close to black and is what makes a pasted table
    shout across a page. So this reads the color and the weight rather
    than asking whether rules exist at all.
    """
    from docx.oxml.ns import qn

    borders = table._tbl.tblPr.find(qn("w:tblBorders"))
    if borders is None:
        style = getattr(table.style, "name", "") or ""
        return "grid" in style.lower()
    for edge in ("insideV", "insideH", "left", "right", "top", "bottom"):
        node = borders.find(qn(f"w:{edge}"))
        if node is None or node.get(qn("w:val")) in (None, "none", "nil"):
            continue
        color = (node.get(qn("w:color")) or "auto").lstrip("#")
        if color.lower() == "auto":
            return True
        try:
            if luminance(color) < 0.45:
                return True
        except ValueError:
            return True
        if int(node.get(qn("w:sz")) or 0) > 12:
            return True
    return False


def read_docx(path: Path):
    from docx import Document
    from docx.shared import Pt

    doc = Document(str(path))
    chunks, findings, sizes, fonts = [], [], set(), set()
    for para in doc.paragraphs:
        chunks.append(para.text)
        words = len(_words(para.text))
        if words > LIMITS["doc_paragraph_words"]:
            findings.append(_f("warn", "long_paragraph", _where(path),
                               f"a paragraph of {words} words; split it"))
        for run in para.runs:
            if run.font.size:
                sizes.add(round(run.font.size.pt, 1))
            if run.font.name:
                fonts.add(run.font.name.lower())
    for style_name in ("Normal", "Heading 1", "Heading 2", "Body Text"):
        try:
            style = doc.styles[style_name]
        except KeyError:
            continue
        if style.font.name:
            fonts.add(style.font.name.lower())
        if style.font.size:
            sizes.add(round(style.font.size.pt, 1))
    for table in doc.tables:
        if _docx_loud_rules(table):
            findings.append(_f("warn", "loud_table_rules", _where(path),
                               "table ruled in near black; the house grid is a "
                               "light grey hairline that sits under the text"))
            break
        for row in table.rows:
            for cell in row.cells:
                chunks.append(cell.text)

    stock = fonts & STOCK_FONTS
    if stock:
        findings.append(_f("warn", "stock_font", _where(path),
                           f"stock office face in use: {', '.join(sorted(stock))}"))
    off_scale = _off_scale(sizes, "doc")
    if off_scale:
        findings.append(_f("warn", "off_scale_type", _where(path),
                           f"sizes outside the house scale: {sorted(off_scale)}"))
    elif len(sizes) > LIMITS["doc_font_sizes"] + 2:
        findings.append(_f("warn", "size_soup", _where(path),
                           f"{len(sizes)} distinct type sizes: "
                           f"{sorted(sizes)}"))
    # Measure: characters a line at the body size and the page width.
    section = doc.sections[0] if doc.sections else None
    if section is not None:
        width_pt = (section.page_width - section.left_margin
                    - section.right_margin) / 12700
        body = 11.0
        try:
            body = doc.styles["Normal"].font.size.pt or 11.0
        except (KeyError, AttributeError):
            pass
        chars = width_pt / (0.5 * body)
        low, high = LIMITS["doc_chars_per_line"]
        if not low <= chars <= high:
            findings.append(_f("warn", "measure", _where(path),
                               f"about {chars:.0f} characters a line; a "
                               f"typeset page sits between {low} and {high}"))
    return "\n".join(chunks), findings


def read_pptx(path: Path):
    from pptx import Presentation

    prs = Presentation(str(path))
    chunks, findings, sizes, fonts = [], [], set(), set()
    for n, slide in enumerate(prs.slides, 1):
        where = f"{_where(path)} slide {n}"
        words, bullets, visuals = 0, 0, 0
        items = []
        # A composed layout (cards, a timeline, a comparison) is many
        # positioned shapes, not a bullet list, and the shapes themselves
        # are the visual. Counting their paragraphs as bullets reported a
        # designed slide as a wall of text.
        composed = sum(1 for sh in slide.shapes
                       if not sh.is_placeholder and sh.has_text_frame) >= 3
        for shape in slide.shapes:
            if getattr(shape, "has_chart", False) or shape.shape_type == 13:
                visuals += 1
            if shape.has_table:
                visuals += 1
            if not shape.has_text_frame:
                continue
            for para in shape.text_frame.paragraphs:
                text = "".join(r.text for r in para.runs)
                if not text.strip():
                    continue
                chunks.append(text)
                items.append(text)
                words += len(_words(text))
                if (shape.is_placeholder
                        and shape.placeholder_format.idx != 0
                        and not composed):
                    bullets += 1
                    if len(_words(text)) > LIMITS["bullet_words"]:
                        findings.append(_f("warn", "long_bullet", where,
                                           f"{len(_words(text))} words in one "
                                           "bullet; target six"))
                for run in para.runs:
                    if run.font.size:
                        sizes.add(round(run.font.size.pt, 1))
                    if run.font.name:
                        fonts.add(run.font.name.lower())
                    try:
                        rgb = run.font.color.rgb
                    except (AttributeError, TypeError):
                        rgb = None
                    if rgb is not None and str(rgb) in STOCK_ACCENTS:
                        findings.append(_f("warn", "stock_accent", where,
                                           f"office theme accent {rgb} in text"))
        if words > LIMITS["slide_words_max"]:
            findings.append(_f("error", "slide_wall_of_text", where,
                               f"{words} words; split the slide, do not shrink "
                               f"the type (ceiling {LIMITS['slide_words_max']})"))
        elif words > LIMITS["slide_words"]:
            findings.append(_f("warn", "slide_heavy", where,
                               f"{words} words; target {LIMITS['slide_words']}"))
        if bullets > LIMITS["slide_bullets"]:
            findings.append(_f("warn", "bullet_pile", where,
                               f"{bullets} bullets; {LIMITS['slide_bullets']} "
                               "is the ceiling, and a grid usually reads better"))
        if composed:
            visuals += 1
        if visuals == 0 and words > 15:
            findings.append(_f("warn", "text_only_slide", where,
                               "no chart, table or image: text only slides are "
                               "the default failure of a generated deck"))
        findings.extend(sibling_openings(items, where))

    small = [s for s in sizes if s < 14]
    if small:
        findings.append(_f("warn", "type_too_small", _where(path),
                           f"type at {sorted(small)} pt; 18 is the floor for a "
                           "projected slide, 14 for one read as a file"))
    # A deck that uses eight roles of one scale is not size soup. A deck
    # carrying 17, 19 and 23 pt is, whatever the count says.
    off_scale = _off_scale(sizes, "deck")
    if off_scale:
        findings.append(_f("warn", "off_scale_type", _where(path),
                           f"sizes outside the house scale: {sorted(off_scale)}"))
    elif len(sizes) > LIMITS["deck_font_sizes"] + 2:
        findings.append(_f("warn", "size_soup", _where(path),
                           f"{len(sizes)} distinct type sizes: {sorted(sizes)}"))
    stock = fonts & STOCK_FONTS
    if stock:
        findings.append(_f("warn", "stock_font", _where(path),
                           f"stock office face in use: {', '.join(sorted(stock))}"))
    if len(fonts) > LIMITS["font_families"] + 1:
        findings.append(_f("warn", "font_zoo", _where(path),
                           f"{len(fonts)} families: {sorted(fonts)}"))
    return "\n".join(chunks), findings


def read_xlsx(path: Path):
    from openpyxl import load_workbook

    wb = load_workbook(str(path), data_only=False)
    chunks, findings, fonts = [], [], set()
    for ws in wb.worksheets:
        where = f"{_where(path)}[{ws.title}]"
        if ws.sheet_view.showGridLines:
            findings.append(_f("warn", "gridlines_on", where,
                               "the grey grid is the loudest thing on the "
                               "sheet; turn it off"))
        if ws.freeze_panes is None and ws.max_row > 12:
            findings.append(_f("warn", "no_freeze", where,
                               "a long sheet with no frozen header"))
        if ws.merged_cells.ranges:
            findings.append(_f("warn", "merged_cells", where,
                               f"{len(ws.merged_cells.ranges)} merged range(s): "
                               "they break sorting, filtering and formulas"))
        rules = getattr(ws.conditional_formatting, "_cf_rules", {})
        total = sum(len(v) for v in rules.values()) if rules else 0
        if total > LIMITS["conditional_formats_per_sheet"]:
            findings.append(_f("warn", "conditional_noise", where,
                               f"{total} conditional formatting rules"))
        plain_numbers = 0
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                if isinstance(cell.value, str):
                    chunks.append(cell.value)
                elif isinstance(cell.value, (int, float)) and \
                        cell.number_format == "General":
                    plain_numbers += 1
                if cell.font and cell.font.name:
                    fonts.add(cell.font.name.lower())
        if plain_numbers > 5:
            findings.append(_f("warn", "unformatted_numbers", where,
                               f"{plain_numbers} numbers still on General; give "
                               "each column a real number format"))
    if len(fonts) > 2:
        findings.append(_f("warn", "font_zoo", _where(path),
                           f"{len(fonts)} font families in one workbook"))
    return "\n".join(chunks), findings


def read_pdf(path: Path):
    import shutil
    import subprocess
    exe = shutil.which("pdftotext")
    if not exe:
        return "", [_f("warn", "no_extractor", _where(path),
                       "pdftotext is not installed; prose was not read")]
    out = subprocess.run([exe, str(path), "-"], capture_output=True, text=True)
    return out.stdout, []


READERS = {
    ".docx": read_docx, ".pptx": read_pptx, ".xlsx": read_xlsx,
    ".pdf": read_pdf, ".md": read_text_file, ".txt": read_text_file,
    ".markdown": read_text_file, ".json": read_text_file,
}


def _off_scale(sizes, medium: str) -> set:
    """Sizes that belong to no role of the house scale for this medium."""
    theme = load_theme()
    scale = set(theme.deck.values() if medium == "deck" else theme.doc.values())
    # A stat or a cover number is allowed to go above the top of the
    # scale; it is the odd sizes in the middle that read as improvised.
    ceiling = max(scale)
    return {s for s in sizes if s not in scale and s < ceiling}


def _where(path: Path) -> str:
    """A name the reader can act on. Two SKILL.md files are not the same
    finding, and printing both as "SKILL.md" made that impossible to see."""
    try:
        return str(path.resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def lint(path: Path, only: str = "all") -> list[dict]:
    reader = READERS.get(path.suffix.lower())
    if reader is None:
        return [_f("warn", "unsupported", _where(path),
                   f"no reader for {path.suffix}")]
    text, findings = reader(path)
    if only == "prose":
        findings = []
    if only != "design":
        findings += prose_findings(text, _where(path))
    return findings


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description="Lint a deliverable for machine-written prose and "
                    "template design.")
    parser.add_argument("files", nargs="+")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--only", choices=("all", "prose", "design"),
                        default="all")
    parser.add_argument("--strict", action="store_true",
                        help="fail on warnings too")
    args = parser.parse_args(argv)

    findings: list[dict] = []
    for name in args.files:
        path = Path(name)
        if not path.exists():
            findings.append(_f("error", "missing", name, "no such file"))
            continue
        findings.extend(lint(path, args.only))

    errors = [f for f in findings if f["level"] == "error"]
    warns = [f for f in findings if f["level"] == "warn"]
    if args.json:
        print(json.dumps({"ok": not errors, "errors": len(errors),
                          "warnings": len(warns), "findings": findings},
                         indent=2, ensure_ascii=False))
    else:
        for f in findings:
            mark = "FAIL" if f["level"] == "error" else "warn"
            line = f"{mark:>4}  {f['where']}: {f['rule']} - {f['detail']}"
            if f.get("sample"):
                line += f"\n        {f['sample']}"
            print(line)
        print(f"\n{len(errors)} error(s), {len(warns)} warning(s)")
    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
