# Skill review: what was found, what was applied, what was not

> **Second pass appended at the end of this file.** The review was later
> extended to pdf and xlsx, plus a reverse documentation audit. It found
> three more live bugs, two of them in xlsx. See "Second pass" below.

Method: the `simplify-code` skill's four parallel reviewers (reuse, quality,
efficiency, altitude), plus a fifth agent mapping test coverage at two layers.
Scope: `skills/productivity/{docx,powerpoint,house-style}/scripts`, about
12,800 lines.

Full findings are in the sibling files: [`reuse.md`](reuse.md),
[`quality.md`](quality.md), [`efficiency.md`](efficiency.md),
[`altitude.md`](altitude.md), [`test-coverage.md`](test-coverage.md).
The pre-change test state is in [`baseline.md`](baseline.md).

## Two live bugs, found and fixed

Neither is a cleanup item. Both were shipping.

### 1. The inspector reported "no comments" for every deck, workbook and PDF

`office_inspect.py` called three of its four comment helpers with `--json`.
Only the docx helper defines that flag, and there it is a **shape selector**
(`--json flat|threads`), not an output-format switch. argparse rejected the
bare flag on the other three:

```
$ pptx_comments.py list deck.pptx --json
pptx_comments.py: error: unrecognized arguments: --json
rc=2
```

`_run_helper` catches a non-zero exit and returns `{"items": [], "stderr": ...}`.
From the caller's side that is **indistinguishable from a document with no
comments**, which is the exact failure this script's own docstring says it
exists to avoid:

> "none" and "could not look" are different answers and only one of them is
> safe to act on.

The three helpers already print JSON by default, so the fix was to drop the
flag. Verified end to end before and after.

### 2. The docx worked example contained two commands that cannot run

`skills/productivity/docx/SKILL.md:313-314`, the block an agent copies:

| Documented | Reality |
|---|---|
| `list draft.docx --json` | `--json` requires a value, `flat` or `threads` |
| `add draft.docx --anchor "price move"` | the flag is `--target`; `--anchor` does not exist |

Both fail instantly. Fixed in the SKILL.md.

## One hang risk and one silent-failure class, fixed

**`style_lint.py:442` was the only subprocess in 24 files with no timeout**,
and it ignored the return code. A stuck `pdftotext` hung the skill forever; a
failed one produced empty text and zero findings, which renders identically to
a clean document. Now has a 120 second timeout and reports the real reason on
failure.

**Three locators hardcoded `~/.hermes`** and ignored `HERMES_HOME`, which the
agent honours everywhere else (`hermes_constants.get_hermes_home()`). A Hermes
installed anywhere else silently found no design system and produced unthemed
documents. Fixed using the pattern already blessed in
`skills/productivity/google-workspace/scripts/_hermes_home.py`: read the
variable inline rather than importing from the agent tree, because a skill
installs standalone.

`house_common.py` has five byte-identical copies and
`tests/skills/test_house_style.py:541` asserts they stay identical, so the
change landed on all five together.

## The test finding that mattered most

**98 tests existed that CI had never run.** `pyproject.toml` set
`testpaths = ["tests"]` and `scripts/run_tests_parallel.py` discovered from
`tests/` only, so these five suites were collected by nothing:

```
skills/productivity/{docx,pdf,powerpoint,xlsx,diagrams}/tests/
```

They are the **only** coverage of seven shipped modules: `docx_read`,
`docx_revisions`, `docx_template`, `pptx_edit`, `pptx_read`, `pptx_render`,
`pptx_from_template`. Worse, `test_office_document_skills.py::test_skill_has_tests`
asserts the `tests/` directory exists, so the invariant passed while the
suites never executed. The gap was actively disguised.

They could not simply move under `tests/`: each skill ships to users as a
self-contained directory and that same invariant requires the suite to travel
with it. So the discovery roots were widened instead, in both places.

Wiring them up immediately turned CI red, which is the point: **17 of the 98
were failing**, all in the pdf suite, all because `pypdf` is absent and none
of the five guarded its optional dependency the way `tests/skills/` does.
Added `pytest.importorskip` to all five. 17 hard failures became 1 clean skip.

## Tests written

`tests/skills/test_office_skill_contracts.py`, 12 tests at the two layers.

**Layer B, through the public interface.** Runs the real script as a
subprocess with real arguments and asserts on real output.

- `test_the_real_comment_helper_is_actually_reached[docx|pptx|xlsx]`, the
  regression test for bug 1. The existing `test_office_inspect.py` covers
  `_run_helper` thoroughly but only ever with **stub helpers it writes
  itself**, so the real argv contract was never exercised. That is precisely
  why a 2,000 test suite missed the bug.
- `test_every_documented_flag_exists[docx|powerpoint|xlsx|pdf]`, the
  regression test for bug 2. Parses every `python scripts/...` line out of
  each SKILL.md and checks each flag against the script's own `--help`, which
  argparse generates from the real parser and therefore cannot drift from it.
- `test_the_documented_comment_example_actually_runs`, because a flag can
  exist and the example still be wrong, which is what `list --json` was.

**Layer A, below the public interface.** Imports the module and calls the
function, reaching error paths that are awkward to provoke from outside.

- three tests pinning `style_lint.read_pdf` on its absent, timed-out and
  failed-extractor paths.

**The regression tests were proven, not assumed.** Re-breaking the `--json`
fix turns 3 of them red; restoring it turns them green again.

## Verification

| | Before | After |
|---|---|---|
| `tests/skills/` | 1942 passed, 1 skipped | 1942 passed, 1 skipped |
| in-skill suites, collected? | **no** | **yes** |
| in-skill suites | 81 passed, 17 failed | 77 passed, 1 skipped |
| new contract tests | none | 12 passed |
| **combined** | 1996 running, 17 red, 98 invisible | **2031 passed, 2 skipped** |

Run: `venv/bin/python -m pytest tests/skills/ skills/productivity/ -q`, 2m14s.

## Not applied, deliberately

Per the skill's own rule, RISKY findings are flagged rather than auto-applied.
These are behaviour changes to a document generator, and they are worth doing,
but as their own task with their own verification.

1. **Two forked `Package` classes one directory apart**, `pptx_comments.py:160-290`
   and `pptx_embed_fonts.py:171-296`, about 120 identical lines, plus three
   copies of `resolve_target`. All three reviewers found this independently.
   They have already drifted: a `(target or "")` guard exists in one and not
   the other. Extracting `pptx_opc.py` is safe (same directory, and
   `skills_sync` copies a skill as one unit) but it touches the OOXML plumbing
   under both comment writing and font embedding.
2. **`embed_fonts` duplicated across skills**, about 145 lines each with 20
   differing. The sharing that was attempted leaks badly: `docx_embed_fonts`
   imports a module named `pptx_embed_fonts`, splices `DOCX_FONT_DIRS` into
   `PPTX_FONT_DIRS` as an import-time `os.environ` side effect, and patches
   borrowed text with `note.replace("PowerPoint", "Word")`.
3. **Fixes that landed in docx and never reached pptx.** `docx_edit.py` has a
   `direction` subcommand; `pptx_edit.py` has none, so `pptx_common.apply_rtl`
   is unreachable for a deck a client sent. The library half is already
   written, only the CLI is missing. This is the cleanest of the three.
4. **Three divergent numeric-column detectors**, so the same table is aligned
   by the create script and not by the theme pass.
5. **Efficiency**: `office_inspect` builds the whole report then discards the
   sections `--section` did not ask for; `pptx_embed_fonts` re-walks every
   font directory per family, roughly forty recursive walks of
   `/usr/share/fonts` for six families.

## Out of scope, reported not fixed

- **18 em or en dashes** in skills outside the reviewed scope, a house-rule
  violation: `pdf/scripts/extract_marker.py`, `pdf/scripts/pdf_secure.py`,
  `xlsx/scripts/xlsx_edit.py`, `xlsx/scripts/xlsx_recalc.py`,
  `google-workspace/scripts/{setup.py,gws_bridge.py}`,
  `maps/scripts/maps_client.py`. The reviewed scope is clean.
- **More undocumented flags**, found by the coverage agent and not yet
  reconciled: `house_style.py --theme` and `--accent` (the entire theming
  entry point), `style_lint.py --strict` (it changes the exit code),
  `office_inspect.py --no-lint`, `pptx_render.py --prefix` and `--dpi`, and
  `docx_comments.py reopen`. The new `test_every_documented_flag_exists`
  catches documented-but-missing; it does not catch implemented-but-undocumented,
  which is the opposite direction and needs its own check.
- **`house-style` is absent from `OFFICE_SKILLS`**, so no invariant applies to
  it and its `tests/` directory is empty.
- **`pptx_design.js` is documented, has zero tests**, and is invisible to
  every invariant because they all glob `*.py`.

---

# Second pass: pdf, xlsx, and the documentation audit

Scope: `skills/productivity/{pdf,xlsx}/scripts`, plus a reverse audit of all
299 command line flags across the five office skills. Reports:
[`pdf-xlsx.md`](pdf-xlsx.md), [`undocumented-flags.md`](undocumented-flags.md).

## Three more live bugs, all fixed

### 1. A workbook that lost its formatting still reported ok

openpyxl cannot represent every rule Excel can write. The common one is a
whole column conditional format, stored as `sqref="A:A"`. It is discarded on
load with a `UserWarning` nobody reads, the script saves, and the rule is gone
from the user's file. Both writers, `xlsx_edit` and `xlsx_restructure`,
printed `{"ok": true}` and nothing else, so an agent could not tell a clean
edit from one that quietly threw the user's formatting away.

The edit still happens, that part was never wrong. What changed is that the
loss reaches the JSON under `lost_on_load`, and only when there was one: a
field that is always present stops carrying information.

### 2. A whole column autofilter made a workbook unrestructurable

Excel writes "filter this table" as `A:B`, and `range_boundaries` reports the
missing half as `None`. The arithmetic used it raw. On the row axis that is
`'>=' not supported between instances of 'NoneType' and 'int'`, which names
nothing actionable. On the column axis it was quieter and worse: `None`
reached a format string and produced refs like `"ANone:DNone"`.

An open-ended range is unbounded on that axis by definition, so a shift along
it cannot move it. Inserting rows does not change what `A:C` means.

### 3. pdftoppm could hang forever

`pdf/scripts/_raster.py` ran it with no timeout, the same shape as the
`style_lint` case in the first pass, and nothing above it would ever give up.

## The documentation audit, the other direction

`test_every_documented_flag_exists` catches a flag an example uses and the
parser does not define. It cannot catch the reverse, a flag that works and is
written down nowhere, and an agent only knows what SKILL.md tells it.

47 undocumented flags across 299. The ones that cost the most, now documented:

| What | Why it mattered |
|---|---|
| `house_style.py --theme`, `--accent` | the entire theming entry point, shown only as a Python call while every other example shells out |
| `pptx_from_template.py --add-slides` | a second mode, not a modifier. The only way to add a slide to a brand deck without losing the master |
| `style_lint.py --strict` | changes the exit code, so it is the difference between a gate and a printout |
| `xlsx_comments.py -o` | the only comment script of five never showing an output path, so the examples overwrote the reviewer's own workbook |
| four `xlsx_comments` subcommands, `docx_comments reopen` | absent entirely, including the two legacy-note ones the prose promises in the same paragraph |

Every added example is executable, and the contract test now checks these
lines too, so this drift cannot come back silently.

## Long dashes

Zero left in any productivity script. Eighteen were fixed across pdf, xlsx,
maps and google-workspace, including one in an argparse `epilog` that printed
on `--help`.

Two remain in the tree and are deliberate: they sit inside non-ASCII fixture
strings in the docx and pdf test suites whose whole job is to carry characters
like that through an encoding round trip. Removing them would weaken the test.

131 remain in `.md` files across 18 skills. Not touched: that is a mechanical
sweep across documentation this pass did not review, and it would collide with
other agents editing those files.

## Verification

| | First pass | Now |
|---|---|---|
| `tests/skills/` + `skills/productivity/` | 2031 passed, 2 skipped | **2041 passed, 2 skipped** |

Every fix in both passes was proven by re-breaking it: the new tests fail on
the old code and pass on the new. The counts are 3 for the `--json` bug, 1 for
the conditional-format loss, 5 for the open-ended range, and 1 for the
duplicate preview image in the desktop app.

## Still not applied

The five RISKY items from the first pass stand, unchanged. Added to them from
this pass, all CAREFUL or RISKY and none of them urgent:

- `parse_pages` exists three times in the pdf skill with two incompatible
  meanings: `--pages "5-3"` is an error in `pdf_split` and a silent no-op in
  `pdf_stamp` and `pdf_page_image`.
- `pdf_page_image.py:83` reopens and reparses the whole PDF once per page,
  plus a PATH scan per page.
- The `Package` class has now drifted in three skills in different directions.
  Consolidating is cross-skill, which the install model forbids, so this needs
  a decision rather than a refactor.
