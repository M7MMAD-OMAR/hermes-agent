---
name: herwork
description: Deliver finished office files, with research and diagrams.
version: 1.1.0
author: community
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    # Ordered by how well each term DISCRIMINATES: the index keeps the first
    # three that the description does not already say, so the words a user
    # actually types for this job come first and "productivity", which
    # matches everything, comes last.
    tags: [report, deck, spreadsheet, invoice, letter, resume, herwork, workspace, productivity]
    category: productivity
    related_skills: [docx, powerpoint, xlsx, pdf, house-style, humanizer, excalidraw, grounded-citations, obsidian]
---

# HerWork Mode

A full work environment for Hermes: you act as a colleague with a shared
desk. The user hands you work, a report to write, a deck to build, a
spreadsheet to fill, research to run, a folder to organize, and you deliver
finished files plus a short summary of what you did.

This skill is the orchestration layer. It does not replace the document
skills (`docx`, `powerpoint`, `xlsx`, `pdf`); it tells you which one to
load for each task and where files live.

## When to Use

- The user asks for a complete piece of work, not a code change: a Word
  report, a slide deck, a filled spreadsheet, a formatted PDF.
- The task mixes formats: research on the web, then write it up; read a
  folder of files, then summarize into a document.
- The user drops files for you to process (convert, merge, reformat,
  extract data from).
- The user says "herwork", "herwork mode", or invokes `/herwork`.
- Not for: editing this repository's own source code, or one-off answers
  that need no files.

## The shared desk (workspace layout)

All HerWork work happens under `~/herwork/`:

```
~/herwork/
  inbox/    user drops source files here; treat as read-only
  work/     your scratch space; intermediate drafts and extracted data
  output/   finished deliverables; one subfolder per task if several files
```

Create the three directories at the start of a herwork session if they are
missing. Check `inbox/` when the user's request references "the files I
gave you" without attaching paths.

## Show the plan

Any job with more than one artifact starts with a `todo` list before the work.
The user watches it to know what is in flight; a transcript they have to
re-read is not progress reporting.

## Research is first-class

Open the internal browser and read real sources rather than answering from
memory. Say what you verified and what you assumed; an unverified claim inside
a finished deliverable is a liability. Load `grounded-citations` when the
deliverable asserts researched facts.

The desk's browser does four things a page needs:

- `drive_preview action="elements"` then `click` / `type` to work the page.
- `drive_preview action="look"` **photographs the page and you see it.** Use it
  when the layout is the information: a dashboard, a chart, a rendered
  document, a table whose structure matters. An element inventory cannot tell
  you what a graph says.
- `drive_preview action="upload"` puts a file from the desk into the page's
  file input, exactly as the picker would.
- **Anything you download lands in `work/` by itself** and opens in the rail.
  You do not need to save it anywhere.

**Logins are the user's, never yours.** When a page asks to sign in, stop, say
which page and which account it wants, and ask the user to log in themselves.
Never type a password, and never accept terms on their behalf. The session
persists after they do, so you only ever ask once.

## How it has to read

A file nobody can tell was written by a machine is the job, not a bonus.
Before you write a word of the deliverable, read
`references/writing-and-translation.md` in the `house-style` skill. It is
short, and it carries the rules that a reader notices first.

The three that are broken most often:

- **No em dash and no en dash.** In any language, in any deliverable, in
  any file this desk produces. Use a comma, a colon, or two sentences.
  The lint treats this as an error, not a warning.
- **Say what is done, not what is intended.** "aims to", "is committed
  to", "seeks to" and their Arabic equivalents convert something a reader
  can check into something nobody can argue with. Cut them.
- **Translation is rewriting, not substitution.** Translate the meaning
  for the reader in front of you: re-cut the sentences, take the register
  the target language actually uses, and never carry an English image
  into Arabic word for word. A target text that keeps the source's
  sentence boundaries reads as foreign even when every word is right.
  Fix the terminology in a glossary before you start, and back-translate
  only the ten highest-stakes sentences as a check.

Two tests to run over your own draft, per card, caption and list item:
swap the subject for a competitor (still true? delete it), then cover the
description and read the label (the description adds nothing? delete the
field, do not reword it).

## Draw it, do not describe it

A flow, an architecture, a comparison, a timeline: draw it.

| Where it goes | Use |
| --- | --- |
| Inline in the chat | a ```mermaid fenced block, the desktop renders it |
| A file inside a document or a slide | `diagrams` skill (Mermaid to PNG/SVG) |
| Hand-drawn-style boards | `excalidraw` skill |
| An illustration | the native `image_generate` tool |

The `diagrams` skill picks an Arabic face automatically, which the default
Mermaid stack does not have; an Arabic diagram rendered without it is a row of
empty boxes.

## Workflow

1. **Intake.** Restate the deliverable in one sentence: what file(s),
   what format, who it's for. If the request names source material, read
   it first (inbox files, attached paths, or URLs via the browser tools).
2. **Plan.** Post the `todo` list (see *Show the plan* above) so the user
   can watch the artifacts arrive.
3. **Produce into `work/`.** Every draft and intermediate stays in `work/`.
   Nothing enters `output/` until step 5 promotes it, so `output/` only ever
   holds finished work. Name for the reader (`q3-sales-report.docx`, not
   `draft2-final.docx`).
4. **Verify before delivering.** Re-open what you produced: read the
   `.docx` back, count the slides, recompute the sheet's totals, or open
   the PDF's first page. A file you haven't re-read is not done.

   **Look at it, not only at its bytes.** `open_preview` the file: the rail
   draws a Word document as a document, a workbook as a grid with its sheet
   tabs, and a deck slide by slide. A doubled bullet, a table reading the
   wrong way, a column of blanks where formulas should be: all of these pass
   a text read and fail a glance.

   **Then run the lint, every time:**

   ```bash
   python <skills>/productivity/house-style/scripts/style_lint.py output.docx
   ```

   It exits non-zero on a long dash or a slide past the word ceiling, and
   warns about stock Office faces, type-size soup, a spreadsheet still
   wearing its grey grid, and prose that hedges instead of saying. Fix
   what it finds in the source spec and rebuild; do not hand-edit the
   output file.

   For a deck, also render it and look: `pptx_render.py deck.pptx
   --outdir render` writes one PNG per slide. Text that overflows its box
   is the commonest defect in generated output and it passes every text
   check there is.
5. **Deliver.** Move, do not copy, the finished file from `work/` to
   `output/`, and add a row to `output/MANIFEST.md`:

   ```
   | file | what it is | from draft | verified by | superseded by |
   ```

   Superseded drafts go to `work/archive/`. Without the manifest, `output/`
   is a folder of indistinguishable files and nobody can tell a shipped
   client deliverable from a smoke test.

   Write a **PDF sibling** next to every Office file
   (`soffice --headless --convert-to pdf <file>`). Not for viewing: the rail
   opens Word, spreadsheets and decks natively now. The PDF is the copy that
   travels, to someone who has no Office and no Hermes.

   End with the output paths and two or three sentences on what's inside.
   Offer the obvious next iteration (shorter, different tone, Arabic
   version, ...).

## Routing: which tool for which job

| Job | Use |
| --- | --- |
| Word documents (reports, letters, contracts) | `docx` skill |
| Slide decks | `powerpoint` skill |
| Spreadsheets, data tables, budgets | `xlsx` skill |
| Reading or producing PDFs | `pdf` skill |
| Scanned documents, images of text | `pdf` skill, `references/ocr-extraction.md` |
| Any Arabic or RTL deliverable | `scripts/arabic_style.py` here, after the create script |
| Diagrams as a file (flow, sequence, architecture) | `diagrams` skill |
| Hand-drawn-style diagrams and boards | `excalidraw` skill |
| A diagram inside the chat, not a file | a ```mermaid fenced block |
| An illustration or generated picture | native `image_generate` tool |
| Anything asserting researched facts | `grounded-citations` skill |
| Type, color and layout of any deliverable | `house-style` skill (applied by default) |
| Prose that reads as machine-written | `house-style` lint, then the `humanizer` skill |
| Web research, reading pages, filling web forms | the desk browser: `desktop_preview` + `drive_preview` |
| A second, headless browser for bulk fetching | native `browser_*` tools |
| GUI apps with no API (desktop clicks) | `computer-use` skill |
| Notes and knowledge bases | `obsidian` skill |
| Convert docx/pptx/xlsx → PDF | `soffice --headless --convert-to pdf <file>` (needs LibreOffice) |
| Convert markdown ↔ docx/html | `pandoc` (needs pandoc) |
| OCR scanned images (Arabic + English) | `tesseract <img> <out> -l ara+eng` (needs tesseract + lang packs) |
| Plain files: move, rename, organize, convert text | native file/terminal tools |

The three converters are optional enhancers: if one is missing and the
task needs it, follow the safety rules below (say what you'd install and
wait for approval).

Load the document skill for the format you're about to produce before
producing it. Each one has scripts and conventions that prevent broken
files (e.g. the docx tracked-changes and templating CLIs).

## Type, color and layout

You do not choose them per job. The `house-style` skill carries one type
scale, one neutral palette, one spacing grid and one set of table and
chart rules, and the four create scripts apply it by default: the JSON
they print back names the theme under `"theme"`. Read that skill when a
user asks for their own brand color (`"theme": {"accent": "1F4E79"}`),
when they want a different look (`"theme": "slate"` or `"mono"`), or when
you want to know why a number is what it is.

Three passes, in this order, and the order is load-bearing:

1. the create script builds the file and applies the house system,
2. the same script runs the RTL pass,
3. you run `arabic_style.style_docx` / `style_pptx` last.

The house pass sets sizes, colors, spacing and the Latin face. The Arabic
pass owns the complex-script slot. Run them the other way round and the
Arabic text quietly returns to a fallback face.

## Arabic typography

Any deliverable that contains Arabic MUST use the **Cairo** font. The
office-suite default (Calibri) renders Arabic badly. Use the helper at
`scripts/arabic_style.py` in this skill's directory:

- docx: `style_docx(doc)` after building the Document, covers named styles
  AND every run (body, nested tables, text boxes, headers/footers), because
  a run with direct formatting overrides its style
- pptx: `style_pptx(prs)` after building the Presentation, covers tables,
  grouped shapes at any nesting depth, and speaker notes
- pdf (reportlab): `register_pdf_font()`, then draw with
  `canvas.setFont("Cairo", size)` and pass every Arabic string through
  `shape_arabic(text)`, never `arabic_reshaper` + `get_display` directly

Setting `font.name` alone is NOT enough. Arabic is shaped from the
complex-script font slot (`w:cs` in docx, `a:cs` in pptx), which these
helpers also set. Call them AFTER all content is added: they font what is
in the document at call time, and runs added later carry only their style.
Text in monospace styles (code, macros, preformatted) is deliberately left
alone. `register_pdf_font` locates the Cairo TTF across
Linux/macOS/Windows font directories and raises an install hint if Cairo
is missing (free at fonts.google.com/specimen/Cairo). Pure-English
deliverables may use the suite defaults.

Direction comes with the font. `style_docx` also runs the docx skill's
`apply_rtl`, which marks every Arabic paragraph right-to-left (`w:bidi` and
`w:rtl`) and lays out mostly-Arabic tables from the right; a document built
with `docx_create.py` gets the same pass from `"rtl": "auto"`. Without it the
full stop lands at the START of the line and «(Python)» brackets face the
wrong way, which is exactly how the desk's first reports came out.

Punctuation: no em dash and no en dash in any deliverable, Arabic or
English. Use a comma, a colon, or two sentences. The house rule exists
because the dash reads as a machine's habit, and a reader of a business
document notices.

`shape_arabic` is not optional for PDFs. reportlab draws codepoint by
codepoint with no shaper, and Cairo carries only 89 of the 144
Presentation Forms-B codepoints a reshaper emits. Isolated alef and teh
are among the missing, so a plain reshape+bidi renders «المبيعات» as
«▯لمبيعا▯» in a file that otherwise looks finished. `shape_arabic` checks
each shaped character against the registered font's own cmap and folds the
uncovered ones back to their base letter. docx and pptx are unaffected:
Word and PowerPoint shape the text themselves at open time.

## Safety rules (non-negotiable)

- **Write only inside `~/herwork/`** unless the user explicitly gives a
  target path. Never modify a user's original file in place, copy it to
  `work/` first and edit the copy.
- `inbox/` is read-only. Deliverables go to `output/`, never back into
  `inbox/`.
- No destructive operations outside the workspace. Inside it, prefer
  moving superseded drafts to `work/archive/` over deleting them.
- Browser work follows the normal website policy; never enter credentials
  or payment details into web forms.
- If a task needs software that isn't installed, say what you'd install
  and wait for approval before installing system-wide.
