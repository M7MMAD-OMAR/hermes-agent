# Reviewer 3: efficiency and resource handling

Scope: `skills/productivity/docx/scripts/*.py`, `skills/productivity/powerpoint/scripts/*.py`,
`skills/productivity/house-style/scripts/*.py`. Cleanup pass on working code, not a bug hunt.

All line numbers are from the working tree on `autobuild/sidebar-browser` at review time.

### `--section` filtering happens after the whole report is already built
- **Where:** `skills/productivity/house-style/scripts/office_inspect.py:355-392`
- **Problem:** `inspect()` always runs every section: the object model walk, the media walk, the
  `_run_helper` subprocess for comments, and `style_lint.run_lint(path)` at line 361. Only at line
  388, after all of it has finished, does `main()` drop the sections the caller did not ask for.
- **Cost:** `office_inspect.py deck.pptx --section summary` pays for a full house style lint (which
  opens and parses the package twice more of its own, see below), a fresh Python interpreter
  spawned by `_run_helper`, and several zip opens, then throws the results away. On a large deck
  that is several seconds of pure waste on the most common inspection call.
- **Fix:** push the wanted section set down into `inspect()`. Skip `run_lint` unless `lint` is
  wanted, skip the `_run_helper` call unless `review` is wanted, skip `_media_from_zip` unless
  `inventory` is wanted. `--no-lint` already proves the plumbing for one of these exists, this
  generalises it.
- **Confidence:** high
- **Risk:** SAFE

### `pdftotext` is the one subprocess in the whole scope with no timeout
- **Where:** `skills/productivity/house-style/scripts/style_lint.py:442`
- **Problem:** `subprocess.run([exe, str(path), "-"], capture_output=True, text=True)` has no
  `timeout`. The return code is ignored too: a failed extraction returns empty stdout and no
  finding, so the prose lint silently reports nothing wrong.
- **Cost:** a malformed or encrypted PDF that makes `pdftotext` spin leaves the lint, and anything
  that called it (`office_inspect`, any skill invoking the linter), hung with no upper bound. The
  silent path is worse than slow: a PDF whose text was never read lints clean.
- **Fix:** add `timeout=60`, catch `subprocess.TimeoutExpired` and `OSError`, and on a non zero
  return code emit the existing `no_extractor` style warning instead of returning empty text. This
  is very likely an oversight rather than a choice: every other subprocess in scope carries a
  timeout (`pptx_render.py:49,59` use 300, `office_inspect.py:75` uses 120, `pptx_embed_fonts.py:491`
  uses 10 and `:605` uses 15, `house_style.py:352` uses 15 and `:957,963` use 10).
- **Confidence:** high
- **Risk:** SAFE

### `--only geometry` still parses the whole document for output it discards
- **Where:** `skills/productivity/house-style/scripts/style_lint.py:1056-1068`
- **Problem:** `text, findings = reader(path)` at line 1061 runs unconditionally. When
  `only == "geometry"`, line 1063 immediately replaces `findings` with `[]` and `text` is never
  used, because the prose pass is gated at line 1066.
- **Cost:** one full python-docx or python-pptx parse of the package, plus the entire design rule
  pass over it, computed and thrown away on every `--only geometry` run.
- **Fix:** guard the reader call, for example `text, findings = reader(path) if only in ("all",
  "design", "prose") else ("", [])`, keeping the existing gates below unchanged.
- **Confidence:** high
- **Risk:** SAFE

### Every font directory is walked again for each family
- **Where:** `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:440-468`,
  `:566-570`, `:618-657`, `:660-682` (reached from docx too through
  `skills/productivity/docx/scripts/docx_embed_fonts.py:216,233-241`)
- **Problem:** `_candidate_files` does two `base.rglob(pattern)` walks over every directory
  `font_dirs()` returns, per family. `family_licence` then does five more `rglob` walks over the
  same directories, again per family. `find_licence` is called inside that loop and rebuilds the
  resolved font root set with `font_dirs()` plus a `resolve()` per directory on every call. If no
  face is found, lines 566-570 walk the tree a further time looking for `.otf` files.
- **Cost:** `/usr/share/fonts` is a deep tree with thousands of files on a normal Fedora install.
  A deck using six families costs roughly forty full recursive stat walks of it, when one walk
  would answer every question. This is the dominant cost of an embed run on a machine with many
  fonts installed.
- **Fix:** build the index once per process. A module level `_font_index()` behind
  `functools.lru_cache(maxsize=1)` that walks each directory from `font_dirs()` exactly once and
  returns a list of paths, then match families against that list in memory with the existing
  `_belongs` test. `font_dirs()` itself should also be `lru_cache`d, it only reads the environment.
  Keep `PPTX_FONT_DIRS` precedence by keeping the index ordered the way `font_dirs()` is ordered.
- **Confidence:** high
- **Risk:** CAREFUL (the ordering of candidates decides which file wins a slot, so the index must
  preserve `font_dirs()` order and the per pattern order inside a directory)

### Text measurement is repeated for strings that were already measured
- **Where:** `skills/productivity/house-style/scripts/house_style.py:990-1006` (`text_width_pt`),
  `:1009-1025` (`wrap_lines`), `:1049-1064` (`fit_size`), `:1067` (`fill_factor`)
- **Problem:** `text_width_pt` measures with `face.getlength(text)` at the fixed `_MEASURE_PT` and
  scales the answer, so the underlying measurement depends only on `(family, text)` and not on the
  requested size. Nothing caches it. `fit_size` loops shrinking the size by a factor of 0.93 until
  the text fits, and `fill_factor` searches in the other direction, and each iteration re-wraps
  every paragraph from scratch, measuring the exact same candidate strings it measured on the
  previous iteration.
- **Cost:** roughly five to ten times more shaping work than needed on every fitted or grown text
  frame. With raqm present the measurement is a full shaping pass, so this is real CPU on the deck
  build path (`pptx_create.py:369-371`) and on the lint geometry path
  (`style_lint.py:645`).
- **Fix:** factor the raw measurement into a helper and cache it:
  `@lru_cache(maxsize=4096)` on `_raw_width(family, text)` returning `face.getlength(text)`, with
  `text_width_pt` doing only the `* size_pt / _MEASURE_PT` scaling. Bound the cache rather than
  leaving it unbounded, the key is arbitrary document text. Note the remaining quadratic inside a
  single `wrap_lines` pass (each candidate line is measured in full as it grows) is inherent to
  measuring shaped text accurately and should be left alone.
- **Confidence:** high
- **Risk:** SAFE

### Font binaries are read in full even when nothing will be written
- **Where:** `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:865-893`,
  `skills/productivity/docx/scripts/docx_embed_fonts.py:594-627`
- **Problem:** `data = source.read_bytes()` runs at the top of the slot loop, before the code
  discovers that the face is already embedded (`existing_part is not None`, which `continue`s) and
  before the `if dry_run: continue`. The bytes are then only used for `len(data)` on both of those
  paths.
- **Cost:** a `--dry-run` reads every face of every family off disk for nothing, and so does the
  second, idempotent run over an already embedded deck. Four faces of a variable font family is
  tens of megabytes read and discarded per family, and the whole package is already resident in
  memory beside it.
- **Fix:** use `source.stat().st_size` for the reported and accumulated byte counts, and move
  `data = source.read_bytes()` down to just above the `pkg.put(...)` call that actually needs it.
- **Confidence:** high
- **Risk:** SAFE

### Whole images are decompressed just to read width and height
- **Where:** `skills/productivity/house-style/scripts/office_inspect.py:97-111`
- **Problem:** `Image.open(BytesIO(zf.read(info.filename)))` decompresses the entire zip member into
  memory when PIL only needs the header to answer `.size`.
- **Cost:** a deck with thirty photos at three megabytes each inflates ninety megabytes of image
  data, peak resident, to fill in two integers per entry.
- **Fix:** `with zf.open(info) as fh: entry["width"], entry["height"] = Image.open(fh).size`.
  Verified on this machine that `ZipExtFile` reports `seekable() is True` and `Image.open` accepts
  it directly, so PIL reads only as far as the header.
- **Confidence:** high
- **Risk:** SAFE

### The same package is opened three to five times per inspection
- **Where:** `skills/productivity/house-style/scripts/office_inspect.py:129` (`Document`),
  `:163` (`_parts`), `:174` (`_media_from_zip`), `:175-178` (`_run_helper` subprocess),
  `:361` (`run_lint`, which opens it twice more)
- **Problem:** `inspect_docx` opens the archive through python-docx, then opens it again for the
  part listing, then a third time for the media walk. `_run_helper` then spawns a whole new Python
  interpreter that opens it a fourth time to list comments, and the lint opens it a fifth and sixth
  time. The same is true of `inspect_pptx` at `:191,239`.
- **Cost:** six decompressions and parses of one file per inspection, plus one interpreter startup.
  On a large deck this is the difference between a fast inspection and a visibly slow one.
- **Fix:** two independent steps. First, open the zip once in `inspect_*` and pass the open
  `ZipFile` to `_parts` and `_media_from_zip`, which are trivially reworked to take one. Second,
  drop `_run_helper` for the comments listing in favour of importing the sibling script's
  `list_threads` directly, since `_skill_script` already puts it on a known path and both comment
  modules guard their `main()` behind `if __name__ == "__main__"`. Note the docstring at `:64-69`
  deliberately isolates a crashing helper behind a subprocess, so the import version needs the same
  try or except around it to keep that property, and if that isolation is judged worth keeping then
  gating the call on the requested sections (first finding above) recovers most of the cost anyway.
- **Confidence:** high for the triple zip open, medium for replacing the subprocess
- **Risk:** SAFE for the zip sharing, CAREFUL for the subprocess change

### The house style parses the whole package twice per lint
- **Where:** `skills/productivity/house-style/scripts/style_lint.py:235` and `:962` for docx,
  `:301` and `:887` for pptx
- **Problem:** `read_docx` opens `Document(str(path))` and `geometry_docx` opens it again, and
  `lint()` calls both on an `--only all` run. Same shape for `read_pptx` and `geometry_pptx`.
- **Cost:** two full unzips plus two full lxml parses of every part, per file linted. This is on
  the default path, `--only all` is the default.
- **Fix:** open once in `lint()` and pass the loaded `Document` or `Presentation` down to both the
  reader and the geometry pass. It touches four function signatures, so it is worth doing only
  together, not piecemeal.
- **Confidence:** high
- **Risk:** CAREFUL

### A `ZipFile` opened without a context manager, with three early returns
- **Where:** `skills/productivity/docx/scripts/docx_validate.py:58-73`
- **Problem:** `zf = zipfile.ZipFile(path)` is never wrapped in `with` and never closed. The
  function returns early at line 62, at line 73, and can raise out of the `etree` calls further
  down, on every one of which the handle is left to the garbage collector.
- **Cost:** modest in practice, CPython reclaims the handle by refcount when the frame dies, so
  this is a correctness of style issue rather than a measurable leak. It becomes a real leak the
  moment the function is called from a longer lived process or under a non refcounting runtime.
- **Fix:** wrap the body in `with zipfile.ZipFile(path) as zf:`, keeping the `try` around the
  constructor for the `not-a-zip` issue.
- **Confidence:** high
- **Risk:** SAFE
- **Separate note, same function:** `zf.testzip()` at line 66 decompresses and CRC checks every
  member unconditionally, before the cheap structural checks below it have run. For a validator
  that is defensible, but if a caller ever wants the cheap checks alone it deserves a flag.

### `Package.save` rewrites every entry with a fresh `ZipInfo`
- **Where:** `skills/productivity/powerpoint/scripts/pptx_comments.py:205-217` and
  `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:205-217` (the class is duplicated;
  `docx_embed_fonts.py:240` and `pptx_comments.py` both inherit it)
- **Problem:** `z.writestr(name, self.blobs[name])` passes a bare name, so the original member's
  `ZipInfo` is discarded: the stored compression type and the modification timestamp of every part
  are replaced by the archive default of `ZIP_DEFLATED` and the current time.
- **Cost:** fidelity first, every part of the rewritten file gets a new timestamp even though only
  one or two parts changed, which defeats any downstream byte comparison. There is a CPU component
  too, any member the producer stored uncompressed is now deflated on the way out, though most
  Office producers already deflate their media so the size of that win is producer dependent.
- **Fix:** keep the `infolist()` alongside the blobs in `__init__` and in `save` write through the
  original `ZipInfo` (`z.writestr(info, blob)`), synthesising one only for parts this script added.
- **Confidence:** high
- **Risk:** SAFE

### `obfuscate` makes two full copies of every font
- **Where:** `skills/productivity/docx/scripts/docx_embed_fonts.py:307-318`
- **Problem:** `bytearray(data)` copies the whole font, thirty two bytes are XORed, then
  `bytes(out)` copies the whole thing again, so a ten megabyte face costs twenty megabytes of
  copying to change thirty two bytes.
- **Cost:** with four faces per family and several families, tens of megabytes of pointless
  memcpy and peak memory on top of a package that is already fully resident.
- **Fix:** build only the header and concatenate:
  `head = bytes(b ^ key[i % 16] for i, b in enumerate(data[:32]))`, then `return head + data[32:]`.
  One copy instead of two, and the short input case the docstring calls out still behaves.
- **Confidence:** high
- **Risk:** SAFE

### A broken `house_style.py` is indistinguishable from an uninstalled one
- **Where:** `skills/productivity/house-style/scripts/house_common.py:36-38`, and the identical
  copies at `skills/productivity/docx/scripts/house_common.py:36-38` and
  `skills/productivity/powerpoint/scripts/house_common.py:36-38`
- **Problem:** `except ImportError: return None` swallows the reason. The docstring justifies
  degrading to `None` when the house style skill is not installed, and that case is already handled
  by the `.exists()` check on line 31 failing. This branch is a different case: the file is there
  and will not import, for instance because a dependency is missing from this interpreter.
- **Cost:** every document is then built with no theme at all, silently, and the output simply looks
  wrong with nothing anywhere saying why. Compare `docx_embed_fonts.py:190-196`, which handles the
  same situation for the font module by failing loudly with the exception text.
- **Fix:** keep returning `None` so nothing breaks, but print the exception to stderr first, for
  example `print(f"house_style found at {candidate} but will not import: {exc}", file=sys.stderr)`.
  The three copies are kept in step by hand, so all three need it.
- **Confidence:** high
- **Risk:** SAFE

## Considered and rejected

- **A batch mode for comments.** `docx_comments.py:934-989` and `pptx_comments.py` handle exactly
  one comment per invocation, so adding ten comments means ten full open, parse and save cycles of
  the document. True, and expensive, but the fix is a new CLI feature, not a cleanup, so it is out
  of remit for this pass.
- **`except Exception` around `insert_element_before`.** `docx_create.py:454-460`,
  `docx_create.py:543-546` and `docx_common.py:151-159` each swallow broadly, but each has an
  explaining comment and a real fallback path, and the underlying python-docx helper does not
  document what it raises. Narrowing them is a guess. Chesterton's fence holds, leave them.
- **`shell=True`.** Checked across the whole scope, there is none. Every `subprocess.run` passes an
  argument list.
- **Import time work.** Checked every module level assignment in all twenty four files. The only
  module level call that does real work is `shared = _load_shared()` at
  `docx_embed_fonts.py:216`, and it is load bearing, the module's public names are bound from it
  immediately after. Everything else at module level is tuple and dict constants.
- **Repeated `load_theme()` calls.** `style_lint.py:455,888,963` and several sites in
  `house_style.py` call it per function rather than per run, but the only expensive thing inside it
  is `resolve_font`, which goes through `_installed_families()`, which is already memoised in
  `_font_cache` at `house_style.py:340-366`. The second call onward is pure dict work.
- **`detect_revisions` reading every `word/*.xml`.** `docx_read.py:97-113` could stop as soon as all
  three markers are true. The saving is real but small, the parts it reads are the ones it was going
  to need anyway, and the early exit makes the loop harder to read. Not worth the clarity.
- **`pptx_create.py` per shape work.** Swept for repeated theme or font resolution inside the slide
  loop. It is already correct: `pptx_create.py:1177-1179` resolves the theme once before building,
  with a comment saying exactly why, and `DeckStyle` caches the resolved geometry and fonts.
- **`workbook_blob` per chart.** `docx_graphics.py:427-451` builds a fresh openpyxl workbook for
  each chart, but each chart carries its own data, so there is nothing to share.
- **Regex compilation inside loops.** Present in several places but Python's own pattern cache
  covers it, and hoisting the patterns to module level would trade readable local context for
  nothing measurable.
- **`.exists()` before import or write.** `house_common.py:31`, `docx_embed_fonts.py:192` and the
  `os.path.isdir` checks at `pptx_embed_fonts.py:926` and `docx_embed_fonts.py:651` are pre checks
  rather than try and handle. They are technically racy, but each exists to produce a specific,
  readable error message, and the race is not one that happens in practice for these tools.
