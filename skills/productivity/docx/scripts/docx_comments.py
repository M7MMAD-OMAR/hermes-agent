#!/usr/bin/env python3
# MIT License. Part of the Hermes docx skill.
"""Hold a review conversation inside a .docx: read, reply, resolve, delete.

Subcommands:
  list          JSON per comment: id, author, initials, date, text,
                anchored_text, context, para_id, parent_id, resolved,
                reply_ids.
                --json threads returns the same records as a thread tree.
  add           add a comment anchored to the first occurrence of --target
  reply         reply in thread to an existing comment by --id
  resolve       mark a whole thread resolved (parent and replies together)
  reopen        clear the resolved mark on a whole thread
  delete        remove one comment (and its range markers) by --id
  delete-thread remove a whole thread by --id

Examples:
  docx_comments.py list report.docx --json threads
  docx_comments.py add report.docx --target "Q3 revenue" \
      --text "Needs a source" --author "Reviewer" -o out.docx
  docx_comments.py reply report.docx --id 0 --text "Added one" -o out.docx
  docx_comments.py resolve report.docx --id 0 -o out.docx
  docx_comments.py delete-thread report.docx --id 0 -o out.docx

Threading lives in three sibling parts that Word writes next to
word/comments.xml, and this script creates them when they are absent:

  word/commentsExtended.xml    w15:commentEx, one per comment, keyed by the
                               w14:paraId of the comment's last paragraph.
                               w15:paraIdParent points at the thread root and
                               w15:done carries the resolved state.
  word/commentsIds.xml         w16cid:commentId, pairing that paraId with a
                               durable id that survives renumbering.
  word/commentsExtensible.xml  w16cex:commentExtensible, optional, updated
                               only when the document already has the part.

A LibreOffice round trip (soffice --headless --convert-to docx) keeps the
thread structure, the paraIdParent links, the resolved state and Arabic text,
and it loses two things: word/commentsIds.xml is dropped entirely, and both
w:id and w14:paraId are renumbered, so never key anything on the numeric id
across a conversion. The next write through this script recreates the ids
part and backfills a durable id for every comment that has a paraId.

Word threads are flat: one root plus its replies, never a reply to a reply.
So a reply to a reply is filed under the same root, which is what Word does
and what makes the thread render as one conversation.

Uses the native python-docx comments API (>= 1.2) for `add` when available;
falls back to building word/comments.xml and the range markers directly for
older versions (or when --xml is passed). Everything else works at the XML
level so it handles documents from any producer, Word or LibreOffice.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import random
import sys
from copy import deepcopy

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import XmlPart
from docx.oxml.parser import parse_xml
from lxml import etree

from docx_common import iter_part_roots

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid"
W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

OOX = "application/vnd.openxmlformats-officedocument.wordprocessingml"
COMMENTS_CT = f"{OOX}.comments+xml"
EXTENDED_CT = f"{OOX}.commentsExtended+xml"
IDS_CT = f"{OOX}.commentsIds+xml"
EXTENSIBLE_CT = f"{OOX}.commentsExtensible+xml"

EXTENDED_RT = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended"
IDS_RT = "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds"
EXTENSIBLE_RT = ("http://schemas.microsoft.com/office/2018/08/relationships"
                 "/commentsExtensible")

_TRUE = {"1", "true", "on", "t"}


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def q14(tag: str) -> str:
    return f"{{{W14}}}{tag}"


def q15(tag: str) -> str:
    return f"{{{W15}}}{tag}"


def qcid(tag: str) -> str:
    return f"{{{W16CID}}}{tag}"


def qcex(tag: str) -> str:
    return f"{{{W16CEX}}}{tag}"


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _is_true(value) -> bool:
    return str(value or "").strip().lower() in _TRUE


# ---------------------------------------------------------------- parts

def _part_by_reltype(doc, reltype):
    for rel in doc.part.rels.values():
        if rel.reltype == reltype and not rel.is_external:
            return rel.target_part
    return None


def _live_root(part):
    """Return an element tree for `part` whose edits reach the saved file.

    Parts that python-docx loaded as opaque blobs get parsed once and then
    promoted to XmlPart, whose blob is serialized from the live element.
    """
    element = getattr(part, "_element", None)
    if element is not None:
        return element
    part._element = parse_xml(part.blob)
    if not isinstance(part, XmlPart):
        part.__class__ = type(
            f"Live{part.__class__.__name__}", (XmlPart, part.__class__), {})
    return part._element


def _comments_root(doc):
    """Return the XML root of the comments part, or None."""
    part = _part_by_reltype(doc, RT.COMMENTS)
    return None if part is None else _live_root(part)


def _ensure_part(doc, reltype, partname: str, content_type: str,
                 root_xml: str):
    """Return the live root of a sibling part, creating the part if needed."""
    part = _part_by_reltype(doc, reltype)
    if part is not None:
        return _live_root(part)
    root = parse_xml(root_xml.encode("utf-8"))
    part = XmlPart(PackURI(partname), content_type, root, doc.part.package)
    doc.part.relate_to(part, reltype)
    return root


def _ensure_comments_root(doc):
    root = _comments_root(doc)
    if root is not None:
        return root
    return _ensure_part(
        doc, RT.COMMENTS, "/word/comments.xml", COMMENTS_CT,
        f'<w:comments xmlns:w="{W}" xmlns:w14="{W14}" xmlns:mc="{MC}"'
        f' mc:Ignorable="w14"/>')


def _ensure_extended_root(doc):
    return _ensure_part(
        doc, EXTENDED_RT, "/word/commentsExtended.xml", EXTENDED_CT,
        f'<w15:commentsEx xmlns:w="{W}" xmlns:w14="{W14}" xmlns:w15="{W15}"'
        f' xmlns:mc="{MC}" mc:Ignorable="w14 w15"/>')


def _ensure_ids_root(doc):
    return _ensure_part(
        doc, IDS_RT, "/word/commentsIds.xml", IDS_CT,
        f'<w16cid:commentsIds xmlns:w="{W}" xmlns:w14="{W14}"'
        f' xmlns:w16cid="{W16CID}" xmlns:mc="{MC}"'
        f' mc:Ignorable="w14 w16cid"/>')


def _extended_root(doc):
    part = _part_by_reltype(doc, EXTENDED_RT)
    return None if part is None else _live_root(part)


def _ids_root(doc):
    part = _part_by_reltype(doc, IDS_RT)
    return None if part is None else _live_root(part)


def _extensible_root(doc):
    part = _part_by_reltype(doc, EXTENSIBLE_RT)
    return None if part is None else _live_root(part)


def _ensure_namespace(root, prefix: str, uri: str):
    """Return a root that declares `prefix`, rebuilding it once if it does not.

    A comment written by LibreOffice can arrive without the w14 prefix, and
    lxml cannot add a namespace declaration to an element that already exists.
    Rebuilding the root keeps mc:Ignorable and the serialized prefixes honest.
    """
    if root.nsmap.get(prefix) == uri:
        return root
    nsmap = dict(root.nsmap)
    nsmap.pop(None, None)
    nsmap[prefix] = uri
    nsmap.setdefault("mc", MC)
    decls = " ".join(f'xmlns:{p}="{u}"' for p, u in nsmap.items())
    tag = etree.QName(root).localname
    root_prefix = root.prefix or "w"
    new_root = parse_xml(f"<{root_prefix}:{tag} {decls}/>".encode("utf-8"))
    for name, value in root.attrib.items():
        new_root.set(name, value)
    ignorable = new_root.get(f"{{{MC}}}Ignorable", "").split()
    if prefix not in ignorable:
        ignorable.append(prefix)
        new_root.set(f"{{{MC}}}Ignorable", " ".join(ignorable))
    new_root.extend(list(root))
    parent = root.getparent()
    if parent is not None:
        parent.replace(root, new_root)
    return new_root


def _swap_comments_root(doc, root):
    """Install `root` as the comments part's live element."""
    part = _part_by_reltype(doc, RT.COMMENTS)
    if part is not None:
        part._element = root
        comments = getattr(part, "_comments", None)
        if comments is not None:
            part._comments = root
    return root


# ---------------------------------------------------------------- styles

COMMENT_STYLES = (
    ('<w:style xmlns:w="{w}" w:type="character" w:styleId="CommentReference">'
     '<w:name w:val="annotation reference"/><w:uiPriority w:val="99"/>'
     '<w:semiHidden/><w:unhideWhenUsed/>'
     '<w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'),
    ('<w:style xmlns:w="{w}" w:type="paragraph" w:styleId="CommentText">'
     '<w:name w:val="annotation text"/><w:basedOn w:val="Normal"/>'
     '<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
     '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
     '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'),
)


def ensure_comment_styles(doc) -> list:
    """Define the annotation styles the comment markup refers to.

    python-docx's native add_comment writes a CommentReference run style into
    document.xml, and its default template does not define it. An undefined
    style id is what docx_validate.py flags and what makes Word complain.
    """
    root = doc.styles.element
    have = {s.get(q("styleId")) for s in root.iter(q("style"))}
    added = []
    for xml in COMMENT_STYLES:
        element = parse_xml(xml.format(w=W).encode("utf-8"))
        style_id = element.get(q("styleId"))
        if style_id in have:
            continue
        root.append(element)
        added.append(style_id)
    return added


# ---------------------------------------------------------------- reading

def _anchored_texts(doc) -> dict:
    """Map comment id -> document text between its range markers."""
    anchored: dict[str, list[str]] = {}
    for root in iter_part_roots(doc):
        active: set[str] = set()
        for el in root.iter():
            if el.tag == q("commentRangeStart"):
                cid = el.get(q("id"))
                active.add(cid)
                anchored.setdefault(cid, [])
            elif el.tag == q("commentRangeEnd"):
                active.discard(el.get(q("id")))
            elif el.tag == q("t") and active:
                for cid in active:
                    anchored[cid].append(el.text or "")
    return {cid: "".join(parts) for cid, parts in anchored.items()}


def _comment_contexts(doc) -> dict:
    """Map comment id to the paragraph text its reference sits in.

    Word anchors a comment to a range, but LibreOffice writes a point
    comment: a w:commentReference with no w:commentRangeStart around it.
    For those, ``anchored_text`` is honestly empty and this is the only
    thing that tells a reader what the comment is about, so the listing
    carries both.
    """
    contexts: dict[str, str] = {}
    for root in iter_part_roots(doc):
        for para in root.iter(q("p")):
            refs = [el.get(q("id")) for el in para.iter(q("commentReference"))]
            if not refs:
                continue
            text = "".join(t.text or "" for t in para.iter(q("t")))
            for cid in refs:
                contexts.setdefault(cid, text.strip())
    return contexts


def _comment_paragraphs(comment):
    return [p for p in comment.iter(q("p"))]


def _comment_para_id(comment) -> str | None:
    """The w14:paraId Word threads on: the last paragraph of the comment."""
    for para in reversed(_comment_paragraphs(comment)):
        pid = para.get(q14("paraId"))
        if pid:
            return pid
    return None


def _comment_text(comment) -> str:
    return "\n".join("".join(t.text or "" for t in p.iter(q("t")))
                     for p in _comment_paragraphs(comment))


def _extended_entries(doc) -> dict:
    """Map paraId -> the w15:commentEx element carrying its thread state."""
    root = _extended_root(doc)
    if root is None:
        return {}
    out = {}
    for ex in root.iter(q15("commentEx")):
        pid = ex.get(q15("paraId"))
        if pid:
            out[pid] = ex
    return out


def thread_index(doc) -> dict:
    """Resolve every comment's paraId, thread root and resolved state.

    Returns {"order": [id, ...], "by_id": {id: record}}, where a record holds
    id, para_id, parent_id (None for a thread root) and resolved.
    """
    root = _comments_root(doc)
    order, by_id, by_para = [], {}, {}
    if root is None:
        return {"order": order, "by_id": by_id, "by_para": by_para}
    entries = _extended_entries(doc)
    for comment in root.iter(q("comment")):
        cid = comment.get(q("id"))
        para_id = _comment_para_id(comment)
        record = {"id": cid, "element": comment, "para_id": para_id,
                  "parent_para_id": None, "resolved": False}
        entry = entries.get(para_id) if para_id else None
        if entry is not None:
            record["parent_para_id"] = entry.get(q15("paraIdParent"))
            record["resolved"] = _is_true(entry.get(q15("done")))
        order.append(cid)
        by_id[cid] = record
        if para_id:
            by_para[para_id] = cid
    for record in by_id.values():
        parent = record["parent_para_id"]
        record["parent_id"] = by_para.get(parent) if parent else None
        if record["parent_id"] == record["id"]:
            record["parent_id"] = None
    return {"order": order, "by_id": by_id, "by_para": by_para}


def thread_root_id(index: dict, cid: str) -> str:
    """Walk paraIdParent up to the comment that has none. Word threads are flat."""
    seen = set()
    current = cid
    while current in index["by_id"] and current not in seen:
        seen.add(current)
        parent = index["by_id"][current].get("parent_id")
        if not parent:
            return current
        current = parent
    return current


def thread_member_ids(index: dict, cid: str) -> list:
    """The thread root followed by its replies, in comment-part order."""
    root_id = thread_root_id(index, cid)
    members = [root_id]
    for other in index["order"]:
        if other != root_id and thread_root_id(index, other) == root_id:
            members.append(other)
    return members


def reference_order(doc) -> dict:
    """Map comment id -> position of its reference mark in the document.

    The order of the comments part itself is arbitrary, and LibreOffice
    rewrites it on a round trip. The reference marks keep the order the
    conversation was written in, so replies are sorted by them.
    """
    order: dict[str, int] = {}
    position = 0
    for root in iter_part_roots(doc):
        for el in root.iter(q("commentReference")):
            cid = el.get(q("id"))
            if cid is not None and cid not in order:
                order[cid] = position
                position += 1
    return order


def list_comments(doc) -> list:
    """Flat JSON records, one per comment, in comments-part order."""
    root = _comments_root(doc)
    if root is None:
        return []
    anchored = _anchored_texts(doc)
    contexts = _comment_contexts(doc)
    index = thread_index(doc)
    positions = reference_order(doc)
    replies: dict[str, list] = {cid: [] for cid in index["order"]}
    for cid in index["order"]:
        parent = index["by_id"][cid].get("parent_id")
        if parent in replies:
            replies[parent].append(cid)
    for cid, kids in replies.items():
        kids.sort(key=lambda c: (positions.get(c, len(positions)),
                                 int(c) if c.isdigit() else 0))
    out = []
    for comment in root.iter(q("comment")):
        cid = comment.get(q("id"))
        record = index["by_id"].get(cid, {})
        out.append({"id": cid, "author": comment.get(q("author")),
                    "initials": comment.get(q("initials")),
                    "date": comment.get(q("date")),
                    "text": _comment_text(comment),
                    "anchored_text": anchored.get(cid, ""),
                    "context": contexts.get(cid, ""),
                    "para_id": record.get("para_id"),
                    "parent_id": record.get("parent_id"),
                    "resolved": bool(record.get("resolved")),
                    "reply_ids": replies.get(cid, [])})
    return out


def list_threads(doc) -> list:
    """The same records as a tree: thread roots each carrying their replies."""
    flat = {rec["id"]: dict(rec) for rec in list_comments(doc)}
    index = thread_index(doc)
    positions = reference_order(doc)
    roots = sorted(index["order"],
                   key=lambda c: (positions.get(c, len(positions)),
                                  int(c) if c.isdigit() else 0))
    threads = []
    for cid in roots:
        record = flat.get(cid)
        if record is None or record["parent_id"]:
            continue
        record["replies"] = [flat[r] for r in record["reply_ids"]
                             if r in flat]
        for reply in record["replies"]:
            reply.pop("reply_ids", None)
        record["resolved"] = bool(record["resolved"])
        threads.append(record)
    return threads


# ---------------------------------------------------------------- anchoring

def _split_run(para, run_el, offset: int):
    """Split a run element at text offset; return the new right-hand run."""
    text = "".join(t.text or "" for t in run_el.iter(q("t")))
    right = deepcopy(run_el)
    run_el.addnext(right)
    for el, s in ((run_el, text[:offset]), (right, text[offset:])):
        for t in list(el.iter(q("t"))):
            el.remove(t)
        t = etree.SubElement(el, q("t"))
        t.text = s
        t.set(XML_SPACE, "preserve")
    return right


def find_anchor_runs(doc, target: str):
    """Isolate `target`'s first occurrence into whole runs; return them."""
    from docx_common import iter_all_paragraphs
    for para in iter_all_paragraphs(doc):
        full = para.text
        start = full.find(target)
        if start < 0:
            continue
        end = start + len(target)
        pos = 0
        covered = []
        for run_el in para._p.iter(q("r")):
            rtext = "".join(t.text or "" for t in run_el.iter(q("t")))
            r_start, r_end = pos, pos + len(rtext)
            pos = r_end
            if r_end <= start or r_start >= end:
                continue
            if r_start < start:  # split off the left part
                run_el = _split_run(para, run_el, start - r_start)
                r_start = start
            if r_end > end:      # split off the right part
                _split_run(para, run_el, end - r_start)
            covered.append(run_el)
        return para, covered
    return None, []


def _anchor_nodes(doc, cid: str) -> dict:
    """The range start, range end and reference run belonging to one comment."""
    found = {"start": None, "end": None, "ref": None}
    for root in iter_part_roots(doc):
        for el in root.iter(q("commentRangeStart"), q("commentRangeEnd"),
                            q("commentReference")):
            if el.get(q("id")) != cid:
                continue
            name = etree.QName(el).localname
            if name == "commentRangeStart" and found["start"] is None:
                found["start"] = el
            elif name == "commentRangeEnd" and found["end"] is None:
                found["end"] = el
            elif name == "commentReference" and found["ref"] is None:
                parent = el.getparent()
                found["ref"] = parent if parent.tag == q("r") else el
    return found


# ---------------------------------------------------------------- ids

def _used_para_ids(doc) -> set:
    used = set()
    for root in iter_part_roots(doc):
        for para in root.iter(q("p")):
            pid = para.get(q14("paraId"))
            if pid:
                used.add(pid.upper())
    comments = _comments_root(doc)
    if comments is not None:
        for para in comments.iter(q("p")):
            pid = para.get(q14("paraId"))
            if pid:
                used.add(pid.upper())
    return used


def _new_hex_id(used: set) -> str:
    """An 8-digit hex id in Word's range: nonzero and below 0x80000000."""
    while True:
        value = f"{random.randint(1, 0x7FFFFFFE):08X}"
        if value not in used:
            used.add(value)
            return value


def ensure_para_id(doc, comment) -> str:
    """Give a comment the w14:paraId that threading keys on, if it lacks one."""
    existing = _comment_para_id(comment)
    if existing:
        return existing
    paragraphs = _comment_paragraphs(comment)
    if not paragraphs:
        paragraphs = [etree.SubElement(comment, q("p"))]
    para = paragraphs[-1]
    root = _comments_root(doc)
    if root is not None and root.nsmap.get("w14") != W14:
        new_root = _ensure_namespace(root, "w14", W14)
        if new_root is not root:
            _swap_comments_root(doc, new_root)
            for candidate in new_root.iter(q("comment")):
                if candidate.get(q("id")) == comment.get(q("id")):
                    comment = candidate
                    break
            paragraphs = _comment_paragraphs(comment)
            para = paragraphs[-1]
    para_id = _new_hex_id(_used_para_ids(doc))
    para.set(q14("paraId"), para_id)
    if not para.get(q14("textId")):
        para.set(q14("textId"), para_id)
    return para_id


def _backfill_ids(doc, ids_root) -> None:
    """Give every comment that already has a paraId a durable id row.

    A commentsIds part that lists only the comment we just wrote would be a
    half-filled part, so the rows for comments that Word or LibreOffice left
    behind are filled in too. Comments with no paraId are left alone.
    """
    known = {row.get(qcid("paraId")) for row in ids_root.iter(qcid("commentId"))}
    used = {(row.get(qcid("durableId")) or "").upper()
            for row in ids_root.iter(qcid("commentId"))}
    comments = _comments_root(doc)
    if comments is None:
        return
    for comment in comments.iter(q("comment")):
        para_id = _comment_para_id(comment)
        if not para_id or para_id in known:
            continue
        row = etree.SubElement(ids_root, qcid("commentId"))
        row.set(qcid("paraId"), para_id)
        row.set(qcid("durableId"), _new_hex_id(used))
        known.add(para_id)


def register_comment(doc, cid: str, parent_para_id: str | None = None,
                     done: bool = False) -> dict:
    """Create or update the commentsExtended and commentsIds rows for a comment."""
    root = _comments_root(doc)
    comment = None
    if root is not None:
        for candidate in root.iter(q("comment")):
            if candidate.get(q("id")) == cid:
                comment = candidate
                break
    if comment is None:
        raise KeyError(cid)
    para_id = ensure_para_id(doc, comment)

    extended = _ensure_extended_root(doc)
    entry = None
    for ex in extended.iter(q15("commentEx")):
        if ex.get(q15("paraId")) == para_id:
            entry = ex
            break
    if entry is None:
        entry = etree.SubElement(extended, q15("commentEx"))
        entry.set(q15("paraId"), para_id)
    if parent_para_id:
        entry.set(q15("paraIdParent"), parent_para_id)
    entry.set(q15("done"), "1" if done else "0")

    ids_root = _ensure_ids_root(doc)
    _backfill_ids(doc, ids_root)
    durable = None
    for row in ids_root.iter(qcid("commentId")):
        if row.get(qcid("paraId")) == para_id:
            durable = row.get(qcid("durableId"))
            break
    if durable is None:
        used = {r.get(qcid("durableId"), "").upper()
                for r in ids_root.iter(qcid("commentId"))}
        durable = _new_hex_id(used)
        row = etree.SubElement(ids_root, qcid("commentId"))
        row.set(qcid("paraId"), para_id)
        row.set(qcid("durableId"), durable)

    extensible = _extensible_root(doc)
    if extensible is not None:
        known = {r.get(qcex("durableId"), "").upper()
                 for r in extensible.iter(qcex("commentExtensible"))}
        if durable.upper() not in known:
            row = etree.SubElement(extensible, qcex("commentExtensible"))
            row.set(qcex("durableId"), durable)
            row.set(qcex("dateUtc"), _now())
    return {"para_id": para_id, "durable_id": durable}


# ---------------------------------------------------------------- adding

def _next_id(doc) -> int:
    root = _comments_root(doc)
    if root is None:
        return 0
    ids = [int(c.get(q("id"), "0")) for c in root.iter(q("comment"))
           if c.get(q("id"), "").lstrip("-").isdigit()]
    return max(ids) + 1 if ids else 0


def _comment_body(comment, text: str) -> None:
    """Fill a w:comment with one paragraph per line of `text`."""
    for line in (text or "").split("\n"):
        p = etree.SubElement(comment, q("p"))
        p_pr = etree.SubElement(p, q("pPr"))
        style = etree.SubElement(p_pr, q("pStyle"))
        style.set(q("val"), "CommentText")
        ref_run = etree.SubElement(p, q("r"))
        r_pr = etree.SubElement(ref_run, q("rPr"))
        r_style = etree.SubElement(r_pr, q("rStyle"))
        r_style.set(q("val"), "CommentReference")
        etree.SubElement(ref_run, q("annotationRef"))
        run = etree.SubElement(p, q("r"))
        t = etree.SubElement(run, q("t"))
        t.text = line
        t.set(XML_SPACE, "preserve")


def _new_comment_element(doc, cid: str, text: str, author: str,
                         initials: str):
    root = _ensure_comments_root(doc)
    comment = etree.SubElement(root, q("comment"))
    comment.set(q("id"), cid)
    comment.set(q("author"), author)
    comment.set(q("initials"), initials or "")
    comment.set(q("date"), _now())
    _comment_body(comment, text)
    return comment


def add_comment_native(doc, runs, text, author, initials):
    from docx.text.run import Run
    run_objs = [Run(r, None) for r in runs]
    comment = doc.add_comment(run_objs, text=text, author=author,
                              initials=initials or "")
    return str(comment.comment_id)


def add_comment_xml(doc, runs, text, author, initials) -> str:
    cid = str(_next_id(doc))
    _new_comment_element(doc, cid, text, author, initials)
    # range markers around the anchor runs + reference run after them
    first, last = runs[0], runs[-1]
    start = first.makeelement(q("commentRangeStart"), {q("id"): cid})
    first.addprevious(start)
    end = last.makeelement(q("commentRangeEnd"), {q("id"): cid})
    last.addnext(end)
    ref_run = last.makeelement(q("r"), {})
    ref = etree.SubElement(ref_run, q("commentReference"))
    ref.set(q("id"), cid)
    end.addnext(ref_run)
    return cid


# ---------------------------------------------------------------- replying

def reply_to_comment(doc, comment_id: str, text: str, author: str = "Hermes",
                     initials: str = "") -> dict:
    """Add a comment that Word shows as a reply inside `comment_id`'s thread.

    The reply is anchored to the thread root's range, so the conversation hangs
    off one place in the text, and its w15:commentEx carries the root's paraId
    as paraIdParent. Word threads never nest, so replying to a reply files the
    new comment under the same root.
    """
    index = thread_index(doc)
    if comment_id not in index["by_id"]:
        raise KeyError(comment_id)
    root_id = thread_root_id(index, comment_id)
    root_record = index["by_id"][root_id]
    root_para_id = ensure_para_id(doc, root_record["element"])
    # The root may have gained its paraId only now, so re-read the index.
    index = thread_index(doc)
    resolved = bool(index["by_id"].get(root_id, {}).get("resolved"))

    cid = str(_next_id(doc))
    _new_comment_element(doc, cid, text, author, initials)

    anchors = _anchor_nodes(doc, root_id)
    if anchors["start"] is not None and anchors["end"] is not None:
        start = anchors["start"].makeelement(
            q("commentRangeStart"), {q("id"): cid})
        anchors["start"].addnext(start)
        end = anchors["end"].makeelement(q("commentRangeEnd"), {q("id"): cid})
        anchors["end"].addprevious(end)
        after = anchors["end"]
    else:
        after = None
    # The reference run goes after every reference already in the thread, so
    # Word reads the conversation in the order it was written.
    last_ref = None
    for member in thread_member_ids(index, root_id):
        ref = _anchor_nodes(doc, member)["ref"]
        if ref is not None:
            last_ref = ref
    anchor_after = last_ref if last_ref is not None else after
    if anchor_after is not None:
        ref_run = anchor_after.makeelement(q("r"), {})
        ref = etree.SubElement(ref_run, q("commentReference"))
        ref.set(q("id"), cid)
        anchor_after.addnext(ref_run)

    info = register_comment(doc, cid, parent_para_id=root_para_id,
                            done=resolved)
    ensure_comment_styles(doc)
    return {"comment_id": cid, "parent_id": root_id,
            "para_id_parent": root_para_id, "para_id": info["para_id"],
            "resolved": resolved}


# ---------------------------------------------------------------- resolving

def set_thread_resolved(doc, comment_id: str, done: bool) -> list:
    """Set or clear w15:done across a whole thread, parent and replies alike."""
    index = thread_index(doc)
    if comment_id not in index["by_id"]:
        raise KeyError(comment_id)
    members = thread_member_ids(index, comment_id)
    root_id = members[0]
    root_para_id = ensure_para_id(doc, index["by_id"][root_id]["element"])
    for cid in members:
        parent = None if cid == root_id else root_para_id
        register_comment(doc, cid, parent_para_id=parent, done=done)
    return members


# ---------------------------------------------------------------- deleting

def _remove_metadata(doc, para_id: str | None) -> None:
    if not para_id:
        return
    extended = _extended_root(doc)
    durable_ids = set()
    if extended is not None:
        for ex in list(extended.iter(q15("commentEx"))):
            if ex.get(q15("paraId")) == para_id:
                ex.getparent().remove(ex)
            elif ex.get(q15("paraIdParent")) == para_id:
                # A reply whose root just went away becomes a root itself,
                # rather than a comment pointing at a parent that is gone.
                del ex.attrib[q15("paraIdParent")]
    ids_root = _ids_root(doc)
    if ids_root is not None:
        for row in list(ids_root.iter(qcid("commentId"))):
            if row.get(qcid("paraId")) == para_id:
                durable = row.get(qcid("durableId"))
                if durable:
                    durable_ids.add(durable.upper())
                row.getparent().remove(row)
    extensible = _extensible_root(doc)
    if extensible is not None and durable_ids:
        for row in list(extensible.iter(qcex("commentExtensible"))):
            if (row.get(qcex("durableId")) or "").upper() in durable_ids:
                row.getparent().remove(row)


def delete_comment(doc, cid: str) -> bool:
    """Remove one comment, its anchors and its threading rows."""
    root = _comments_root(doc)
    found = False
    para_id = None
    if root is not None:
        for c in list(root.iter(q("comment"))):
            if c.get(q("id")) == cid:
                para_id = _comment_para_id(c)
                c.getparent().remove(c)
                found = True
    for part_root in iter_part_roots(doc):
        for tag in ("commentRangeStart", "commentRangeEnd",
                    "commentReference"):
            for el in list(part_root.iter(q(tag))):
                if el.get(q("id")) != cid:
                    continue
                parent = el.getparent()
                # remove the wrapping run for reference marks
                if tag == "commentReference" and parent.tag == q("r"):
                    parent.getparent().remove(parent)
                else:
                    parent.remove(el)
                found = True
    _remove_metadata(doc, para_id)
    return found


def delete_thread(doc, comment_id: str) -> list:
    """Remove a whole thread: every comment in it, anchors and metadata."""
    index = thread_index(doc)
    if comment_id not in index["by_id"]:
        raise KeyError(comment_id)
    members = thread_member_ids(index, comment_id)
    for cid in members:
        delete_comment(doc, cid)
    return members


# ---------------------------------------------------------------- CLI

def _fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Read, reply to, resolve and delete comments in a .docx.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="list comments as JSON")
    p.add_argument("path", help="input .docx")
    p.add_argument("--json", dest="shape", choices=("flat", "threads"),
                   default="flat",
                   help="flat list (default) or a thread tree")

    def with_output(p):
        p.add_argument("path", help="input .docx")
        p.add_argument("-o", "--output",
                       help="output path (default: in place)")

    p = sub.add_parser("add", help="add a comment anchored to text")
    with_output(p)
    p.add_argument("--target", required=True,
                   help="anchor: first occurrence of this text")
    p.add_argument("--text", required=True, help="comment body")
    p.add_argument("--author", default="Hermes")
    p.add_argument("--initials", default="")
    p.add_argument("--xml", action="store_true",
                   help="force the XML fallback (skip native API)")

    p = sub.add_parser("reply", help="reply in thread to a comment")
    with_output(p)
    p.add_argument("--id", required=True, help="comment id to reply to")
    p.add_argument("--text", required=True, help="reply body")
    p.add_argument("--author", default="Hermes")
    p.add_argument("--initials", default="")

    for name, doc_help in (("resolve", "mark a thread resolved"),
                           ("reopen", "clear a thread's resolved mark")):
        p = sub.add_parser(name, help=doc_help)
        with_output(p)
        p.add_argument("--id", required=True,
                       help="any comment id in the thread")

    p = sub.add_parser("delete", help="delete one comment by id")
    with_output(p)
    p.add_argument("--id", required=True, help="comment id")

    p = sub.add_parser("delete-thread", help="delete a whole thread by id")
    with_output(p)
    p.add_argument("--id", required=True, help="any comment id in the thread")

    args = ap.parse_args()
    doc = Document(args.path)

    if args.cmd == "list":
        if args.shape == "threads":
            payload = {"ok": True, "threads": list_threads(doc)}
        else:
            payload = {"ok": True, "comments": list_comments(doc)}
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    if args.cmd == "add":
        para, runs = find_anchor_runs(doc, args.target)
        if not runs:
            return _fail(f"target not found: {args.target}")
        native = hasattr(doc, "add_comment") and not args.xml
        if native:
            cid = add_comment_native(doc, runs, args.text, args.author,
                                     args.initials)
        else:
            cid = add_comment_xml(doc, runs, args.text, args.author,
                                  args.initials)
        info = register_comment(doc, cid)
        ensure_comment_styles(doc)
        result = {"ok": True, "comment_id": cid, "native_api": native,
                  "anchored_to": args.target, "para_id": info["para_id"]}
    elif args.cmd == "reply":
        try:
            info = reply_to_comment(doc, args.id, args.text, args.author,
                                    args.initials)
        except KeyError:
            return _fail(f"no comment with id {args.id}")
        result = {"ok": True, **info}
    elif args.cmd in ("resolve", "reopen"):
        done = args.cmd == "resolve"
        try:
            members = set_thread_resolved(doc, args.id, done)
        except KeyError:
            return _fail(f"no comment with id {args.id}")
        result = {"ok": True, "thread": members, "resolved": done}
    elif args.cmd == "delete-thread":
        try:
            members = delete_thread(doc, args.id)
        except KeyError:
            return _fail(f"no comment with id {args.id}")
        result = {"ok": True, "deleted_ids": members}
    else:  # delete
        if not delete_comment(doc, args.id):
            return _fail(f"no comment with id {args.id}")
        result = {"ok": True, "deleted_id": args.id}

    out = args.output or args.path
    doc.save(out)
    result["output"] = out
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
