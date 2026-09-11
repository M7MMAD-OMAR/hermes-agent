#!/usr/bin/env python3
# MIT License. Part of the Hermes powerpoint skill.
"""List, add, reply to, resolve and delete comments in a .pptx.

PowerPoint has two comment systems and this script reads both.

Legacy per slide comments live in ppt/comments/commentN.xml as a
p:cmLst of p:cm elements keyed by (authorId, idx), with the author
roster in ppt/commentAuthors.xml. A reply is a sibling p:cm carrying a
p15:parentCm back reference inside its p:extLst. There is no resolved
state in that system.

Modern threaded comments live in ppt/comments/modernComment_*.xml as a
p188:cmLst, with the author roster in ppt/authors.xml. Replies nest
inside p188:replyLst, and the thread's resolved state is the status
attribute on p188:cm ("active", "resolved" or "closed"). This is what
current PowerPoint and the web app write, so new comments are written
here.

Subcommands:
  list      JSON per comment: kind, slide, id, author, created, text,
            shape, parent_id, resolved
  add       add a thread on a slide, optionally anchored to a shape
  reply     append a reply into an existing thread
  resolve   mark a thread resolved
  reopen    mark a resolved thread active again
  delete    remove a thread and its replies

Examples:
  pptx_comments.py list deck.pptx
  pptx_comments.py add deck.pptx --slide 2 --text "Tighten this" \
      --author "Reviewer" -o reviewed.pptx
  pptx_comments.py add deck.pptx --slide 2 --shape "Title 1" \
      --text "Wrong wording"
  pptx_comments.py reply deck.pptx --id "{...}" --text "Fixed"
  pptx_comments.py resolve deck.pptx --id "{...}"
  pptx_comments.py delete deck.pptx --id "{...}"

Every write goes through a zip level rewrite that copies each part
across untouched unless this script changed it, so charts, embedded
workbooks, media and any part python-pptx does not model survive.
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

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P188 = "http://schemas.microsoft.com/office/powerpoint/2018/8/main"
P15 = "http://schemas.microsoft.com/office/powerpoint/2012/main"
PC = "http://schemas.microsoft.com/office/powerpoint/2013/main/command"
AC = "http://schemas.microsoft.com/office/drawing/2013/main/command"
A16 = "http://schemas.microsoft.com/office/drawing/2014/main"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

REL_LEGACY_COMMENTS = f"{R}/comments"
REL_COMMENT_AUTHORS = f"{R}/commentAuthors"
REL_SLIDE = f"{R}/slide"
REL_MODERN_COMMENTS = ("http://schemas.microsoft.com/office/2018/10"
                       "/relationships/comments")
REL_AUTHORS = ("http://schemas.microsoft.com/office/2018/10"
               "/relationships/authors")

CT_LEGACY_COMMENT = ("application/vnd.openxmlformats-officedocument"
                     ".presentationml.comment+xml")
CT_COMMENT_AUTHORS = ("application/vnd.openxmlformats-officedocument"
                      ".presentationml.commentAuthors+xml")
CT_MODERN_COMMENT = "application/vnd.ms-powerpoint.comments+xml"
CT_AUTHORS = "application/vnd.ms-powerpoint.authors+xml"

# The uri is fixed by the drawing extension that carries a shape's
# creation id; a modern comment anchors to that id, not to the shape's
# numeric id alone.
CREATION_ID_EXT = "{FAA26D3D-D897-4be2-8F04-BA451C77F1D7}"
# The two extension uris a legacy comment uses for threading and for
# the author's presence record.
THREADING_EXT = "{C676402C-5697-4E1C-873F-D02D1690AC5C}"

NSMAP_MODERN = {"a": A, "r": R, "p188": P188}
NSMAP_AUTHORS = {"a": A, "r": R, "p188": P188}


def qa(tag):
    return f"{{{A}}}{tag}"


def qp(tag):
    return f"{{{P}}}{tag}"


def qr(tag):
    return f"{{{R}}}{tag}"


def q188(tag):
    return f"{{{P188}}}{tag}"


def q15(tag):
    return f"{{{P15}}}{tag}"


def qpc(tag):
    return f"{{{PC}}}{tag}"


def qac(tag):
    return f"{{{AC}}}{tag}"


def qct(tag):
    return f"{{{CT_NS}}}{tag}"


def qrel(tag):
    return f"{{{REL_NS}}}{tag}"


def now_stamp():
    """Timestamp in the shape PowerPoint itself writes.

    Observed producer output carries milliseconds and no timezone
    designator, so a file this script writes reads back the same way a
    PowerPoint authored one does.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]


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

    # --- raw parts

    def has(self, name):
        return name in self.blobs

    def get(self, name):
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

    # --- parsed parts

    def tree(self, name):
        """Parsed root of a part, cached so edits accumulate."""
        if name not in self._trees:
            if name not in self.blobs:
                return None
            self._trees[name] = etree.fromstring(self.blobs[name])
        return self._trees[name]

    def set_tree(self, name, root):
        self._trees[name] = root

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
        """Absolute part names a part points at through reltype."""
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
        """Add a relationship if it is missing, returning its id."""
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


# ---------------------------------------------------------------- slides


def slide_parts(pkg):
    """Slide part names in presentation order."""
    pres = pkg.tree("ppt/presentation.xml")
    if pres is None:
        return []
    rels = pkg.rels("ppt/presentation.xml")
    by_id = {}
    if rels is not None:
        for rel in rels.findall(qrel("Relationship")):
            by_id[rel.get("Id")] = rel.get("Target")
    out = []
    lst = pres.find(qp("sldIdLst"))
    if lst is None:
        return out
    for sld in lst.findall(qp("sldId")):
        target = by_id.get(sld.get(qr("id")))
        if target:
            out.append(resolve_target("ppt", target))
    return out


def slide_ids(pkg):
    """Map slide part name to the sldId the presentation gave it."""
    pres = pkg.tree("ppt/presentation.xml")
    rels = pkg.rels("ppt/presentation.xml")
    by_id = {}
    if rels is not None:
        for rel in rels.findall(qrel("Relationship")):
            by_id[rel.get("Id")] = rel.get("Target")
    out = {}
    lst = pres.find(qp("sldIdLst")) if pres is not None else None
    if lst is None:
        return out
    for sld in lst.findall(qp("sldId")):
        target = by_id.get(sld.get(qr("id")))
        if target:
            part = resolve_target("ppt", target)
            out[part] = sld.get("id")
    return out


def shape_index(pkg, slide_part):
    """Map shape name and shape id to (id, name, creation_id)."""
    root = pkg.tree(slide_part)
    by_name, by_id = {}, {}
    if root is None:
        return by_name, by_id
    for cnv in root.iter(qp("cNvPr")):
        sid = cnv.get("id")
        name = cnv.get("name") or ""
        creation = None
        ext_lst = cnv.find(qa("extLst"))
        if ext_lst is not None:
            for ext in ext_lst.findall(qa("ext")):
                cid = ext.find(f"{{{A16}}}creationId")
                if cid is not None:
                    creation = cid.get("id")
        entry = (sid, name, creation)
        by_id[sid] = entry
        by_name.setdefault(name, entry)
    return by_name, by_id


def ensure_creation_id(pkg, slide_part, shape_id):
    """Give a shape a creation id so a comment can anchor to it.

    PowerPoint matches a modern comment's anchor on the creation id, so
    a shape authored by a producer that never wrote one (python-pptx
    among them) needs one added before it can carry an anchored
    comment.
    """
    root = pkg.tree(slide_part)
    for cnv in root.iter(qp("cNvPr")):
        if cnv.get("id") != shape_id:
            continue
        ext_lst = cnv.find(qa("extLst"))
        if ext_lst is None:
            ext_lst = etree.SubElement(cnv, qa("extLst"))
        for ext in ext_lst.findall(qa("ext")):
            cid = ext.find(f"{{{A16}}}creationId")
            if cid is not None:
                return cid.get("id")
        ext = etree.SubElement(ext_lst, qa("ext"))
        ext.set("uri", CREATION_ID_EXT)
        cid = etree.SubElement(ext, f"{{{A16}}}creationId",
                               nsmap={"a16": A16})
        guid = new_guid()
        cid.set("id", guid)
        return guid
    return None


def slide_change_id(slide_part):
    """A stable cId for a slide marker.

    PowerPoint stores a per session change id here. Nothing reads it
    back for correctness, so a value derived from the part name keeps
    repeated runs on one deck byte stable.
    """
    h = 0
    for ch in slide_part:
        h = (h * 131 + ord(ch)) & 0x7FFFFFFF
    return str(h)


# ---------------------------------------------------------------- authors


def legacy_authors(pkg):
    out = {}
    part = "ppt/commentAuthors.xml"
    root = pkg.tree(part)
    if root is None:
        return out
    for author in root.findall(qp("cmAuthor")):
        out[author.get("id")] = {
            "name": author.get("name") or "",
            "initials": author.get("initials") or "",
        }
    return out


def modern_authors(pkg):
    out = {}
    root = pkg.tree("ppt/authors.xml")
    if root is None:
        return out
    for author in root.findall(q188("author")):
        out[author.get("id")] = {
            "name": author.get("name") or "",
            "initials": author.get("initials") or "",
        }
    return out


def ensure_modern_author(pkg, name, initials):
    """Find or create an entry in ppt/authors.xml, returning its id."""
    part = "ppt/authors.xml"
    root = pkg.tree(part)
    if root is None:
        root = etree.Element(q188("authorLst"), nsmap=NSMAP_AUTHORS)
        pkg.put(part, etree.tostring(root, xml_declaration=True,
                                     encoding="UTF-8", standalone=True))
        pkg.set_tree(part, root)
        pkg.ensure_override("/ppt/authors.xml", CT_AUTHORS)
        pkg.ensure_rel("ppt/presentation.xml", REL_AUTHORS, part)
    for author in root.findall(q188("author")):
        if author.get("name") == name:
            return author.get("id")
    guid = new_guid()
    author = etree.SubElement(root, q188("author"))
    author.set("id", guid)
    author.set("name", name)
    author.set("initials", initials or "".join(
        w[0] for w in name.split()[:3]).upper())
    return guid


# ---------------------------------------------------------------- reading


def text_of_txbody(body):
    """Paragraph text of a p188:txBody, newline separated."""
    if body is None:
        return ""
    paras = []
    for para in body.findall(qa("p")):
        paras.append("".join(t.text or "" for t in para.iter(qa("t"))))
    return "\n".join(paras)


def anchor_of(cm, by_id):
    """Shape name and id a modern comment is anchored to, if any."""
    for lst in (cm.find(qac("deMkLst")), cm.find(qpc("spMkLst"))):
        if lst is None:
            continue
        for mk in lst:
            tag = etree.QName(mk).localname
            if not tag.endswith("Mk") or tag in ("docMk", "sldMk"):
                continue
            sid = mk.get("id")
            entry = by_id.get(sid)
            return (entry[1] if entry else None), sid
    return None, None


def read_modern(pkg, slide_no, part, authors, by_id):
    root = pkg.tree(part)
    out = []
    if root is None:
        return out
    for cm in root.findall(q188("cm")):
        status = cm.get("status") or "active"
        shape, shape_id = anchor_of(cm, by_id)
        author = authors.get(cm.get("authorId"), {})
        cid = cm.get("id")
        out.append({
            "kind": "modern",
            "slide": slide_no,
            "id": cid,
            "author": author.get("name", ""),
            "author_id": cm.get("authorId"),
            "created": cm.get("created"),
            "text": text_of_txbody(cm.find(q188("txBody"))),
            "shape": shape,
            "shape_id": shape_id,
            "parent_id": None,
            "resolved": status == "resolved",
            "status": status,
            "part": part,
        })
        replies = cm.find(q188("replyLst"))
        if replies is None:
            continue
        for reply in replies.findall(q188("reply")):
            rauthor = authors.get(reply.get("authorId"), {})
            out.append({
                "kind": "modern",
                "slide": slide_no,
                "id": reply.get("id"),
                "author": rauthor.get("name", ""),
                "author_id": reply.get("authorId"),
                "created": reply.get("created"),
                "text": text_of_txbody(reply.find(q188("txBody"))),
                "shape": shape,
                "shape_id": shape_id,
                "parent_id": cid,
                "resolved": status == "resolved",
                "status": status,
                "part": part,
            })
    return out


def legacy_parent(cm):
    """The (authorId, idx) a legacy reply points back at, if any."""
    ext_lst = cm.find(qp("extLst"))
    if ext_lst is None:
        return None
    for ext in ext_lst.findall(qp("ext")):
        info = ext.find(q15("threadingInfo"))
        if info is None:
            continue
        parent = info.find(q15("parentCm"))
        if parent is not None:
            return f"{parent.get('authorId')}:{parent.get('idx')}"
    return None


def read_legacy(pkg, slide_no, part, authors):
    root = pkg.tree(part)
    out = []
    if root is None:
        return out
    for cm in root.findall(qp("cm")):
        author = authors.get(cm.get("authorId"), {})
        text_el = cm.find(qp("text"))
        out.append({
            "kind": "legacy",
            "slide": slide_no,
            "id": f"{cm.get('authorId')}:{cm.get('idx')}",
            "author": author.get("name", ""),
            "author_id": cm.get("authorId"),
            "created": cm.get("dt"),
            "text": text_el.text or "" if text_el is not None else "",
            "shape": None,
            "shape_id": None,
            "parent_id": legacy_parent(cm),
            # The legacy system predates resolvable threads, so a
            # legacy comment has no resolved state to report.
            "resolved": None,
            "status": None,
            "part": part,
        })
    return out


def list_comments(pkg, include_part=False):
    legacy = legacy_authors(pkg)
    modern = modern_authors(pkg)
    out = []
    for i, slide in enumerate(slide_parts(pkg), start=1):
        _, by_id = shape_index(pkg, slide)
        for part in pkg.rel_targets(slide, REL_LEGACY_COMMENTS):
            out.extend(read_legacy(pkg, i, part, legacy))
        for part in pkg.rel_targets(slide, REL_MODERN_COMMENTS):
            out.extend(read_modern(pkg, i, part, modern, by_id))
    if not include_part:
        for row in out:
            row.pop("part", None)
    return out


# ---------------------------------------------------------------- writing


def make_txbody(text):
    body = etree.Element(q188("txBody"))
    etree.SubElement(body, qa("bodyPr"))
    etree.SubElement(body, qa("lstStyle"))
    for line in (text or "").split("\n"):
        para = etree.SubElement(body, qa("p"))
        run = etree.SubElement(para, qa("r"))
        rpr = etree.SubElement(run, qa("rPr"))
        rpr.set("lang", "en-US")
        t = etree.SubElement(run, qa("t"))
        t.text = line
    return body


def modern_part_for(pkg, slide_part, create=False):
    existing = pkg.rel_targets(slide_part, REL_MODERN_COMMENTS)
    if existing:
        return existing[0]
    if not create:
        return None
    n = 1
    while pkg.has(f"ppt/comments/modernComment_{n}.xml"):
        n += 1
    part = f"ppt/comments/modernComment_{n}.xml"
    root = etree.Element(q188("cmLst"), nsmap=NSMAP_MODERN)
    pkg.put(part, etree.tostring(root, xml_declaration=True,
                                 encoding="UTF-8", standalone=True))
    pkg.set_tree(part, root)
    pkg.ensure_override("/" + part, CT_MODERN_COMMENT)
    pkg.ensure_rel(slide_part, REL_MODERN_COMMENTS, part)
    return part


def add_marker(cm, slide_part, sld_id, shape):
    """Attach the anchor markers a modern comment needs.

    An unanchored comment carries a slide marker list; one pinned to a
    shape carries a drawing element marker list that repeats the slide
    marker and adds the shape.
    """
    cid = slide_change_id(slide_part)
    if shape is None:
        lst = etree.SubElement(cm, qpc("sldMkLst"), nsmap={"pc": PC})
        etree.SubElement(lst, qpc("docMk"))
        sld = etree.SubElement(lst, qpc("sldMk"))
        sld.set("cId", cid)
        sld.set("sldId", sld_id or "256")
        return
    shape_id, _name, creation = shape
    lst = etree.SubElement(cm, qac("deMkLst"), nsmap={"ac": AC})
    etree.SubElement(lst, qpc("docMk"), nsmap={"pc": PC})
    sld = etree.SubElement(lst, qpc("sldMk"), nsmap={"pc": PC})
    sld.set("cId", cid)
    sld.set("sldId", sld_id or "256")
    sp = etree.SubElement(lst, qac("spMk"))
    sp.set("id", shape_id)
    sp.set("creationId", creation)


def add_comment(pkg, slide_no, text, author, initials, shape_name):
    parts = slide_parts(pkg)
    if not 1 <= slide_no <= len(parts):
        raise SystemExit(f"no slide {slide_no}; deck has {len(parts)}")
    slide_part = parts[slide_no - 1]
    author_id = ensure_modern_author(pkg, author, initials)
    part = modern_part_for(pkg, slide_part, create=True)
    root = pkg.tree(part)

    shape = None
    if shape_name:
        by_name, by_id = shape_index(pkg, slide_part)
        entry = by_name.get(shape_name) or by_id.get(shape_name)
        if entry is None:
            raise SystemExit(f"no shape named {shape_name!r} on slide "
                             f"{slide_no}")
        shape_id, name, creation = entry
        if not creation:
            creation = ensure_creation_id(pkg, slide_part, shape_id)
        shape = (shape_id, name, creation)

    cm = etree.SubElement(root, q188("cm"))
    guid = new_guid()
    cm.set("id", guid)
    cm.set("authorId", author_id)
    cm.set("created", now_stamp())
    add_marker(cm, slide_part, slide_ids(pkg).get(slide_part), shape)
    cm.append(make_txbody(text))
    return guid


def find_thread(pkg, comment_id):
    """Locate the p188:cm a thread id names, by id or by reply id."""
    for slide in slide_parts(pkg):
        for part in pkg.rel_targets(slide, REL_MODERN_COMMENTS):
            root = pkg.tree(part)
            if root is None:
                continue
            for cm in root.findall(q188("cm")):
                if cm.get("id") == comment_id:
                    return part, root, cm
                replies = cm.find(q188("replyLst"))
                if replies is None:
                    continue
                for reply in replies.findall(q188("reply")):
                    if reply.get("id") == comment_id:
                        return part, root, cm
    return None, None, None


def reply_to(pkg, comment_id, text, author, initials):
    part, _root, cm = find_thread(pkg, comment_id)
    if cm is None:
        raise SystemExit(f"no modern comment thread with id {comment_id}")
    author_id = ensure_modern_author(pkg, author, initials)
    replies = cm.find(q188("replyLst"))
    if replies is None:
        replies = etree.SubElement(cm, q188("replyLst"))
    reply = etree.SubElement(replies, q188("reply"))
    guid = new_guid()
    reply.set("id", guid)
    reply.set("authorId", author_id)
    reply.set("created", now_stamp())
    reply.append(make_txbody(text))
    return guid, cm.get("id"), part


def set_status(pkg, comment_id, status):
    _part, _root, cm = find_thread(pkg, comment_id)
    if cm is None:
        raise SystemExit(f"no modern comment thread with id {comment_id}")
    cm.set("status", status)
    return cm.get("id")


def delete_thread(pkg, comment_id):
    """Remove a thread, modern or legacy, with every reply under it."""
    part, root, cm = find_thread(pkg, comment_id)
    if cm is not None:
        root.remove(cm)
        return {"deleted": comment_id, "kind": "modern", "part": part}

    for slide in slide_parts(pkg):
        for part in pkg.rel_targets(slide, REL_LEGACY_COMMENTS):
            root = pkg.tree(part)
            if root is None:
                continue
            doomed = []
            for cm in root.findall(qp("cm")):
                key = f"{cm.get('authorId')}:{cm.get('idx')}"
                if key == comment_id or legacy_parent(cm) == comment_id:
                    doomed.append(cm)
            if doomed:
                for cm in doomed:
                    root.remove(cm)
                return {"deleted": comment_id, "kind": "legacy",
                        "part": part, "removed": len(doomed)}
    raise SystemExit(f"no comment thread with id {comment_id}")


# ---------------------------------------------------------------- cli


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="list every comment in the deck")
    p.add_argument("pptx")

    p = sub.add_parser("add", help="add a thread on a slide")
    p.add_argument("pptx")
    p.add_argument("-o", "--output", help="output path (default: in place)")
    p.add_argument("--slide", type=int, required=True,
                   help="slide number, 1 based")
    p.add_argument("--text", required=True)
    p.add_argument("--author", default="Hermes")
    p.add_argument("--initials", default="")
    p.add_argument("--shape", help="anchor to this shape name or id")

    p = sub.add_parser("reply", help="reply into a thread")
    p.add_argument("pptx")
    p.add_argument("-o", "--output")
    p.add_argument("--id", required=True, help="thread or reply id")
    p.add_argument("--text", required=True)
    p.add_argument("--author", default="Hermes")
    p.add_argument("--initials", default="")

    for name, help_text in (("resolve", "mark a thread resolved"),
                            ("reopen", "make a thread active again")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("pptx")
        p.add_argument("-o", "--output")
        p.add_argument("--id", required=True)

    p = sub.add_parser("delete", help="delete a thread and its replies")
    p.add_argument("pptx")
    p.add_argument("-o", "--output")
    p.add_argument("--id", required=True)

    args = ap.parse_args(argv)
    pkg = Package(args.pptx)

    if args.cmd == "list":
        print(json.dumps({"ok": True,
                          "comments": list_comments(pkg)},
                         ensure_ascii=False))
        return 0

    report = {"ok": True}
    if args.cmd == "add":
        report["id"] = add_comment(pkg, args.slide, args.text,
                                   args.author, args.initials, args.shape)
        report["slide"] = args.slide
    elif args.cmd == "reply":
        guid, parent, _part = reply_to(pkg, args.id, args.text,
                                       args.author, args.initials)
        report["id"] = guid
        report["parent_id"] = parent
    elif args.cmd == "resolve":
        report["id"] = set_status(pkg, args.id, "resolved")
        report["resolved"] = True
    elif args.cmd == "reopen":
        report["id"] = set_status(pkg, args.id, "active")
        report["resolved"] = False
    elif args.cmd == "delete":
        report.update(delete_thread(pkg, args.id))

    out = args.output or args.pptx
    if not os.path.isdir(os.path.dirname(out) or "."):
        raise SystemExit(f"no directory for {out}")
    pkg.save(out)
    report["output"] = out
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
