# Reviewer 2, code quality

Scope: `skills/productivity/docx/scripts/*.py`, `skills/productivity/powerpoint/scripts/*.py`,
`skills/productivity/house-style/scripts/*.py`. Cleanup pass, not a bug hunt.
Paths below are relative to `skills/productivity/`.

---

### The OPC `Package` class is copy-pasted between two powerpoint scripts

- **Where:** `powerpoint/scripts/pptx_comments.py:160-290` and `powerpoint/scripts/pptx_embed_fonts.py:171-296`
- **Problem:** Two 130 line classes that a line by line diff shows are the same code.
  `__init__`, `has`, `get`, `put`, `tree`, `set_tree`, `save`, `ensure_override`,
  `rels_name`, `rels`, `ensure_rel` and the module level `resolve_target` are byte
  identical. The only real differences are three methods each side needs and the
  other does not: `drop`/`drop_override`/`rel_targets` in the comments copy,
  `overrides`/`rel_target` in the fonts copy. Both files live in the same
  `powerpoint/scripts/` directory, so the install-independence argument that
  justifies the five `house_common.py` copies does not apply here.
- **Cost:** Every fix to zip round-tripping, content-type handling or relationship
  id minting has to be made twice, and a fix applied to one copy only is invisible.
  `ensure_rel` already carries a comment in the fonts copy, about presentation.xml
  being relationship dense, that the comments copy does not have, which is exactly
  how the two drift apart.
- **Fix:** Add `powerpoint/scripts/pptx_opc.py` holding `resolve_target`, the
  namespace helpers `qct`/`qrel`, and one `Package` class carrying the union of the
  six divergent methods. Both scripts then do `from pptx_opc import Package,
  resolve_target`, a sibling import inside one skill, which is what `pptx_common.py`
  already does for `pptx_create.py`. Do not reach across skills for this.
- **Confidence:** high
- **Risk:** CAREFUL

---

### `embed_fonts` is duplicated across the docx and powerpoint skills, and the seam chosen to share it leaks

- **Where:** `powerpoint/scripts/pptx_embed_fonts.py:791-933` and `docx/scripts/docx_embed_fonts.py:513-659`; the sharing hack at `docx/scripts/docx_embed_fonts.py:183-241`
- **Problem:** Two ~145 line functions with the same shape: size_before, open package,
  `used_families`, the wanted list, the named-but-unused note, the no-faces skip, the
  licence lookup, the identical `skipped` record with the same wording, the per slot
  loop with the same idempotence check, the same report dict, the same `dry_run`
  early return, the same output directory check and save. Roughly twenty lines
  actually differ: the container element, the part extension, the obfuscation, the
  two flags. `git log` confirms the copy: the pptx version landed in `6d2f7f3339`,
  the docx version one commit later in `5fdceda4d0`.

  The sharing that was attempted is worse than the duplication. `docx_embed_fonts.py`
  imports a module called `pptx_embed_fonts` for font discovery, which drags three
  further leaks with it: `_pptx_module_paths` re-implements `house_common.house_style_paths`
  by hand, `DOCX_FONT_DIRS` has to be spliced into `PPTX_FONT_DIRS` at import time
  as a global side effect (lines 218-222), and `find_faces` patches the borrowed
  notes with `note.replace("PowerPoint", "Word")`, which is prose repair standing in
  for an abstraction boundary.
- **Cost:** A licence policy change or a font discovery fix has to be reasoned about
  in a module named for the wrong format. The env var splice mutates `os.environ` on
  import, so importing the docx script changes the behaviour of the pptx script in
  the same process. The `replace` breaks silently the moment a note is reworded.
- **Fix:** Two moves, in this order.
  1. Move the format neutral half, `font_dirs`, `_candidate_files`, `_fc_match`,
     `find_faces`, `family_licence`, `find_licence`, `licence_evidence`, into
     `house-style/scripts/` and reach it through the existing blessed locator,
     `house_common.load_house_style()`. `house-style` is the one skill every other
     skill already has a sanctioned path to, so this is the only cross-skill import
     that does not break a solo install. Word the notes format neutrally there and
     delete both `_pptx_module_paths`/`_load_shared` and the `replace` call. Have the
     shared half read one env var, or take the extra directories as an argument
     instead of through the environment.
  2. Reduce the two `embed_fonts` bodies to one driver plus a small per format
     descriptor: `(part_extension, content_type_hook, container_getter,
     slot_element_name, encode(data) -> bytes, finish(root, embedded))`. The docx
     `obfuscate` becomes `encode`, the pptx one becomes identity.
  Step 1 alone is worth doing even if step 2 is deferred.
- **Confidence:** high
- **Risk:** RISKY for step 2. The docx docstring states an invariant the pptx side
  does not have: a second run must keep the existing `w:fontKey`, because a fresh
  GUID would not match the obfuscation the stored bytes were written for and the
  file stops being readable. Unifying the loop puts that invariant into shared code.
  Step 1 is CAREFUL.

---

### Three different answers to "which table columns are numeric"

- **Where:** `docx/scripts/docx_create.py:205-258`, `house-style/scripts/house_style.py:577` with `671-686`, and `house-style/scripts/house_style.py:1229-1242`
- **Problem:** Three implementations of one rule, with three different behaviours.
  `docx_create._NUMERIC_CELL` handles Western, Arabic-Indic and extended Arabic-Indic
  digits, currency symbols leading and trailing, three letter currency codes,
  parenthesised negatives and the Arabic percent sign, and it has an `_ABSTAINING_CELLS`
  set so a placeholder dash does not disqualify a column. `house_style._NUMERIC` is a
  single line regex with none of that, and it is used twice: once walking
  `table.rows[1:]` with an `IndexError` guard, once walking `rows[1:]` without one.
  The two house_style copies differ only in how they iterate.
- **Cost:** The same table can be right aligned by the create script and then left
  alone by the theme pass, or the reverse, because the two disagree about what a
  number is. An Arabic report with figures typed in Arabic-Indic numerals is exactly
  the case `docx_create` was extended to cover and the case the theme pass still gets
  wrong. Three copies means the next digit or currency fix lands in one of them.
- **Fix:** Put the rule in `house-style/scripts/house_style.py` as
  `numeric_columns(grid: list[list[str]]) -> set[int]` plus `is_numeric_cell(text)`,
  carrying `docx_create`'s richer regex and its abstaining set. `_docx_numeric_columns`
  and `_pptx_numeric_columns` shrink to a text grid extraction feeding it, and
  `docx_create.numeric_columns` becomes a call. Its list-vs-set return type and
  header-width parameter are the only real adaptation.
- **Cost of the change itself:** this is a behaviour change, not a pure refactor.
  Columns that the theme pass currently leaves alone, currency, Arabic-Indic digits,
  a column with one placeholder dash, will start being right aligned. Already
  generated files are unaffected, newly themed ones will differ.
- **Confidence:** high
- **Risk:** CAREFUL

---

### `add_callout` is a 160 line if/elif chain in a file that already has the registry it wants

- **Where:** `docx/scripts/docx_graphics.py:797-957`, registry at `docx/scripts/docx_graphics.py:959`
- **Problem:** The function validates `style` against `CALLOUT_STYLES` at line 823,
  then dispatches on the same string through five branches, the last of which is a
  bare `else:` with a `# block` comment rather than a named branch. Each branch is
  self-contained: it builds paragraphs and appends them to `made`. The file already
  ends with `BUILDERS = {"chart": add_chart, "image": add_picture, ...}`, so the
  registry pattern is the file's own idiom and this function does not follow it.
  The `lead` branch (lines 918-932) additionally re-implements the body of the local
  `new_paragraph` helper by hand, setting size, face and color on two runs inline,
  because `new_paragraph` creates a whole paragraph and `lead` needs two runs in one.
- **Cost:** To answer "what does the quote style do" you scroll a 160 line function
  and count `elif`s. Adding a sixth treatment means editing the chain, the
  `CALLOUT_STYLES` tuple and nothing links them, so the two can disagree. The
  duplicated run styling in `lead` will drift from `new_paragraph` the first time a
  property is added to one.
- **Fix:** Extract a `_CalloutContext` (doc, theme colors, `body_pt`, `face`, `rtl`,
  `text`, `label`) built once by `add_callout`, split `new_paragraph` into
  `_style_run(run, size, bold, color, face)` and `new_paragraph` which calls it, then
  make each branch a module level `_callout_rules(ctx) -> list`,
  `_callout_edge(ctx)`, `_callout_quote(ctx)`, `_callout_lead(ctx)` (which now uses
  `_style_run` for both runs), `_callout_block(ctx)`. Replace `CALLOUT_STYLES` and the
  chain with one `CALLOUT_BUILDERS` dict, exactly like `BUILDERS`. `add_callout`
  becomes about twenty lines: validate, build ctx, dispatch, apply RTL, return.
- **Confidence:** high
- **Risk:** SAFE

---

### `build_slide` tests the same condition four times and inlines four spec sections

- **Where:** `powerpoint/scripts/pptx_create.py:1057-1147`
- **Problem:** `composer is None` is re-tested at lines 1080, 1083 and 1090 after
  `composer is not None` at 1074, so one binary decision is spelled four times and
  the reader has to hold it across a 20 line span. After that the function carries
  four inline `for ... in spec.get(key, [])` blocks, images, tables, shapes and
  charts, each 8 to 14 lines of python-pptx calls with no relation to each other.
- **Cost:** 91 lines where the control flow is not visible from any one screen. The
  repeated `composer is None` makes the placeholder path look like three unrelated
  optional features rather than one alternative branch, which is how a fifth
  `if composer is None` gets added in the wrong place.
- **Fix:** Turn the composer decision into one `if composer is not None: ... else: ...`
  with the title, subtitle and bullets handling inside the `else`. Extract the four
  loops to `_add_images(slide, spec)`, `_add_tables(slide, spec)`,
  `_add_shapes(slide, spec)`, `_add_charts(slide, spec)`, each taking exactly the
  slide and the spec. `build_slide` then reads as: pick layout, apply background and
  chrome, compose or fill placeholders, add the four attachment kinds, set notes.
  About thirty lines.
- **Confidence:** high
- **Risk:** SAFE

---

### Seven near-identical sidecar part accessors, one of which does its work twice

- **Where:** `docx/scripts/docx_comments.py:146-201`
- **Problem:** `_comments_root`, `_extended_root`, `_ids_root` and `_extensible_root`
  are the same two lines four times over, differing only in the reltype constant.
  `_ensure_comments_root`, `_ensure_extended_root` and `_ensure_ids_root` are the
  same call three times over, differing in a four-tuple of reltype, part name,
  content type and root XML. On top of that, `_ensure_comments_root` (lines 164-168)
  calls `_comments_root` and returns early if it finds a root, which is precisely
  what `_ensure_part` already does on its first two lines. The other two `_ensure_*`
  functions do not have that pre-check, so the three are inconsistent as well as
  redundant. `git blame` puts all of it in one commit, `e9d76ec110`, so there is no
  history explaining the odd one out.
- **Cost:** Seven names to keep straight for two operations. The four-tuples are the
  real data and they are scattered across three function bodies instead of sitting in
  one table where a reader can compare them.
- **Fix:** One module level table, `_SIDECARS = {"comments": (RT.COMMENTS,
  "/word/comments.xml", COMMENTS_CT, COMMENTS_ROOT_XML), "extended": (...),
  "ids": (...), "extensible": (EXTENSIBLE_RT, None, None, None)}`, and two functions,
  `_root(doc, kind)` and `_ensure_root(doc, kind)`, the second raising for a kind with
  no creation template. Delete the duplicate pre-check in the comments path. Seven
  functions become two plus a table the reader can scan.
- **Confidence:** high
- **Risk:** SAFE

---

### The typography verdict block is written out three times in `style_lint`

- **Where:** `house-style/scripts/style_lint.py:266-275` (docx), `366-385` (pptx), `431-433` (xlsx)
- **Problem:** The same sequence of three judgements, stock face in use, sizes off the
  house scale falling back to size soup, too many families, is written once per reader
  with the same message strings and the same `elif` relationship. Only the medium
  string, `"doc"` versus `"deck"`, and the LIMITS key change. The xlsx reader carries a
  third copy of just the `font_zoo` check with a hardcoded `len(fonts) > 2` instead of
  `LIMITS["font_families"] + 1`, and a different message, so the workbook rule silently
  disagrees with the other two.
- **Cost:** Rewording a finding means finding all three sites. The hardcoded 2 is the
  visible result of the copy: a magic number where every sibling uses a named limit.
- **Fix:** Extract `_type_findings(sizes, fonts, where, medium) -> list[dict]`
  containing the stock-face check, the off-scale-or-soup check and the family-count
  check, reading `LIMITS[f"{medium}_font_sizes"]` and `LIMITS["font_families"]`. Each
  reader ends with `findings += _type_findings(sizes, fonts, _where(path), "doc")`.
  Give the workbook its own `LIMITS` entry rather than the literal 2.
- **Confidence:** high
- **Risk:** SAFE

---

### `_docx_runs` threads two accumulators through its parameter list

- **Where:** `house-style/scripts/style_lint.py:919-947`, called at `1000` and `1011`
- **Problem:** Six parameters, of which `findings` and `seen` are out-parameters the
  function mutates, and `body_size` and `qn`-adjacent state that never changes across
  calls. The caller must create both accumulators, thread them through two nested
  call sites and trust that the callee appends rather than replaces. Nothing in the
  signature says which parameters are inputs and which are outputs.
- **Cost:** The contract is invisible. A future caller that forgets `seen` gets
  duplicate findings rather than an error, and a reader cannot tell from the call site
  at line 1011 that two of the six arguments are being written to.
- **Fix:** A small `_ContrastScan` holding `paper`, `body_size`, `findings` and `seen`,
  with `scan(paragraph, where, backdrop)`. `geometry_docx` builds it once, the two call
  sites drop to three arguments, and `findings` is read off the object at the end. The
  scan object is also the natural home for the `qn` lookup discussed below.
- **Confidence:** high
- **Risk:** SAFE

---

### Three hand-rolled caches in `house_style`, one of which lies about its type

- **Where:** `house-style/scripts/house_style.py:341` with `343-366`, and `939-940` with `944-987`
- **Problem:** `_font_cache: dict[str, bool]` is declared to hold booleans and actually
  holds a `set[str]` under the sentinel key `"__families__"`, which needs two
  `# type: ignore` comments (lines 347 and 365) to get past a checker. The annotation
  is not merely wrong, it is documenting a design that no longer exists. Beside it,
  `_FONT_FILES` and `_FONT_OBJECTS` are two more module level dicts with the same
  hand-written check, compute, store body. `_FONT_OBJECTS` is keyed on
  `(family, _MEASURE_PT)` where `_MEASURE_PT` is a module constant that never varies,
  so half of every key is dead weight.
- **Cost:** Three memoisation bodies to read instead of three decorators, a type
  annotation that actively misleads, and two suppressions that hide whatever the
  checker would say next. The sentinel key means a family literally named
  `__families__` would collide, which is silly but is the kind of thing the pattern
  invites.
- **Fix:** Delete all three dicts. Decorate `_installed_families`, `font_file` and
  `_measurer` with `functools.lru_cache(maxsize=None)` and drop the bodies' first and
  last lines, the sentinel key, and both `# type: ignore` comments. About twenty five
  lines go, and the constant tuple key disappears with them.
- **Confidence:** high
- **Risk:** SAFE

---

### `_mostly_rtl` is private by name and public by use

- **Where:** defined at `docx/scripts/docx_common.py:285`, imported at `docx/scripts/docx_graphics.py:48` and `docx/scripts/docx_create.py:135`, used at `docx_graphics.py:176,310,623,667,829` and `docx_create.py:196,425`
- **Problem:** Two modules import an underscore-prefixed name from a third and call it
  seven times, `docx_graphics.py` with a `# noqa: E402` beside it. The module's public
  `has_rtl_text` answers a different question, "any RTL letter at all" against
  "more RTL than Latin", so the private one is not a slip, it is the function callers
  actually need, wearing the wrong name. Secondly, both `has_rtl_text` and
  `_mostly_rtl` do `import re` inside the function body, and `_mostly_rtl` is called
  once per paragraph from the RTL pass at `docx_common.py:229` and `241`.
- **Cost:** The underscore tells a maintainer the function is free to change, and it
  is not. A rename inside `docx_common` breaks two other scripts with no signal. The
  in-body import is re-executed per paragraph and is inconsistent with the rest of the
  file, which imports at module level.
- **Fix:** Rename to `mostly_rtl` and update the seven call sites, leaving
  `has_rtl_text` alone since `pptx_common.py` has the same name for the same meaning.
  Move `import re` to module level in both functions. If the underscore was guarding
  something, that guard is already gone.
- **Confidence:** high
- **Risk:** SAFE

---

### The composed-layout "line dict" is an untyped record repeated seventeen times

- **Where:** `powerpoint/scripts/pptx_create.py`, consumed at `251-278` (`_fill_frame`), built at `344-350, 396-419, 466-487, 552-563, 590-620, 640-675, 690-707, 720-735`
- **Problem:** Every composed layout builds dicts with the keys `text`, `size`, `bold`,
  `color`, `font`, `spacing`, `space_after`, read back by string in `_fill_frame`.
  Seventeen `"spacing"` literals, sixteen `"font": style.fonts[...]`, twelve
  `style.color["ink"]`. `_fill_frame` supplies defaults for missing keys, so a typo in
  a key name is not an error, it is a silently un-styled run. Separately,
  `_compose_cards` at lines 543-549 re-implements the frame setup that `_add_text`
  already does at lines 285-290, including the identical
  `for side in ("margin_left", "margin_right", "margin_top", "margin_bottom")` loop,
  because it needs the frame of a surface shape rather than a new textbox.
- **Cost:** A misspelled key degrades silently rather than failing. The seven line
  literal at each site buries the one or two properties that actually differ from the
  house default under five that do not.
- **Fix:** Two extractions. First, a `_line(text, style, *, role="body", bold=False,
  color=None, size=None, latin=1.2, arabic=1.45, space_after=0)` factory that reads
  the size from `style.type[role]`, the face from `style.fonts`, the ink from
  `style.color` and calls `_leading` itself. Most call sites become
  `_line(card_label, style, role="body", bold=True)`. Second, pull the frame setup out
  of `_add_text` into `_prepare_frame(frame, anchor, pad)` and have `_compose_cards`
  call it instead of repeating the margin loop. If a dataclass is wanted later, the
  factory is the place to put it.
- **Confidence:** medium. The factory's keyword surface needs one pass over all
  eight call sites to confirm it covers them without growing a parameter per site,
  which would trade one problem for another.
- **Risk:** CAREFUL

---

### Long dashes in two comments, against the repo rule

- **Where:** `powerpoint/scripts/pptx_edit.py:246` and `powerpoint/scripts/pptx_edit.py:318`
- **Problem:** Both lines contain U+2014 inside a docstring: line 246 between
  "supported" and "better", line 318 between "copy" and "this". `AGENTS.md` forbids
  long dashes in code comments and strings, in every language, and these are the only
  two in the whole 11,773 line scope, so the rule is otherwise held.
- **Cost:** Small on its own, but these are the seeds. A file that already contains one
  is the file where the next one is added without a second thought, and the rule exists
  because violations outlive the session that made them.
- **Fix:** Replace each with a comma or a colon. Line 246 reads naturally with a colon,
  line 318 with a comma.
- **Confidence:** high
- **Risk:** SAFE

---

### `lint` computes findings it then throws away, and dispatches modes with three different string tuples

- **Where:** `house-style/scripts/style_lint.py:1056-1068`
- **Problem:** The `only` mode is checked three times against three different literal
  tuples, `("all", "design")` negated, then `("all", "geometry")`, then
  `("all", "prose")`. Worse, the reader at line 1060 is always run, opening and
  parsing the whole document, and then line 1062 discards its findings whenever the
  mode is not design. So `--only geometry` pays for a full design pass it never uses,
  and the reason is invisible: the reader is also what produces `text` for the prose
  pass, which is why it cannot simply be skipped.
- **Cost:** Reading the function, it is not obvious that the discarded work is
  deliberate, so someone will either "fix" it by skipping the reader and break
  `--only prose`, or leave the waste in place. Three different membership tuples for
  one three-way switch is a lookup table written as prose.
- **Fix:** Name the modes in a module level `MODES = {"design", "geometry", "prose"}`
  with `"all"` expanding to the set, compute `wanted = MODES if only == "all" else {only}`
  once, and branch on set membership. Add a one line comment where the reader runs
  saying it is kept for its text return even when its findings are dropped, or return
  the text and the findings separately so the discard is explicit.
- **Confidence:** medium
- **Risk:** SAFE

---

### `qn` is passed as a function argument to avoid a module level import

- **Where:** `house-style/scripts/style_lint.py:907` (`_docx_shading(element, qn)`), `1017` (`_docx_table_width(table, qn)`), imported inside `geometry_docx` at `961`
- **Problem:** `geometry_docx` imports `docx.oxml.ns.qn` locally, presumably so the
  module loads without python-docx installed, then threads that imported function
  through as a parameter to two helpers. The parameter is not configuration, it is a
  dependency being smuggled past the import system.
- **Cost:** Both helpers carry a parameter that can only ever hold one value, and their
  signatures suggest a flexibility that does not exist. Any third helper needing `qn`
  grows the same parameter, and the threading spreads.
- **Fix:** A module level `def _qn(tag): from docx.oxml.ns import qn; return qn(tag)`,
  memoised or not, or simply import `qn` at the top of the two helper bodies the way
  `geometry_docx` does. Drop the parameter from both signatures and the three call
  sites. The lazy-import goal is preserved either way.
- **Confidence:** medium. The local import may be guarding against python-docx being
  absent in a prose-only install, which the fix preserves, but the original intent is
  not stated in a comment.
- **Risk:** SAFE

---

## Considered and rejected

- **The five identical `house_common.py` copies.** `md5sum` confirms all five are
  byte identical across docx, powerpoint, house-style, pdf and xlsx. The file's own
  docstring states the reason: the skills install independently, so a shared import
  breaks whichever one is installed alone, and a twenty line locator that degrades to
  `None` does not. That is a documented fence and the duplication is the point. Not a
  finding.

- **Per-script OOXML namespace URI constants.** `W`, `A`, `REL_NS` and friends are
  redeclared in eight scripts. Same fence: these are standalone CLI scripts meant to
  run when the sibling skills are absent, so self-containment beats a shared constants
  module. The two powerpoint scripts sharing a directory are the one place where this
  does not hold, and that is covered by the `Package` finding above.

- **`_local_is_arabic` in `pptx_create.py:142`.** A fourth is-this-Arabic
  implementation, but its docstring says exactly why: "the house rule, kept locally
  for an install without house-style", and `DeckStyle.__init__` prefers
  `house.is_arabic` when house-style is reachable. Deliberate fallback, not drift.

- **Raw rule-name strings in `style_lint`.** Thirty one distinct rule ids passed as
  string literals to `_f`. Checked for a canonical registry and for external consumers:
  there is none, and no `.md` or other script references a rule name, so there is
  nothing for the literals to drift from. Introducing a constants block would be churn.

- **`docx_comments.py:499` importing `iter_all_paragraphs` inside a function** when
  line 69 already imports `iter_part_roots` from the same module at module level.
  Real inconsistency, but it is two lines and changing it buys nothing measurable.
  Nit, not a finding.
