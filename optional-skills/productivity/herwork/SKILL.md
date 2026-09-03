---
name: herwork
description: Use when asked for a finished office file, not code.
version: 1.1.0
author: community
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    # Ordered by how well each term DISCRIMINATES: the index keeps the first
    # three that the description does not already say, so the words a user
    # actually types for this job come first and "productivity" — which
    # matches everything — comes last.
    tags: [report, deck, spreadsheet, invoice, letter, resume, herwork, workspace, productivity]
    category: productivity
    related_skills: [docx, powerpoint, xlsx, pdf, ocr-and-documents, arabic-rtl-documents, architecture-diagram, excalidraw, grounded-citations, adversarial-doc-review, obsidian]
---

# HerWork Mode

A full work environment for Hermes: you act as a colleague with a shared
desk. The user hands you work — write a report, build a deck, fill a
spreadsheet, research on the web, organize a folder — and you deliver
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
The user watches it to know what is in flight — a transcript they have to
re-read is not progress reporting.

## Research is first-class

Open the internal browser and read real sources rather than answering from
memory. Screenshot what matters into `work/` so the evidence outlives the
conversation. Say what you verified and what you assumed; an unverified claim
inside a finished deliverable is a liability. Load `grounded-citations` when
the deliverable asserts researched facts.

## Draw it, do not describe it

A flow, an architecture, a comparison, a timeline: draw it.

| Where it goes | Use |
| --- | --- |
| Inline in the chat | a ```mermaid fenced block — the desktop renders it |
| A file in the deliverable | `architecture-diagram` or `excalidraw` skill |
| An illustration | the native `image_generate` tool |

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
5. **Deliver.** Move — do not copy — the finished file from `work/` to
   `output/`, and add a row to `output/MANIFEST.md`:

   ```
   | file | what it is | from draft | verified by | superseded by |
   ```

   Superseded drafts go to `work/archive/`. Without the manifest, `output/`
   is a folder of indistinguishable files and nobody can tell a shipped
   client deliverable from a smoke test.

   Write a **PDF sibling** next to every Office file
   (`soffice --headless --convert-to pdf <file>`): the desktop preview rail
   renders PDF but refuses docx and pptx, so without it the user cannot see
   their own deliverable without leaving the app.

   End with the output paths and two or three sentences on what's inside.
   Offer the obvious next iteration (shorter, different tone, Arabic
   version, ...).

## Routing — which tool for which job

| Job | Use |
| --- | --- |
| Word documents (reports, letters, contracts) | `docx` skill |
| Slide decks | `powerpoint` skill |
| Spreadsheets, data tables, budgets | `xlsx` skill |
| Reading or producing PDFs | `pdf` skill |
| Scanned documents, images of text | `ocr-and-documents` skill |
| Any Arabic or RTL deliverable | `arabic-rtl-documents` skill |
| System / flow diagrams as a file | `architecture-diagram` skill |
| Hand-drawn-style diagrams and boards | `excalidraw` skill |
| A diagram inside the chat, not a file | a ```mermaid fenced block |
| An illustration or generated picture | native `image_generate` tool |
| Anything asserting researched facts | `grounded-citations` skill |
| Stress-testing a document before it ships | `adversarial-doc-review` skill |
| Web research, reading pages, filling web forms | native `browser_*` tools |
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
producing it — each one has scripts and conventions that prevent broken
files (e.g. the docx tracked-changes and templating CLIs).

## Arabic typography

Any deliverable that contains Arabic MUST use the **Cairo** font — the
office-suite default (Calibri) renders Arabic badly. Use the helper at
`scripts/arabic_style.py` in this skill's directory:

- docx: `style_docx(doc)` after building the Document — covers named styles
  AND every run (body, nested tables, text boxes, headers/footers), because
  a run with direct formatting overrides its style
- pptx: `style_pptx(prs)` after building the Presentation — covers tables,
  grouped shapes at any nesting depth, and speaker notes
- pdf (reportlab): `register_pdf_font()`, then draw with
  `canvas.setFont("Cairo", size)` and pass every Arabic string through
  `shape_arabic(text)` — never `arabic_reshaper` + `get_display` directly

Setting `font.name` alone is NOT enough — Arabic is shaped from the
complex-script font slot (`w:cs` in docx, `a:cs` in pptx), which these
helpers also set. Call them AFTER all content is added — they font what is
in the document at call time, and runs added later carry only their style.
Text in monospace styles (code, macros, preformatted) is deliberately left
alone. `register_pdf_font` locates the Cairo TTF across
Linux/macOS/Windows font directories and raises an install hint if Cairo
is missing (free at fonts.google.com/specimen/Cairo). Pure-English
deliverables may use the suite defaults.

`shape_arabic` is not optional for PDFs. reportlab draws codepoint by
codepoint with no shaper, and Cairo carries only 89 of the 144
Presentation Forms-B codepoints a reshaper emits — isolated alef and teh
are among the missing, so a plain reshape+bidi renders «المبيعات» as
«▯لمبيعا▯» in a file that otherwise looks finished. `shape_arabic` checks
each shaped character against the registered font's own cmap and folds the
uncovered ones back to their base letter. docx and pptx are unaffected:
Word and PowerPoint shape the text themselves at open time.

## Safety rules (non-negotiable)

- **Write only inside `~/herwork/`** unless the user explicitly gives a
  target path. Never modify a user's original file in place — copy it to
  `work/` first and edit the copy.
- `inbox/` is read-only. Deliverables go to `output/`, never back into
  `inbox/`.
- No destructive operations outside the workspace. Inside it, prefer
  moving superseded drafts to `work/archive/` over deleting them.
- Browser work follows the normal website policy; never enter credentials
  or payment details into web forms.
- If a task needs software that isn't installed, say what you'd install
  and wait for approval before installing system-wide.
