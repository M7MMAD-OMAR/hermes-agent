# Altitude review: docx, powerpoint, house-style scripts

Reviewer 4 (Altitude). Angle: changes made at the wrong depth, band-aids on
shared infrastructure instead of fixes to the infrastructure. Report only, no
files were edited.

Scope reviewed: `skills/productivity/docx/scripts/*.py`,
`skills/productivity/powerpoint/scripts/*.py`,
`skills/productivity/house-style/scripts/*.py`. Two siblings outside the stated
scope, `skills/productivity/xlsx/scripts/xlsx_comments.py` and
`skills/productivity/pdf/scripts/pdf_annotate.py`, are named where they share a
flaw with an in-scope file, because the shared flaw is the finding.

---

### The `--json` fix landed at one call site, three siblings still pass a flag that does not exist

- **Where:** `skills/productivity/house-style/scripts/office_inspect.py:176-178`
  is the site that was fixed. The three siblings that were not:
  `office_inspect.py:240-241` (powerpoint), `office_inspect.py:288-289` (xlsx),
  `office_inspect.py:341-342` (pdf). The contract itself is
  `skills/productivity/docx/scripts/docx_comments.py:893`, where `--json` is an
  option taking a value out of `("flat", "threads")`; the other three helpers
  define no `--json` at all. The enabling mechanism is
  `office_inspect.py:78-80`.
- **Problem:** commit `28a78c03f8` diagnosed this correctly in its own message,
  "the inspector called the comment helper with a bare `--json`, which that
  helper reads as a flag taking a value", and then fixed it by appending the
  string `"threads"` at the docx call site. The root cause is that `--json`
  names two different things across four sibling helpers with otherwise
  parallel CLIs. Every other call site still passes a bare `--json`, and
  argparse rejects it. Reproduced:

  ```
  $ python3 skills/productivity/powerpoint/scripts/pptx_comments.py list x.pptx --json
  pptx_comments.py: error: unrecognized arguments: --json   (exit 2)
  ```

  Same for `xlsx_comments.py` and `pdf_annotate.py`. So `office_inspect` reports
  comments for a Word file and reports none for a deck, a workbook or a PDF.
  `_run_helper` at `office_inspect.py:78-80` is what let this survive: a
  non-zero exit returns `{"source": "... exited 2", "items": []}`, and a
  consumer reading `items` sees "no comments" rather than "could not look".
  That is precisely the distinction commit `e9d76ec110` said it was introducing
  `office_inspect` to preserve.
- **Cost:** right now the review section of every deck, workbook and PDF report
  is silently empty, which is the exact defect the docx fix was written to
  remove. As it accumulates: every new helper inherits a CLI whose flag names
  mean whatever that helper chose, and `_run_helper`'s swallow guarantees the
  mismatch is invisible until somebody reads a real file and notices the
  comments missing. That is once per helper, forever.
- **Fix:** make `--json` mean one thing across the four helpers. The cheapest
  version that keeps the docx behaviour is to give docx_comments a separate
  `--shape {flat,threads}` and let `--json` be a no-op boolean everywhere, or
  to add the same `--json` boolean to the three that lack it and move docx's
  value to its own flag. Then add one contract test that runs
  `<helper> list <fixture> --json` for all four and asserts exit 0 with
  parseable JSON. That test is what kills the class, not the flag rename.
  Belongs in this cleanup; it is a handful of lines plus one test.
- **Confidence:** high
- **Risk:** CAREFUL (it is a CLI contract change, so SKILL.md examples and any
  caller in `optional-skills/productivity/herwork` need the same sweep)

---

### Two forked copies of `Package` one directory apart, and the fix landed in one of them

- **Where:** `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:171-296`
  and `skills/productivity/powerpoint/scripts/pptx_comments.py:160-290`. The
  helper in front of each, `resolve_target`, exists three times:
  `pptx_embed_fonts.py:155-165`, `pptx_comments.py:146-156`, and
  `skills/productivity/xlsx/scripts/xlsx_comments.py:126`.
- **Problem:** these are two near-identical raw-OOXML zip package classes in the
  *same* `scripts/` directory of the *same* skill. The independent-install
  boundary that `house_common.py` documents in its own docstring protects
  cross-skill imports; it does not apply to two files one directory apart. The
  copies have already drifted, which is the proof they are a fork and not a
  deliberate split: `pptx_embed_fonts.py:162` guards a missing target with
  `target = (target or "").replace("\\", "/")`, `pptx_comments.py:153` has the
  unguarded `target.replace("\\", "/")`. The `pptx_comments` copy still carries
  the xlsx docstring, "Office writes these relative to the owning part's
  directory, but *openpyxl* writes them rooted at the package", in a file that
  never touches openpyxl, so the fork direction is visible in the text. Beyond
  that the two `Package` classes differ only in which methods each caller
  happened to need: `drop`/`drop_override` exist in one, `overrides`/
  `rel_target` in the other, `rel_targets` in the first.
- **Cost:** every OOXML package fix now has to be found in three places and is
  landing in one. The `or ""` guard is the first divergence; it will not be the
  last, and the failure mode is silent because both copies pass their own tests.
- **Fix:** two levels. Shallow and correct for this cleanup: sync the `or ""`
  guard into `pptx_comments.py:153` and `xlsx_comments.py:126`, and fix the
  stray openpyxl docstring. Deep: one `ooxml_package.py` module in the
  powerpoint skill holding `Package` and `resolve_target`, with the union of
  the methods, imported by both pptx scripts. The cross-skill case (xlsx) hits
  the real installability boundary and should follow the `house_common`
  locator pattern rather than a hard import; that part is its own task.
- **Confidence:** high
- **Risk:** SAFE for the guard sync, CAREFUL for the extraction

---

### `docx_embed_fonts` hard-imports a module named for another format, and hard-exits when it is missing

- **Where:** `skills/productivity/docx/scripts/docx_embed_fonts.py:183-216`
  (`_pptx_module_paths`, `_load_shared`, and the module-level `shared =
  _load_shared()` at `:216`), and `:228-230` where three names are re-exported.
  The policy it contradicts is stated in
  `skills/productivity/docx/scripts/house_common.py:1-12`.
- **Problem:** the genuinely format-neutral half of font work, font-directory
  discovery (`pptx_embed_fonts.py:393-418`), face matching
  (`:440-575`) and licence detection (`:581-718`), lives in a module named
  `pptx_embed_fonts.py`. Rather than lift it out when Word needed it (commit
  `5fdceda4d0`), docx reaches across the skill boundary and imports the deck
  module by name. `house_common.py` says in its own words why that is not the
  house pattern: "The skills are installed independently, so a shared import
  would break whichever one was installed alone; a twenty line locator that
  degrades to `None` does not." `docx_embed_fonts` uses the same three-path
  probe and then does the opposite thing at the end: `raise SystemExit` with a
  message telling the user to install the powerpoint skill. Installing the docx
  skill alone now silently yields a script that cannot run.
- **Cost:** a Word-only install has a broken font embedder with an error message
  that names a presentation skill. Any future third consumer (xlsx, pdf) either
  imports the deck module too or forks it, and the module keeps accreting
  responsibilities that have nothing to do with PresentationML.
- **Fix:** extract the format-neutral half into its own module and locate it the
  way `house_common` locates `house_style`, degrading to a clear "font
  discovery unavailable" result rather than `SystemExit`. Honest note: this is
  a real refactor of roughly 350 lines across two skills plus the test suite,
  and it is its own task, not part of this cleanup. What does belong here is
  making the failure a structured result instead of a `SystemExit` at import
  time, so the module can at least be imported and reported on.
- **Confidence:** high
- **Risk:** RISKY for the extraction, CAREFUL for the import-time failure change

---

### The direction repair exists for a Word file somebody else wrote, and not for a deck

- **Where:** `skills/productivity/docx/scripts/docx_edit.py:165-182`
  (`cmd_direction`) and `:227` (the `direction` subparser). The mirror that was
  never built: `skills/productivity/powerpoint/scripts/pptx_edit.py:359-432`
  has no direction option. The library half already exists at
  `skills/productivity/powerpoint/scripts/pptx_common.py:124`
  (`apply_rtl`), and its only caller is
  `skills/productivity/powerpoint/scripts/pptx_create.py:1196`.
  `optional-skills/productivity/herwork/SKILL.md:250` routes the repair for
  Word only.
- **Problem:** commit `6ae36f21b9` added both halves for Word, the per-run
  script marking *and* the `docx_edit direction` command, and said why: "For a
  file somebody else wrote, docx_edit gained a direction command. It is repair
  and not restyling." Commit `f9dda436b0` mirrored the library half into
  `pptx_common` and stopped there. So the deck direction pass is reachable only
  on the path where Hermes builds the deck itself, which is the path least
  likely to need repair, and unreachable on the path that motivated the work.
- **Cost:** an Arabic deck a client sent cannot be direction-repaired at all,
  while the identical Word file can. The asymmetry is invisible from the code
  because `pptx_common.apply_rtl` looks fully implemented; only the CLI is
  missing. As more repair passes are written this is the shape that keeps
  recurring: library mirrored, entry point not.
- **Fix:** add `--direction {auto,on,off}` to `pptx_edit.py` calling the
  existing `pptx_common.apply_rtl`, mirroring `cmd_direction`'s idempotence and
  "changes no text, no font, no spacing" contract, and add the row to the
  herwork table beside the Word one. Small and belongs in this cleanup; the
  library work is already done.
- **Confidence:** high
- **Risk:** SAFE

---

### A wrapper rewrites the application name in a message rather than parameterizing it

- **Where:** `skills/productivity/docx/scripts/docx_embed_fonts.py:233-241`.
  The messages it rewrites are produced in
  `skills/productivity/powerpoint/scripts/pptx_embed_fonts.py:507-575`
  (`find_faces`).
- **Problem:** `find_faces` calls the shared implementation and then does
  `note.replace("PowerPoint", "Word")` over every returned note. The docstring
  is candid: "The shared notes name PowerPoint because that is where they were
  written." This is a wrapper added to avoid touching the thing that needs
  changing, and it is string surgery on human-readable text, so it breaks the
  moment a note mentions PowerPoint for a reason other than naming the host
  application, or mentions it in a different casing, or a third format arrives
  and has to add a second `.replace`.
- **Cost:** low today, but it is the template. The next format copies the
  pattern instead of fixing the message.
- **Fix:** give the shared `find_faces` an `app="PowerPoint"` keyword and format
  the notes with it, then have docx pass `app="Word"` and delete the wrapper.
  Small and belongs in this cleanup, though it touches the same module as the
  extraction task above, so sequence it after or fold it into that.
- **Confidence:** high
- **Risk:** SAFE

---

### The `is_linked_to_previous` guard was mirrored into both walkers, the wider part list was not

- **Where:** `skills/productivity/docx/scripts/docx_common.py:258-278`
  (`_iter_all_tables`) versus `:8-31` (`iter_all_paragraphs`).
- **Problem:** commit `f9dda436b0` found a real and well-diagnosed defect,
  reading an inherited header or footer materializes the part, and applied the
  `is_linked_to_previous` guard to both walkers. But `iter_all_paragraphs`
  enumerates all six section parts (`header`, `footer`, `first_page_header`,
  `first_page_footer`, `even_page_header`, `even_page_footer`) while
  `_iter_all_tables` still enumerates only `section.header` and
  `section.footer`. The guard was mirrored, the part list was not, so a table
  sitting in a first-page or even-page header is invisible to
  `apply_rtl`'s table pass while the paragraphs in that same part are visited.
- **Cost:** an Arabic table in a first-page header keeps its left-to-right cell
  order after a direction pass reports success. Small blast radius, but it is a
  half-finished mirror sitting one function away from the finished one, which
  is how the next reader concludes the narrow list is intentional.
- **Fix:** hoist the part enumeration into one helper, something like
  `_section_parts(section)` that yields the six names and applies the
  `is_linked_to_previous` guard once, and have both walkers consume it. That
  removes the duplicated `try/except (AttributeError, ValueError)` block as
  well. Belongs in this cleanup.
- **Confidence:** medium (the narrow list may predate the guard and simply not
  have been revisited; no commit states a reason for it either way)
- **Risk:** SAFE

---

### The same script-detection predicate is defined twice, differently, and one of them is imported privately

- **Where:** `skills/productivity/docx/scripts/docx_common.py:281-282`
  (`_has_latin_letters`, a character-range loop) versus
  `skills/productivity/powerpoint/scripts/pptx_common.py:25` and `:59-60`
  (`_LATIN_RE` plus `_has_latin_letters`). Same split for
  `docx_common.py:285-290` (`_mostly_rtl`, private, and it re-imports `re`
  inside the function body) versus `pptx_common.py:37-41` (`mostly_rtl`,
  public). The private one crosses a module boundary at
  `skills/productivity/docx/scripts/docx_create.py:135`.
- **Problem:** `f9dda436b0` mirrored the per-run direction logic from docx into
  pptx by hand, and the two halves of the same idea ended up with different
  spellings, different visibility and different helper names. `docx_create`
  imports `_mostly_rtl` by its underscore name, which says the author wanted it
  public and did not want to touch `docx_common`.
- **Cost:** small now. It matters because these two functions are the whole
  definition of "what script is this run", and the next fix to that definition,
  an extended Arabic range, Hebrew, Latin-1 accented letters that neither
  version currently counts, has to be found and applied twice in two different
  idioms.
- **Fix:** rename `_mostly_rtl` to `mostly_rtl` in `docx_common` to match the
  pptx spelling and update the one import, hoist the `import re` to module
  scope, and make `_has_latin_letters` the same regex in both. Cross-skill
  sharing is not available here (the installability boundary is real), so
  identical spelling in both copies is the achievable goal. Belongs in this
  cleanup.
- **Confidence:** medium
- **Risk:** SAFE

---

## Considered and rejected

These look like band-aids and are not. The test applied: does the file or the
commit state its reason, and have the copies actually drifted?

- **Five byte-identical copies of `house_common.py`** across docx, powerpoint,
  house-style, pdf and xlsx (`md5 efb47ddb8c4ef4d3524a0ceb07e684f1` in all
  five). This is a deliberate boundary, stated in the file's own docstring at
  `skills/productivity/docx/scripts/house_common.py:1-12`: the skills are
  installed independently, a shared import would break a solo install, and the
  locator degrades to `None` so the create scripts fall back to pre-design-system
  behaviour. The copies are identical, so they have not drifted. Not a finding.
  It is the pattern the `docx_embed_fonts` finding above should have followed.

- **`geometry_docx` has two rules where `geometry_pptx` has five.**
  `style_lint.py:884-904` versus `:950-1014`. Commit `806cceb9b5` states the
  reason: "Word gets the two rules that survive a reflowing page: an oversized
  image or table, and contrast against the shading actually behind the run."
  Overflow, safe margins and overlap are not defined for a flowing page. This
  is a correct medium distinction, not a half-done mirror.

- **`house_style.py` has separate `theme_docx`, `theme_pptx`, `theme_xlsx` and
  `pdf_styles` rather than one themed entry point.** There is no `if medium ==`
  branching anywhere in the file (grep returns nothing). The shared layer is the
  colour, type-scale and measurement primitives; the per-format functions are
  genuinely different object models. This is the right depth already.

- **`pptx_create` calls `paginate_items`, `fill_factor` and `estimate_lines`
  from `house_style` while `docx_create` calls none of them.** Same reflowing-page
  reason as the lint: a Word page paginates itself, a slide does not. Not a gap.

- **The deck has no `rules`/`quote`/`lead`/`block`/`edge` aside vocabulary to
  match `docx_graphics.py:745` (`CALLOUT_STYLES`).** Commits `276d0e26e1` and
  `df0cc1d1f8` are explicitly about how a *report* sets an aside, citing IMF,
  Bank of England, GOV.UK, Tufte and Butterick, all print-page sources. A deck's
  equivalent is the card and stat archetypes, which exist. Different medium,
  different vocabulary, deliberately. Confidence that this is deliberate:
  medium, since no commit says so in as many words.

---

## Note for the correctness reviewer

Finding 1 is a live functional defect, not only an altitude problem:
`office_inspect` currently reports zero comments for every `.pptx`, `.xlsx` and
`.pdf` it inspects. Flagged here because the interesting part is where the fix
was placed, but it should be on the correctness list too.
