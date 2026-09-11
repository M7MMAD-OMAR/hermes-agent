#!/usr/bin/env python3
# MIT License. Part of the Hermes xlsx skill.
"""List, add, reply to, resolve and delete comments in a .xlsx.

Excel has two comment systems and this script reads both.

A legacy note lives in xl/commentsN.xml, anchored to a cell, with its
yellow box described in a VML drawing part. That is what openpyxl's
Comment writes and what xlsx_edit.py --note produces. A note has one
author, no replies, and no resolved state.

A threaded comment lives in xl/threadedComments/threadedCommentN.xml,
with the author roster in xl/persons/person.xml. A reply is another
threadedComment carrying parentId, and the thread's resolved state is
the done attribute on the first comment of the thread. That is what a
reviewer in current Excel or the web app leaves, so new comments are
written there.

Subcommands:
  list        JSON per comment: kind, sheet, cell, id, author, created,
              text, parent_id, resolved
  add         start a threaded comment on a cell
  reply       append a reply into an existing thread
  resolve     mark a thread resolved
  reopen      mark a resolved thread open again
  delete      remove a thread and its replies, or a legacy note
  add-note    write a legacy note on a cell
  delete-note remove a legacy note from a cell

Examples:
  xlsx_comments.py list book.xlsx
  xlsx_comments.py add book.xlsx --sheet Sheet1 --cell B2 \
      --text "Where is this from?" --author "Reviewer" -o out.xlsx
  xlsx_comments.py reply book.xlsx --id "{...}" --text "Source added"
  xlsx_comments.py resolve book.xlsx --id "{...}"
  xlsx_comments.py add-note book.xlsx --sheet Sheet1 --cell B2 \
      --text "Check the units"

openpyxl drops parts it does not model when it saves, so every write
here is a zip level rewrite instead: each part is copied across
untouched unless this script changed it. Charts, pivot caches, slicers
and images therefore survive a comment edit.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import sys
import uuid
import zipfile
from datetime import datetime, timezone

from lxml import etree
from openpyxl.comments import Comment
from openpyxl.comments.shape_writer import ShapeWriter

X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
TC = ("http://schemas.microsoft.com/office/spreadsheetml/2018"
      "/threadedcomments")
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

REL_WORKSHEET = f"{R}/worksheet"
REL_COMMENTS = f"{R}/comments"
REL_VML = f"{R}/vmlDrawing"
REL_THREADED = ("http://schemas.microsoft.com/office/2017/10"
                "/relationships/threadedComment")
REL_PERSON = ("http://schemas.microsoft.com/office/2017/10"
              "/relationships/person")

CT_COMMENTS = ("application/vnd.openxmlformats-officedocument"
               ".spreadsheetml.comments+xml")
CT_VML = "application/vnd.openxmlformats-officedocument.vmlDrawing"
CT_THREADED = "application/vnd.ms-excel.threadedcomments+xml"
CT_PERSON = "application/vnd.ms-excel.person+xml"

PERSON_PART = "xl/persons/person.xml"

# Elements that may follow legacyDrawing in a worksheet. The schema
# fixes this order, and an element out of place is what makes Excel
# offer to repair the file.
AFTER_LEGACY_DRAWING = ("legacyDrawingHF", "drawingHF", "picture",
                        "oleObjects", "controls", "webPublishItems",
                        "tableParts", "extLst")


def qx(tag):
    return f"{{{X}}}{tag}"


def qr(tag):
    return f"{{{R}}}{tag}"


def qtc(tag):
    return f"{{{TC}}}{tag}"


def qct(tag):
    return f"{{{CT_NS}}}{tag}"


def qrel(tag):
    return f"{{{REL_NS}}}{tag}"


def now_stamp():
    """Timestamp in the shape Excel itself writes.

    Observed producer output carries fractional seconds and no timezone
    designator, so a file this script writes reads back the same way an
    Excel authored one does.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-4]


def new_guid():
    return "{" + str(uuid.uuid4()).upper() + "}"


# ---------------------------------------------------------------- package

def resolve_target(base, target):
    """Absolute part name for a relationship target.

    Office writes these relative to the owning part's directory, but
    openpyxl writes them rooted at the package, so both forms have to
    resolve to the same zip entry name.
    """
    target = target.replace("\\", "/")
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(base, target))



class Package:
    """Every zip entry held in memory, so a save rewrites the whole file.

    Reading and writing the package this way is what keeps parts this
    script does not understand intact: they are copied byte for byte.
    """

    def __init__(self, path):
        self.path = path
        with zipfile.ZipFile(path) as z:
            self.names = list(z.namelist())
            self.blobs = {n: z.read(n) for n in self.names}
        self._trees = {}

    def has(self, name):
        return name in self.blobs

    def raw(self, name):
        return self.blobs.get(name)

    def put(self, name, data):
        if name not in self.blobs:
            self.names.append(name)
        self.blobs[name] = data

    def drop(self, name):
        if name in self.blobs:
            del self.blobs[name]
            self.names.remove(name)
        self._trees.pop(name, None)

    def tree(self, name):
        """Parsed root of a part, cached so edits accumulate."""
        if name not in self._trees:
            if name not in self.blobs:
                return None
            self._trees[name] = etree.fromstring(self.blobs[name])
        return self._trees[name]

    def set_tree(self, name, root):
        self._trees[name] = root

    def forget_tree(self, name):
        """Drop a cached tree so a raw replacement of the part wins."""
        self._trees.pop(name, None)

    def save(self, out):
        for name, root in self._trees.items():
            if name in self.blobs:
                self.blobs[name] = etree.tostring(
                    root, xml_declaration=True, encoding="UTF-8",
                    standalone=True)
        tmp = out + ".tmp"
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for name in self.names:
                z.writestr(name, self.blobs[name])
        os.replace(tmp, out)

    # --- content types

    def ensure_override(self, part_name, content_type):
        root = self.tree("[Content_Types].xml")
        for ov in root.findall(qct("Override")):
            if ov.get("PartName") == part_name:
                ov.set("ContentType", content_type)
                return
        ov = etree.SubElement(root, qct("Override"))
        ov.set("PartName", part_name)
        ov.set("ContentType", content_type)

    def ensure_default(self, extension, content_type):
        root = self.tree("[Content_Types].xml")
        for df in root.findall(qct("Default")):
            if df.get("Extension") == extension:
                return
        df = etree.Element(qct("Default"))
        df.set("Extension", extension)
        df.set("ContentType", content_type)
        # Defaults precede overrides in every package Office writes.
        last = None
        for existing in root.findall(qct("Default")):
            last = existing
        root.insert(0 if last is None else root.index(last) + 1, df)

    def drop_override(self, part_name):
        root = self.tree("[Content_Types].xml")
        for ov in root.findall(qct("Override")):
            if ov.get("PartName") == part_name:
                root.remove(ov)
                return

    # --- relationships

    @staticmethod
    def rels_name(part):
        head, tail = posixpath.split(part)
        return posixpath.join(head, "_rels", tail + ".rels")

    def rels(self, part, create=False):
        name = self.rels_name(part)
        root = self.tree(name)
        if root is None and create:
            root = etree.Element(qrel("Relationships"),
                                 nsmap={None: REL_NS})
            self.put(name, etree.tostring(root, xml_declaration=True,
                                          encoding="UTF-8",
                                          standalone=True))
            self.set_tree(name, root)
        return root

    def rel_targets(self, part, reltype):
        root = self.rels(part)
        if root is None:
            return []
        base = posixpath.dirname(part)
        out = []
        for rel in root.findall(qrel("Relationship")):
            if rel.get("Type") != reltype:
                continue
            if rel.get("TargetMode") == "External":
                continue
            out.append(resolve_target(base, rel.get("Target")))
        return out

    def ensure_rel(self, part, reltype, target_part):
        root = self.rels(part, create=True)
        base = posixpath.dirname(part)
        target = posixpath.relpath(target_part, base)
        used = set()
        for rel in root.findall(qrel("Relationship")):
            used.add(rel.get("Id"))
            if (rel.get("Type") == reltype
                    and resolve_target(base, rel.get("Target"))
                    == target_part):
                return rel.get("Id")
        n = 1
        while f"rId{n}" in used:
            n += 1
        rel = etree.SubElement(root, qrel("Relationship"))
        rel.set("Id", f"rId{n}")
        rel.set("Type", reltype)
        rel.set("Target", target)
        return rel.get("Id")


# ---------------------------------------------------------------- sheets


def sheets(pkg):
    """List of (sheet name, worksheet part name) in workbook order."""
    book = pkg.tree("xl/workbook.xml")
    if book is None:
        return []
    rels = pkg.rels("xl/workbook.xml")
    by_id = {}
    if rels is not None:
        for rel in rels.findall(qrel("Relationship")):
            by_id[rel.get("Id")] = rel.get("Target")
    out = []
    lst = book.find(qx("sheets"))
    if lst is None:
        return out
    for sheet in lst.findall(qx("sheet")):
        target = by_id.get(sheet.get(qr("id")))
        if not target:
            continue
        part = resolve_target("xl", target)
        out.append((sheet.get("name"), part))
    return out


def sheet_part(pkg, name):
    for sheet_name, part in sheets(pkg):
        if sheet_name == name:
            return part
    raise SystemExit(f"no sheet named {name!r}")


# ---------------------------------------------------------------- persons


def persons(pkg):
    out = {}
    root = pkg.tree(PERSON_PART)
    if root is None:
        return out
    for person in root.findall(qtc("person")):
        out[person.get("id")] = person.get("displayName") or ""
    return out


def ensure_person(pkg, display_name):
    """Find or create an entry in xl/persons/person.xml, return its id."""
    root = pkg.tree(PERSON_PART)
    if root is None:
        root = etree.Element(qtc("personList"), nsmap={None: TC, "x": X})
        pkg.put(PERSON_PART, etree.tostring(root, xml_declaration=True,
                                            encoding="UTF-8",
                                            standalone=True))
        pkg.set_tree(PERSON_PART, root)
        pkg.ensure_override("/" + PERSON_PART, CT_PERSON)
        pkg.ensure_rel("xl/workbook.xml", REL_PERSON, PERSON_PART)
    for person in root.findall(qtc("person")):
        if person.get("displayName") == display_name:
            return person.get("id")
    guid = new_guid()
    person = etree.SubElement(root, qtc("person"))
    person.set("displayName", display_name)
    person.set("id", guid)
    person.set("userId", display_name)
    person.set("providerId", "None")
    return guid


# ---------------------------------------------------------------- reading


def read_threaded(pkg, sheet_name, part, people):
    root = pkg.tree(part)
    out = []
    if root is None:
        return out
    resolved_by_id = {}
    for tc in root.findall(qtc("threadedComment")):
        if not tc.get("parentId"):
            resolved_by_id[tc.get("id")] = tc.get("done") in ("1", "true")
    for tc in root.findall(qtc("threadedComment")):
        parent = tc.get("parentId")
        text = tc.find(qtc("text"))
        thread_id = parent or tc.get("id")
        out.append({
            "kind": "threaded",
            "sheet": sheet_name,
            "cell": tc.get("ref"),
            "id": tc.get("id"),
            "author": people.get(tc.get("personId"), ""),
            "author_id": tc.get("personId"),
            "created": tc.get("dT"),
            "text": text.text or "" if text is not None else "",
            "parent_id": parent,
            "resolved": resolved_by_id.get(thread_id, False),
            "part": part,
        })
    return out


def note_text(comment):
    """Flatten a legacy note's rich text runs into one string."""
    text = comment.find(qx("text"))
    if text is None:
        return ""
    chunks = []
    for t in text.iter(qx("t")):
        chunks.append(t.text or "")
    return "".join(chunks)


def read_notes(pkg, sheet_name, part):
    root = pkg.tree(part)
    out = []
    if root is None:
        return out
    authors = []
    author_lst = root.find(qx("authors"))
    if author_lst is not None:
        authors = [a.text or "" for a in author_lst.findall(qx("author"))]
    lst = root.find(qx("commentList"))
    if lst is None:
        return out
    for comment in lst.findall(qx("comment")):
        try:
            author = authors[int(comment.get("authorId") or 0)]
        except (ValueError, IndexError):
            author = ""
        out.append({
            "kind": "note",
            "sheet": sheet_name,
            "cell": comment.get("ref"),
            "id": f"note:{sheet_name}!{comment.get('ref')}",
            "author": author,
            "author_id": comment.get("authorId"),
            "created": None,
            "text": note_text(comment),
            "parent_id": None,
            # A legacy note predates resolvable threads, so it has no
            # resolved state to report.
            "resolved": None,
            "part": part,
        })
    return out


def list_comments(pkg, include_part=False):
    people = persons(pkg)
    out = []
    for name, part in sheets(pkg):
        for comments_part in pkg.rel_targets(part, REL_COMMENTS):
            try:
                out.extend(read_notes(pkg, name, comments_part))
            except etree.XMLSyntaxError:
                # One unreadable legacy part must not hide the rest.
                pass
        for tc_part in pkg.rel_targets(part, REL_THREADED):
            out.extend(read_threaded(pkg, name, tc_part, people))
    if not include_part:
        for row in out:
            row.pop("part", None)
    return out


# ------------------------------------------------------- threaded writing


def threaded_part_for(pkg, sheet, create=False):
    existing = pkg.rel_targets(sheet, REL_THREADED)
    if existing:
        return existing[0]
    if not create:
        return None
    n = 1
    while pkg.has(f"xl/threadedComments/threadedComment{n}.xml"):
        n += 1
    part = f"xl/threadedComments/threadedComment{n}.xml"
    root = etree.Element(qtc("ThreadedComments"), nsmap={None: TC, "x": X})
    pkg.put(part, etree.tostring(root, xml_declaration=True,
                                 encoding="UTF-8", standalone=True))
    pkg.set_tree(part, root)
    pkg.ensure_override("/" + part, CT_THREADED)
    pkg.ensure_rel(sheet, REL_THREADED, part)
    return part


def add_threaded(pkg, sheet_name, cell, text, author):
    sheet = sheet_part(pkg, sheet_name)
    person_id = ensure_person(pkg, author)
    part = threaded_part_for(pkg, sheet, create=True)
    root = pkg.tree(part)
    tc = etree.SubElement(root, qtc("threadedComment"))
    guid = new_guid()
    tc.set("ref", cell.upper())
    tc.set("dT", now_stamp())
    tc.set("personId", person_id)
    tc.set("id", guid)
    body = etree.SubElement(tc, qtc("text"))
    body.text = text
    return guid


def find_thread(pkg, comment_id):
    """Locate the first comment of the thread a given id belongs to."""
    for name, sheet in sheets(pkg):
        for part in pkg.rel_targets(sheet, REL_THREADED):
            root = pkg.tree(part)
            if root is None:
                continue
            by_id = {tc.get("id"): tc
                     for tc in root.findall(qtc("threadedComment"))}
            tc = by_id.get(comment_id)
            if tc is None:
                continue
            parent = tc.get("parentId")
            head = by_id.get(parent, tc) if parent else tc
            return name, part, root, head
    return None, None, None, None


def reply_threaded(pkg, comment_id, text, author):
    name, part, root, head = find_thread(pkg, comment_id)
    if head is None:
        raise SystemExit(f"no threaded comment with id {comment_id}")
    person_id = ensure_person(pkg, author)
    tc = etree.SubElement(root, qtc("threadedComment"))
    guid = new_guid()
    tc.set("ref", head.get("ref"))
    tc.set("dT", now_stamp())
    tc.set("personId", person_id)
    tc.set("id", guid)
    tc.set("parentId", head.get("id"))
    body = etree.SubElement(tc, qtc("text"))
    body.text = text
    return guid, head.get("id"), name


def set_done(pkg, comment_id, done):
    _name, _part, _root, head = find_thread(pkg, comment_id)
    if head is None:
        raise SystemExit(f"no threaded comment with id {comment_id}")
    if done:
        head.set("done", "1")
    else:
        head.set("done", "0")
    return head.get("id")


def delete_threaded(pkg, comment_id):
    _name, part, root, head = find_thread(pkg, comment_id)
    if head is None:
        return None
    thread_id = head.get("id")
    removed = 0
    for tc in list(root.findall(qtc("threadedComment"))):
        if tc.get("id") == thread_id or tc.get("parentId") == thread_id:
            root.remove(tc)
            removed += 1
    return {"deleted": thread_id, "kind": "threaded", "part": part,
            "removed": removed}


# ---------------------------------------------------------- legacy notes


def comments_part_for(pkg, sheet, create=False):
    existing = pkg.rel_targets(sheet, REL_COMMENTS)
    if existing:
        return existing[0]
    if not create:
        return None
    n = 1
    while pkg.has(f"xl/comments{n}.xml"):
        n += 1
    part = f"xl/comments{n}.xml"
    root = etree.Element(qx("comments"), nsmap={None: X})
    etree.SubElement(root, qx("authors"))
    etree.SubElement(root, qx("commentList"))
    pkg.put(part, etree.tostring(root, xml_declaration=True,
                                 encoding="UTF-8", standalone=True))
    pkg.set_tree(part, root)
    pkg.ensure_override("/" + part, CT_COMMENTS)
    pkg.ensure_rel(sheet, REL_COMMENTS, part)
    return part


def ensure_legacy_drawing(pkg, sheet, vml_part):
    """Point the worksheet at the VML part that draws its note boxes."""
    rid = pkg.ensure_rel(sheet, REL_VML, vml_part)
    root = pkg.tree(sheet)
    existing = root.find(qx("legacyDrawing"))
    if existing is not None:
        existing.set(qr("id"), rid)
        return rid
    el = etree.Element(qx("legacyDrawing"))
    el.set(qr("id"), rid)
    drawing = root.find(qx("drawing"))
    if drawing is not None:
        drawing.addnext(el)
        return rid
    for tag in AFTER_LEGACY_DRAWING:
        following = root.find(qx(tag))
        if following is not None:
            following.addprevious(el)
            return rid
    root.append(el)
    return rid


def vml_part_for(pkg, sheet):
    existing = pkg.rel_targets(sheet, REL_VML)
    if existing:
        return existing[0]
    n = 1
    while pkg.has(f"xl/drawings/vmlDrawing{n}.vml"):
        n += 1
    return f"xl/drawings/vmlDrawing{n}.vml"


def rewrite_vml(pkg, sheet, part, notes):
    """Regenerate the note boxes for one sheet.

    openpyxl's ShapeWriter is reused here so the VML matches what the
    library itself produces, while the rest of the package is left
    alone.
    """
    pkg.ensure_default("vml", CT_VML)
    root = None
    if pkg.has(part):
        try:
            root = etree.fromstring(pkg.raw(part))
        except etree.XMLSyntaxError:
            root = None
    comments = [(ref, Comment(text, author))
                for ref, author, text in notes]
    pkg.put(part, ShapeWriter(comments).write(root))
    pkg.forget_tree(part)
    ensure_legacy_drawing(pkg, sheet, part)


def notes_of(pkg, part):
    """Existing notes of a comments part as (ref, author, text)."""
    root = pkg.tree(part)
    out = []
    if root is None:
        return out
    authors = []
    author_lst = root.find(qx("authors"))
    if author_lst is not None:
        authors = [a.text or "" for a in author_lst.findall(qx("author"))]
    lst = root.find(qx("commentList"))
    if lst is None:
        return out
    for comment in lst.findall(qx("comment")):
        try:
            author = authors[int(comment.get("authorId") or 0)]
        except (ValueError, IndexError):
            author = ""
        out.append((comment.get("ref"), author, note_text(comment)))
    return out


def write_notes(pkg, part, notes):
    """Replace a comments part's author list and comment list."""
    root = pkg.tree(part)
    authors = []
    for _ref, author, _text in notes:
        if author not in authors:
            authors.append(author)
    author_lst = root.find(qx("authors"))
    if author_lst is None:
        author_lst = etree.SubElement(root, qx("authors"))
    for child in list(author_lst):
        author_lst.remove(child)
    for author in authors:
        el = etree.SubElement(author_lst, qx("author"))
        el.text = author
    lst = root.find(qx("commentList"))
    if lst is None:
        lst = etree.SubElement(root, qx("commentList"))
    for child in list(lst):
        lst.remove(child)
    for ref, author, text in notes:
        comment = etree.SubElement(lst, qx("comment"))
        comment.set("ref", ref)
        comment.set("authorId", str(authors.index(author)))
        body = etree.SubElement(comment, qx("text"))
        run = etree.SubElement(body, qx("r"))
        etree.SubElement(run, qx("rPr"))
        t = etree.SubElement(run, qx("t"))
        t.text = text
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def add_note(pkg, sheet_name, cell, text, author):
    sheet = sheet_part(pkg, sheet_name)
    part = comments_part_for(pkg, sheet, create=True)
    ref = cell.upper()
    notes = [n for n in notes_of(pkg, part) if n[0] != ref]
    notes.append((ref, author, text))
    write_notes(pkg, part, notes)
    rewrite_vml(pkg, sheet, vml_part_for(pkg, sheet), notes)
    return ref


def delete_note(pkg, sheet_name, cell):
    sheet = sheet_part(pkg, sheet_name)
    part = comments_part_for(pkg, sheet)
    if part is None:
        raise SystemExit(f"{sheet_name} has no legacy notes")
    ref = cell.upper()
    notes = notes_of(pkg, part)
    kept = [n for n in notes if n[0] != ref]
    if len(kept) == len(notes):
        raise SystemExit(f"no note on {sheet_name}!{ref}")
    write_notes(pkg, part, kept)
    rewrite_vml(pkg, sheet, vml_part_for(pkg, sheet), kept)
    return ref


def delete_any(pkg, comment_id):
    """Delete a threaded thread, or a legacy note by its note: id."""
    if comment_id.startswith("note:"):
        target = comment_id[len("note:"):]
        if "!" not in target:
            raise SystemExit(f"malformed note id {comment_id}")
        sheet_name, cell = target.rsplit("!", 1)
        delete_note(pkg, sheet_name, cell)
        return {"deleted": comment_id, "kind": "note"}
    result = delete_threaded(pkg, comment_id)
    if result is None:
        raise SystemExit(f"no comment thread with id {comment_id}")
    return result


# ---------------------------------------------------------------- cli


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="list every comment in the workbook")
    p.add_argument("xlsx")

    p = sub.add_parser("add", help="start a threaded comment on a cell")
    p.add_argument("xlsx")
    p.add_argument("-o", "--output", help="output path (default: in place)")
    p.add_argument("--sheet", required=True)
    p.add_argument("--cell", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--author", default="Hermes")

    p = sub.add_parser("reply", help="reply into a thread")
    p.add_argument("xlsx")
    p.add_argument("-o", "--output")
    p.add_argument("--id", required=True, help="thread or reply id")
    p.add_argument("--text", required=True)
    p.add_argument("--author", default="Hermes")

    for name, help_text in (("resolve", "mark a thread resolved"),
                            ("reopen", "make a thread open again")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("xlsx")
        p.add_argument("-o", "--output")
        p.add_argument("--id", required=True)

    p = sub.add_parser("delete", help="delete a thread or a legacy note")
    p.add_argument("xlsx")
    p.add_argument("-o", "--output")
    p.add_argument("--id", required=True)

    p = sub.add_parser("add-note", help="write a legacy note on a cell")
    p.add_argument("xlsx")
    p.add_argument("-o", "--output")
    p.add_argument("--sheet", required=True)
    p.add_argument("--cell", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--author", default="Hermes")

    p = sub.add_parser("delete-note", help="remove a legacy note")
    p.add_argument("xlsx")
    p.add_argument("-o", "--output")
    p.add_argument("--sheet", required=True)
    p.add_argument("--cell", required=True)

    args = ap.parse_args(argv)
    pkg = Package(args.xlsx)

    if args.cmd == "list":
        print(json.dumps({"ok": True,
                          "comments": list_comments(pkg)},
                         ensure_ascii=False))
        return 0

    report = {"ok": True}
    if args.cmd == "add":
        report["id"] = add_threaded(pkg, args.sheet, args.cell,
                                    args.text, args.author)
        report["cell"] = args.cell.upper()
    elif args.cmd == "reply":
        guid, parent, sheet_name = reply_threaded(pkg, args.id, args.text,
                                                  args.author)
        report["id"] = guid
        report["parent_id"] = parent
        report["sheet"] = sheet_name
    elif args.cmd == "resolve":
        report["id"] = set_done(pkg, args.id, True)
        report["resolved"] = True
    elif args.cmd == "reopen":
        report["id"] = set_done(pkg, args.id, False)
        report["resolved"] = False
    elif args.cmd == "delete":
        report.update(delete_any(pkg, args.id))
    elif args.cmd == "add-note":
        report["cell"] = add_note(pkg, args.sheet, args.cell, args.text,
                                  args.author)
        report["kind"] = "note"
    elif args.cmd == "delete-note":
        report["cell"] = delete_note(pkg, args.sheet, args.cell)
        report["kind"] = "note"

    out = args.output or args.xlsx
    if not os.path.isdir(os.path.dirname(out) or "."):
        raise SystemExit(f"no directory for {out}")
    pkg.save(out)
    report["output"] = out
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
