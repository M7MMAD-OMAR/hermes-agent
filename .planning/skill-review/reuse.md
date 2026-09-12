# Skill scripts review: code reuse

Reviewer 1 of 4. Angle: code that reimplements something the codebase already
has. Scope: `skills/productivity/docx/scripts/*.py`,
`skills/productivity/powerpoint/scripts/*.py`,
`skills/productivity/house-style/scripts/*.py`.

One fact decides most of what follows, so it is stated once here.
`tools/skills_sync.py` copies a whole skill directory into
`<hermes home>/skills/`, tracking one origin hash per skill. Everything inside
a single `scripts/` directory therefore always ships together, and sharing
within one skill is free. Sharing across two skills is not, which is why the
`house_common.py` locator exists. Findings respect that line.

---

### Two near-identical OOXML `Package` classes in the same directory

- **Where:**
  `skills/productivity/powerpoint/scripts/pptx_comments.py:160-292`
  and `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:171-296`.
  Supporting helpers duplicated alongside them:
  `qa` (pptx_comments.py, pptx_embed_fonts.py:135),
  `qr` (pptx_embed_fonts.py:143), `qct` (pptx_embed_fonts.py:147),
  `qrel` (pptx_embed_fonts.py:151) and
  `resolve_target` (pptx_embed_fonts.py:155-168).
  A third copy of the same class lives at
  `skills/productivity/xlsx/scripts/xlsx_comments.py:147-196` (different
  skill, listed for completeness, not part of the change).
- **Problem:** `__init__`, `has`, `get`, `put`, `tree`, `set_tree`, `save`,
  `ensure_override`, `rels`, `rels_name` and `ensure_rel` are byte identical
  across the two powerpoint files, about 120 lines. A `diff` of the two spans
  shows only four real differences: `pptx_comments` adds `drop` and
  `drop_override` and `rel_targets`, `pptx_embed_fonts` adds `overrides` and
  `rel_target` and a longer `ensure_rel` docstring. The duplication is not a
  portability compromise, both files are in the same skill directory and are
  always installed together.
- **Cost:** Any fix to the package layer, and the atomic `tmp` then
  `os.replace` save in particular, has to be made twice in this directory and
  a third time in xlsx. The two copies have already diverged on which
  accessors exist, so a caller cannot move between them. About 120 lines of
  the powerpoint skill's 4,066 are a copy.
- **Fix:** Two shapes, both safe because skills_sync ships the directory whole.
  (a) Extract `Package` plus `qa`, `qr`, `qct`, `qrel` and `resolve_target`
  into a new `skills/productivity/powerpoint/scripts/ooxml_package.py`, union
  the accessors, and have both files import it. `docx_embed_fonts._load_shared`
  (docx/scripts:193-213) then retargets from `pptx_embed_fonts` to
  `ooxml_package`, which also removes the oddity of the Word script importing
  the PowerPoint font script for its package plumbing. One new file.
  (b) Cheaper, no new file: make `pptx_comments.Package` subclass
  `pptx_embed_fonts.Package` and promote `drop`, `drop_override` and
  `rel_targets` into the base. `pptx_embed_fonts.Package` is already the
  de-facto base, `docx_embed_fonts.py:244` subclasses it through `shared`.
  The drawback is that the comments script would then depend on the font
  embedding script, which reads oddly. Prefer (a).
- **Confidence:** high
- **Risk:** CAREFUL

---

### Three sibling-skill locators, none of which honours `HERMES_HOME`

- **Where:**
  `skills/productivity/docx/scripts/house_common.py:20-40` (and the four
  identical copies under `powerpoint/scripts`, `house-style/scripts`,
  `pdf/scripts`, `xlsx/scripts`, all md5 `efb47ddb8c4e...`),
  `skills/productivity/docx/scripts/docx_embed_fonts.py:183-213`
  (`_pptx_module_paths` and `_load_shared`),
  `skills/productivity/house-style/scripts/office_inspect.py:50-62`
  (`_SKILL_ROOTS` and `_skill_script`).
- **Problem:** The same job, find a sibling skill's `scripts/` directory and
  fall back gracefully, is written three times with three different search
  path lists. They have already drifted: `house_common.house_style_paths` and
  `_pptx_module_paths` both search `here` first so a co-installed copy wins,
  while `office_inspect._SKILL_ROOTS` has no `here` entry at all and relies on
  `parents[2]`. More seriously, all three hardcode
  `Path.home() / ".hermes" / "skills" / "productivity"`, while the real
  install root is `get_hermes_home() / "skills"` from
  `tools/hermes_constants.py:82-87`, which resolves a context-local override,
  then the `HERMES_HOME` environment variable, then the platform default (and
  on Windows the default is `%LOCALAPPDATA%/hermes`, not `~/.hermes`,
  `hermes_constants.py:45-51`). Under a non-default `HERMES_HOME` or on
  Windows, every one of these locators silently misses and the caller quietly
  degrades to the no-theme path.
- **Cost:** Three places to fix one path bug, and the bug is invisible: the
  failure mode of all three is "return None and build the plain version", so
  a wrong-profile or Windows install loses the house design system with no
  error. `house_common.py` is already the file every skill carries, so the
  extra two implementations buy nothing.
- **Fix:** Generalise the existing `house_common.py` from
  `house_style_paths()` to a `skill_scripts_dir(skill_name)` /
  `load_skill_module(skill_name, module_name)` pair, keeping
  `load_house_style()` as a thin wrapper so current callers
  (`docx_create.py:137`, `docx_graphics.py:49`, `pptx_create.py:86`) are
  untouched. Have `docx_embed_fonts._load_shared` and
  `office_inspect._skill_script` call it. A portable skill script cannot
  import `tools/hermes_constants.py`, but it can read the same environment
  variable, so the root list becomes `os.environ.get("HERMES_HOME")` first,
  then `Path.home() / ".hermes"`, then, for Windows parity,
  `%LOCALAPPDATA%/hermes`. Because all five `house_common.py` copies are
  byte identical today, the edit is made once and copied, and any drift is
  detectable with `md5sum`.
- **Confidence:** high for the duplication, high for the `HERMES_HOME` miss
  (`hermes_constants.py:82-87` is explicit), medium on whether the skills are
  ever run under a non-default home in practice.
- **Risk:** CAREFUL

---

### RTL predicates copied between `docx_common` and `pptx_common`, then drifted

- **Where:**
  `skills/productivity/docx/scripts/docx_common.py:116-129` (`_RTL_CHARS`,
  `has_rtl_text`), `:281-283` (`_has_latin_letters`), `:285-290`
  (`_mostly_rtl`);
  `skills/productivity/powerpoint/scripts/pptx_common.py:15-30`
  (`_RTL_CHARS`, `_RTL_RE`, `_LATIN_RE`, `has_rtl_text`, `mostly_rtl`),
  `:59-60` (`_has_latin_letters`).
  A fourth copy of the same character class, in the literal spelling
  `pptx_common` uses, sits at
  `skills/productivity/diagrams/scripts/diagram_render.py:29`.
- **Problem:** The character class is the same six ranges in both files, one
  written as `\uXXXX` escapes and one as literal characters, so a `diff`
  does not catch it. `has_rtl_text` is the same predicate in both.
  `docx_common._mostly_rtl` and `pptx_common.mostly_rtl` are the same function
  with different visibility. The drift is mechanical rather than meaningful:
  `docx_common` does `import re` inside the function body and rebuilds the
  character class into a fresh pattern string on every call
  (`docx_common.py:128-129`, `:288-289`), while `pptx_common` compiles
  `_RTL_RE` and `_LATIN_RE` once at module level; and `_has_latin_letters` is
  a per-character Python loop in `docx_common.py:281-283` against a compiled
  regex in `pptx_common.py:59-60`. These functions are called once per
  paragraph across a whole document by `apply_rtl`
  (`docx_common.py:214-255`), so the recompilation is not free.
- **Cost:** Two implementations of the same four predicates that must stay
  behaviourally identical for a mixed Arabic/Latin deliverable to look the
  same in Word and PowerPoint, with no test tying them together. Adding a
  script range (Thaana, N'Ko) means editing four places, one of which is in
  another skill entirely.
- **Fix:** Do *not* move these into `house_style.py`. `house_common`'s whole
  contract is that it may return `None`, so `docx_common.apply_rtl` has to
  work with the house-style skill absent, and the design decision is stated in
  `house_common.py:4-8`. Instead, align `docx_common` to the already better
  `pptx_common` form: move `import re` to module scope, add module level
  `_RTL_RE` and `_LATIN_RE` compiled once, express `_has_latin_letters` as
  `_LATIN_RE.search`, and either rename `_mostly_rtl` to `mostly_rtl` or give
  `pptx_common` the underscore, so the two modules read as one idea. Then note
  in a comment that `pptx_common.py` and `diagram_render.py:29` carry the same
  class. Chesterton check: `git log -L116,130` on `docx_common.py` gives
  `23f2d91c79` (10 Sep 2026, `fix(skills/docx): mark Arabic paragraphs
  right-to-left`) and `pptx_common.py` was created the same day by
  `cd3483c614` (`fix(skills): lay Arabic decks and sheets out right to left`).
  `pptx_common.py:8` even names `docx_common.apply_rtl` as its model. The
  divergence is copy-and-improve, not a deliberate split.
- **Confidence:** high
- **Risk:** SAFE

---

### `914400` written out by hand where the library exposes the conversion

- **Where:**
  `skills/productivity/house-style/scripts/house_style.py:771-772` and
  `:791-792`;
  `skills/productivity/house-style/scripts/style_lint.py:484` (`EMU_IN =
  914400.0`) feeding `_inches` at `:502-503`, and `:283` which divides by
  `12700` for points;
  `skills/productivity/powerpoint/scripts/pptx_create.py:197-198`;
  `skills/productivity/house-style/scripts/office_inspect.py:235-236`.
  The thing they could call is already used two files over:
  `skills/productivity/powerpoint/scripts/pptx_read.py:120-121` writes
  `round(Emu(prs.slide_width).inches, 3)`.
- **Problem:** EMU to inch and EMU to point conversion is reimplemented as a
  bare magic number at five sites, while `python-pptx` (and `python-docx`,
  same `shared` module) ships `Emu`/`Length` with `.inches`, `.pt`, `.cm` and
  `.emu`. Both libraries are already hard dependencies of these scripts, and
  the construction direction (`Inches(...)`, `Pt(...)`) is used everywhere in
  the same files, so only the reading direction was hand rolled.
- **Cost:** Small in lines, real in readability and in grep-ability: someone
  auditing unit handling has to know that `914400` and `12700` are the unit
  constants, and `style_lint.py` defines its own `EMU_IN` rather than reusing
  either the library or the identical expression three files away. It is also
  the kind of constant that gets copied into the next script.
- **Fix:** Replace `x / 914400` with `Emu(x).inches` and `x / 12700` with
  `Emu(x).pt`, following the pattern already in `pptx_read.py:120-121`. In
  `style_lint.py`, delete `EMU_IN` and have `_inches` call `Emu(value).inches`.
  Note that shape attributes can be `None` in python-pptx, so keep the
  existing `or 0` guards (`house_style.py:792`) around the call.
- **Confidence:** high
- **Risk:** SAFE

---

### `_next_font_number` and `SLOTS` duplicated across the two font embedders

- **Where:**
  `skills/productivity/docx/scripts/docx_embed_fonts.py:501-511` and
  `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:782-789`;
  `SLOTS = ("regular", "bold", "italic", "boldItalic")` at
  `docx_embed_fonts.py:104` and `pptx_embed_fonts.py:93`.
- **Problem:** `_next_font_number` is the same eight lines twice, scanning
  `pkg.names` for `<FONT_DIR>/font<N>.<ext>` and returning the highest plus
  one. The only difference is the extension, `.odttf` for Word and `.fntdata`
  for PowerPoint, both already module constants beside `FONT_DIR`. `SLOTS` is
  the same four-tuple in both, and it is a shared vocabulary, not a
  coincidence: `docx_embed_fonts` already imports `find_faces` from the
  PowerPoint module and keys the result by these names.
- **Cost:** Cheap to fix and cheap to leave, but the sharing channel already
  exists. `docx_embed_fonts.py:216` binds `shared = _load_shared()` and
  `:228-230` already re-exports `family_licence`, `licence_evidence` and
  `resolve_target` from it, so these two are an inconsistency in an otherwise
  deliberate arrangement, not a portability constraint.
- **Fix:** Give the shared module `next_font_number(pkg, font_dir, extension)`
  and have both call it, and re-export `SLOTS` through the existing
  `shared.` bindings at `docx_embed_fonts.py:228-230` rather than redeclaring
  it. If finding 1 lands as option (a), both belong in the new
  `ooxml_package.py` instead.
- **Confidence:** high
- **Risk:** SAFE

---

### `docx_graphics._hex` duplicates `house_style._norm`

- **Where:** `skills/productivity/docx/scripts/docx_graphics.py:733-734`
  (six callers), plus the same expression inlined at
  `docx_graphics.py:134` inside `_srgb`. The existing function is
  `skills/productivity/house-style/scripts/house_style.py:66-72` (`_norm`).
- **Problem:** `_hex` is `str(color).lstrip("#").upper()`. `_norm` does the
  same and additionally expands three-digit shorthand and raises on anything
  that is not `RRGGBB`. `docx_graphics.py:49` already imports from
  `house_common`, and `:80` and `:1003` already call `load_house_style()`, so
  the module is reachable. A `#abc` or a stray colour name currently reaches
  the DrawingML `val` attribute unvalidated and silently produces a document
  a renderer will not colour.
- **Cost:** Low in lines, but it is the third notion of "hex colour" in this
  tree (`house_style._norm`, `docx_graphics._hex`, and the raw `.lstrip("#")`
  at `style_lint.py:218` and `:913`), and only one of them validates.
- **Fix:** Since `house_style` may legitimately be absent, keep `_hex` as the
  fallback but route through `house_style._norm` when `load_house_style()`
  returned a module, or, simpler and with no new import, copy `_norm`'s
  shorthand expansion and `re.fullmatch` guard into `_hex` and use `_hex` at
  `:134` instead of inlining the expression again. Do not make `docx_graphics`
  hard-depend on `house-style`.
- **Confidence:** medium. The colour values reaching `_hex` come from the
  theme and from user specs, and I did not establish whether a three-digit
  hex can actually arrive, so the validation half may be defensive rather
  than load bearing. The inlined duplicate at `:134` is unambiguous.
- **Risk:** SAFE

---

## Considered and rejected

**The five identical `house_common.py` copies.** All five files under
`docx/scripts`, `powerpoint/scripts`, `house-style/scripts`, `pdf/scripts` and
`xlsx/scripts` have md5 `efb47ddb8c4ef4d3524a0ceb07e684f1`, so they are byte
identical, not merely near identical. The duplication is deliberate and the
file says so in its own docstring at `house_common.py:3-8`: the skills are
installed independently, so a shared import would break whichever one was
installed alone, and a locator that degrades to `None` does not. The commit
that introduced all five is `cca1068126`, `feat(skills): one house design
system for every office deliverable`, a single commit, not a copy that crept.
`tools/skills_sync.py` copies each skill directory separately with its own
origin hash, which confirms the premise. The only thing worth changing here is
the search path itself, which is finding 2 above, and that change keeps the
five copies.

**`docx_graphics._col_letter` (docx_graphics.py:235-245) versus
`openpyxl.utils.get_column_letter`.** It looks like an eleven line
reimplementation of a library function already imported elsewhere in the tree
(`xlsx/scripts/csv_to_xlsx.py:27`, `xlsx_edit.py:52`). It is not a safe swap.
`openpyxl` is an *optional* import inside `workbook_blob`
(docx_graphics.py:433-435, returning `None` when absent), while `_col_letter`
feeds `_val_ref` and `_tx_ref` unconditionally through `chart_xml`. Swapping
in `get_column_letter` would either make the whole chart path hard-depend on
openpyxl, which the current code deliberately avoids, or need a lazy import
with fallback longer than the eleven lines it replaces.

**Hand-rolled DrawingML chart XML in `docx_graphics.py:292-424`
(`chart_xml`).** It looks like a reimplementation of what `pptx_create.py`
gets for free from `python-pptx`'s `add_chart`. It is not: `python-docx` has
no chart API at all, so there is nothing to call. The neighbouring
`workbook_blob` (`:427-451`) does the right thing already by delegating the
embedded workbook to `openpyxl` rather than writing SpreadsheetML by hand.

**`pptx_embed_fonts.font_dirs` (`:393-418`) versus
`optional-skills/productivity/herwork/scripts/arabic_style.py:78-94`
(`_font_dirs`).** Same directory list, but the docstring at
`pptx_embed_fonts.py:396-397` states the alignment is intentional, so that a
family this machine can set type in is a family this script can embed. It is
also a cross-skill pair where one side lives under `optional-skills/`, so the
locator machinery would have to grow a second root for a twenty line list.
Not worth it.

**The `print(json.dumps({"ok": ...}))` CLI envelope, repeated in roughly
eighteen scripts** (`docx_comments.py:881-883`, `docx_create.py:675`,
`docx_graphics.py:1010`, `style_lint.py:1096`, `office_inspect.py:384`,
`pptx_comments.py:795`, `pptx_read.py:108`, and the rest). This is the
skills' CLI contract, consumed by `office_inspect._run_helper`
(`office_inspect.py:64-85`) which parses the JSON of any sibling script. A
shared emitter would be a cross-skill dependency for three lines each, and the
value of the convention is precisely that every script can be read and run on
its own.

**`house_style.is_arabic` (`house_style.py:264-276`) as a fourth copy of the
RTL predicate.** It is not. `_ARABIC_RANGE` at `:261` covers Arabic only, not
Hebrew, and the function is a *majority of alphabetic characters* test used to
pick line spacing and font slots, while `has_rtl_text` is an *any RTL
character present* test used to set `w:bidi`. Merging them would change
behaviour. `style_lint.py:45-47` and `office_inspect.py:43` already import
`is_arabic` from `house_style`, so the house-style skill's own internal reuse
is healthy.

**`docx_comments.py` versus `pptx_comments.py`.** The two comment
implementations look parallel at 993 and 829 lines, but they do not share a
package layer by design: the Word side works through `python-docx` parts
(`_part_by_reltype`, `docx_comments.py:123-128`) while the PowerPoint side
works on a raw zip `Package`, because PresentationML has two incompatible
comment systems and `python-pptx` models neither. The shared surface is
`author`/`initials`/timestamp argument names, which is a CLI contract, not
code.
