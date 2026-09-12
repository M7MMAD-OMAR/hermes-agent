---
name: docx
description: Create, read, edit, template, and review Word .docx files.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [word, docx, documents, office, templates, revisions, comments]
    category: productivity
    related_skills: [pdf, xlsx, powerpoint]
---

# Docx Skill

Create, read, edit, and template Microsoft Word `.docx` files with
python-docx via small CLIs. It handles text, styles, lists, tables,
images, headers/footers, `{{token}}` templating, tracked changes
(list/accept/reject), comments (list/add/delete), TOC and page-number
fields, and package health checks. It does not render documents itself
(PDF needs LibreOffice, see Converting to PDF) or edit legacy `.doc`.

## When to Use

- The user asks to generate a Word document (report, letter, contract).
- You need the text, outline, styles, or embedded images of a `.docx`.
- You must change an existing `.docx`: replace text, edit table cells,
  insert/delete paragraphs, apply styles, merge fragmented runs.
- You have a `.docx` template with `{{placeholders}}` to fill from data.
- The document has tracked changes to review, accept, or reject.
- You need to read reviewers' comments, or add/delete comments.
- A `.docx` won't open or behaves oddly and you need corruption triage.
- The document needs a table of contents or "Page X of Y" footers.
- Not for: `.doc` (legacy), `.odt`, or WYSIWYG layout work.

## Prerequisites

- Python 3.10+ with `python-docx` installed:
  `pip install python-docx` (import name is `docx`; lxml comes with it).
- Comments `add` uses the native API on python-docx >= 1.2 and an XML
  fallback on older versions, both are automatic.
- For image blocks: the image files must exist locally (PNG/JPEG).

## How to Run

All helpers live in `scripts/` next to this file. Run them with the
`terminal` tool; each supports `--help` and prints JSON to stdout.

```bash
python scripts/docx_create.py spec.json out.docx
python scripts/docx_read.py out.docx --text
python scripts/docx_edit.py replace out.docx --find old --replace new
python scripts/docx_template.py tpl.docx values.json filled.docx
python scripts/docx_revisions.py list out.docx
python scripts/docx_comments.py list out.docx
python scripts/docx_validate.py out.docx
```

## Arabic, Persian, Urdu, Hebrew (right-to-left)
`docx_create.py` marks direction automatically (`"rtl": "auto"`, the
default): every paragraph containing RTL letters gets `w:bidi` plus `w:rtl`
on its runs, and a mostly-RTL table is laid out from the right with all its
cells aligned. This is what keeps the full stop at the END of an Arabic line
and `(Python)` brackets facing the right way; without it Word and
LibreOffice treat the paragraph as left-to-right and every punctuation mark
lands on the wrong side. Force it with `"rtl": "on"`, disable with `"off"`,
or override per block (`"rtl": true|false`). The CLI flag `--rtl` wins
over the spec. Edits to an existing file can call
`docx_common.apply_rtl(doc, "auto")` before saving. Fonts are a separate
concern: set an Arabic-capable family (Cairo, Noto Naskh Arabic, Amiri) in
`styles`, in the complex-script slot too, or the text shapes in a fallback.
Always convert to PDF and look at the first page before delivering.

## House style is on by default
`docx_create.py` type-sets the document with the house design system (the
sibling `house-style` skill) and reports which one under `"theme"` in its
JSON output; the key is `null` when that skill is not installed beside
this one. The pass fills in only what the spec left unset, so an explicit
size, color or fill in the spec still wins.

Tables are ruled in both directions in a quiet grey, with a tinted header row and numbers right aligned. `{"theme": {"table_style": "rules"}}` switches to three horizontal rules and no vertical ones.

Change it or drop it with `"theme": "slate"`,
`"theme": {"name": "editorial", "accent": "1F4E79"}`, or
`"theme": false` in the spec, or `--no-theme` on the command line. The
env vars `HERMES_HOUSE_THEME` and `HERMES_HOUSE_ACCENT` set it globally.

What it changes in a `.docx`:

- Named styles on the house type scale (22 / 17 / 14 / 11 pt for
  `Heading 1` to `Heading 4` over an 11 pt body), so text added after the
  pass still lands in the system.
- Page margins, but only when the spec carries no `page` key.
- Booktabs tables: three horizontal rules and no vertical ones, instead
  of the boxed grid that reads as a spreadsheet screenshot.
- Arabic paragraphs at 1.7 leading, with italics turned into weight.

Order of passes is load-bearing: house style, then the RTL pass, then the
Arabic font pass (`arabic_style.style_docx` from the herwork skill),
which owns the complex-script slot and must run last. `docx_create.py`
already runs the first two in that order.

## Quick Reference

| Task | Command |
| --- | --- |
| Create from JSON spec | `docx_create.py spec.json out.docx` |
| Full text (body+tables+headers/footers) | `docx_read.py f.docx --text` |
| Heading outline + table shapes | `docx_read.py f.docx --structure` |
| Styles actually used | `docx_read.py f.docx --styles` |
| Extract embedded images | `docx_read.py f.docx --images outdir/` |
| Detect tracked changes/comments | `docx_read.py f.docx --revisions` |
| Find/replace (formatting kept) | `docx_edit.py replace f.docx --find A --replace B -o out.docx` |
| Set a table cell | `docx_edit.py set-cell f.docx --table 0 --row 1 --col 2 --text X` |
| Insert paragraph before index N | `docx_edit.py insert f.docx --index N --text X --style Normal` |
| Delete paragraph N | `docx_edit.py delete f.docx --index N` |
| Apply style to paragraph N | `docx_edit.py style f.docx --index N --style "Heading 1"` |
| Merge equal-format adjacent runs | `docx_edit.py normalize f.docx -o out.docx` |
| Insert TOC field before para N | `docx_edit.py toc f.docx --index N -o out.docx` |
| "Page X of Y" footer fields | `docx_edit.py page-numbers f.docx` |
| Fill `{{tokens}}` | `docx_template.py tpl.docx values.json out.docx --strict` |
| List revisions (id/author/date/text) | `docx_revisions.py list f.docx` |
| Accept / reject all revisions | `docx_revisions.py accept-all f.docx -o out.docx` (or `reject-all`) |
| Accept / reject one revision | `docx_revisions.py accept f.docx --id 3 -o out.docx` |
| List comments (+anchored text) | `docx_comments.py list f.docx` |
| Add comment anchored to text | `docx_comments.py add f.docx --target "phrase" --text "note" --author You` |
| Delete comment by id | `docx_comments.py delete f.docx --id 0` |
| Health-check the package | `docx_validate.py f.docx` (exit 1 on errors) |

## Procedure

1. **Create.** Write a JSON spec with `write_file`, then run
   `scripts/docx_create.py`. The spec supports: `page` (size + margins in
   mm), `header`/`footer` strings, `footer_page_numbers` (adds a
   "Page X of Y" field footer), `styles` (custom paragraph styles with
   font, size, bold/italic, hex `color`), and `blocks`, `heading`
   (level 1-9), `paragraph` (either `text` or a `runs` list where each run
   may set `bold`/`italic`/`underline`), `bullet_list`, `numbered_list`,
   `table` (`header` row rendered bold, `rows`, optional built-in table
   `style` such as `Table Grid`), `image` (`path`, optional `width_mm`),
   `toc` (Table of Contents field), and `page_break`. The full spec
   format is documented at the top of `scripts/docx_create.py`.
2. **Read.** Use `scripts/docx_read.py` with exactly one mode flag.
   `--text` returns body paragraphs, all table cell text, and
   header/footer text as JSON. `--structure` returns the heading outline
   plus paragraph/table/section counts. `--images DIR` copies every file
   under `word/media/` out of the package.
3. **Edit.** Use `scripts/docx_edit.py`. `replace` walks body, tables
   (nested included), headers and footers, and preserves run formatting;
   add `--body-only` to skip headers/footers. Pass `-o out.docx` to keep
   the original; omit it to edit in place. Paragraph indices for
   `insert`/`delete`/`style`/`toc` refer to `--structure`/`--text` body
   order. Run `normalize` first on documents that came out of heavy Word
   editing, it merges adjacent runs with identical formatting so later
   find-replace matches reliably.
4. **Review revisions.** `docx_revisions.py list` reports every `w:ins`
   and `w:del` (id, author, date, affected text) anywhere in body,
   tables, headers, or footers. `accept-all` / `reject-all` resolve them
   in bulk; `accept`/`reject --id N` handles a single revision. Accept
   keeps insertions and drops deleted text; reject does the reverse.
5. **Comments.** `docx_comments.py list` returns each comment's id,
   author, date, body text, and the document text it is anchored to.
   `add --target "some phrase"` anchors a new comment to the first
   occurrence of that phrase (runs are split as needed; formatting is
   preserved). `delete --id N` removes the comment and its markers
   without touching document text.
6. **Template.** Put `{{name}}`-style tokens in the document. Run
   `scripts/docx_template.py` with a JSON object of values. Use
   `--strict` to fail when tokens remain unfilled; the JSON output lists
   `filled` counts and `unfilled_tokens` either way.
7. **Verify** (always): re-read the output with `--text` or
   `--structure`, and run `docx_validate.py` on anything you produced
   via revision/comment surgery.

## Converting to PDF

No script needed. When LibreOffice is installed, convert headlessly:

```bash
soffice --headless --convert-to pdf --outdir outdir/ file.docx
```

Check availability first (`command -v soffice || command -v
libreoffice`). If neither exists, tell the user PDF conversion is
unavailable in this environment rather than improvising, python-docx
cannot render PDFs, and layout fidelity requires a real renderer.

## Charts, pictures and shapes

`scripts/docx_graphics.py` puts real graphics in a Word file, and
`docx_create.py` reaches it through three block types, so a spec asks for
data and not for a look:

```jsonc
{"type": "chart", "chart": "column", "title": "Revenue by quarter",
 "categories": ["Q1", "Q2", "Q3"], "series": {"Revenue": [120, 140, 188]},
 "width_mm": 150, "height_mm": 80}
{"type": "image", "path": "site.png", "width_mm": 90,
 "caption": "The site at dawn", "alt": "A low building at dawn"}
{"type": "callout", "style": "rules", "kicker": "the risk",
 "text": "One customer is 22 percent of the book."}
```

The chart is a genuine `word/charts/chart1.xml` part with its own
embedded workbook, not a picture of a chart: the reader can click it in
Word, see the numbers and change them. Colors, type sizes and the
no-gridlines treatment come from the house theme, and `bar`, `column`,
`line` and `pie` are the kinds.

### An aside is a paragraph, not a box

A rounded rectangle with a fill and a thin border around it is the most
recognisable shape in a generated document, so the callout block sets an
aside the way a typeset report does, with paragraph properties that flow
with the text around them:

| `style` | What it is |
| --- | --- |
| `rules` (default) | with a label, a hairline above it and none below; without one, an extract band between two half point rules |
| `quote` | 1.6 times the body, tight leading, the measure taken off the end of the line, no rule and no fill |
| `edge` | a rule on the leading edge with a real indent and no fill behind it |
| `lead` | a bold lead in phrase and then the sentence, no decoration at all |
| `block` | a flat tint with real padding, square corners, no outline |

The numbers come from reading how published reports actually do it: the
IMF and Bank of England box is a pale tint with no outline at all, the
GOV.UK inset is a leading edge rule with no fill, Tufte sets an aside at
80 percent of body, and Butterick puts a hairline at half a point to one
point. Word paints a paragraph fill tight against the glyphs with no
padding anywhere, which is the mechanical reason a tinted block reads as
generated, so the tint is padded by a border in its own colour: invisible,
and its `w:space` is the only padding a paragraph can carry.

All of them mirror in Arabic, and two details make that work. The small
caps treatment is dropped, because Arabic has no upper case and tracking
breaks the joins between its letters. And the rule side is chosen by the
generator, because `w:pBdr` has no logical start child: a left rule sits
on the trailing edge of an Arabic line, which looks like a mistake. The
indents are logical and need no branch, since `w:ind w:left` is the start
side under `w:bidi`.

`{"type": "shape", ...}` still exists for the rare case that genuinely
needs a floating box. Its default is now a flat tint with square corners
and no outline; an outline is opt in with `"line"`.

Append graphics to a document that already exists with
`docx_graphics.py blocks.json out.docx --into existing.docx`.

Captions are their own block, `{"type": "caption", "text": "...",
"kind": "figure"}`, numbered per kind through the document, and they use
the Arabic words when the caption is Arabic.

## Two scripts in one document

A paragraph has one base direction, its runs do not, and conflating the
two is what puts a full stop at the start of an Arabic line and reverses
a Latin brand name inside an Arabic sentence.

- An Arabic paragraph gets `w:bidi`, and each run is marked by its own
  script: the Arabic runs `w:rtl`, a Latin name or a version number not.
- An English paragraph that quotes Arabic keeps its left to right base
  and only the Arabic run is marked.
- A run of digits or punctuation has no script of its own, so it follows
  the paragraph.

`docx_create.py` does this as it builds. For a file somebody else wrote,
repair it without restyling anything:

```bash
python scripts/docx_edit.py direction theirs.docx -o fixed.docx
python scripts/docx_edit.py direction theirs.docx --mode on -o all-rtl.docx
```

The pass changes direction only: no text, no font, no spacing, and
running it twice produces the same bytes as running it once.

## Embedding the faces, so Arabic survives the trip

A .docx names a font family and the reader's machine resolves it. An
Arabic report opened where the face is not installed renders in a
substitute, or as empty boxes.

```bash
python scripts/docx_embed_fonts.py report report.docx     # what it uses
python scripts/docx_embed_fonts.py embed report.docx      # write the faces in
python scripts/docx_embed_fonts.py verify report.docx     # the parts agree
```

Word stores an embedded face obfuscated, as `word/fonts/fontN.odttf`,
keyed by the `w:fontKey` GUID in `word/fontTable.xml`: the sixteen bytes
of the GUID are XORed over the first thirty two bytes of the font file.
The script writes that, plus the relationship in
`word/_rels/fontTable.xml.rels` (an `r:id` resolves against the part it
appears in, not against the document), the content type and the
`w:embedTrueTypeFonts` flag in settings. Embedding twice adds zero bytes
and keeps the existing key, because a fresh GUID would leave the stored
bytes obfuscated for the old one.

Two things to know before using it. The licence gate is the same as the
deck path: a face whose licence file cannot be found is refused, and
`--allow-unlicensed` is the explicit override. And the size is real, an
Arabic report went from 45 KB to about 1 MB with every family embedded,
so `--family` is the lever when a file has to travel by mail rather than
by link.

## Comments, as a conversation

`scripts/docx_comments.py` reads and writes the whole review thread, not
just single comments:

```bash
python scripts/docx_comments.py list draft.docx --json threads
python scripts/docx_comments.py add draft.docx --target "price move" \
    --text "Which month?" --author Reviewer -o out.docx
python scripts/docx_comments.py reply draft.docx --id 3 \
    --text "July" --author Hermes -o out.docx
python scripts/docx_comments.py resolve draft.docx --id 3 -o out.docx
```

A reply carries the `w15:commentEx` parent that makes Word draw it inside
the thread rather than as a second loose comment, and resolving a thread
resolves its replies with it. `delete-thread` removes a whole thread and
its anchors; `delete` takes one comment.

## Pitfalls

- **Tokens split across runs.** Word often fragments text into several
  runs. The replace helpers collapse matched runs (replacement inherits
  the first run's formatting); running `docx_edit.py normalize` first
  reduces fragmentation for all later edits.
- **Revision coverage.** `docx_revisions.py` resolves run-level
  insertions and deletions (the overwhelming majority). Paragraph-mark
  and table-row revisions, format-change records, and moves are detected
  by `--revisions` but not auto-resolved, see
  `references/revisions-and-comments.md` and hand those to Word.
- **Comment threading.** Replies and "resolved" status live in
  `commentsExtended.xml`, which this skill ignores; comments it adds are
  plain top-level comments.
- **Field results are computed by Word.** `toc`, `page-numbers`, and the
  `toc`/`footer_page_numbers` spec options write *field codes*.
  Word/LibreOffice populates the actual entries and numbers when the
  file is opened (Word may prompt to update fields); python-docx never
  computes them, so placeholder text shows until then.
- **Validation is a health check, not schema validation.**
  `docx_validate.py` verifies the zip, required parts, relationship
  targets, image magic bytes, and referenced styles. It is NOT XSD
  validation, a file can pass and still contain XML Word dislikes.
- **Style names must exist.** Applying a style that isn't defined in the
  document raises `KeyError`. Built-ins like `Heading 1`, `List Bullet`,
  `List Number`, `Table Grid` exist in the default template; custom
  styles must be declared in the create spec first.
- **Numbered lists restart.** `List Number` relies on Word's default
  numbering; separate lists in one document may continue numbering
  instead of restarting. Warn users needing precise multi-list numbering.
- **Cell writes replace formatting.** `set-cell` uses `cell.text = ...`,
  which resets runs in that cell to plain formatting.
- **Encoding.** All JSON specs/values files are read as UTF-8 explicitly;
  never rely on locale defaults when writing your own glue code.
- **Don't unzip-and-sed the XML.** Edit through the scripts (or
  python-docx); raw text substitution in `document.xml` corrupts files
  easily. Use `patch`/`write_file` only for the JSON inputs, never on the
  `.docx` itself.

## Verification

- Before delivering, lint the file:
  `python scripts/../../house-style/scripts/style_lint.py out.docx`.
  A long dash is an error, not a warning.
- After create/edit/template, run `docx_read.py out.docx --text` and
  check the expected strings appear (and old strings are gone).
- After accept/reject, `docx_revisions.py list` should return `[]` (or
  only the ids you intentionally left); after comment surgery,
  `docx_comments.py list` should reflect the change and `--text` output
  must be unchanged.
- `docx_validate.py out.docx` exits 0 with `"ok": true` on a healthy
  package, run it after any revision/comment/field manipulation.
- For templates run with `--strict`, or check `unfilled_tokens == []`.
- Structure checks: `--structure` should show the expected heading
  outline and table shapes; `--styles` confirms custom styles applied.
