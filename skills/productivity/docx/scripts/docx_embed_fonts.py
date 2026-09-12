#!/usr/bin/env python3
# MIT License. Part of the Hermes docx skill.
"""Embed the font faces a .docx actually uses into the package itself.

A font name is not a font. A .docx carries a family name in ``w:rFonts``
attributes and in the DrawingML of its charts and shapes, and the
reader's machine resolves that name against whatever it happens to have
installed. For Latin text a substitution is ugly. For Arabic it is a
correctness bug: a report set in IBM Plex Sans Arabic opened on a machine
without it renders in some fallback face, or as tofu boxes.

Word solves this with embedded fonts, and does it differently from
PowerPoint in three ways that are the whole of the work here:

* The slots are named in ``word/fontTable.xml``. Each ``w:font`` gets
  ``w:embedRegular``, ``w:embedBold``, ``w:embedItalic`` and
  ``w:embedBoldItalic`` children carrying an ``r:id`` and a
  ``w:fontKey`` GUID. The ``r:id`` resolves against the rels of the part
  it appears in, so the relationships live in
  ``word/_rels/fontTable.xml.rels`` and not in the document's rels.
* The bytes are obfuscated. The part is ``word/fonts/fontN.odttf``: the
  font file with its first 32 bytes XORed against the 16 byte key taken
  from the ``w:fontKey`` GUID. See ``obfuscate`` for the derivation and
  for how it was checked against a file this script did not write.
* ``word/settings.xml`` needs ``w:embedTrueTypeFonts``, and
  ``w:saveSubsetFonts`` set to false because whole faces are embedded.

python-docx models none of this, so every write here is a zip level
rewrite that copies each part across untouched unless this script changed
it, the same shape as docx_comments.py.

Shared with the deck path
-------------------------
Finding a family on disk, picking one file per slot, handling variable
fonts and gating on a licence are identical problems for a deck and a
document, and they are solved once, in
``powerpoint/scripts/pptx_embed_fonts.py``. This script imports that half
rather than growing a second copy of it that would drift. Unlike the
house style locator, this one does not degrade to None: without it there
is no font discovery at all, so a missing module is a hard error with a
JSON explanation.

Licence gate
------------
Embedding ships the font bytes inside every deliverable, so the script
refuses a face whose licence it cannot find on disk. The SIL Open Font
License 1.1 permits embedding explicitly. ``--allow-unlicensed``
overrides the refusal for a face whose licence file is simply not
packaged next to it; it does not make an unlicensed face legal to ship.

Subcommands:
  embed   write the faces into the package (``--report`` makes it a dry
          run that changes nothing)
  report  what the document uses, what would be embedded, what would be
          skipped and why
  verify  check an embedding is internally consistent: every slot
          resolves to a part that exists and is typed, every part
          de-obfuscates to a real font, nothing orphaned

DOCX_FONT_DIRS, a path separated list, goes in front of the font search
path. A build that ships its own licensed faces points it at them, and
then embeds those rather than whatever the host has under the same name.

Examples:
  docx_embed_fonts.py report report.docx
  docx_embed_fonts.py embed report.docx -o shipped.docx
  docx_embed_fonts.py embed report.docx --family "IBM Plex Sans Arabic"
  docx_embed_fonts.py embed report.docx --allow-unlicensed
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

REL_FONT = f"{R}/font"
REL_FONT_TABLE = f"{R}/fontTable"
REL_SETTINGS = f"{R}/settings"

CT_OBFUSCATED = "application/vnd.openxmlformats-officedocument.obfuscatedFont"
CT_FONT_TABLE = ("application/vnd.openxmlformats-officedocument"
                 ".wordprocessingml.fontTable+xml")
CT_SETTINGS = ("application/vnd.openxmlformats-officedocument"
               ".wordprocessingml.settings+xml")

DOCUMENT = "word/document.xml"
FONT_TABLE = "word/fontTable.xml"
SETTINGS = "word/settings.xml"
FONT_DIR = "word/fonts"

# The slot names are the local names of the w:font children, minus the
# "embed" prefix, and this is also the order the schema fixes for them.
SLOTS = ("regular", "bold", "italic", "boldItalic")
SLOT_ELEMENTS = {"regular": "embedRegular", "bold": "embedBold",
                 "italic": "embedItalic", "boldItalic": "embedBoldItalic"}

# CT_Font is a fixed sequence and the four embed children go last, in
# this order. An element out of place is what makes Word offer to repair
# the file.
FONT_CHILD_ORDER = ("altName", "panose1", "charset", "family",
                    "notTrueType", "pitch", "sig",
                    "embedRegular", "embedBold", "embedItalic",
                    "embedBoldItalic")

# CT_Settings is a fixed sequence too. These are the elements that may
# precede w:embedTrueTypeFonts in it; w:saveSubsetFonts follows the two
# embed flags, so it gets the same list plus those.
BEFORE_EMBED_FLAG = ("writeProtection", "view", "zoom",
                     "removePersonalInformation", "removeDateAndTime",
                     "doNotDisplayPageBoundaries", "displayBackgroundShape",
                     "printPostScriptOverText",
                     "printFractionalCharacterWidth", "printFormsData")
BEFORE_SUBSET_FLAG = BEFORE_EMBED_FLAG + ("embedTrueTypeFonts",
                                          "embedSystemFonts")

# The first four bytes of a font file. Checked after de-obfuscation,
# because a wrong key or a part wired to the wrong slot produces bytes
# that still unzip fine and still look like a font to a casual reader.
SFNT_TAGS = (b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf")

# Theme font references, in both spellings a Word package uses. The
# w:rFonts theme attributes carry values like "majorBidi"; the DrawingML
# in a chart or a shape carries the "+mj-cs" tokens instead. Both mean
# the same slot of the theme's font scheme.
THEME_VALUES = {
    "majorAscii": ("major", "latin"), "majorHAnsi": ("major", "latin"),
    "majorEastAsia": ("major", "ea"), "majorBidi": ("major", "cs"),
    "minorAscii": ("minor", "latin"), "minorHAnsi": ("minor", "latin"),
    "minorEastAsia": ("minor", "ea"), "minorBidi": ("minor", "cs"),
    "+mj-lt": ("major", "latin"), "+mj-ea": ("major", "ea"),
    "+mj-cs": ("major", "cs"), "+mn-lt": ("minor", "latin"),
    "+mn-ea": ("minor", "ea"), "+mn-cs": ("minor", "cs"),
}

# w:rFonts names a family in these attributes, and points at the theme in
# the matching *Theme attributes.
RFONTS_ATTRS = ("ascii", "hAnsi", "cs", "eastAsia")
RFONTS_THEME_ATTRS = ("asciiTheme", "hAnsiTheme", "cstheme", "eastAsiaTheme")

# Parts whose text can name a family. Headers and footers carry the
# running head, numbering.xml the bullet glyph font, and charts and
# diagrams their labels: an Arabic chart axis is the easiest family to
# miss. styles.xml is the load bearing one, because the house style sets
# the family in a style and not on every run.
_TEXT_PART_RE = re.compile(
    r"^word/("
    r"document\d*\.xml|styles\.xml|stylesWithEffects\.xml|numbering\.xml"
    r"|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml"
    r"|comments\.xml|(charts|diagrams|drawings)/[^/]+\.xml"
    r")$")


def qw(tag):
    return f"{{{W}}}{tag}"


def qa(tag):
    return f"{{{A}}}{tag}"


def qr(tag):
    return f"{{{R}}}{tag}"


def qct(tag):
    return f"{{{CT_NS}}}{tag}"


# ------------------------------------------------------------- shared half


def _hermes_home() -> Path:
    """Hermes home, honouring ``HERMES_HOME``.

    Same rule as ``house_common.hermes_home()``, repeated rather than
    imported because this module is reached before the house-style bridge
    and must not depend on it.
    """
    val = os.environ.get("HERMES_HOME", "").strip()
    return Path(val) if val else Path.home() / ".hermes"


def _pptx_module_paths():
    here = Path(__file__).resolve().parent
    return [
        here,                                          # co-installed
        here.parents[1] / "powerpoint" / "scripts",    # sibling skill
        _hermes_home() / "skills" / "productivity" / "powerpoint"
        / "scripts",                                   # installed bundle
    ]


def _load_shared():
    """Import the font discovery and licence half, or fail loudly."""
    for candidate in _pptx_module_paths():
        if (candidate / "pptx_embed_fonts.py").exists():
            if str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
            try:
                import pptx_embed_fonts  # noqa: PLC0415
            except ImportError as exc:
                raise SystemExit(json.dumps({
                    "ok": False,
                    "error": f"pptx_embed_fonts.py is present but will not "
                             f"import: {exc}"}))
            return pptx_embed_fonts
    raise SystemExit(json.dumps({
        "ok": False,
        "error": "font discovery lives in the powerpoint skill's "
                 "pptx_embed_fonts.py, which was not found beside this "
                 "skill; install the powerpoint skill or put it on "
                 "PYTHONPATH",
        "searched": [str(p) for p in _pptx_module_paths()]}))


shared = _load_shared()

# The shared search path reads PPTX_FONT_DIRS. DOCX_FONT_DIRS is the name
# a document author expects, so it is bridged here rather than by
# teaching the shared half a second variable it would have to keep in
# step. Both are honoured, ours first.
_ours = os.environ.get("DOCX_FONT_DIRS", "")
if _ours:
    _theirs = os.environ.get("PPTX_FONT_DIRS", "")
    os.environ["PPTX_FONT_DIRS"] = (
        _ours + (os.pathsep + _theirs if _theirs else ""))

family_licence = shared.family_licence
licence_evidence = shared.licence_evidence
resolve_target = shared.resolve_target


def find_faces(family):
    """One file per slot, with the notes worded for Word.

    The shared notes name PowerPoint because that is where they were
    written. The substance holds for Word, whose embedding is a TrueType
    facility too, so only the application name is rewritten.
    """
    faces, notes = shared.find_faces(family)
    return faces, [note.replace("PowerPoint", "Word") for note in notes]


class Package(shared.Package):
    """The shared in-memory package, plus what Word needs of it.

    Word types the font parts with a Default for the odttf extension
    rather than one Override per part, which is the one piece of package
    plumbing PresentationML never needs.
    """

    def ensure_default(self, extension, content_type):
        root = self.tree("[Content_Types].xml")
        for default in root.findall(qct("Default")):
            if (default.get("Extension") or "").lower() == extension.lower():
                default.set("ContentType", content_type)
                return
        default = etree.Element(qct("Default"))
        default.set("Extension", extension)
        default.set("ContentType", content_type)
        # Defaults precede Overrides in the part, so a new one goes after
        # the last Default rather than at the end of the element.
        index = 0
        for i, child in enumerate(root):
            if etree.QName(child).localname == "Default":
                index = i + 1
        root.insert(index, default)

    def defaults(self):
        root = self.tree("[Content_Types].xml")
        return {(d.get("Extension") or "").lower(): d.get("ContentType")
                for d in root.findall(qct("Default"))}

    def content_type_of(self, part_name):
        """The effective content type of a part, Default or Override."""
        override = self.overrides().get("/" + part_name)
        if override:
            return override
        extension = part_name.rsplit(".", 1)[-1].lower()
        return self.defaults().get(extension)


# ------------------------------------------------------------- obfuscation


def new_font_key():
    """A fresh w:fontKey, spelled the way Word spells one."""
    return "{" + str(uuid.uuid4()).upper() + "}"


def key_bytes(font_key):
    """The 16 byte XOR key behind a w:fontKey GUID.

    Strip the braces and the hyphens, read the 32 hex digits as 16 bytes,
    and reverse them. The reversal is the part worth stating plainly,
    because getting it wrong still produces a file that unzips and still
    round trips through this script's own de-obfuscation. It was checked
    against .odttf parts written by another implementation, whose first
    four bytes come back as a real sfnt tag only in this order.
    """
    digits = (font_key or "").strip().strip("{}").replace("-", "")
    if len(digits) != 32:
        raise ValueError(f"not a font key: {font_key!r}")
    return bytes.fromhex(digits)[::-1]


def obfuscate(data, font_key):
    """XOR the first 32 bytes of a font file against the key.

    Its own inverse, so this is also how a reader de-obfuscates. A file
    shorter than 32 bytes is not a font, but it is handled anyway so a
    truncated input fails on the sfnt check and not on an index error.
    """
    out = bytearray(data)
    key = key_bytes(font_key)
    for i in range(min(32, len(out))):
        out[i] ^= key[i % 16]
    return bytes(out)


def looks_like_a_font(data):
    return bytes(data[:4]) in SFNT_TAGS


# ---------------------------------------------------------------- families


def _theme_scheme(pkg):
    """The theme font scheme as {(kind, script): [families]}.

    A list because a package can carry more than one theme part, and two
    themes can fill the same slot with different families.
    """
    scheme = {}
    for name in sorted(pkg.names):
        if not (name.startswith("word/theme/") and name.endswith(".xml")):
            continue
        root = pkg.tree(name)
        if root is None:
            continue
        fonts = root.find(f".//{qa('fontScheme')}")
        if fonts is None:
            continue
        for kind, element in (("major", "majorFont"), ("minor", "minorFont")):
            holder = fonts.find(qa(element))
            if holder is None:
                continue
            for script in ("latin", "ea", "cs"):
                face = holder.find(qa(script))
                if face is None:
                    continue
                family = (face.get("typeface") or "").strip()
                if not family:
                    continue
                bucket = scheme.setdefault((kind, script), [])
                if family not in bucket:
                    bucket.append(family)
    return scheme


def used_families(pkg):
    """Families the document actually asks for, sorted.

    Two walks, because a .docx names fonts in two grammars. Body text,
    styles, numbering and the running heads use ``w:rFonts``; a chart
    axis, a callout and a text box are DrawingML and use ``a:latin``,
    ``a:cs`` and ``a:ea``. Skipping either walk loses a family that is
    genuinely on the page.

    Theme references are resolved through the theme's font scheme in both
    grammars, so the result is real family names and never a token.
    """
    scheme = _theme_scheme(pkg)
    found = {}

    def note(family, where):
        family = (family or "").strip()
        if not family or family.startswith("+"):
            return
        found.setdefault(family, set()).add(where)

    def note_theme(value, where):
        for family in scheme.get(THEME_VALUES.get(value, ()), ()):
            note(family, where)

    for name in sorted(n for n in pkg.names if _TEXT_PART_RE.match(n)):
        root = pkg.tree(name)
        if root is None:
            continue
        where = name.split("/")[1] if name.count("/") > 1 else \
            name.split("/")[-1].rsplit(".", 1)[0]
        for rfonts in root.iter(qw("rFonts")):
            for attr in RFONTS_ATTRS:
                note(rfonts.get(qw(attr)), where)
            for attr in RFONTS_THEME_ATTRS:
                value = rfonts.get(qw(attr))
                if value:
                    note_theme(value, where)
        for script in ("latin", "cs", "ea"):
            for face in root.iter(qa(script)):
                typeface = (face.get("typeface") or "").strip()
                if typeface in THEME_VALUES:
                    note_theme(typeface, where)
                else:
                    note(typeface, where)

    return {family: sorted(where) for family, where in sorted(found.items())}


# ------------------------------------------------------------------ parts


def _font_table(pkg, create=True):
    """The w:fonts root, created and wired into the package if absent.

    A document without a font table is rare but legal, and a package that
    grows one needs its content type and a relationship from the document
    as well as the part itself.
    """
    root = pkg.tree(FONT_TABLE)
    if root is not None or not create:
        return root
    root = etree.Element(qw("fonts"), nsmap={"w": W, "r": R})
    pkg.put(FONT_TABLE, etree.tostring(root, xml_declaration=True,
                                       encoding="UTF-8", standalone=True))
    pkg.set_tree(FONT_TABLE, root)
    pkg.ensure_override("/" + FONT_TABLE, CT_FONT_TABLE)
    if pkg.has(DOCUMENT):
        pkg.ensure_rel(DOCUMENT, REL_FONT_TABLE, FONT_TABLE)
    return root


def _settings(pkg):
    root = pkg.tree(SETTINGS)
    if root is not None:
        return root
    root = etree.Element(qw("settings"), nsmap={"w": W})
    pkg.put(SETTINGS, etree.tostring(root, xml_declaration=True,
                                     encoding="UTF-8", standalone=True))
    pkg.set_tree(SETTINGS, root)
    pkg.ensure_override("/" + SETTINGS, CT_SETTINGS)
    if pkg.has(DOCUMENT):
        pkg.ensure_rel(DOCUMENT, REL_SETTINGS, SETTINGS)
    return root


def _insert_after(parent, element, prefix):
    """Put an element after the last child the schema orders before it."""
    index = 0
    for i, child in enumerate(parent):
        if etree.QName(child).localname in prefix:
            index = i + 1
    parent.insert(index, element)


def _set_flag(root, name, prefix, value=None):
    """Set one w:settings on/off element, in its schema position."""
    element = root.find(qw(name))
    if element is None:
        element = etree.Element(qw(name))
        _insert_after(root, element, prefix)
    if value is None:
        # Present with no w:val already means true, which is how Word
        # itself writes the embed flag.
        element.attrib.pop(qw("val"), None)
    else:
        element.set(qw("val"), value)


def _font_entry(root, family, create=True):
    for font in root.findall(qw("font")):
        if font.get(qw("name")) == family:
            return font
    if not create:
        return None
    font = etree.SubElement(root, qw("font"))
    font.set(qw("name"), family)
    return font


def _set_slot(font, slot, rel_id, font_key):
    """Point one slot at a part, keeping CT_Font's child order."""
    tag = SLOT_ELEMENTS[slot]
    element = font.find(qw(tag))
    if element is None:
        element = etree.Element(qw(tag))
        want = FONT_CHILD_ORDER.index(tag)
        index = len(font)
        for i, child in enumerate(font):
            local = etree.QName(child).localname
            if local in FONT_CHILD_ORDER \
                    and FONT_CHILD_ORDER.index(local) > want:
                index = i
                break
        font.insert(index, element)
    element.set(qr("id"), rel_id)
    element.set(qw("fontKey"), font_key)
    return element


def _next_font_number(pkg):
    highest = 0
    for name in pkg.names:
        match = re.match(rf"^{FONT_DIR}/font(\d+)\.odttf$", name)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


# ---------------------------------------------------------------- writing


def embed_fonts(path, families=None, allow_unlicensed=False, output=None,
                dry_run=False):
    """Embed the faces the document uses, and report what happened.

    ``families`` restricts the pass to a list of family names; the
    default is every family the document asks for. A family with no
    findable file, or with no findable licence, is reported and skipped
    rather than raising: one missing face must not cost the document its
    other three.

    The pass is idempotent. A slot already pointing at a part that exists
    keeps both the part and its w:fontKey: minting a fresh GUID on a
    second run would change the obfuscation the stored bytes were written
    for, and the file would stop being readable.
    """
    size_before = os.path.getsize(path)
    pkg = Package(path)
    used = used_families(pkg)
    wanted = list(used) if families is None else list(families)

    # Read the table now, create it only if a face is actually embedded:
    # a document with nothing to embed must not grow an empty part.
    table = _font_table(pkg, create=False)
    counter = _next_font_number(pkg)

    embedded = []
    skipped = []
    bytes_added = 0

    for family in wanted:
        faces, notes = find_faces(family)
        if families is not None and family not in used:
            # A family named on the command line is embedded even when the
            # walk did not see it: the caller may know about a family this
            # script cannot reach. The empty used_in is what shows up a
            # typo.
            notes = list(notes) + [
                f"{family}: not named anywhere the walk reached, embedded "
                f"because it was asked for"]
        if not faces:
            skipped.append({"family": family, "reason": "no font file found",
                            "detail": notes or
                            [f"{family}: no .ttf under the font directories"]})
            continue

        licence_path, licence_via = family_licence(family, faces["regular"])
        if licence_via:
            notes = list(notes) + [
                f"{family}: licence found through {licence_via}, which is "
                f"another file of the same family"]
        if licence_path is None and not allow_unlicensed:
            skipped.append({
                "family": family,
                "reason": "no licence file found",
                "detail": [
                    f"{family}: searched beside {faces['regular']} and "
                    f"every other file of the family, up to the font root, "
                    f"and the owning package's entry under "
                    f"/usr/share/licenses",
                    "embedding ships the font bytes inside every copy of "
                    "the document; pass --allow-unlicensed to override",
                ],
                "licence_evidence": licence_evidence(faces["regular"]),
            })
            continue

        if table is None and not dry_run:
            table = _font_table(pkg, create=True)
        font = None
        if table is not None:
            font = _font_entry(table, family, create=not dry_run)

        record = {
            "family": family,
            "used_in": used.get(family, []),
            "licence": str(licence_path) if licence_path else None,
            "licence_override": licence_path is None,
            "licence_evidence": licence_evidence(faces["regular"]),
            "slots": {},
            "notes": notes,
        }
        for slot in SLOTS:
            source = faces.get(slot)
            if source is None:
                continue
            data = source.read_bytes()
            existing_part = None
            if font is not None:
                element = font.find(qw(SLOT_ELEMENTS[slot]))
                if element is not None:
                    target = pkg.rel_target(FONT_TABLE, element.get(qr("id")))
                    if target and pkg.has(target):
                        existing_part = target
            if existing_part is not None:
                # Already embedded on an earlier run. Leaving the part and
                # its key alone is what makes a second run add nothing.
                record["slots"][slot] = {"part": existing_part,
                                         "file": str(source),
                                         "bytes": len(pkg.get(existing_part)),
                                         "added": False}
                continue
            part = f"{FONT_DIR}/font{counter}.odttf"
            counter += 1
            record["slots"][slot] = {"part": part, "file": str(source),
                                     "bytes": len(data), "added": True}
            bytes_added += len(data)
            if dry_run:
                continue
            font_key = new_font_key()
            pkg.put(part, obfuscate(data, font_key))
            pkg.ensure_default("odttf", CT_OBFUSCATED)
            rel_id = pkg.ensure_rel(FONT_TABLE, REL_FONT, part)
            _set_slot(font, slot, rel_id, font_key)
            record["slots"][slot]["font_key"] = font_key
        embedded.append(record)

    if not dry_run and embedded:
        # The checkbox Word shows as "Embed fonts in the file". The subset
        # flag goes to false because whole faces are embedded, not
        # subsets, and an on/off element present without a w:val means
        # true, so this one needs the attribute spelled out.
        root = _settings(pkg)
        _set_flag(root, "embedTrueTypeFonts", BEFORE_EMBED_FLAG)
        _set_flag(root, "saveSubsetFonts", BEFORE_SUBSET_FLAG, "false")

    report = {
        "ok": True,
        "families_used": used,
        "embedded": embedded,
        "skipped": skipped,
        "bytes_added": bytes_added,
        "size_before": size_before,
    }

    if dry_run:
        report["dry_run"] = True
        report["size_after"] = size_before
        return report

    out = output or path
    if not os.path.isdir(os.path.dirname(out) or "."):
        raise SystemExit(f"no directory for {out}")
    pkg.save(out)
    report["output"] = out
    report["size_after"] = os.path.getsize(out)
    report["size_delta"] = report["size_after"] - size_before
    return report


# --------------------------------------------------------------- checking


def verify(path):
    """Consistency of the embedding, as Word sees it.

    Every slot's relationship has to resolve, from the font table's own
    rels, to a part that exists and is typed, and that part has to
    de-obfuscate with the slot's own key into something whose first four
    bytes are a real sfnt tag. That last check is the one that catches a
    key written for a different part, which no amount of round tripping
    through this script's own code ever would.
    """
    pkg = Package(path)
    table = _font_table(pkg, create=False)
    settings = pkg.tree(SETTINGS)
    problems = []
    referenced = set()
    families = []

    if table is not None:
        for font in table.findall(qw("font")):
            family = font.get(qw("name"))
            slots = {}
            for slot in SLOTS:
                element = font.find(qw(SLOT_ELEMENTS[slot]))
                if element is None:
                    continue
                rel_id = element.get(qr("id"))
                font_key = element.get(qw("fontKey"))
                target = pkg.rel_target(FONT_TABLE, rel_id)
                if target is None:
                    problems.append(
                        f"{family} {slot}: {rel_id} has no relationship in "
                        f"{Package.rels_name(FONT_TABLE)}")
                    continue
                if not pkg.has(target):
                    problems.append(
                        f"{family} {slot}: {target} is not in the package")
                    continue
                referenced.add(target)
                if pkg.content_type_of(target) != CT_OBFUSCATED:
                    problems.append(
                        f"{family} {slot}: {target} is not typed "
                        f"{CT_OBFUSCATED}")
                if not font_key:
                    problems.append(f"{family} {slot}: no w:fontKey")
                    continue
                try:
                    plain = obfuscate(pkg.get(target), font_key)
                except ValueError as exc:
                    problems.append(f"{family} {slot}: {exc}")
                    continue
                if not looks_like_a_font(plain):
                    problems.append(
                        f"{family} {slot}: {target} does not de-obfuscate "
                        f"to a font with {font_key}")
                slots[slot] = {"part": target, "bytes": len(pkg.get(target)),
                               "font_key": font_key}
            if slots:
                families.append({"family": family, "slots": slots})

    for name in pkg.names:
        if name.startswith(FONT_DIR + "/") and name.endswith(".odttf"):
            if name not in referenced:
                problems.append(f"{name} is orphaned")

    if families:
        flag = settings.find(qw("embedTrueTypeFonts")) \
            if settings is not None else None
        if flag is None:
            problems.append(
                "faces are embedded but w:settings has no "
                "w:embedTrueTypeFonts, so Word ignores them")
        elif flag.get(qw("val")) in ("0", "false"):
            problems.append("w:embedTrueTypeFonts is switched off")

    return {"ok": not problems, "families": families, "problems": problems}


# -------------------------------------------------------------------- cli


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("embed", help="embed the faces the document uses")
    p.add_argument("docx")
    p.add_argument("-o", "--output", help="output path (default: in place)")
    p.add_argument("--family", action="append", dest="families",
                   help="restrict to this family, repeatable")
    p.add_argument("--allow-unlicensed", action="store_true",
                   help="embed a face whose licence file was not found")
    p.add_argument("--report", action="store_true",
                   help="report only, write nothing")

    p = sub.add_parser("report",
                       help="what is used, what would be embedded, what not")
    p.add_argument("docx")
    p.add_argument("--family", action="append", dest="families")
    p.add_argument("--allow-unlicensed", action="store_true")

    p = sub.add_parser("verify",
                       help="check the embedding is internally consistent")
    p.add_argument("docx")

    args = ap.parse_args(argv)

    if args.cmd == "verify":
        result = verify(args.docx)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1

    dry_run = args.cmd == "report" or getattr(args, "report", False)
    report = embed_fonts(args.docx,
                         families=args.families,
                         allow_unlicensed=args.allow_unlicensed,
                         output=getattr(args, "output", None),
                         dry_run=dry_run)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
