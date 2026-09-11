#!/usr/bin/env python3
# MIT License. Part of the Hermes powerpoint skill.
"""Embed the font faces a .pptx actually uses into the package itself.

A font name is not a font. A .pptx carries a family name in
``a:latin``, ``a:cs`` and ``a:ea`` typeface attributes, and the reader's
machine resolves that name against whatever it happens to have
installed. For Latin text a substitution is ugly. For Arabic it is a
correctness bug: a deck set in IBM Plex Sans Arabic opened on a machine
without it renders in some fallback face, or as tofu boxes.

PowerPoint solves this with embedded fonts. The package carries the font
files as ``ppt/fonts/fontN.fntdata`` parts, each with an
``application/x-fontdata`` content type override and a ``font``
relationship from ``ppt/presentation.xml``, and ``p:embeddedFontLst``
inside ``p:presentation`` names the typeface and points its regular,
bold, italic and boldItalic slots at those parts.

Two format details are load bearing:

* The fntdata payload is the font file itself, unobfuscated. Word's
  ``word/fonts/*.odttf`` XORs its first 32 bytes against a ``w:fontKey``;
  ``p:embeddedFont`` has no key attribute at all, which is the tell that
  PresentationML does not obfuscate.
* Element order inside ``p:presentation`` is fixed by the schema.
  ``p:embeddedFontLst`` goes after ``p:notesSz`` and ``p:smartTags`` and
  before ``p:defaultTextStyle``. Out of order is exactly what makes
  PowerPoint offer to repair the file.

python-pptx does not model any of this, so every write here is a zip
level rewrite that copies each part across untouched unless this script
changed it, the same shape as pptx_comments.py.

Licence gate
------------
Embedding ships the font bytes inside every deliverable, so the script
refuses a face whose licence it cannot find on disk. It looks beside the
font file, then up to the font root, then at the owning rpm's entry
under /usr/share/licenses. The SIL Open Font License 1.1 permits this
explicitly: its terms grant permission to "use, study, copy, merge,
embed, modify, redistribute, and sell" the font software, and allow
bundling and redistribution with any software, so an OFL face is safe to
carry inside a deck. ``--allow-unlicensed`` overrides the refusal for a
face whose licence file is simply not packaged next to it; it does not
make an unlicensed face legal to ship.

Subcommands:
  embed   write the faces into the package (``--report`` makes it a dry
          run that changes nothing)
  report  what the deck uses, what would be embedded, what would be
          skipped and why
  verify  check an embedding is internally consistent: every slot
          resolves to a part that exists and is typed, nothing orphaned

PPTX_FONT_DIRS, a path separated list, goes in front of the font search
path. A build that ships its own licensed faces points it at them, and
then embeds those rather than whatever the host has under the same name.

Examples:
  pptx_embed_fonts.py report deck.pptx
  pptx_embed_fonts.py embed deck.pptx -o shipped.pptx
  pptx_embed_fonts.py embed deck.pptx --family "IBM Plex Sans Arabic"
  pptx_embed_fonts.py embed deck.pptx --allow-unlicensed
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import subprocess
import sys
import zipfile
from pathlib import Path

from lxml import etree

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

REL_FONT = f"{R}/font"
CT_FONTDATA = "application/x-fontdata"

PRESENTATION = "ppt/presentation.xml"
FONT_DIR = "ppt/fonts"

# The slot names are the local names of the p:embeddedFont children, and
# this is also the order the schema fixes for them.
SLOTS = ("regular", "bold", "italic", "boldItalic")

# Elements that may precede p:embeddedFontLst inside p:presentation. The
# schema fixes this sequence; an element out of place is what makes
# PowerPoint offer to repair the file.
BEFORE_EMBEDDED_FONT_LST = ("sldMasterIdLst", "notesMasterIdLst",
                            "handoutMasterIdLst", "sldIdLst", "sldSz",
                            "notesSz", "smartTags")

# Theme font references. A slide almost never names a family directly:
# house style decks point at the theme, so a literal walk of typeface
# attributes returns these six tokens and no real names at all.
THEME_TOKENS = {
    "+mj-lt": ("major", "latin"),
    "+mj-ea": ("major", "ea"),
    "+mj-cs": ("major", "cs"),
    "+mn-lt": ("minor", "latin"),
    "+mn-ea": ("minor", "ea"),
    "+mn-cs": ("minor", "cs"),
}

# Filename suffixes for the static faces, per slot. Statics are preferred
# over a variable font because PowerPoint reads an embedded face at its
# default instance: two static files give a real bold, one variable file
# gives the same default weight twice.
SLOT_SUFFIXES = {
    "regular": ("Regular", "Roman", "Book"),
    "bold": ("Bold",),
    "italic": ("Italic", "Oblique"),
    "boldItalic": ("BoldItalic", "Bold-Italic", "BoldOblique"),
}

# Substrings that mark a file as a licence. Matched case insensitively
# against the whole file name, so OFL.txt, LICENSE, license.txt,
# COPYING and LICENCE.md all count.
LICENCE_HINTS = ("ofl", "licen", "copying")

# Suffixes a licence file may carry. Without this a face named
# something like NotoKufiOfl-Regular.ttf would vouch for itself.
LICENCE_SUFFIXES = ("", ".txt", ".md", ".rst", ".html")


def qa(tag):
    return f"{{{A}}}{tag}"


def qp(tag):
    return f"{{{P}}}{tag}"


def qr(tag):
    return f"{{{R}}}{tag}"


def qct(tag):
    return f"{{{CT_NS}}}{tag}"


def qrel(tag):
    return f"{{{REL_NS}}}{tag}"


def resolve_target(base, target):
    """Absolute part name for a relationship target.

    Office writes these relative to the owning part's directory and some
    producers root them at the package, so both forms have to resolve to
    the same zip entry name.
    """
    target = (target or "").replace("\\", "/")
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(base, target))


# ---------------------------------------------------------------- package


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

    def overrides(self):
        root = self.tree("[Content_Types].xml")
        return {ov.get("PartName"): ov.get("ContentType")
                for ov in root.findall(qct("Override"))}

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

    def rel_target(self, part, rel_id):
        """Absolute part name behind one relationship id, or None."""
        root = self.rels(part)
        if root is None:
            return None
        base = posixpath.dirname(part)
        for rel in root.findall(qrel("Relationship")):
            if rel.get("Id") == rel_id:
                if rel.get("TargetMode") == "External":
                    return None
                return resolve_target(base, rel.get("Target"))
        return None

    def ensure_rel(self, part, reltype, target_part):
        """Add a relationship if it is missing, returning its id.

        Ids are minted by scanning the ones already in use.
        presentation.xml is relationship dense (masters, slides, theme,
        presProps, tableStyles), so a naive rId1 collides.
        """
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


# ---------------------------------------------------------------- families


def _theme_fonts(pkg):
    """Map every theme font token to the families the themes give it.

    A deck can carry more than one theme, one per master. Collecting the
    tokens across all of them keeps a family used only by a second master
    from being missed. The cost is that a token can resolve to more than
    one family, which is why the value is a list.
    """
    tokens = {key: [] for key in THEME_TOKENS}
    for name in sorted(pkg.names):
        if not (name.startswith("ppt/theme/") and name.endswith(".xml")):
            continue
        root = pkg.tree(name)
        if root is None:
            continue
        scheme = root.find(f".//{qa('fontScheme')}")
        if scheme is None:
            continue
        for kind, element in (("major", "majorFont"),
                              ("minor", "minorFont")):
            holder = scheme.find(qa(element))
            if holder is None:
                continue
            for script in ("latin", "ea", "cs"):
                face = holder.find(qa(script))
                if face is None:
                    continue
                family = (face.get("typeface") or "").strip()
                if not family:
                    continue
                for token, (want_kind, want_script) in THEME_TOKENS.items():
                    if want_kind == kind and want_script == script:
                        if family not in tokens[token]:
                            tokens[token].append(family)
    return tokens


# Parts whose text carries typeface attributes worth honouring. Notes
# masters and notes slides are included because a printed handout shows
# them, charts and diagrams because their labels are text like any other
# and an Arabic chart axis is the easiest family to miss, and
# presentation.xml itself carries defaultTextStyle.
_TEXT_PART_RE = re.compile(
    r"^ppt/(slides|slideLayouts|slideMasters|notesSlides|notesMasters"
    r"|charts|diagrams)/[^/]+\.xml$")


def used_families(pkg):
    """Families the deck actually asks for, sorted.

    Walks a:latin, a:cs and a:ea across the slides, layouts, masters and
    notes, resolving the six theme tokens through the theme, and adds the
    theme's own font scheme families: those are what a run inherits when
    nothing names a family outright.
    """
    tokens = _theme_fonts(pkg)
    found = {}

    def note(family, where):
        family = (family or "").strip()
        if not family or family.startswith("+"):
            return
        found.setdefault(family, set()).add(where)

    for token, families in tokens.items():
        for family in families:
            note(family, "theme")

    parts = [name for name in pkg.names if _TEXT_PART_RE.match(name)]
    if pkg.has(PRESENTATION):
        parts.append(PRESENTATION)
    for name in sorted(parts):
        root = pkg.tree(name)
        if root is None:
            continue
        where = name.split("/")[1] if "/" in name else name
        for script in ("latin", "cs", "ea"):
            for face in root.iter(qa(script)):
                typeface = (face.get("typeface") or "").strip()
                if typeface in THEME_TOKENS:
                    for family in tokens.get(typeface, ()):
                        note(family, where)
                else:
                    note(typeface, where)

    return {family: sorted(where) for family, where in sorted(found.items())}


# ---------------------------------------------------------------- on disk


def font_dirs():
    """Font directories across Linux, macOS and Windows.

    Same list arabic_style.py searches, so a family this machine can set
    type in is a family this script can embed. PPTX_FONT_DIRS, a path
    separated list, goes in front of the list: a build that ships its own
    licensed faces should embed those and not whatever the host happens
    to have installed under the same name.
    """
    home = Path.home()
    dirs = [Path(p) for p in
            os.environ.get("PPTX_FONT_DIRS", "").split(os.pathsep) if p]
    dirs += [
        home / ".local/share/fonts",          # Linux (user)
        home / ".fonts",                      # Linux (legacy user)
        Path("/usr/local/share/fonts"),       # Linux (local system)
        Path("/usr/share/fonts"),             # Linux (system)
        home / "Library/Fonts",               # macOS (user)
        Path("/Library/Fonts"),               # macOS (system)
    ]
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:                         # Windows 10+ per-user fonts
        dirs.append(Path(local_appdata) / "Microsoft/Windows/Fonts")
    windir = os.environ.get("WINDIR", r"C:\Windows")
    dirs.append(Path(windir) / "Fonts")       # Windows system fonts
    return dirs


def _compact(family):
    return re.sub(r"[\s_]+", "", family)


def _belongs(stem, prefix):
    """True when a file stem is this family and not a longer lookalike.

    "IBMPlexSans" must not claim IBMPlexSansArabic-Regular.ttf, and
    "Cairo" must not claim CairoPlay-Regular.ttf. The test is that what
    follows the family in the name is a separator, not more letters.
    """
    if len(stem) < len(prefix):
        return False
    if stem[:len(prefix)].lower() != prefix.lower():
        return False
    tail = stem[len(prefix):]
    return not tail or not tail[0].isalnum()


def _candidate_files(family):
    """Every .ttf on this machine that plausibly belongs to the family.

    Only .ttf: PresentationML font embedding is a TrueType facility, and
    a CFF outline in an .otf is not reliably rendered from an embedded
    part even though fontconfig happily serves it for on screen type. The
    system IBM Plex faces are .otf for that reason, so the user copies in
    ~/.local/share/fonts are the ones that get embedded.
    """
    compact = _compact(family)
    out = []
    seen = set()
    for base in font_dirs():
        if not base.is_dir():
            continue
        for pattern in (f"{compact}*.ttf", f"{family}*.ttf"):
            try:
                hits = sorted(base.rglob(pattern))
            except OSError:
                continue
            for hit in hits:
                key = str(hit.resolve())
                if key in seen:
                    continue
                if not (_belongs(hit.stem, _compact(family))
                        or _belongs(hit.stem, family)):
                    continue
                seen.add(key)
                out.append(hit)
    return out


def _stem_tail(path, family):
    """The part of a file name after the family, e.g. "Bold"."""
    stem = path.stem
    for prefix in (_compact(family), family):
        if stem.lower().startswith(prefix.lower()):
            return stem[len(prefix):].lstrip("-_ ")
    return stem


def _fc_match(family, style=None):
    """Ask fontconfig for a family, and verify what it hands back.

    fc-match always answers, with a fallback face when the family is not
    installed, so the returned family list is checked against the one
    asked for. Without that check every missing family would silently
    embed DejaVu Sans.
    """
    pattern = family if not style else f"{family}:style={style}"
    try:
        out = subprocess.run(
            ["fc-match", "-f", "%{file}\t%{family}", pattern],
            capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or "\t" not in out.stdout:
        return None
    path, families = out.stdout.split("\t", 1)
    wanted = family.strip().lower()
    if wanted not in {f.strip().lower() for f in families.split(",")}:
        return None
    if not path.lower().endswith(".ttf"):
        return None
    return Path(path)


def find_faces(family):
    """Pick one file per slot for a family.

    Returns ``(faces, notes)`` where faces maps a slot name to a Path.
    No file is ever used for two slots: a variable font reports several
    styles at one path, and pointing regular and bold at the same bytes
    would ship the same face twice under two labels for no gain.
    """
    notes = []
    candidates = _candidate_files(family)
    faces = {}
    taken = set()

    for slot in SLOTS:
        for suffix in SLOT_SUFFIXES[slot]:
            for path in candidates:
                if str(path.resolve()) in taken:
                    continue
                if _stem_tail(path, family).lower() == suffix.lower():
                    faces[slot] = path
                    taken.add(str(path.resolve()))
                    break
            if slot in faces:
                break

    if "regular" not in faces:
        # A variable font is one file for the whole weight axis. Embed it
        # once, in the regular slot, and say so: PowerPoint renders an
        # embedded face at its default instance, so it cannot stand in
        # for a real bold.
        # Upright first: IBM Plex Sans ships an italic variable font
        # alongside the upright one, and the italic must not become the
        # regular face just because it sorted first.
        variable = sorted(
            (p for p in candidates
             if "variablefont" in p.name.lower().replace(" ", "")
             or "[wght]" in p.name.lower()),
            key=lambda p: ("italic" in p.name.lower()
                           or "oblique" in p.name.lower()))
        if variable and str(variable[0].resolve()) not in taken:
            faces["regular"] = variable[0]
            taken.add(str(variable[0].resolve()))
            notes.append(
                f"{family}: only a variable font is installed "
                f"({variable[0].name}), embedded once as the regular face")

    if "regular" not in faces:
        matched = _fc_match(family)
        if matched is not None and str(matched.resolve()) not in taken:
            faces["regular"] = matched
            taken.add(str(matched.resolve()))
            notes.append(f"{family}: regular face taken from fc-match")

    if "regular" in faces and "bold" not in faces:
        matched = _fc_match(family, "Bold")
        if matched is not None and str(matched.resolve()) not in taken:
            faces["bold"] = matched
            taken.add(str(matched.resolve()))
            notes.append(f"{family}: bold face taken from fc-match")

    if not faces:
        otf = [p.name for base in font_dirs() if base.is_dir()
               for p in base.rglob(f"{_compact(family)}*.otf")]
        if otf:
            notes.append(
                f"{family}: only .otf files are installed "
                f"({otf[0]} and {len(otf) - 1} more); PowerPoint font "
                f"embedding is a TrueType facility")
    return faces, notes


# ---------------------------------------------------------------- licence


def _licence_in(directory):
    try:
        entries = sorted(directory.iterdir())
    except OSError:
        return None
    for entry in entries:
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in LICENCE_SUFFIXES:
            continue
        lowered = entry.name.lower()
        if any(hint in lowered for hint in LICENCE_HINTS):
            return entry
    return None


def _rpm_licence(path):
    """The owning rpm's licence directory, for packaged system fonts.

    Fedora strips licence files out of /usr/share/fonts and installs them
    under /usr/share/licenses/<package>/ instead, so a font that looks
    unlicensed on disk often is not.
    """
    try:
        out = subprocess.run(["rpm", "-qf", "--queryformat", "%{NAME}",
                              str(path)],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    package = out.stdout.strip()
    if not package or " " in package:
        return None
    return _licence_in(Path("/usr/share/licenses") / package)


def family_licence(family, embedded_path):
    """The licence covering a family, not just the one file embedded.

    A licence covers the font software, not a copy of one file. IBM Plex
    Sans Arabic is the case that forces this: the .ttf copies live in an
    unpackaged directory under the home, while the copy that carries the
    rpm licence is the .otf this script deliberately refuses to embed.
    Searching from the embedded file alone would refuse the exact face
    Arabic decks are set in, on a machine that has its OFL text on disk.

    Returns ``(path, found_via)``: the licence file, and the font file it
    was found through when that is not the one being embedded.
    """
    hit = find_licence(embedded_path)
    if hit is not None:
        return hit, None
    compact = _compact(family)
    seen = {str(Path(embedded_path).resolve())}
    for base in font_dirs():
        if not base.is_dir():
            continue
        for pattern in (f"{compact}*.otf", f"{family}*.otf",
                        f"{compact}*.ttc", f"{compact}*.ttf",
                        f"{family}*.ttf"):
            try:
                hits = sorted(base.rglob(pattern))
            except OSError:
                continue
            for path in hits:
                key = str(path.resolve())
                if key in seen:
                    continue
                if not (_belongs(path.stem, compact)
                        or _belongs(path.stem, family)):
                    continue
                seen.add(key)
                found = find_licence(path)
                if found is not None:
                    return found, str(path)
    return None, None


def find_licence(font_path):
    """Locate the licence file covering a font file, or None.

    Beside the font first, then up the tree to the font root, then the
    owning rpm. The walk stops at the font root so it can never wander
    into the home directory and mistake an unrelated LICENSE for the
    font's own.
    """
    path = Path(font_path).resolve()
    roots = set()
    for base in font_dirs():
        try:
            roots.add(base.resolve())
        except OSError:
            continue
    directory = path.parent
    while True:
        hit = _licence_in(directory)
        if hit is not None:
            return hit
        if directory in roots or directory.parent == directory:
            break
        directory = directory.parent
    return _rpm_licence(path)


def licence_evidence(font_path):
    """What the font binary itself says about embedding.

    Reported, never used to pass the gate: name ids 13 and 14 and the
    OS/2 fsType bits live inside the file, and a file cannot vouch for
    its own licence. The user asked for a gate on licence files found on
    disk, so that is what gates; this is context for the reader.
    """
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None
    try:
        font = TTFont(str(font_path), lazy=True, fontNumber=0)
    except Exception:
        return None
    out = {}
    try:
        out["fs_type"] = int(font["OS/2"].fsType)
    except Exception:
        out["fs_type"] = None
    for name_id, key in ((13, "licence_description"), (14, "licence_url")):
        try:
            value = font["name"].getDebugName(name_id)
        except Exception:
            value = None
        if value:
            out[key] = value.strip()[:200]
    try:
        font.close()
    except Exception:
        pass
    return out


# ---------------------------------------------------------------- writing


def _presentation(pkg):
    root = pkg.tree(PRESENTATION)
    if root is None:
        raise SystemExit("not a presentation: ppt/presentation.xml is missing")
    return root


def _embedded_font_lst(root, create=True):
    """The p:embeddedFontLst, created in its schema position if absent."""
    lst = root.find(qp("embeddedFontLst"))
    if lst is not None or not create:
        return lst
    lst = etree.Element(qp("embeddedFontLst"))
    index = 0
    for i, child in enumerate(root):
        local = etree.QName(child).localname
        if local in BEFORE_EMBEDDED_FONT_LST:
            index = i + 1
    root.insert(index, lst)
    return lst


def _entry_for(lst, family):
    for entry in lst.findall(qp("embeddedFont")):
        font = entry.find(qp("font"))
        if font is not None and font.get("typeface") == family:
            return entry
    return None


def _new_entry(lst, family):
    entry = etree.SubElement(lst, qp("embeddedFont"))
    font = etree.SubElement(entry, qp("font"))
    font.set("typeface", family)
    return entry


def _set_slot(entry, slot, rel_id):
    """Point one slot at a part, keeping the schema's child order."""
    existing = entry.find(qp(slot))
    if existing is not None:
        existing.set(qr("id"), rel_id)
        return existing
    element = etree.Element(qp(slot))
    element.set(qr("id"), rel_id)
    # p:font first, then the four slots in SLOTS order.
    order = ("font",) + SLOTS
    want = order.index(slot)
    index = len(entry)
    for i, child in enumerate(entry):
        local = etree.QName(child).localname
        if local in order and order.index(local) > want:
            index = i
            break
    entry.insert(index, element)
    return element


def _next_font_number(pkg):
    highest = 0
    for name in pkg.names:
        match = re.match(rf"^{FONT_DIR}/font(\d+)\.fntdata$", name)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def embed_fonts(path, families=None, allow_unlicensed=False, output=None,
                dry_run=False):
    """Embed the faces the deck uses, and report what happened.

    ``families`` restricts the pass to a list of family names; the
    default is every family the deck asks for. A family with no findable
    file, or with no findable licence, is reported and skipped rather
    than raising: one missing face must not cost the deck its other
    three. The pass is idempotent, because a slot already pointing at a
    part that exists is left alone.
    """
    size_before = os.path.getsize(path)
    pkg = Package(path)
    used = used_families(pkg)
    wanted = list(used) if families is None else list(families)

    root = _presentation(pkg)
    lst = _embedded_font_lst(root)
    counter = _next_font_number(pkg)

    embedded = []
    skipped = []
    bytes_added = 0

    for family in wanted:
        faces, notes = find_faces(family)
        if families is not None and family not in used:
            # A family named on the command line is embedded even when the
            # walk did not see it: the caller may know about a family this
            # script cannot reach, a chart part or a SmartArt drawing for
            # instance. The empty used_in is what shows up a typo.
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
                    "the deck; pass --allow-unlicensed to override",
                ],
                "licence_evidence": licence_evidence(faces["regular"]),
            })
            continue

        entry = _entry_for(lst, family)
        if entry is None and not dry_run:
            entry = _new_entry(lst, family)

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
            if entry is not None:
                element = entry.find(qp(slot))
                if element is not None:
                    target = pkg.rel_target(PRESENTATION,
                                            element.get(qr("id")))
                    if target and pkg.has(target):
                        existing_part = target
            if existing_part is not None:
                # Already embedded on an earlier run. Leaving the part
                # alone is what makes a second run add nothing.
                record["slots"][slot] = {"part": existing_part,
                                         "file": str(source),
                                         "bytes": len(pkg.get(existing_part)),
                                         "added": False}
                continue
            part = f"{FONT_DIR}/font{counter}.fntdata"
            counter += 1
            record["slots"][slot] = {"part": part, "file": str(source),
                                     "bytes": len(data), "added": True}
            bytes_added += len(data)
            if dry_run:
                continue
            pkg.put(part, data)
            pkg.ensure_override("/" + part, CT_FONTDATA)
            rel_id = pkg.ensure_rel(PRESENTATION, REL_FONT, part)
            _set_slot(entry, slot, rel_id)
        embedded.append(record)

    if not dry_run and embedded:
        # The checkbox PowerPoint shows as "Embed fonts in the file".
        # saveSubsetFonts goes to 0 because full faces are embedded, not
        # subsets: claiming a subset of a complete font confuses the
        # editability prompt PowerPoint shows the reader.
        root.set("embedTrueTypeFonts", "1")
        root.set("saveSubsetFonts", "0")

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

    if not embedded and lst is not None and len(lst) == 0:
        # An empty p:embeddedFontLst is not valid. Nothing was embedded,
        # so take the element back out.
        root.remove(lst)

    out = output or path
    if not os.path.isdir(os.path.dirname(out) or "."):
        raise SystemExit(f"no directory for {out}")
    pkg.save(out)
    report["output"] = out
    report["size_after"] = os.path.getsize(out)
    report["size_delta"] = report["size_after"] - size_before
    return report


# ---------------------------------------------------------------- checking


def verify(path):
    """Consistency of the embedding, as a package reader sees it.

    Every slot's relationship has to resolve to a part that exists and
    carries the fontdata content type, and no fntdata part may be
    orphaned. Either failure is a file PowerPoint offers to repair.
    """
    pkg = Package(path)
    root = _presentation(pkg)
    lst = _embedded_font_lst(root, create=False)
    overrides = pkg.overrides()
    problems = []
    referenced = set()
    families = []

    if lst is not None:
        for entry in lst.findall(qp("embeddedFont")):
            font = entry.find(qp("font"))
            family = font.get("typeface") if font is not None else None
            if not family:
                problems.append("an embeddedFont entry names no typeface")
                continue
            slots = {}
            for slot in SLOTS:
                element = entry.find(qp(slot))
                if element is None:
                    continue
                rel_id = element.get(qr("id"))
                target = pkg.rel_target(PRESENTATION, rel_id)
                if target is None:
                    problems.append(
                        f"{family} {slot}: {rel_id} has no relationship")
                    continue
                if not pkg.has(target):
                    problems.append(
                        f"{family} {slot}: {target} is not in the package")
                    continue
                if overrides.get("/" + target) != CT_FONTDATA:
                    problems.append(
                        f"{family} {slot}: {target} has no {CT_FONTDATA} "
                        f"content type override")
                referenced.add(target)
                slots[slot] = {"part": target,
                               "bytes": len(pkg.get(target))}
            if not slots:
                problems.append(f"{family}: no face parts")
            families.append({"family": family, "slots": slots})

    for name in pkg.names:
        if name.startswith(FONT_DIR + "/") and name.endswith(".fntdata"):
            if name not in referenced:
                problems.append(f"{name} is orphaned")

    return {"ok": not problems, "families": families, "problems": problems}


# ---------------------------------------------------------------- cli


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("embed", help="embed the faces the deck uses")
    p.add_argument("pptx")
    p.add_argument("-o", "--output", help="output path (default: in place)")
    p.add_argument("--family", action="append", dest="families",
                   help="restrict to this family, repeatable")
    p.add_argument("--allow-unlicensed", action="store_true",
                   help="embed a face whose licence file was not found")
    p.add_argument("--report", action="store_true",
                   help="report only, write nothing")

    p = sub.add_parser("report",
                       help="what is used, what would be embedded, what not")
    p.add_argument("pptx")
    p.add_argument("--family", action="append", dest="families")
    p.add_argument("--allow-unlicensed", action="store_true")

    p = sub.add_parser("verify",
                       help="check the embedding is internally consistent")
    p.add_argument("pptx")

    args = ap.parse_args(argv)

    if args.cmd == "verify":
        result = verify(args.pptx)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1

    dry_run = args.cmd == "report" or getattr(args, "report", False)
    report = embed_fonts(args.pptx,
                         families=args.families,
                         allow_unlicensed=args.allow_unlicensed,
                         output=getattr(args, "output", None),
                         dry_run=dry_run)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
