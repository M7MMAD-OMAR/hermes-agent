# Cleanup review: pdf and xlsx skill scripts

Scope: `skills/productivity/pdf/scripts/*.py` and
`skills/productivity/xlsx/scripts/*.py` on `autobuild/sidebar-browser`.
No files were edited. Every claim below was checked against the source, and
the two live bugs were reproduced with the repo venv
(`venv/bin/python`, openpyxl 3.1.5).

Paths are relative to `/home/sbarah/.hermes/hermes-agent/`.

## Live bugs

### Whole column conditional formatting is destroyed and the run reports success
- **Where:** `skills/productivity/xlsx/scripts/xlsx_edit.py:152` and `:252`, same pattern at `skills/productivity/xlsx/scripts/xlsx_restructure.py:220` and `:326`
- **Problem:** openpyxl cannot represent a conditional formatting rule whose
  `sqref` is a whole column (`A:A`), which is what Excel writes for the most
  common "format this column" rule. On `load_workbook` it discards the rule and
  emits a `UserWarning` on stderr. Both scripts then call `wb.save()` and print
  `{"ok": true, ...}` on stdout. The rule is gone from the saved file and the
  JSON contract, which is what a calling agent parses, says the operation
  succeeded. Reproduced: a workbook whose `sheet1.xml` carries
  `sqref="A:A"` on a `conditionalFormatting` element, run through
  `xlsx_edit.py t5.xlsx --set B1=x`, comes back with no
  `conditionalFormatting` element at all and exit code 0 with `"ok": true`.
- **Cost:** silent loss of user formatting on any Excel authored workbook that
  uses a whole column rule, on every edit, with no signal in the machine
  readable output. This is the worst failure mode a file editing skill can
  have: the caller believes the edit was surgical.
- **Fix:** wrap the `load_workbook` call in `warnings.catch_warnings(record=True)`,
  collect anything openpyxl raised, and put it in the JSON report as a
  `"warnings"` list, so `{"ok": true}` is never printed alone when the loader
  threw information away. Same three line change in both scripts. A stronger
  version refuses to save in place when a warning naming "discarded" was
  recorded and requires `--out` instead, but that is a behavior change and
  should be decided separately.
- **Confidence:** high
- **Risk:** SAFE for the reporting change, CAREFUL for the refuse to save variant

### shift_range mishandles open ended ranges, so restructure aborts on a whole column autofilter
- **Where:** `skills/productivity/xlsx/scripts/xlsx_restructure.py:76` (`shift_range`), reached from `:262` (autofilter), `:282` (data validation), `:290` (conditional formatting), `:304` (tables)
- **Problem:** `range_boundaries("A:C")` returns `(1, None, 3, None)` and
  `range_boundaries("1:5")` returns `(None, 1, None, 5)`. `shift_span` then does
  arithmetic and comparisons against `None`. On the rows axis this raises a bare
  `TypeError: '>=' not supported between instances of 'NoneType' and 'int'`; on
  the cols axis it does not raise, it builds the nonsense reference
  `"ANone:DNone"`. Verified directly:
  `shift_range('A:C','rows',3,1,False)` raises, `shift_range('A:C','cols',3,1,False)`
  returns `'ANone:DNone'`.
- **Cost:** a workbook with a whole column autofilter cannot be restructured at
  all. End to end, `xlsx_restructure.py t2.xlsx --sheet Data --insert-cols B:1`
  on a sheet with `auto_filter.ref = 'A:C'` exits with
  `{"ok": false, "error": "Value does not match pattern ^[$]?([A-Za-z]{1,3})..."}`,
  an error message that tells the user nothing about what to do.
- **Fix:** in `shift_range`, treat a `None` bound as the open end of the axis:
  when the axis being shifted has `None` bounds the range is unaffected by a
  row or column shift on that axis and should be returned unchanged; when the
  other axis is open, shift only the bounded pair and re-emit the original open
  form (`A:C` stays `A:C` on a row insert, becomes `A:D` on a column insert at B).
  Add a unit test for `A:C` and `1:5` on both axes and both operations.
- **Confidence:** high, reproduced
- **Risk:** CAREFUL. No corruption is possible today: every openpyxl sink for
  the bad string rejects it. `Table.ref = "ANone:DNone"` raises `ValueError`,
  `DataValidation.sqref` and `auto_filter.ref` raise too, and openpyxl discards
  whole column conditional formatting on load so that path is unreachable. So
  this is an abort, not data loss, and the fix only widens what the script
  accepts.

## Reuse

### parse_pages exists three times inside the pdf skill with two different meanings
- **Where:** `skills/productivity/pdf/scripts/pdf_split.py:10`, `skills/productivity/pdf/scripts/pdf_stamp.py:23`, `skills/productivity/pdf/scripts/pdf_page_image.py:19`
- **Problem:** `pdf_stamp` and `pdf_page_image` hold byte identical copies apart
  from a docstring. `pdf_split` holds a third, different implementation: it
  returns zero based indices, preserves the order and the duplicates the user
  typed, and rejects a reversed range. The other two return a sorted unique one
  based list and accept `"5-3"` as a silent empty selection.
- **Cost:** one flag, `--pages`, behaves differently in three commands of the
  same skill. `--pages "3,1"` extracts page 3 then page 1 in `pdf_split` and
  stamps 1 then 3 in `pdf_stamp`. `--pages "5-3"` is a clear error in one and a
  no-op that reports success in the other two. Three copies also mean a fix
  lands in one of them.
- **Fix:** put one `parse_pages(spec, page_count) -> list[int]` (one based,
  order preserving, explicit error on a reversed or out of range part) in a new
  private module beside `_raster.py`, for example
  `skills/productivity/pdf/scripts/_pages.py`, and have the three callers
  convert to zero based at the call site where they need it. Import it the way
  the existing shared module is imported, not with a bare import:
  `sys.path.insert(0, str(Path(__file__).resolve().parent))` then `import _pages`,
  the pattern already used at `pdf_page_image.py:54` and `pdf_form_layout.py:104`,
  because these scripts are run from arbitrary working directories.
- **Confidence:** high
- **Risk:** CAREFUL, it changes `pdf_stamp` and `pdf_page_image` behavior for
  reversed and duplicated page specs, which is the point.

### The stdio reconfigure block is copy pasted into all thirteen pdf scripts
- **Where:** `pdf_split.py:32`, `pdf_stamp.py:79`, `pdf_annotate.py:67`, `pdf_secure.py:17`, `pdf_fill_form.py:22`, `pdf_watermark.py:13`, `pdf_create.py:43`, `pdf_make_form.py:39`, `pdf_form_layout.py:141`, `pdf_merge.py:14`, `pdf_page_image.py:42`, `pdf_read.py:15`, `pdf_meta.py:27` (all under `skills/productivity/pdf/scripts/`)
- **Problem:** the same five line `for stream in (sys.stdout, sys.stderr): try: stream.reconfigure(...) except Exception: pass`
  appears thirteen times. Four of them already wrap it in a
  `_reconfigure_stdio()` helper (`pdf_read.py`, `pdf_annotate.py`,
  `pdf_create.py`, `pdf_make_form.py`); the rest inline it at the top of `main`.
  The two extractor scripts, `extract_pymupdf.py` and `extract_marker.py`, do
  not have it at all despite printing non ASCII characters.
- **Cost:** sixty five duplicated lines, and an inconsistency where two scripts
  in the same directory can raise `UnicodeEncodeError` on a non UTF-8 stdout
  while their thirteen siblings cannot.
- **Fix:** move `_reconfigure_stdio()` into the same new private module as
  `parse_pages` and call it from all fifteen, including the two extractors,
  using the `sys.path.insert` import pattern noted above.
- **Confidence:** high
- **Risk:** SAFE

### The missing dependency guard is written twelve times in two incompatible output shapes
- **Where:** `skills/productivity/pdf/scripts/pdf_annotate.py:70` (`_need`), `skills/productivity/pdf/scripts/pdf_read.py:19` (`_need`), and inline `try: from pypdf import ... except ImportError` blocks at `pdf_fill_form.py:34`, `pdf_create.py:33` and `:49`, `pdf_make_form.py:53`, `pdf_secure.py:31`, `pdf_watermark.py:26`, `pdf_stamp.py:103`, `pdf_merge.py:24`, `pdf_split.py:51`, `pdf_page_image.py:62`, `pdf_meta.py:46`
- **Problem:** twelve hand written import guards. Ten print a bare English
  sentence to stderr and return 2. `pdf_annotate.py` prints a JSON object
  `{"error": ..., "fix": ...}` and exits 2. `pdf_read.py` prints the bare
  sentence but raises `SystemExit(2)` from a helper. A caller parsing the
  failure cannot use one code path.
- **Cost:** a skill whose contract is machine readable JSON emits three
  different failure formats for the same failure.
- **Fix:** one `need(module, package)` in the shared private module, emitting
  the JSON shape `pdf_annotate.py` already uses, and have the other eleven call
  it. Keep the exit code at 2 everywhere so nothing downstream changes.
- **Confidence:** high
- **Risk:** CAREFUL, it changes the stderr text of ten scripts. Check
  `tests/skills/test_office_skill_contracts.py` and
  `tests/skills/test_office_document_skills.py` for assertions on that text
  before changing it.

### _page_size is forked between the form builder and the form linter, with different A4 constants
- **Where:** `skills/productivity/pdf/scripts/pdf_make_form.py:44` and `skills/productivity/pdf/scripts/pdf_form_layout.py:46`
- **Problem:** both read the same spec key `page_size` from the same JSON
  contract. `pdf_make_form` returns reportlab's `A4` constant
  (595.2755905511812 by 841.8897637795277); `pdf_form_layout` hardcodes
  `{"a4": (595.27, 841.89), "letter": (612.0, 792.0)}`. The linter therefore
  validates "the box is inside the page" against a page a few thousandths of a
  point smaller than the one the builder actually draws.
- **Cost:** small today, since the linter errs toward flagging. The real cost is
  that a future page size added to one is invisible to the other, and the
  linter's whole purpose is to agree with the builder.
- **Fix:** move `_page_size` into the shared private pdf module and have both
  import it, keeping reportlab's constants as the source of truth with the
  hardcoded pair as the fallback when reportlab is absent (the linter must keep
  working without reportlab, which is why it hardcoded them).
- **Confidence:** high
- **Risk:** SAFE

### read_notes and notes_of parse the same XML twice in one file
- **Where:** `skills/productivity/xlsx/scripts/xlsx_comments.py:397` (`read_notes`) and `:626` (`notes_of`)
- **Problem:** both walk `authors` then `commentList` on a legacy comments part,
  and both carry the identical `try: author = authors[int(comment.get("authorId") or 0)] except (ValueError, IndexError): author = ""`
  block (at `:412` and `:642`). One returns dicts for the JSON listing, the other
  returns `(ref, author, text)` tuples for the rewrite path.
- **Cost:** about thirty duplicated lines in one file, and two places to fix any
  parsing bug in the legacy note format.
- **Fix:** keep `notes_of` as the single parser and build `read_notes` on top of
  it, mapping each tuple into the listing dict. Same file, no import concerns.
- **Confidence:** high
- **Risk:** SAFE

### Two CSV exporters in the xlsx skill format dates differently
- **Where:** `skills/productivity/xlsx/scripts/xlsx_to_csv.py:24` (`to_text`) versus `skills/productivity/xlsx/scripts/xlsx_read.py:39` (`jsonable`) used at `:146` and `:151`
- **Problem:** `xlsx_to_csv.py` has the careful rule: Excel stores a pure date
  as a midnight datetime, so a midnight value is emitted as a bare `2026-01-31`.
  `xlsx_read.py --csv` reuses `jsonable`, which calls `.isoformat()` on every
  temporal type, so the same cell comes out as `2026-01-31T00:00:00`.
- **Cost:** the same sheet exported by two commands of one skill produces two
  different CSVs. Anything that diffs or round trips them sees spurious changes.
- **Fix:** move `to_text` into a small module in the xlsx `scripts/` directory
  and have `xlsx_read.py`'s `--csv` branch use it in place of the inline
  `"" if v is None else v` mapping. `jsonable` stays as it is for the JSON path,
  where an ISO datetime is correct.
- **Confidence:** high
- **Risk:** CAREFUL, it changes `xlsx_read.py --csv` output for date cells,
  which is the fix.

### infer() is forked inside the xlsx skill
- **Where:** `skills/productivity/xlsx/scripts/csv_to_xlsx.py:34` and `skills/productivity/xlsx/scripts/xlsx_edit.py:57`
- **Problem:** the same type inference ladder, bool then int then float then ISO
  date then ISO datetime, written twice. They differ in two ways:
  `xlsx_edit`'s version returns a leading `=` string as a formula, and
  `csv_to_xlsx`'s version maps the empty string to `None`.
- **Cost:** a type inference change has to be made twice, and the two entry
  points into the same workbook already disagree on the empty string.
- **Fix:** one `infer(text, *, formulas=False, empty_is_none=False)` in a shared
  module in the same `scripts/` directory, with both callers passing the flag
  they need.
- **Confidence:** high
- **Risk:** SAFE

### cmd_sheets rebuilds the defined names map that cmd_names already produces
- **Where:** `skills/productivity/xlsx/scripts/xlsx_read.py:64` and `:83`
- **Problem:** the identical `{name: dn.attr_text for name, dn in wb.defined_names.items()}`
  comprehension appears in both `cmd_sheets` and `cmd_names`.
- **Cost:** trivial in runtime, but it is two places to change when the shape of
  the reported defined name changes, and one is easy to miss.
- **Fix:** `cmd_sheets` calls a small `defined_names(wb)` helper that `cmd_names`
  also uses.
- **Confidence:** high
- **Risk:** SAFE

## Efficiency and resource handling

### pdftoppm is run with no timeout, so a hung render hangs the skill forever
- **Where:** `skills/productivity/pdf/scripts/_raster.py:69`
- **Problem:** `subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")`
  has no `timeout=`. `pdftoppm` on a malformed or adversarial PDF can spin or
  block; there is nothing to interrupt it. Both callers,
  `pdf_page_image.py:84` and `pdf_form_layout.py:111`, inherit this.
- **Cost:** a single bad input file stalls the whole script with no output and
  no way for a caller to recover short of killing the process tree. This is the
  one class of failure that cannot be retried out of.
- **Fix:** add `timeout=` with a generous default, sixty seconds is reasonable
  for one page, plumbed through `rasterize_page` so a caller can raise it, and
  catch `subprocess.TimeoutExpired` to raise the same `ValueError` the non zero
  return code path raises. Git evidence: the line was added whole in
  `fad88cf1308` with the rest of the office skills, never touched since, so
  there is no deliberate reason for its absence.
- **Confidence:** high
- **Risk:** SAFE

### Exporting N pages reopens and reparses the whole PDF N times
- **Where:** `skills/productivity/pdf/scripts/pdf_page_image.py:83` (the loop) calling `skills/productivity/pdf/scripts/_raster.py:34` (`rasterize_page`)
- **Problem:** `rasterize_page` is per page and stateless. Every call re-runs
  `available_backends()` at `_raster.py:13`, which does `import pypdfium2` and a
  `shutil.which("pdftoppm")` PATH scan, then `_via_pdfium` at `:47` constructs a
  fresh `pdfium.PdfDocument(pdf_path)`, parsing the document from scratch, and
  closes it again. On the `pdftoppm` fallback it spawns one process per page.
- **Cost:** exporting a 200 page PDF opens and parses the document 200 times,
  or spawns 200 processes, plus 200 PATH scans. The work is linear in pages when
  it should be one open plus linear rendering.
- **Fix:** add `rasterize_pages(pdf_path, pages, dpi, password)` to `_raster.py`
  that resolves the backend once, opens the document once, and yields images;
  keep `rasterize_page` as a one line wrapper so `pdf_form_layout.py:111`, which
  genuinely needs a single page, is untouched. Point `pdf_page_image.py`'s loop
  at the new function.
- **Confidence:** high
- **Risk:** SAFE

### get_fields() is walked twice over the same form
- **Where:** `skills/productivity/pdf/scripts/pdf_fill_form.py:49` and `:59`
- **Problem:** `reader.get_fields()` is called at `:49` to build `available` and
  again at `:59` to build `field_info`. It walks the entire AcroForm field tree
  each time, and for a large form that is the dominant cost of the run.
- **Cost:** the form tree is traversed twice for no benefit; the two results are
  the same object graph.
- **Fix:** call it once into `field_info` before `:49` and derive
  `available = set(field_info)`. Two lines. Git blame shows both lines came in
  together in `51570f4da74`, so this is an oversight, not a guard against
  mutation by `writer.append`.
- **Confidence:** high
- **Risk:** SAFE

### pymupdf documents are never closed in the extractor
- **Where:** `skills/productivity/pdf/scripts/extract_pymupdf.py:17`, `:31`, `:43`, `:58`
- **Problem:** all four helpers do `doc = pymupdf.open(path)` with no context
  manager and no `doc.close()`. `extract_images` additionally creates a
  `pymupdf.Pixmap` per image at `:48` and `:50` without freeing it.
- **Cost:** the mapped file and the parsed document stay alive until the process
  exits. It happens to be survivable because each of these is a short lived CLI
  run, but it is the wrong pattern to copy, and on a large PDF with many images
  the pixmap accumulation is real memory.
- **Fix:** `with pymupdf.open(path) as doc:` in all four, and `del pix` or a
  narrow scope for the pixmaps in `extract_images`.
- **Confidence:** high
- **Risk:** SAFE

### The whole CSV is materialized in memory beside the whole workbook
- **Where:** `skills/productivity/xlsx/scripts/csv_to_xlsx.py:68`, read back at `:88`
- **Problem:** `rows = list(csv.reader(fh, ...))` holds the entire CSV as a list
  of lists at the same time as openpyxl holds the entire workbook. The list is
  kept alive only so `:88` can compute per column widths by scanning the rows a
  second time.
- **Cost:** roughly double peak memory on a large import, and a second full pass
  over the data for the widths.
- **Fix:** stream the reader, appending rows as they arrive, and accumulate
  `max(len(str(cell)))` per column in the same loop. Keep only the row count and
  the width array. No behavior change.
- **Confidence:** high
- **Risk:** SAFE

### xlsx_read builds every row in memory before writing a byte
- **Where:** `skills/productivity/xlsx/scripts/xlsx_read.py:139` (`rows = sheet_rows(ws)`), consumed at `:141`, `:145` and `:150`
- **Problem:** `sheet_rows` at `:45` materializes the full sheet as a list of
  lists, then the CSV branch iterates it. The workbook is also loaded without
  `read_only=True` for the `--json` and `--csv` modes, which do not need the
  style or merge information that normal mode builds.
- **Cost:** for a large sheet the script holds the openpyxl object graph, the
  intermediate list, and the output buffer at once, when a streaming write needs
  only the current row.
- **Fix:** for the `--csv` branch, write each row inside the `iter_rows` loop
  rather than through the intermediate list. `--json` genuinely needs the whole
  array. Separately, load with `read_only=True` for `--json` and `--csv` only:
  `--sheets` needs `merged_cells`, `tables` and `protection`, and `--notes`
  needs `cell.comment`, so those must stay in normal mode.
- **Confidence:** medium on the `read_only` half, high on the streaming half
- **Risk:** CAREFUL, `read_only` changes which attributes exist, so it must be
  applied only to the two modes that do not touch them.

### The OOXML package reads every zip entry into memory
- **Where:** `skills/productivity/xlsx/scripts/xlsx_comments.py:149` to `:151`
- **Problem:** `Package.__init__` does `self.blobs = {n: z.read(n) for n in self.names}`,
  decompressing the whole workbook into a dict, including embedded images,
  charts and pivot caches that the comments code never looks at. `save` at `:190`
  then recompresses every one of them with `ZIP_DEFLATED`.
- **Cost:** peak memory proportional to the uncompressed workbook, and a full
  recompress of parts that were only ever copied. On a workbook with images this
  is the dominant cost of adding one comment.
- **Fix:** keep the lazy option: store the source `ZipFile` open, read a blob on
  first access in `raw`/`tree`, and in `save` stream untouched entries straight
  from the source archive with `z.writestr(info, src.read(name))` preserving the
  original `compress_type`. The class docstring's invariant, that unknown parts
  survive byte for byte, is preserved and in fact strengthened.
- **Confidence:** medium
- **Risk:** CAREFUL. The eager read is deliberate and documented in the class
  docstring at `:138` to `:142`, so this is a fence with a stated reason. The
  reason is "do not lose parts we do not understand", not "read everything
  eagerly", and streaming satisfies it, but the in place save path
  (`out == input`) must keep working, which means the source archive has to stay
  open until the temp file is fully written. That is the part to get right.

### Two extra full sheet scans after every sheet is built
- **Where:** `skills/productivity/xlsx/scripts/xlsx_create.py:256` (`sheet_is_rtl`, defined at `:241`) and `:306` (`has_formulas`, defined at `:269`)
- **Problem:** `build_sheet` has just walked every cell to write it. Immediately
  after, `apply_rtl` walks every cell again counting RTL versus Latin letters,
  and `has_formulas` walks every cell a third time looking for a leading `=`.
- **Cost:** three passes where one would do, on data the script itself just
  produced and could have counted while producing.
- **Fix:** have `build_sheet` return the two counters it can accumulate for free
  while writing cells, and pass them to `apply_rtl` and the `full_calc_on_load`
  decision. `has_formulas` short circuits on the first hit at `:306` so it is
  usually cheap; `sheet_is_rtl` never short circuits and is the expensive one.
- **Confidence:** high
- **Risk:** CAREFUL, it changes `build_sheet`'s signature, which is internal to
  this one script.

### A pdfplumber document can be leaked on the quote failure path
- **Where:** `skills/productivity/pdf/scripts/pdf_annotate.py:218` to `:225`
- **Problem:** `plumber_doc = pdfplumber.open(...)` succeeds, then the loop at
  `:221` that caches pages raises, the `except Exception` at `:224` sets
  `plumber_doc = None`, and the reference to the open document is dropped
  without closing it. The `finally` at `:315` then sees `None` and closes
  nothing.
- **Cost:** one leaked file handle and the parsed document for the rest of the
  run. Narrow, since the page cache loop rarely raises, and the process is short
  lived.
- **Fix:** close the document before setting the name to `None` in that
  `except`, or move the whole open plus cache into the `try` whose `finally`
  already closes it.
- **Confidence:** high
- **Risk:** SAFE

### The two extractor scripts print non ASCII without the encoding guard their siblings all have
- **Where:** `skills/productivity/pdf/scripts/extract_marker.py:58` and `:61`, `skills/productivity/pdf/scripts/extract_pymupdf.py:21`
- **Problem:** these two are the only pdf scripts with no stdio reconfigure (see
  the reuse finding above), and they print `⚠️`, `✓` and box drawing text, plus
  arbitrary extracted document text, straight to stdout.
- **Cost:** on a host whose stdout encoding is not UTF-8 these raise
  `UnicodeEncodeError` mid extraction, after the expensive model work is done,
  and neither script has a top level handler, so the traceback is the output.
- **Fix:** call the shared `_reconfigure_stdio()` at the top of both `__main__`
  blocks, as part of the consolidation described in the reuse section.
- **Confidence:** medium
- **Risk:** SAFE

## Long dashes

Five occurrences, all em dashes, in the four files the task predicted. No en
dashes were found anywhere in scope.

- `skills/productivity/pdf/scripts/extract_marker.py:61`
- `skills/productivity/pdf/scripts/pdf_secure.py:4`
- `skills/productivity/xlsx/scripts/xlsx_edit.py:33`
- `skills/productivity/xlsx/scripts/xlsx_edit.py:108`
- `skills/productivity/xlsx/scripts/xlsx_recalc.py:14`

Note that `xlsx_edit.py:108` is inside the argparse `epilog`, so that one is
printed to the user on `--help`, not just carried in a comment.

Verification command used:
`grep -rn -P "[\x{2013}\x{2014}\x{2012}\x{2015}]" skills/productivity/pdf/scripts/ skills/productivity/xlsx/scripts/ --include=*.py`

## Considered and rejected

### house_common.py duplicated five times
Confirmed byte identical across all five office skills by `md5sum`
(`f56a1255d9458996e2b9ca0c4e1c8053` for `docx`, `house-style`, `pdf`,
`powerpoint`, `xlsx`). The fence is real and stronger than described: the test
is `test_every_office_skill_carries_the_locator` at
`tests/skills/test_house_style.py:538` to `:544`, which asserts each skill's copy
equals the `house-style` copy character for character. The file's own docstring
explains why. Not a finding; do not touch.

### The OOXML Package class forked across three skills
Verified by diffing the three regions. The `xlsx` copy at
`skills/productivity/xlsx/scripts/xlsx_comments.py:137` has genuinely drifted
from `skills/productivity/powerpoint/scripts/pptx_comments.py:160`: it renames
`get` to `raw`, adds `forget_tree` and `ensure_default`, and drops several
docstrings. `pptx_embed_fonts.py:171` is a third variant that drops `drop` and
`drop_override` and replaces `rel_targets` with `rel_target` and `drop_override`
with `overrides`. So all three have diverged, in different directions.
Rejected anyway: this is a cross skill consolidation, the skills are
independently installable, and the only sanctioned cross skill duplicate is
`house_common.py` under an explicit test. Consolidating would require a new
shared file with a new fence test, which is a larger decision than a cleanup
pass should make. Recorded here as evidence for whoever makes that call.

### xlsx_recalc loads the workbook twice
`skills/productivity/xlsx/scripts/xlsx_recalc.py:39` to `:41` calls
`load_workbook(path, data_only=False)` and `load_workbook(path, data_only=True)`.
Same pattern at `skills/productivity/xlsx/scripts/xlsx_read.py:88` to `:89`.
This is not avoidable: openpyxl exposes either the formula string or the cached
value from one load, never both, so pairing formula with cached result requires
two loads. Not a finding.

### xlsx_recalc's subprocess call
`skills/productivity/xlsx/scripts/xlsx_recalc.py:81` already passes
`timeout=args.timeout` (default 180, user overridable) and checks
`proc.returncode` at `:89`, and it pins `HOME` and `PATH` in a temp directory so
a concurrent soffice profile cannot collide. This is the correct version of what
`_raster.py:69` is missing. Not a finding, and it is the model to copy.

### pdf_stamp's bare except around alpha
`skills/productivity/pdf/scripts/pdf_stamp.py:51` is `except Exception: pass`
but carries the comment `# very old reportlab: no alpha support`. The intent is
stated, the scope is two `set*Alpha` calls, and swallowing is the right
behavior: an old reportlab should still stamp, just opaquely. Chesterton's fence
holds. Not a finding.

### xlsx_comments' swallowed XML syntax errors
`skills/productivity/xlsx/scripts/xlsx_comments.py:439` is
`except etree.XMLSyntaxError: pass` with the comment
`# One unreadable legacy part must not hide the rest.`, and `:617` is the same
class with `root = None` and a docstring explaining the VML regeneration. Both
state their reason and both are narrow, catching one specific exception type
rather than `Exception`. The only improvement available would be collecting the
unreadable part names into the JSON report instead of discarding them silently,
which is worth doing if the live bug fix above adds a `warnings` list anyway,
but it is not a defect on its own. Not listed as a finding.

### xlsx_edit stripping macros from an .xlsm
Considered, then dropped: `load_workbook` at
`skills/productivity/xlsx/scripts/xlsx_edit.py:152` does not pass `keep_vba`, so
editing a macro enabled workbook would silently drop the macros. But
`grep -rn "xlsm\|keep_vba" skills/productivity/xlsx/` returns nothing at all:
the skill never claims to handle `.xlsm`, every docstring and usage line says
`.xlsx`. Nothing to fix without first deciding to support the format.

### _house() diverging between pdf_create and xlsx_create
`skills/productivity/pdf/scripts/pdf_create.py:28` wraps the
`from house_common import load_house_style` import in
`try/except ImportError: return None`;
`skills/productivity/xlsx/scripts/xlsx_create.py:264` does not, so a missing
locator would abort the whole run there. Rejected because the difference is
unreachable: `house_common.py` ships in both `scripts/` directories and the test
at `tests/skills/test_house_style.py:538` fails the build if either copy goes
missing. Recording it only so nobody rediscovers it as a bug.
