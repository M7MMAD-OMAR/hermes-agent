#!/usr/bin/env python3
"""Read a finished document and report what is in it and how to change it.

Editing a file somebody else made is mostly a reading problem. What is on
slide 7. Which table holds the figures. Where the pictures came from.
Whether anyone left a comment, and whether it was answered. Which
paragraph index to pass to the edit script so the change lands in the
right place and nowhere else.

This walks a .docx, .pptx, .xlsx or .pdf and prints one JSON report with
five sections:

    summary     counts, so you know the shape before you open anything
    structure   the outline: headings, slides, sheets, pages
    inventory   tables, charts, pictures and their sizes
    review      comments and tracked changes, threaded where the format
                carries threads
    targets     the exact address to hand an edit command for every
                editable thing, so a change is a command and not a guess
    lint        the house style findings, the same ones style_lint prints

Usage:
    python office_inspect.py report.docx
    python office_inspect.py deck.pptx --section targets
    python office_inspect.py book.xlsx --no-lint

Comments come from the sibling scripts in the docx, powerpoint, xlsx and
pdf skills when those are installed beside this one. When they are not,
the report says so in ``review.source`` rather than claiming a document
has no comments, because "none" and "could not look" are different
answers and only one of them is safe to act on.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from house_style import is_arabic  # noqa: E402

KINDS = {".docx": "word", ".pptx": "deck", ".xlsx": "workbook",
         ".pdf": "pdf"}

# Where the per format helpers live, relative to this skill and to an
# installed skills tree. Same probe the create scripts use.
_SKILL_ROOTS = [
    Path(__file__).resolve().parents[2],
    Path.home() / ".hermes" / "skills" / "productivity",
]


def _skill_script(skill: str, name: str) -> Path | None:
    for root in _SKILL_ROOTS:
        candidate = root / skill / "scripts" / name
        if candidate.is_file():
            return candidate
    return None


def _run_helper(skill: str, script: str, args: list[str]) -> dict:
    """Call a sibling skill's CLI and parse its JSON.

    A helper that is missing, crashes or prints something other than JSON
    is reported as an unavailable source. The report stays usable either
    way, which matters more than the extra section.
    """
    path = _skill_script(skill, script)
    if path is None:
        return {"source": f"{skill}/{script} not installed", "items": []}
    try:
        out = subprocess.run([sys.executable, str(path), *args],
                             capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"source": f"{script} failed: {exc}", "items": []}
    if out.returncode != 0:
        return {"source": f"{script} exited {out.returncode}",
                "items": [], "stderr": out.stderr.strip()[:400]}
    try:
        return {"source": str(path), "data": json.loads(out.stdout or "{}")}
    except json.JSONDecodeError:
        return {"source": str(path), "items": [],
                "note": "helper printed no JSON"}


def _media_from_zip(path: Path, prefix: str) -> list[dict]:
    """Pictures and other embedded files, straight out of the package.

    Reading the zip rather than the object model catches the media a
    library does not model, such as a picture inside a text box or a
    cropped image referenced from a header.
    """
    media = []
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if prefix not in info.filename:
                continue
            entry = {"part": info.filename, "bytes": info.file_size,
                     "kind": Path(info.filename).suffix.lstrip(".").lower()}
            if entry["kind"] in ("png", "jpeg", "jpg", "gif", "bmp"):
                try:
                    from PIL import Image  # noqa: PLC0415
                    from io import BytesIO  # noqa: PLC0415
                    with Image.open(BytesIO(zf.read(info.filename))) as img:
                        entry["width"], entry["height"] = img.size
                except Exception:  # noqa: BLE001  a size is not worth failing
                    pass
            media.append(entry)
    return media


def _parts(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as zf:
        return [i.filename for i in zf.infolist()]


# ---------------------------------------------------------------------------
# Word
# ---------------------------------------------------------------------------


def inspect_docx(path: Path) -> dict:
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(str(path))
    structure, targets = [], []
    words = 0
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        words += len(text.split())
        style = para.style.name if para.style is not None else "Normal"
        if style.startswith("Heading") or style in ("Title", "Subtitle"):
            structure.append({"paragraph": i, "style": style, "text": text})
        if text:
            targets.append({
                "what": "paragraph", "index": i, "style": style,
                "preview": text[:80],
                "edit": f"docx_edit.py <file> replace --find ... --replace ...",
                "address": f"--index {i}",
            })

    tables = []
    for t, table in enumerate(doc.tables):
        rows = len(table.rows)
        cols = len(table.columns)
        head = [c.text.strip() for c in table.rows[0].cells] if rows else []
        tables.append({"index": t, "rows": rows, "columns": cols,
                       "header": head})
        targets.append({"what": "table", "index": t,
                        "address": f"--table {t} --row R --col C",
                        "edit": "docx_edit.py <file> set-cell"})

    body = doc.element.body
    revisions = {
        "insertions": len(body.findall(".//" + qn("w:ins"))),
        "deletions": len(body.findall(".//" + qn("w:del"))),
        "format_changes": len(body.findall(".//" + qn("w:rPrChange"))),
    }
    parts = _parts(path)
    charts = [p for p in parts if "charts/chart" in p and p.endswith(".xml")]

    return {
        "summary": {"paragraphs": len(doc.paragraphs), "words": words,
                    "tables": len(doc.tables), "sections": len(doc.sections),
                    "headings": len(structure), "charts": len(charts),
                    "arabic": is_arabic(" ".join(p.text for p in
                                                 doc.paragraphs[:60]))},
        "structure": structure,
        "inventory": {"tables": tables, "charts": charts,
                      "media": _media_from_zip(path, "word/media/")},
        "review": {"tracked_changes": revisions,
                   "comments": _run_helper("docx", "docx_comments.py",
                                           ["list", str(path), "--json",
                                            "threads"])},
        "targets": targets,
    }


# ---------------------------------------------------------------------------
# Deck
# ---------------------------------------------------------------------------


def inspect_pptx(path: Path) -> dict:
    from pptx import Presentation

    prs = Presentation(str(path))
    structure, targets, charts, tables = [], [], [], []
    total_words = 0

    for n, slide in enumerate(prs.slides, 1):
        title = slide.shapes.title.text.strip() if slide.shapes.title else ""
        words = 0
        shapes = []
        for shape in slide.shapes:
            entry = {"name": shape.shape_id and shape.name,
                     "kind": str(shape.shape_type)}
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                words += len(text.split())
                entry["text"] = text[:80]
            if getattr(shape, "has_chart", False):
                plot = shape.chart.plots[0] if shape.chart.plots else None
                charts.append({
                    "slide": n, "shape": shape.name,
                    "type": str(shape.chart.chart_type),
                    "series": [s.name for s in shape.chart.series],
                    "categories": list(plot.categories) if plot else [],
                })
                entry["chart"] = True
            if shape.has_table:
                tables.append({"slide": n, "shape": shape.name,
                               "rows": len(shape.table.rows),
                               "columns": len(shape.table.columns)})
            shapes.append(entry)
            targets.append({"what": "shape", "slide": n, "name": shape.name,
                            "address": f"--slide {n - 1} --shape {shape.name}",
                            "edit": "pptx_edit.py <file> --replace-text / "
                                    "--swap-image"})
        total_words += words
        structure.append({"slide": n, "layout": slide.slide_layout.name,
                          "title": title, "words": words,
                          "shapes": len(shapes),
                          "notes": (slide.notes_slide.notes_text_frame.text
                                    .strip()[:120]
                                    if slide.has_notes_slide else "")})

    return {
        "summary": {"slides": len(prs.slides._sldIdLst), "words": total_words,
                    "charts": len(charts), "tables": len(tables),
                    "size_in": [round(prs.slide_width / 914400, 3),
                                round(prs.slide_height / 914400, 3)]},
        "structure": structure,
        "inventory": {"charts": charts, "tables": tables,
                      "media": _media_from_zip(path, "ppt/media/")},
        "review": {"comments": _run_helper("powerpoint", "pptx_comments.py",
                                           ["list", str(path), "--json"])},
        "targets": targets,
    }


# ---------------------------------------------------------------------------
# Workbook
# ---------------------------------------------------------------------------


def inspect_xlsx(path: Path) -> dict:
    from openpyxl import load_workbook

    wb = load_workbook(str(path), data_only=False)
    sheets, targets = [], []
    formulas = 0
    for ws in wb.worksheets:
        used = ws.calculate_dimension()
        header = [c.value for c in next(ws.iter_rows(max_row=1), [])]
        sheet_formulas = 0
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    sheet_formulas += 1
        formulas += sheet_formulas
        sheets.append({
            "name": ws.title, "dimensions": used,
            "rows": ws.max_row, "columns": ws.max_column,
            "header": header, "formulas": sheet_formulas,
            "frozen": ws.freeze_panes,
            "gridlines": ws.sheet_view.showGridLines,
            "rtl": bool(ws.sheet_view.rightToLeft),
            "merged": [str(r) for r in ws.merged_cells.ranges],
            "charts": len(getattr(ws, "_charts", [])),
            "images": len(getattr(ws, "_images", [])),
            "tables": list(getattr(ws, "tables", {}) or {}),
        })
        targets.append({"what": "sheet", "name": ws.title,
                        "address": f"--sheet '{ws.title}' --cell A1",
                        "edit": "xlsx_edit.py <file> --set / --note"})

    return {
        "summary": {"sheets": len(wb.worksheets), "formulas": formulas,
                    "defined_names": list(wb.defined_names),
                    "charts": sum(s["charts"] for s in sheets)},
        "structure": sheets,
        "inventory": {"media": _media_from_zip(path, "xl/media/")},
        "review": {"comments": _run_helper("xlsx", "xlsx_comments.py",
                                           ["list", str(path), "--json"])},
        "targets": targets,
    }


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def inspect_pdf(path: Path) -> dict:
    # pypdf lives on the system interpreter here rather than in the
    # project venv, so a missing import is a normal outcome and gets a
    # readable answer instead of a traceback.
    try:
        from pypdf import PdfReader  # noqa: PLC0415
    except ImportError:
        return {"summary": {"error": "pypdf is not installed for this "
                                     "interpreter; try /usr/bin/python3"},
                "structure": [], "inventory": {}, "review": {}, "targets": []}

    reader = PdfReader(str(path))
    pages, targets = [], []
    annotations = 0
    for n, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        annots = page.get("/Annots") or []
        annotations += len(annots)
        box = page.mediabox
        pages.append({"page": n, "words": len(text.split()),
                      "size_pt": [round(float(box.width), 1),
                                  round(float(box.height), 1)],
                      "annotations": len(annots),
                      "preview": text[:120].replace("\n", " ")})
        targets.append({"what": "page", "page": n,
                        "address": f"--page {n}",
                        "edit": "pdf_annotate.py <file> add / pdf_stamp.py"})

    fields = {}
    try:
        fields = reader.get_fields() or {}
    except Exception:  # noqa: BLE001  a malformed AcroForm is not fatal here
        fields = {}

    return {
        "summary": {"pages": len(reader.pages), "annotations": annotations,
                    "form_fields": len(fields),
                    "encrypted": bool(reader.is_encrypted),
                    "metadata": {k: str(v) for k, v in
                                 (reader.metadata or {}).items()}},
        "structure": pages,
        "inventory": {"form_fields": list(fields)},
        "review": {"comments": _run_helper("pdf", "pdf_annotate.py",
                                           ["list", str(path), "--json"])},
        "targets": targets,
    }


INSPECTORS = {"word": inspect_docx, "deck": inspect_pptx,
              "workbook": inspect_xlsx, "pdf": inspect_pdf}


def inspect(path: Path, *, lint: bool = True) -> dict:
    kind = KINDS.get(path.suffix.lower())
    if kind is None:
        raise ValueError(f"no inspector for {path.suffix}; "
                         f"have {sorted(KINDS)}")
    report = {"file": str(path), "kind": kind, "bytes": path.stat().st_size}
    report.update(INSPECTORS[kind](path))
    if lint:
        try:
            from style_lint import lint as run_lint  # noqa: PLC0415
            report["lint"] = run_lint(path)
        except Exception as exc:  # noqa: BLE001
            report["lint"] = [{"level": "warn", "rule": "lint_unavailable",
                               "where": path.name, "detail": str(exc)}]
    return report


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description="Report what is inside a document and how to edit it.")
    parser.add_argument("file")
    parser.add_argument("--section", action="append",
                        choices=("summary", "structure", "inventory",
                                 "review", "targets", "lint"),
                        help="print only these sections (repeatable)")
    parser.add_argument("--no-lint", action="store_true",
                        help="skip the house style pass")
    args = parser.parse_args(argv)

    path = Path(args.file)
    if not path.exists():
        print(json.dumps({"ok": False, "error": f"no such file: {path}"}),
              file=sys.stderr)
        return 1
    report = inspect(path, lint=not args.no_lint)
    if args.section:
        keep = set(args.section) | {"file", "kind"}
        report = {k: v for k, v in report.items() if k in keep}
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
