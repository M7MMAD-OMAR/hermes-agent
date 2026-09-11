#!/usr/bin/env python3
"""Read, add, answer and remove PDF comments. JSON to stdout, pypdf only.

A PDF that comes back from a reviewer carries its comments in each page's
/Annots array. This script reads that array, writes to it, and keeps the
rest of the file byte-for-byte intact, so a commented file stays workable
instead of read only.

Subcommands:
  list     every annotation: page, subtype, author, dates, contents,
           quoted text, rect, review state, and its thread parent
  add      a sticky note (/Text) or a /Highlight, at a rectangle or
           anchored to a text match on the page
  reply    an annotation whose /IRT points at another and whose /RT is /R
  resolve  a state annotation (/IRT plus /StateModel /Review plus /State)
  delete   an annotation, its replies and their popups

Examples:
  pdf_annotate.py list report.pdf
  pdf_annotate.py add report.pdf -o out.pdf --anchor-text "Revenue" \\
      --type highlight --contents "Which quarter is this?" --author Hermes
  pdf_annotate.py add report.pdf -o out.pdf --page 1 --rect 72 700 92 720 \\
      --contents "Check this figure"
  pdf_annotate.py reply report.pdf -o out.pdf --id 3f2a... --contents "Fixed"
  pdf_annotate.py resolve report.pdf -o out.pdf --id 3f2a... --state Accepted
  pdf_annotate.py delete report.pdf -o out.pdf --id 3f2a...

Identifiers: every annotation this script writes carries a unique /NM,
which is its id. An annotation that arrived without one is addressed as
"p<page>i<index>", its 1 based page and its position in /Annots.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
import uuid

# Subtypes that are comments rather than page furniture. /Widget is a form
# field and is never treated as a comment.
COMMENT_SUBTYPES = {
    "/Text", "/FreeText", "/Highlight", "/Underline", "/Squiggly",
    "/StrikeOut", "/Square", "/Circle", "/Line", "/Polygon", "/PolyLine",
    "/Ink", "/Stamp", "/Caret", "/FileAttachment", "/Sound", "/Redact",
}

REVIEW_STATES = ("Accepted", "Rejected", "Cancelled", "Completed", "None")

STATE_VIEWER_NOTE = (
    "Per PDF 1.7 section 12.5.6.4, a review state is a child annotation "
    "carrying /IRT, /StateModel /Review and /State. Acrobat and Acrobat "
    "Reader are documented to surface it as the thread's status; pdf.js, "
    "Chrome, Firefox, macOS Preview, Okular and poppler viewers such as "
    "Evince are not known to, so they show the thread as unresolved and may "
    "list the state annotation as an extra empty reply. Only poppler was "
    "tested when this script was written, and it ignores /StateModel. This "
    "script always reports the state on the parent, so a round trip through "
    "it is lossless whatever the viewer does."
)


def _reconfigure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _need(module: str, package: str):
    """Import a dependency or exit non-zero naming the package to install."""
    try:
        return __import__(module)
    except ImportError:
        print(json.dumps({
            "error": f"Missing dependency: {module}",
            "fix": f"python3 -m pip install {package}",
        }, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)


class AnnotateError(Exception):
    """A failure the user can act on: reported as JSON, exit code 4."""


# ---------------------------------------------------------------------------
# Small PDF object helpers
# ---------------------------------------------------------------------------


def _deref(value):
    return value.get_object() if hasattr(value, "get_object") else value


def _raw_annots(page):
    """The page's /Annots array, resolved but with its items left raw.

    The items must stay raw: /IRT has to hold the indirect reference to the
    parent annotation, not a copy of its dictionary, or no viewer threads
    the reply.
    """
    annots = page.get("/Annots")
    annots = _deref(annots)
    return annots if annots is not None else None


def _text(value) -> str | None:
    value = _deref(value)
    if value is None:
        return None
    return str(value)


def _now_pdf_date() -> str:
    now = _dt.datetime.now().astimezone()
    offset = now.strftime("%z")  # +0300
    tail = "Z00'00'" if offset in ("", "+0000") else f"{offset[:3]}'{offset[3:]}'"
    return now.strftime("D:%Y%m%d%H%M%S") + tail


_DATE_RE = re.compile(
    r"D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?"
    r"(?:([Zz+-])(\d{2})'?(\d{2})?'?)?"
)


def _iso_date(raw: str | None) -> str | None:
    """A PDF date string as ISO 8601, or None when it is not parseable."""
    if not raw:
        return None
    match = _DATE_RE.match(str(raw).strip())
    if not match:
        return None
    year, month, day, hour, minute, second, sign, oh, om = match.groups()
    try:
        stamp = _dt.datetime(
            int(year), int(month or 1), int(day or 1),
            int(hour or 0), int(minute or 0), int(second or 0),
        )
    except ValueError:
        return None
    if sign in ("+", "-"):
        delta = _dt.timedelta(hours=int(oh or 0), minutes=int(om or 0))
        if sign == "-":
            delta = -delta
        stamp = stamp.replace(tzinfo=_dt.timezone(delta))
    elif sign in ("Z", "z"):
        stamp = stamp.replace(tzinfo=_dt.timezone.utc)
    return stamp.isoformat()


def _annot_id(obj, page_number: int, index: int) -> str:
    name = obj.get("/NM")
    name = _deref(name)
    if name is not None and str(name):
        return str(name)
    return f"p{page_number}i{index}"


def _rect_of(obj) -> list[float] | None:
    rect = _deref(obj.get("/Rect"))
    if rect is None:
        return None
    try:
        return [round(float(_deref(v)), 3) for v in rect]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def _open_reader(path: str, password: str | None):
    pypdf = _need("pypdf", "pypdf")
    reader = pypdf.PdfReader(path)
    if reader.is_encrypted:
        if password is None or not reader.decrypt(password):
            raise AnnotateError("Input is encrypted: pass --password.")
    return reader


def _quoted_text(plumber_page, rect, subtype: str) -> str | None:
    """The text a markup annotation sits on, when it is recoverable."""
    if plumber_page is None or rect is None:
        return None
    if subtype not in ("/Highlight", "/Underline", "/Squiggly", "/StrikeOut"):
        return None
    try:
        top_edge = float(plumber_page.mediabox[3])
        x0, y0, x1, y1 = rect
        bbox = (
            max(float(plumber_page.bbox[0]), min(x0, x1) - 1),
            max(float(plumber_page.bbox[1]), top_edge - max(y0, y1) - 1),
            min(float(plumber_page.bbox[2]), max(x0, x1) + 1),
            min(float(plumber_page.bbox[3]), top_edge - min(y0, y1) + 1),
        )
        if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            return None
        text = plumber_page.crop(bbox).extract_text() or ""
    except Exception:
        return None
    text = " ".join(text.split())
    return text or None


def collect(path: str, password: str | None, include_widgets: bool,
            quote: bool = True) -> dict:
    """Every annotation in the file, with threads resolved."""
    reader = _open_reader(path, password)

    plumber_pages: dict[int, object] = {}
    plumber_doc = None
    if quote:
        try:
            pdfplumber = __import__("pdfplumber")
            plumber_doc = pdfplumber.open(path, password=password or "")
            for idx, page in enumerate(plumber_doc.pages):
                plumber_pages[idx] = page
        except Exception:
            plumber_doc = None

    records: list[dict] = []
    # Map an object id number to the annotation id, so /IRT resolves to a
    # parent this script can also address on the command line.
    by_idnum: dict[int, str] = {}

    try:
        for page_index, page in enumerate(reader.pages):
            annots = _raw_annots(page)
            if not annots:
                continue
            for index, raw in enumerate(annots):
                obj = _deref(raw)
                if not hasattr(obj, "get"):
                    continue
                ident = _annot_id(obj, page_index + 1, index)
                idnum = getattr(raw, "idnum", None)
                if idnum is None:
                    idnum = getattr(getattr(obj, "indirect_reference", None),
                                    "idnum", None)
                if idnum is not None:
                    by_idnum[idnum] = ident
                records.append({"obj": obj, "raw": raw, "id": ident,
                                "page": page_index + 1, "index": index})

        out: list[dict] = []
        states: dict[str, dict] = {}
        for record in records:
            obj = record["obj"]
            subtype = _text(obj.get("/Subtype")) or ""
            if subtype == "/Widget" and not include_widgets:
                continue
            if subtype == "/Popup" and not include_widgets:
                continue
            rect = _rect_of(obj)
            irt_raw = obj.get("/IRT")
            parent_id = None
            if irt_raw is not None:
                idnum = getattr(irt_raw, "idnum", None)
                if idnum is None:
                    parent = _deref(irt_raw)
                    idnum = getattr(getattr(parent, "indirect_reference", None),
                                    "idnum", None)
                if idnum is not None:
                    parent_id = by_idnum.get(idnum)
                if parent_id is None:
                    parent = _deref(irt_raw)
                    if hasattr(parent, "get"):
                        name = _deref(parent.get("/NM"))
                        parent_id = str(name) if name else None
            state = _text(obj.get("/State"))
            state_model = _text(obj.get("/StateModel"))
            entry = {
                "id": record["id"],
                "page": record["page"],
                "subtype": subtype,
                "author": _text(obj.get("/T")),
                "contents": _text(obj.get("/Contents")),
                "subject": _text(obj.get("/Subj")),
                "created": _text(obj.get("/CreationDate")),
                "created_iso": _iso_date(_text(obj.get("/CreationDate"))),
                "modified": _text(obj.get("/M")),
                "modified_iso": _iso_date(_text(obj.get("/M"))),
                "rect": rect,
                "reply_to": parent_id,
                "reply_type": _text(obj.get("/RT")),
                "state": state,
                "state_model": state_model,
                "is_reply": bool(parent_id) and state is None,
                "is_state": bool(state_model),
            }
            quoted = entry["subject"]
            if not quoted and quote:
                quoted = _quoted_text(plumber_pages.get(record["page"] - 1),
                                      rect, subtype)
            entry["quoted_text"] = quoted
            if entry["is_state"] and parent_id:
                # A state annotation is bookkeeping, not a comment: report
                # it on the thread it marks, not as a phantom empty reply.
                states[parent_id] = {
                    "state": state, "state_model": state_model,
                    "by": entry["author"], "at": entry["modified_iso"],
                    "annotation_id": entry["id"],
                }
            out.append(entry)

        for entry in out:
            marked = states.get(entry["id"])
            entry["thread_state"] = marked
            entry["resolved"] = bool(marked and marked.get("state") in
                                     ("Accepted", "Completed"))
    finally:
        if plumber_doc is not None:
            try:
                plumber_doc.close()
            except Exception:
                pass

    comments = [e for e in out if not e["is_state"] and not e["is_reply"]
                and e["subtype"] in COMMENT_SUBTYPES]
    return {
        "file": path,
        "page_count": len(reader.pages),
        "annotation_count": len(out),
        "comment_count": len(comments),
        "annotations": out,
    }


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _open_writer(path: str, password: str | None):
    pypdf = _need("pypdf", "pypdf")
    reader = _open_reader(path, password)
    # clone_from copies the whole document: pages, AcroForm, metadata and
    # the outline. append() rebuilds the catalogue and can drop form fields.
    writer = pypdf.PdfWriter(clone_from=reader)
    return writer


def _writer_pages(writer):
    return list(writer.pages)


def _find_annotation(writer, ident: str):
    """(page, page_number, index, raw_ref, obj) for an id, or raise."""
    for page_index, page in enumerate(_writer_pages(writer)):
        annots = _raw_annots(page)
        if not annots:
            continue
        for index, raw in enumerate(annots):
            obj = _deref(raw)
            if not hasattr(obj, "get"):
                continue
            if _annot_id(obj, page_index + 1, index) == ident:
                return page, page_index + 1, index, raw, obj
    raise AnnotateError(f"No annotation with id {ident!r}. "
                        "Run 'pdf_annotate.py list' to see the ids.")


def _indirect(writer, raw, obj):
    """An indirect reference to an annotation, promoting it if needed."""
    pypdf = _need("pypdf", "pypdf")
    if isinstance(raw, pypdf.generic.IndirectObject):
        return raw
    existing = getattr(obj, "indirect_reference", None)
    if existing is not None:
        return existing
    return writer._add_object(obj)


def _attach(writer, page_number: int, annotation, *, author: str | None,
            contents: str | None, subject: str | None = None,
            name: str | None = None, extra: dict | None = None):
    """Add an annotation to a page and stamp the common comment keys."""
    pypdf = _need("pypdf", "pypdf")
    from pypdf.generic import NameObject, TextStringObject

    added = writer.add_annotation(page_number=page_number - 1,
                                  annotation=annotation)
    ident = name or uuid.uuid4().hex
    stamp = _now_pdf_date()
    # TextStringObject picks UTF-16BE with a BOM whenever the text is not
    # PDFDocEncodable, which is what makes Arabic contents survive.
    added[NameObject("/NM")] = TextStringObject(ident)
    added[NameObject("/CreationDate")] = TextStringObject(stamp)
    added[NameObject("/M")] = TextStringObject(stamp)
    if author:
        added[NameObject("/T")] = TextStringObject(author)
    if contents is not None:
        added[NameObject("/Contents")] = TextStringObject(contents)
    if subject:
        added[NameObject("/Subj")] = TextStringObject(subject)
    for key, value in (extra or {}).items():
        added[NameObject(key)] = value
    del pypdf  # only imported for the generic namespace above
    return added, ident


def _add_popup(writer, page_number: int, parent_added, rect):
    """A popup window so a viewer without a comment pane still shows text."""
    from pypdf.annotations import Popup
    from pypdf.generic import NameObject

    x0, y0, x1, y1 = rect
    popup_rect = (x1 + 2, max(0.0, y0 - 80), x1 + 202, y0 + 20)
    popup = Popup(rect=popup_rect, parent=parent_added, open=False)
    added = writer.add_annotation(page_number=page_number - 1, annotation=popup)
    parent_ref = getattr(added, "indirect_reference", None)
    if parent_ref is not None:
        parent_added[NameObject("/Popup")] = parent_ref
    return added


def _write(writer, out_path: str) -> None:
    with open(out_path, "wb") as handle:
        writer.write(handle)


# ---------------------------------------------------------------------------
# Anchoring to text
# ---------------------------------------------------------------------------


def find_anchor(path: str, needle: str, password: str | None,
                page: int | None, occurrence: int) -> dict:
    """Locate a text match and return its rectangle in PDF points."""
    pdfplumber = _need("pdfplumber", "pdfplumber")
    hits: list[dict] = []
    warnings: list[str] = []
    with pdfplumber.open(path, password=password or "") as doc:
        for index, plumber_page in enumerate(doc.pages):
            page_number = index + 1
            if page is not None and page_number != page:
                continue
            try:
                matches = plumber_page.search(needle, regex=False,
                                              return_chars=False)
            except Exception as exc:
                raise AnnotateError(f"Text search failed on page "
                                    f"{page_number}: {exc}") from exc
            if matches and int(plumber_page.rotation or 0) % 360:
                warnings.append(
                    f"Page {page_number} is rotated by "
                    f"{int(plumber_page.rotation)} degrees: the rectangle is "
                    "computed in unrotated page space and may need checking."
                )
            top_edge = float(plumber_page.mediabox[3])
            if matches and abs(float(plumber_page.cropbox[3]) - top_edge) > 0.5:
                warnings.append(
                    f"Page {page_number} has a cropbox that differs from its "
                    "mediabox: the rectangle is computed against the mediabox "
                    "and may need checking."
                )
            for match in matches:
                hits.append({
                    "page": page_number,
                    "text": match.get("text", needle),
                    # pdfplumber measures from the page top, PDF from the
                    # bottom, so the vertical pair flips around the top edge.
                    "rect": [
                        float(match["x0"]),
                        top_edge - float(match["bottom"]),
                        float(match["x1"]),
                        top_edge - float(match["top"]),
                    ],
                })
    if not hits:
        where = f" on page {page}" if page else ""
        raise AnnotateError(f"Text {needle!r} not found{where}. The page may "
                            "be a scan with no text layer.")
    if occurrence < 1 or occurrence > len(hits):
        raise AnnotateError(f"--occurrence {occurrence} is out of range: "
                            f"{len(hits)} match(es) found.")
    hit = hits[occurrence - 1]
    hit["match_count"] = len(hits)
    hit["warnings"] = warnings
    return hit


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_list(args) -> dict:
    result = collect(args.pdf, args.password, args.include_widgets,
                     quote=not args.no_quote)
    result["state_support"] = STATE_VIEWER_NOTE
    return result


def cmd_add(args) -> dict:
    from pypdf.annotations import Highlight, Text
    from pypdf.generic import ArrayObject, FloatObject

    warnings: list[str] = []
    quoted = None
    if args.anchor_text:
        hit = find_anchor(args.pdf, args.anchor_text, args.password,
                          args.page, args.occurrence)
        page_number = hit["page"]
        text_rect = hit["rect"]
        quoted = hit["text"]
        warnings.extend(hit.get("warnings") or [])
    else:
        if args.page is None or args.rect is None:
            raise AnnotateError("Give either --anchor-text, or both --page "
                                "and --rect x0 y0 x1 y1.")
        page_number = args.page
        text_rect = [float(v) for v in args.rect]

    writer = _open_writer(args.pdf, args.password)
    if not 1 <= page_number <= len(writer.pages):
        raise AnnotateError(f"Page {page_number} is outside 1 to "
                            f"{len(writer.pages)}.")
    box = writer.pages[page_number - 1].mediabox
    x0, y0, x1, y1 = text_rect
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    if (x1 < float(box.left) or x0 > float(box.right)
            or y1 < float(box.bottom) or y0 > float(box.top)):
        raise AnnotateError(
            f"Rectangle {[x0, y0, x1, y1]} falls outside page "
            f"{page_number}, which is "
            f"{[float(box.left), float(box.bottom), float(box.right), float(box.top)]}."
        )

    if args.type == "highlight":
        quad = ArrayObject([FloatObject(v) for v in
                            (x0, y1, x1, y1, x0, y0, x1, y0)])
        annotation = Highlight(rect=(x0, y0, x1, y1), quad_points=quad,
                               highlight_color=args.color.lstrip("#"),
                               printing=True)
        rect = (x0, y0, x1, y1)
    else:
        size = float(args.icon_size)
        # The sticky note is an icon, not a box: anchor it at the top left
        # of the target and keep it on the page.
        nx0 = min(max(x0, float(box.left)), float(box.right) - size)
        ny1 = min(max(y1, float(box.bottom) + size), float(box.top))
        rect = (nx0, ny1 - size, nx0 + size, ny1)
        annotation = Text(rect=rect, text=args.contents, open=False)

    added, ident = _attach(writer, page_number, annotation,
                           author=args.author, contents=args.contents,
                           subject=args.subject or quoted)
    if args.popup:
        _add_popup(writer, page_number, added, rect)
    _write(writer, args.output)
    return {
        "output": args.output,
        "id": ident,
        "page": page_number,
        "type": args.type,
        "rect": [round(float(v), 3) for v in rect],
        "author": args.author,
        "contents": args.contents,
        "quoted_text": quoted,
        "warnings": warnings,
    }


def cmd_reply(args) -> dict:
    from pypdf.annotations import Text
    from pypdf.generic import NameObject

    writer = _open_writer(args.pdf, args.password)
    page, page_number, _index, raw, obj = _find_annotation(writer, args.id)
    if _text(obj.get("/Subtype")) == "/Widget":
        raise AnnotateError(f"{args.id} is a form field widget, not a comment.")
    parent_ref = _indirect(writer, raw, obj)

    parent_rect = _rect_of(obj) or [72.0, 72.0, 92.0, 92.0]
    px0, py0, px1, py1 = parent_rect
    size = float(args.icon_size)
    box = page.mediabox
    # Sit the icon in the margin beside the parent rather than on top of
    # it. A reply drawn at the parent's own corner covers the first word
    # of the sentence it is answering, which is the one the reader needs.
    gap = 4.0
    rx0 = px0 - size - gap
    if rx0 < float(box.left) + 2:
        rx0 = min(px1 + gap, float(box.right) - size - 2)
    rx0 = min(max(rx0, float(box.left)), float(box.right) - size)
    ry1 = min(max(py1, float(box.bottom) + size), float(box.top))
    rect = (rx0, ry1 - size, rx0 + size, ry1)

    annotation = Text(rect=rect, text=args.contents, open=False)
    added, ident = _attach(
        writer, page_number, annotation,
        author=args.author, contents=args.contents,
        extra={"/IRT": parent_ref, "/RT": NameObject("/R")},
    )
    if args.popup:
        _add_popup(writer, page_number, added, rect)
    _write(writer, args.output)
    return {
        "output": args.output,
        "id": ident,
        "reply_to": args.id,
        "page": page_number,
        "reply_type": "/R",
        "author": args.author,
        "contents": args.contents,
    }


def cmd_resolve(args) -> dict:
    from pypdf.annotations import Text
    from pypdf.generic import NameObject, TextStringObject

    writer = _open_writer(args.pdf, args.password)
    page, page_number, _index, raw, obj = _find_annotation(writer, args.id)
    if _text(obj.get("/Subtype")) == "/Widget":
        raise AnnotateError(f"{args.id} is a form field widget, not a comment.")
    parent_ref = _indirect(writer, raw, obj)

    parent_rect = _rect_of(obj) or [72.0, 72.0, 92.0, 92.0]
    size = float(args.icon_size)
    box = page.mediabox
    rx0 = min(max(parent_rect[0], float(box.left)), float(box.right) - size)
    ry1 = min(max(parent_rect[3], float(box.bottom) + size), float(box.top))
    rect = (rx0, ry1 - size, rx0 + size, ry1)

    contents = args.contents if args.contents is not None else ""
    annotation = Text(rect=rect, text=contents, open=False)
    added, ident = _attach(
        writer, page_number, annotation,
        author=args.author, contents=contents,
        extra={
            "/IRT": parent_ref,
            "/RT": NameObject("/R"),
            "/StateModel": TextStringObject("Review"),
            "/State": TextStringObject(args.state),
        },
    )
    del added
    _write(writer, args.output)
    return {
        "output": args.output,
        "id": ident,
        "thread": args.id,
        "page": page_number,
        "state": args.state,
        "state_model": "Review",
        "resolved": args.state in ("Accepted", "Completed"),
        "viewer_support": STATE_VIEWER_NOTE,
    }


def _idnums_of(writer) -> dict[str, int]:
    """Annotation id to object id number, across every page."""
    mapping: dict[str, int] = {}
    for page_index, page in enumerate(_writer_pages(writer)):
        annots = _raw_annots(page)
        if not annots:
            continue
        for index, raw in enumerate(annots):
            obj = _deref(raw)
            if not hasattr(obj, "get"):
                continue
            idnum = getattr(raw, "idnum", None)
            if idnum is None:
                idnum = getattr(getattr(obj, "indirect_reference", None),
                                "idnum", None)
            if idnum is not None:
                mapping[_annot_id(obj, page_index + 1, index)] = idnum
    return mapping


def cmd_delete(args) -> dict:
    writer = _open_writer(args.pdf, args.password)
    _page, _page_number, _index, raw, obj = _find_annotation(writer, args.id)
    if _text(obj.get("/Subtype")) == "/Widget":
        raise AnnotateError(
            f"{args.id} is a form field widget, not a comment. Deleting it "
            "would remove a field from the form; use the form scripts instead."
        )

    target_idnums = {_idnums_of(writer).get(args.id)}
    target_idnums.discard(None)
    if not target_idnums:
        # A direct object has no id number: match it by identity instead.
        target_idnums = set()

    doomed_objs = {id(obj)}
    removed: list[dict] = []
    # Replies can chain, so sweep until nothing new joins the doomed set.
    for _pass in range(8):
        grew = False
        for page_index, page in enumerate(_writer_pages(writer)):
            annots = _raw_annots(page)
            if not annots:
                continue
            for item in annots:
                candidate = _deref(item)
                if not hasattr(candidate, "get"):
                    continue
                if id(candidate) in doomed_objs:
                    continue
                parent = candidate.get("/IRT") or candidate.get("/Parent")
                hit = False
                if parent is not None:
                    idnum = getattr(parent, "idnum", None)
                    if idnum is not None and idnum in target_idnums:
                        hit = True
                    elif id(_deref(parent)) in doomed_objs:
                        hit = True
                if hit:
                    doomed_objs.add(id(candidate))
                    own = getattr(item, "idnum", None)
                    if own is not None:
                        target_idnums.add(own)
                    grew = True
            del page_index
        if not grew:
            break

    from pypdf.generic import ArrayObject, NameObject
    for page_index, page in enumerate(_writer_pages(writer)):
        annots = _raw_annots(page)
        if not annots:
            continue
        keep = ArrayObject()
        for index, item in enumerate(annots):
            candidate = _deref(item)
            if hasattr(candidate, "get") and id(candidate) in doomed_objs:
                removed.append({
                    "id": _annot_id(candidate, page_index + 1, index),
                    "page": page_index + 1,
                    "subtype": _text(candidate.get("/Subtype")),
                })
                continue
            keep.append(item)
        page[NameObject("/Annots")] = keep

    if not removed:
        raise AnnotateError(f"Nothing removed for id {args.id!r}.")
    _write(writer, args.output)
    return {
        "output": args.output,
        "deleted": args.id,
        "removed": removed,
        "removed_count": len(removed),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read, add, answer and remove PDF comments (pypdf).")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def common(sub):
        sub.add_argument("pdf", help="Input PDF path")
        sub.add_argument("--password", help="Password if the input is encrypted")

    listing = subparsers.add_parser("list", help="List every annotation")
    common(listing)
    listing.add_argument("--include-widgets", action="store_true",
                         help="Also list /Widget form fields and /Popup windows")
    listing.add_argument("--no-quote", action="store_true",
                         help="Skip recovering the text under a markup annotation")
    listing.set_defaults(func=cmd_list)

    adding = subparsers.add_parser("add", help="Add a note or a highlight")
    common(adding)
    adding.add_argument("-o", "--output", required=True, help="Output PDF path")
    adding.add_argument("--contents", required=True, help="Comment text")
    adding.add_argument("--type", choices=("note", "highlight"), default="note",
                        help="Sticky note (default) or highlight")
    adding.add_argument("--page", type=int, help="Page number, 1 based")
    adding.add_argument("--rect", nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                        type=float, help="Rectangle in PDF points, origin bottom left")
    adding.add_argument("--anchor-text", help="Anchor to the first match of this text")
    adding.add_argument("--occurrence", type=int, default=1,
                        help="Which match of --anchor-text to use, 1 based")
    adding.add_argument("--author", help="Author name, written to /T")
    adding.add_argument("--subject", help="Subject line, written to /Subj")
    adding.add_argument("--color", default="ffff00",
                        help="Highlight colour as hex, default ffff00")
    adding.add_argument("--icon-size", type=float, default=20.0,
                        help="Sticky note icon size in points, default 20")
    adding.add_argument("--no-popup", dest="popup", action="store_false",
                        help="Do not attach a popup window")
    adding.set_defaults(func=cmd_add, popup=True)

    replying = subparsers.add_parser("reply", help="Reply inside a thread")
    common(replying)
    replying.add_argument("-o", "--output", required=True, help="Output PDF path")
    replying.add_argument("--id", required=True, help="Id of the annotation answered")
    replying.add_argument("--contents", required=True, help="Reply text")
    replying.add_argument("--author", help="Author name, written to /T")
    replying.add_argument("--icon-size", type=float, default=20.0,
                          help="Reply icon size in points, default 20")
    replying.add_argument("--no-popup", dest="popup", action="store_false",
                          help="Do not attach a popup window")
    replying.set_defaults(func=cmd_reply, popup=True)

    resolving = subparsers.add_parser("resolve", help="Mark a thread reviewed")
    common(resolving)
    resolving.add_argument("-o", "--output", required=True, help="Output PDF path")
    resolving.add_argument("--id", required=True, help="Id of the thread's first comment")
    resolving.add_argument("--state", choices=REVIEW_STATES, default="Accepted",
                           help="Review state, default Accepted")
    resolving.add_argument("--author", help="Author name, written to /T")
    resolving.add_argument("--contents", help="Optional note beside the state")
    resolving.add_argument("--icon-size", type=float, default=20.0,
                           help="State marker size in points, default 20")
    resolving.set_defaults(func=cmd_resolve)

    deleting = subparsers.add_parser("delete", help="Delete an annotation and its replies")
    common(deleting)
    deleting.add_argument("-o", "--output", required=True, help="Output PDF path")
    deleting.add_argument("--id", required=True, help="Id of the annotation to delete")
    deleting.set_defaults(func=cmd_delete)
    return parser


def main(argv: list[str] | None = None) -> int:
    _reconfigure_stdio()
    args = build_parser().parse_args(argv)
    try:
        result = args.func(args)
    except AnnotateError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 4
    except FileNotFoundError as exc:
        print(json.dumps({"error": f"File not found: {exc.filename}"},
                         ensure_ascii=False), file=sys.stderr)
        return 5
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
