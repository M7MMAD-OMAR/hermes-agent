# Test coverage of the document generation skills

Read only review, branch `autobuild/sidebar-browser`, 12 Sep 2026.

Scope: `skills/productivity/docx`, `skills/productivity/powerpoint`,
`skills/productivity/house-style`, and the shared suite `tests/skills/`.

Two layers are distinguished throughout:

- **Layer A, below the public interface.** The test loads a module out of a
  skill's `scripts/` directory (`importlib`, `spec_from_file_location`, the
  local `_load(...)` helpers) and calls its internal functions directly. No
  subprocess, no document on disk in the general case.
- **Layer B, through the public interface.** The test runs the script as a
  subprocess with its real command line arguments, then reopens the produced
  `.docx` or `.pptx` with `python-docx`, `python-pptx` or `zipfile` and
  asserts on what is inside. This is the layer that proves SKILL.md.

A subprocess call that only checks the exit code or the printed JSON report is
recorded as **partial** Layer B, because it never opens the artifact.

## Headline finding, read this first

**The two skill local test suites are never executed, by CI or by anything
else, and seven shipped modules have their only coverage there.**

`pyproject.toml` sets `testpaths = ["tests"]`, and CI does not pass explicit
paths: `.github/workflows/tests.yml` runs `scripts/run_tests.sh` with no
`--files`, and `scripts/run_tests_parallel.py` discovers with
`root.rglob("test_*.py")` under `tests/` only. So
`skills/productivity/docx/tests/test_docx_skill.py` (33 tests) and
`skills/productivity/powerpoint/tests/test_powerpoint_skill.py` (21 tests) are
orphaned, 54 tests in total, and every one of the 54 is Layer B.

Worse, `tests/skills/test_office_document_skills.py::test_skill_has_tests`
asserts that each office skill ships a `tests/` directory containing
`test_*.py`. That invariant passes, so the repository asserts the existence of
a suite nothing runs. The gap is actively disguised.

Modules whose only coverage lives in those orphaned files, and which therefore
have zero executed coverage at either layer:

`docx_read.py`, `docx_revisions.py`, `docx_template.py`, `pptx_edit.py`,
`pptx_read.py`, `pptx_render.py`, `pptx_from_template.py`.

`pptx_design.js` has no test anywhere, and the invariants in
`test_office_document_skills.py` all glob `*.py` (and
`test_referenced_scripts_exist` matches `scripts/[\w./-]+\.py`), so the
JavaScript path is not even guarded by a smoke check.

A second structural hole: `OFFICE_SKILLS` in
`tests/skills/test_office_document_skills.py` is `["docx", "xlsx", "pdf",
"powerpoint"]`. `house-style` is exempt from every invariant, which is why its
`skills/productivity/house-style/tests/` directory is completely empty and
nobody noticed.

---

## 1. Inventory of the public interface

### 1.1 docx

| Script | Public surface | Documented in SKILL.md |
|---|---|---|
| `docx_create.py` | positional `spec` `output`, `--rtl {auto,on,off}`, `--no-theme` | yes, `--rtl` documented at the direction section |
| `docx_edit.py` | subcommands `replace`, `set-cell`, `insert`, `delete`, `style`, `normalize`, `direction`, `toc`, `page-numbers` | all nine documented |
| `docx_read.py` | positional `path`, `--text`, `--structure`, `--styles`, `--images`, `--revisions` | all documented |
| `docx_revisions.py` | `list`, `accept-all`, `reject-all`, `accept --id`, `reject --id` | all documented |
| `docx_template.py` | positional `template` `values` `output`, `--strict` | documented |
| `docx_validate.py` | positional `path` | documented |
| `docx_comments.py` | `list`, `add`, `reply`, `resolve`, `reopen`, `delete`, `delete-thread` | `reopen` is **not** documented, see defects |
| `docx_graphics.py` | positional `spec` `output`, `--into`, `--no-theme` | documented |
| `docx_embed_fonts.py` | `embed`, `report`, `verify` | all three documented |
| `docx_common.py`, `house_common.py` | internal, no CLI | exempt by convention |

### 1.2 powerpoint

| Script | Public surface | Documented in SKILL.md |
|---|---|---|
| `pptx_create.py` | positional `spec` `output`, `--rtl {auto,on,off}`, `--no-theme` | yes |
| `pptx_edit.py` | positional `pptx`, `--output`, and twelve operation flags: `--replace-text`, `--chart-data`, `--swap-image`, `--remove-slide`, `--move-slide`, `--duplicate-slide`, `--set-background`, `--hyperlink`, `--enable-slide-number`, `--set-footer`, `--set-notes`, `--append-notes` | all twelve documented |
| `pptx_read.py` | positional `pptx`, `--outline`, `--notes`, `--images` | yes |
| `pptx_render.py` | positional `pptx`, `--outdir`, `--prefix`, `--dpi` | `--outdir` documented, `--prefix` and `--dpi` are not |
| `pptx_from_template.py` | positional `template` `output`, `--values`, `--add-slides` | yes |
| `pptx_comments.py` | `list`, `add`, `reply`, `resolve`, `reopen`, `delete` | all six documented |
| `pptx_embed_fonts.py` | `embed`, `report`, `verify` | yes |
| `pptx_design.js` | `design.json out.pptx`, the PptxGenJS path | documented, untested |
| `pptx_common.py`, `house_common.py` | internal | exempt |

### 1.3 house-style

| Script | Public surface | Documented in SKILL.md |
|---|---|---|
| `house_style.py` | `--theme`, `--accent`, `--check-contrast` | only `--check-contrast` is documented |
| `style_lint.py` | positional `files` (variadic), `--json`, `--only`, `--strict` | `--only` and `--json` documented, `--strict` is not |
| `office_inspect.py` | positional `file`, `--section`, `--no-lint` | `--section` documented, `--no-lint` is not |
| `house_common.py` | internal locator | exempt |

### 1.4 Interface defects found

1. **`docx_comments.py reopen` is implemented and undocumented.** Generated by
   the loop at `docx_comments.py:920`. The powerpoint SKILL.md documents the
   equivalent `pptx_comments.py reopen`, the docx SKILL.md does not mention
   `reopen` anywhere. An agent reading the docx skill cannot un-resolve a
   thread.
2. **`house_style.py --theme` and `--accent` are implemented and
   undocumented.** They are the entire theming and brand hue entry point
   (`house_style.py:1518` and `:1519`, feeding `load_theme`). SKILL.md mentions
   only `--check-contrast`. The design system is configurable and nothing tells
   the agent so.
3. **`style_lint.py --strict`, `office_inspect.py --no-lint`,
   `pptx_render.py --prefix` and `--dpi` are implemented and undocumented.**
   `--strict` in particular changes the exit code, which is the difference
   between a lint that gates and a lint that only prints.
4. **`docx_comments.py add --anchor` is documented and does not exist.** The
   docx SKILL.md spells the anchor flag two different ways in one file:
   line 127 says `docx_comments.py add f.docx --target "phrase"`, line 314
   says `python scripts/docx_comments.py add draft.docx --anchor "price move"`.
   The parser at `docx_comments.py:902` defines `--target` and only `--target`,
   so the second form exits with an argparse error. This is a documented
   command that does not exist, and it is the single worst of the interface
   defects, because the worked example in the prose section is the form an
   agent is most likely to copy. Apart from this one flag, every subcommand
   and flag quoted in the three SKILL.md files exists.
5. **house-style would fail `test_referenced_scripts_exist` if it were added
   to `OFFICE_SKILLS`.** Its SKILL.md line 47 says
   `python ../powerpoint/scripts/pptx_create.py deck.json out.pptx`, and the
   invariant's regex `scripts/[\w./-]+\.py` captures `scripts/pptx_create.py`
   and resolves it against the house-style directory, where it does not exist.
   The cross skill reference is correct in intent, the invariant is not
   cross skill aware. Worth fixing together.

---

## 2. Inventory of existing tests

### 2.1 The convention, and whether it holds

It does not hold. There are two conventions running at once.

- **`tests/skills/*.py`, 15 files, 327 executed tests.** Feature oriented
  names (`test_docx_fonts.py`, `test_lint_geometry.py`). Discovered by
  `testpaths`, run in CI, and they inherit `tests/conftest.py` with its autouse
  stubs, OS marker gating and per file subprocess isolation.
- **`skills/productivity/<skill>/tests/`, 2 files, 54 tests.** Named after the
  skill (`test_docx_skill.py`, `test_powerpoint_skill.py`), written as broad
  end to end CLI walks. Never discovered. They also sit outside
  `tests/conftest.py`, so even if they were pointed at directly they would run
  without the shared fixtures and isolation the rest of the suite assumes.
- **`skills/productivity/house-style/tests/`, empty.**

The historical reading is that the skill local layout came in with the
clean-room rewrite (`51570f4da7 feat: replace Anthropic office document skills
with clean-room MIT implementations`) and everything written since then landed
in `tests/skills/` instead, without the older files being moved.

### 2.2 File by file

All counts below are **test functions**, not pytest collected items. The
`tests/skills/` files hold 260 test functions which pytest expands to 327
collected items through `parametrize`. The two orphaned files hold 54 test
functions and collect as 54.

Classification is per test function, computed from the AST: a helper or
fixture that reaches `subprocess.run` transitively marks its callers Layer B,
a helper or fixture that reaches `_load` or an in-test `import` of a skill
module marks its callers Layer A, and a test reaching both is mixed. This
matters, because several files run the real CLI once in a module scoped
fixture and then assert on the artifact across many tests, which is Layer B
even though the test body contains no `subprocess` call.

| File | Test fns | A | B | Mixed | Scripts touched | Subcommands exercised |
|---|---|---|---|---|---|---|
| `tests/skills/test_docx_comments.py` | 16 | 13 | 2 | 1 | `docx_comments.py`, `docx_validate.py` | `add`, `reply`, `resolve`, `reopen`, `delete`, `delete-thread`, `list`, mostly at Layer A |
| `tests/skills/test_docx_direction.py` | 7 | 4 | 3 | 0 | `docx_edit.py` | `direction` only |
| `tests/skills/test_docx_fonts.py` | 27 | 1 | 23 | 3 | `docx_embed_fonts.py`, `docx_create.py` | `embed`, `report`, `verify`, Layer B with package reopen |
| `tests/skills/test_docx_graphics.py` | 25 | 9 | 13 | 3 | `docx_create.py`, `docx_graphics.py`, `docx_validate.py` | charts, pictures, shapes, callouts |
| `tests/skills/test_docx_report.py` | 23 | 0 | 23 | 0 | `docx_create.py`, `docx_edit.py`, `docx_common.py`, `house_common.py` | cover, contents, running head, captions, table alignment, all through the `docx_create.py` CLI |
| `tests/skills/test_pptx_direction.py` | 12 | 12 | 0 | 0 | `pptx_common.py` | `apply_rtl` only |
| `tests/skills/test_pptx_fonts.py` | 19 | 0 | 16 | 3 | `pptx_embed_fonts.py` | `embed`, `report`, `verify` |
| `tests/skills/test_pptx_layouts.py` | 15 | 15 | 0 | 0 | `pptx_create.py` | layout composition internals, no CLI at all |
| `tests/skills/test_pptx_planner.py` | 17 | 13 | 3 | 1 | `pptx_create.py`, `style_lint.py` | the deck planner added in `f049e673ae` |
| `tests/skills/test_office_comments.py` | 10 | 0 | 10 | 0 | `pptx_comments.py`, `xlsx_comments.py` | `add`, `reply`, `resolve`, `delete`, `list` |
| `tests/skills/test_office_document_skills.py` | 8 | invariants | | | all four office skills | frontmatter, licence, docs, argparse shape |
| `tests/skills/test_office_inspect.py` | 9 | 8 | 1 | 0 | `office_inspect.py` | `--section`, helper discovery |
| `tests/skills/test_office_stress.py` | 13 | 0 | 13 | 0 | `docx_comments.py`, `pptx_comments.py`, `xlsx_comments.py`, `office_inspect.py`, `docx_create.py`, `docx_edit.py`, `docx_graphics.py` (including `--into`), `docx_validate.py` | comment operations against a model, fuzz text, truncated package |
| `tests/skills/test_house_style.py` | 30 | 28 | 2 | 0 | `house_style.py`, `style_lint.py`, `house_common.py`, `pptx_create.py` | per format appliers, contrast, lint rules |
| `tests/skills/test_lint_geometry.py` | 29 | 23 | 1 | 5 | `style_lint.py`, `house_style.py`, `docx_create.py`, `pptx_create.py` | the geometry lint added in `806cceb9b5` |
| `skills/productivity/docx/tests/test_docx_skill.py` (orphaned) | 33 | 0 | 33 | 0 | `docx_create.py`, `docx_read.py`, `docx_edit.py`, `docx_template.py`, `docx_revisions.py`, `docx_comments.py`, `docx_validate.py` | the widest Layer B walk in the repo |
| `skills/productivity/powerpoint/tests/test_powerpoint_skill.py` (orphaned) | 21 | 0 | 21 | 0 | `pptx_create.py`, `pptx_edit.py`, `pptx_read.py`, `pptx_render.py`, `pptx_from_template.py` | the only coverage of four of those five |

**Executed totals: 126 Layer A, 110 Layer B, 16 mixed, plus 8 invariant
functions, 260 test functions in all.** The split is close to even, but it is
not evenly spread. The Layer B mass sits in three feature areas only: font
embedding (39 of it), comments (25) and report furniture (23). The Layer A
mass sits in the design system and the two composition engines: `house_style.py`
28, `pptx_create.py` layouts and planner 28, `docx_graphics.py` 9,
direction passes 16.

**Orphaned totals: 54 test functions, all 54 Layer B.** They are the only
coverage of the plain read, edit, template, revisions and render paths, at
either layer.

---

## 3. The coverage matrix

"Covered" below means covered **by tests that actually run**. The orphaned
column is called out separately because it is where a follow-up pass can
harvest tests rather than write them from scratch.

### 3.1 docx

| Module | Public subcommands | Layer A | Layer B | Orphaned coverage | Most valuable missing Layer A test | Most valuable missing Layer B test |
|---|---|---|---|---|---|---|
| `docx_create.py` | `spec output --rtl --no-theme` | thin, only through `docx_common` helpers | yes, strong, it is the build helper for report, graphics and fonts tests | yes | the spec to block dispatch called directly, so a bad block type is a fast failure not a subprocess | none urgent |
| `docx_edit.py` | 9 subcommands | partial, `direction` only | no | yes | `normalize` run merging on runs split by spell check | one Layer B test per subcommand: `replace`, `set-cell`, `insert`, `delete`, `style`, `toc`, `page-numbers` |
| `docx_read.py` | 6 flags | no | no | yes | none, it is a thin reader | `--structure` and `--images` against a document with tables, headers and two images |
| `docx_revisions.py` | 5 subcommands | no | no | yes | `accept`/`reject` on a single `w:id` inside a table cell | `accept-all` then `list` returns empty and the text is the accepted text |
| `docx_template.py` | `--strict` | no | no | yes | placeholder scan across header, footer and table cells | `--strict` exits non zero and writes no output when a placeholder is unfilled |
| `docx_validate.py` | `path` | no | partial, used as an assertion helper | yes | the individual check functions, dangling rel, missing style, empty image | `docx_validate.py` on a deliberately corrupted package exits non zero with a named finding |
| `docx_comments.py` | 7 subcommands | yes, strong, 13 tests | partial, 2 CLI walks plus the stress suite | yes | none urgent | `reopen` through the CLI, and `add --target` exercised through the CLI so the `--anchor` documentation defect cannot recur |
| `docx_graphics.py` | `spec output --into --no-theme` | yes, 9 tests | yes, 13 plus 3 mixed, and `--into` once in `test_office_stress.py:165` | no | none urgent | `--into` against a document that already carries images and a chart, asserting the pre-existing graphics and their rels survive; the one stress test merges into a plain review document only |
| `docx_embed_fonts.py` | `embed report verify` | thin, one test | yes, strong | no | `_obfuscate`/`_deobfuscate` key derivation as a pure round trip, and the family name matcher | none urgent |
| `docx_common.py` | internal | partial | n/a | no | unit conversion and colour helpers called directly | n/a |

### 3.2 powerpoint

| Module | Public subcommands | Layer A | Layer B | Orphaned coverage | Most valuable missing Layer A test | Most valuable missing Layer B test |
|---|---|---|---|---|---|---|
| `pptx_create.py` | `spec output --rtl --no-theme` | yes, strong, 28 tests | partial, only as a deck builder for lint and planner tests | yes | none urgent, layouts and planner are well covered | run the CLI on a spec using every documented archetype and reopen with `python-pptx`; `test_pptx_layouts.py` never touches the CLI at all |
| `pptx_edit.py` | 12 operation flags | no | no | yes | `--move-slide` index arithmetic and the `sldIdLst` rewrite as a pure function | `--remove-slide` and `--move-slide` together, reopen and assert slide order and that no relationship dangles |
| `pptx_read.py` | 4 flags | no | no | yes | none, thin | `--outline` JSON shape against a deck with a table, a chart and a group |
| `pptx_render.py` | `--outdir --prefix --dpi` | no | no | yes | none, it shells out | `--outdir` produces one PNG per slide, `--dpi` changes the pixel size |
| `pptx_from_template.py` | `--values --add-slides` | no | no | yes | placeholder substitution across layouts and masters | `--values` with non ASCII fill, reopen and assert the text |
| `pptx_comments.py` | 6 subcommands | thin, one test | yes | no | the modern comment part construction versus the legacy fallback | `reopen` through the CLI |
| `pptx_embed_fonts.py` | `embed report verify` | no | yes, strong | no | the licence gate predicate and the family matcher as pure functions | none urgent |
| `pptx_design.js` | `design.json out.pptx` | **no** | **no** | **no** | n/a, JavaScript | a smoke test that the documented invocation produces a `.pptx` that `python-pptx` opens |
| `pptx_common.py` | internal | yes, `apply_rtl` | n/a | no | none urgent | n/a |

### 3.3 house-style

| Module | Public subcommands | Layer A | Layer B | Orphaned coverage | Most valuable missing Layer A test | Most valuable missing Layer B test |
|---|---|---|---|---|---|---|
| `house_style.py` | `--theme --accent --check-contrast` | yes, strong, 28 tests | no | no | `load_theme` with an invalid `--accent` value, malformed hex, out of range | `house_style.py --theme slate --accent 0055AA --check-contrast` exits zero and prints a system whose every pair clears AA |
| `style_lint.py` | `files --json --only --strict` | yes, strong | partial, 5 tests | no | the `--only` filter selecting each named category in turn | `--strict` exit code contract on a file with findings versus a clean file |
| `office_inspect.py` | `file --section --no-lint` | yes | thin, one test | no | `--no-lint` suppressing the lint section | `--section` with an unknown name is refused rather than silently empty |
| `house_common.py` | internal locator | yes | n/a | no | none urgent | n/a |

---

## 4. Top 15 missing tests, ranked

Risk weighting used: recency of change from `git log --since='60 days ago'`,
whether the code parses user supplied input, whether it manipulates OOXML or
zip structures directly, and whether any test runs today. Change counts in the
last 60 days: `docx_create.py` 7, `pptx_create.py` 7, `house_style.py` 6,
`docx_common.py` 5, `docx_graphics.py` 5, `style_lint.py` 5, `pptx_design.js`
3, `docx_comments.py` 3, `docx_edit.py` 3.

**Rank 0, not a test, a prerequisite.** Make the skill local suites run, or
delete them and move their 54 tests into `tests/skills/`. Every entry below
assumes the executed set is the one that counts. Concretely: either add
`skills` to `testpaths` and teach `run_tests_parallel.py` to discover there,
or relocate `test_docx_skill.py` to `tests/skills/test_docx_cli.py` and
`test_powerpoint_skill.py` to `tests/skills/test_pptx_cli.py` so they inherit
`tests/conftest.py`. Relocation is the lower risk option, because those suites
have never run under the shared conftest and may depend on its absence.

| # | Layer | File it belongs in | What it asserts | Why it matters |
|---|---|---|---|---|
| 1 | B | `tests/skills/test_pptx_cli.py` (relocated) | `pptx_edit.py --remove-slide 3 --move-slide 2 0` on a real deck, reopen with `python-pptx`, assert slide count, slide order, and that every `r:id` in `sldIdLst` still resolves | Twelve documented flags with zero executed coverage, and slide removal rewrites the presentation part's relationship list by hand. A dangling `r:id` gives the user a deck PowerPoint refuses to open. |
| 2 | B | `tests/skills/test_docx_cli.py` (relocated) | `docx_edit.py` `replace`, `set-cell`, `insert`, `delete`, `style`, one test each, reopen and assert text and style, plus that unrelated runs keep their formatting | Nine subcommands, one of them (`direction`) covered, the other eight not executed. `docx_edit.py` changed three times in the window. |
| 3 | B | `tests/skills/test_pptx_design.py` (new) | The documented `node scripts/pptx_design.js design.json out.pptx` produces a file `python-pptx` opens with the expected slide count | The only shipped script with no test at either layer, and the only one the `*.py` invariants do not even see. Changed three times in the window. A broken `pptx_design.js` fails silently for every agent that takes the documented PptxGenJS path. |
| 4 | A | `tests/skills/test_house_style.py` | `load_theme` given a malformed `--accent` (not six hex digits, empty, `#` prefixed, out of gamut) raises or falls back with a named error rather than producing a theme with `None` colours | `house_style.py` changed six times in the window and is the input funnel for every other skill's palette. `--accent` is raw user text and is currently only exercised with valid values. |
| 5 | B | `tests/skills/test_house_style.py` | `style_lint.py --strict` exits non zero on a file with findings and zero on a clean file, and `--json` output parses | `--strict` is the gate semantics, undocumented and untested. A lint that silently exits zero is a lint nobody notices is broken. |
| 6 | B | `tests/skills/test_docx_cli.py` (relocated) | `docx_template.py tpl.docx values.json out.docx --strict` with one placeholder unfilled exits non zero and leaves no output file on disk | Partial output on failure is the classic template bug, and the module has no executed coverage at all. |
| 7 | B | `tests/skills/test_docx_cli.py` (relocated) | `docx_revisions.py accept-all` then `list` returns empty, and the visible text equals the accepted text, on a document with revisions inside a table and a header | Tracked change surgery edits `w:ins`/`w:del` in place. Zero executed coverage, and the SKILL.md explicitly promises it works in tables, headers and footers. |
| 8 | A | `tests/skills/test_docx_fonts.py` | The obfuscation key derivation and `_obfuscate`/`_deobfuscate` as a pure round trip over random bytes, plus the family name prefix matcher | 27 tests on this module and only one is Layer A. Every failure today needs a real font on the host and a subprocess, so the pure logic is slow to debug and the tests skip when `fc-match` finds nothing. |
| 9 | A | `tests/skills/test_pptx_fonts.py` | The licence gate predicate called directly with each licence file arrangement, and the family matcher | Nineteen tests, zero Layer A. Same argument as 8, and the licence gate is a correctness-and-legal boundary that should be testable without a font on disk. |
| 10 | B | `tests/skills/test_docx_comments.py` | `docx_comments.py add draft.docx --target "phrase" --text ... -o out.docx` through the CLI, reopen and assert the anchor landed on the right range | This is the `--anchor` documentation defect made un-repeatable. Thirteen of the sixteen tests in this file call the module directly, so the flag names the SKILL.md promises are never exercised, which is exactly how the two spellings diverged. |
| 11 | B | `tests/skills/test_pptx_cli.py` (relocated) | `pptx_from_template.py brand.pptx out.pptx --values v.json` with non ASCII values, reopen and assert the substituted text and that layouts are preserved | Zero executed coverage. Template fill across masters and layouts is where placeholder substitution silently misses. |
| 12 | B | `tests/skills/test_house_style.py` | `house_style.py --theme slate --accent 0055AA --check-contrast` exits zero and prints a system whose every reported pair clears AA | `house_style.py` has 28 Layer A tests and zero Layer B tests. It changed six times in the window, and `--theme`/`--accent` are the undocumented flags from defect 2, so documenting them without a CLI test documents something nothing checks. |
| 13 | A | `tests/skills/test_house_style.py` | `style_lint.py --only <category>` selects exactly that category for each documented category name, and an unknown name is refused | `--only` is documented and the lint gained a whole geometry category in `806cceb9b5`. A silently empty `--only geometry` looks like a clean file. |
| 14 | B | `tests/skills/test_pptx_cli.py` (relocated) | `pptx_read.py deck.pptx --outline` JSON shape against a deck containing a table, a chart, a group and speaker notes | `--outline` is the contract the agent reads a deck through, and SKILL.md uses it as the verification step after every build. No executed coverage. |
| 15 | A | `tests/skills/test_docx_report.py` | `docx_common.py` unit conversion and colour helpers called directly: EMU and point conversions at boundary values, and hex to `RGBColor` on short, long and invalid input | Five changes in the window, imported by every other docx script, and currently only exercised indirectly through document building. An off by one in EMU conversion shows up as a subtly wrong margin, not as a failure. |

Counted by layer: **10 Layer B gaps and 5 Layer A gaps** in the top 15.

The Layer B entries are 1, 2, 3, 5, 6, 7, 10, 11, 12 and 14. Six of them
(1, 2, 6, 7, 11, 14) are recoverable from the orphaned suites rather than
written from scratch, so the prerequisite relocation closes most of the Layer B
deficit in one move and should be done first. The remaining four (3, 5, 10, 12)
are new writing, and three of the four exist to make an interface defect from
section 1.4 un-repeatable.

The Layer A entries are 4, 8, 9, 13 and 15. All five are genuinely new
writing, none can be harvested, and all five target pure functions that are
currently reachable only by building a document, which is why they are slow to
debug today.

Order of work: rank 0 first, then the four new Layer B tests, then the five
Layer A tests. The harvested six come free with rank 0 and need only to be
confirmed green under `tests/conftest.py`.

---

## 5. How to run the tests

### 5.1 The command, and what it does today

Per `CLAUDE.md`, scope pytest, never run `tests/` unscoped. The interpreter is
the checkout venv, not a bare `python3`.

```bash
cd /home/sbarah/.hermes/hermes-agent
venv/bin/python -m pytest \
  tests/skills/test_docx_comments.py tests/skills/test_docx_direction.py \
  tests/skills/test_docx_fonts.py tests/skills/test_docx_graphics.py \
  tests/skills/test_docx_report.py tests/skills/test_pptx_direction.py \
  tests/skills/test_pptx_fonts.py tests/skills/test_pptx_layouts.py \
  tests/skills/test_pptx_planner.py tests/skills/test_office_comments.py \
  tests/skills/test_office_document_skills.py tests/skills/test_office_inspect.py \
  tests/skills/test_office_stress.py tests/skills/test_house_style.py \
  tests/skills/test_lint_geometry.py \
  skills/productivity/docx/tests/test_docx_skill.py \
  skills/productivity/powerpoint/tests/test_powerpoint_skill.py \
  -q -p no:randomly
```

**Result, run on 12 Sep 2026: `381 passed in 132.62s`, exit code 0.** No
failures, no skips, no errors, so nothing in this report is a reaction to a
red test.

Reconciling the numbers, `--collect-only` confirms the split: the 15
`tests/skills/` files collect **327** items (260 test functions, expanded by
`parametrize`, mostly in `test_office_document_skills.py`), the two orphaned
files collect **54** items (54 test functions, no parametrize). 327 plus 54 is
the 381. Only the 327 run in CI.

The shorter daily form, just the shared suite, is
`venv/bin/python -m pytest tests/skills/ -q`.

Note `addopts = "-m 'not integration'"` in `pyproject.toml` applies to both
forms.

### 5.2 Configuration, and the orphan confirmation

- `pyproject.toml` `[tool.pytest.ini_options]` sets `testpaths = ["tests"]`.
  `testpaths` applies only when no path argument is given, so the manual
  command above reaches the skill local files. Nothing automated does.
- CI (`.github/workflows/tests.yml`) runs `scripts/run_tests.sh` with no
  `--files` argument. `scripts/run_tests_parallel.py` discovers with
  `root.rglob("test_*.py")` rooted at `tests/`, one pytest subprocess per
  file. It never looks under `skills/`.
- There is no `pytest.ini`, `tox.ini` or `setup.cfg` that could override this,
  and no workflow references `skills/productivity` at all.

**Conclusion: the skill local test directories are orphaned.**
`skills/productivity/docx/tests/test_docx_skill.py` and
`skills/productivity/powerpoint/tests/test_powerpoint_skill.py` have never run
in CI. 54 tests, and the only coverage of seven shipped modules.

A secondary hazard for whoever fixes this: `tests/conftest.py` applies only
below its own directory. The two orphaned suites currently run without the
autouse stubs, OS marker gating and per file subprocess isolation that every
`tests/skills/` file inherits. Moving them under `tests/skills/` changes their
runtime environment, so move them one at a time and confirm each still passes.

`skills/productivity/house-style/tests/` is an empty directory. house-style is
absent from `OFFICE_SKILLS`, so `test_skill_has_tests` never looks at it.
