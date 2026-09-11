---
name: powerpoint
description: Create, read, edit .pptx decks with python-pptx.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [pptx, powerpoint, presentations, slides, office, python-pptx]
    category: productivity
    related_skills: [docx, xlsx, pdf]
---

# Powerpoint Skill

Create, inspect, and edit PowerPoint (.pptx) presentations using the
python-pptx library. The helper scripts cover deck creation from a JSON
spec, structured read-back, in-place edits, template-driven brand decks,
and slide rendering, all offline, with no PowerPoint installation
required. A second, optional deck path builds art-directed decks with
PptxGenJS under Node.

## When to Use

- The user asks to build a slide deck, report presentation, or pitch deck.
- You need to extract text, notes, tables, chart data, or images from a
  .pptx someone shared.
- You need to update an existing deck: replace text, refresh or patch
  chart data, swap a logo, duplicate/remove/reorder slides, set
  backgrounds, footers, hyperlinks, or speaker notes.
- You must produce an on-brand deck from a company .pptx template.
- Do NOT use this for .ppt (legacy binary) files, convert them first with
  `soffice --convert-to pptx old.ppt` if LibreOffice is available.

## Prerequisites

- Python 3.10+ with `python-pptx` installed
  (`pip install python-pptx`).
- Optional: LibreOffice (`soffice`) plus poppler (`pdftoppm` or
  `pdftocairo`) for rendering slides to PNGs and for PDF export.
  `pptx_render.py` detects both with `shutil.which` and degrades
  gracefully (reports `{"rendered": false, "missing": [...]}`, exit 0)
  when absent, all create/read/edit operations work without them.
- Optional, for the design path only: Node plus PptxGenJS, installed in
  the task workspace with `npm install pptxgenjs`. It is not installed by
  default, and the python path is the default one.
- Check availability via `terminal`:
  `python -c "import pptx; print(pptx.__version__)"` and `which soffice pdftoppm`.

## How to Run

All scripts live in `scripts/`, take `--help`, print JSON to stdout, and
exit non-zero on failure. Run them with `terminal`:

```bash
python scripts/pptx_create.py deck.json out.pptx
python scripts/pptx_read.py deck.pptx --outline      # full JSON outline
python scripts/pptx_read.py deck.pptx --notes        # speaker notes
python scripts/pptx_read.py deck.pptx --images ./img # export pictures
python scripts/pptx_edit.py deck.pptx --replace-text "Old Corp" "New Corp"
python scripts/pptx_edit.py deck.pptx --chart-data update.json
python scripts/pptx_edit.py deck.pptx --duplicate-slide 2
python scripts/pptx_edit.py deck.pptx --remove-slide 3 --move-slide 2 0
python scripts/pptx_from_template.py brand.pptx out.pptx --values vals.json
python scripts/pptx_render.py deck.pptx --outdir ./render  # slide PNGs
node scripts/pptx_design.js design.json out.pptx     # PptxGenJS design path
```

Author JSON specs with `write_file`; inspect script output and generated
JSON with `read_file`.

## Quick Reference

| Task | Command |
|---|---|
| New deck from spec | `pptx_create.py spec.json out.pptx` |
| 16:9 vs 4:3 | `"slide_size": "16:9"` or `"4:3"` in the spec |
| Outline as JSON | `pptx_read.py deck.pptx --outline` |
| Export images | `pptx_read.py deck.pptx --images DIR` |
| Replace text | `pptx_edit.py deck.pptx --replace-text OLD NEW` |
| Replace chart data | `pptx_edit.py deck.pptx --chart-data spec.json` |
| Patch one series | same flag, spec with `"ops"` (see below) |
| Swap picture | `pptx_edit.py deck.pptx --swap-image N NAME new.png` |
| Duplicate slide | `pptx_edit.py deck.pptx --duplicate-slide N` |
| Remove slide | `pptx_edit.py deck.pptx --remove-slide N` |
| Reorder slide | `pptx_edit.py deck.pptx --move-slide FROM TO` |
| Slide background | `pptx_edit.py deck.pptx --set-background N RRGGBB` |
| Hyperlink runs | `pptx_edit.py deck.pptx --hyperlink N TEXT URL` |
| Slide number on | `pptx_edit.py deck.pptx --enable-slide-number N` |
| Footer text | `pptx_edit.py deck.pptx --set-footer N TEXT` |
| Set notes | `pptx_edit.py deck.pptx --set-notes N TEXT` |
| Append notes | `pptx_edit.py deck.pptx --append-notes N TEXT` |
| Fill template | `pptx_from_template.py tpl.pptx out.pptx --values v.json` |
| Render slide PNGs | `pptx_render.py deck.pptx --outdir DIR` |
| Art-directed deck (Node) | `node scripts/pptx_design.js design.json out.pptx` |

## Procedure

### 1. Create a deck

Write a JSON spec (see `pptx_create.py --help` for the full format), then
run `pptx_create.py`. Per slide you can set: `layout` (title,
title_content, section, two_content, title_only, blank), `title`,
`subtitle`, `bullets` (strings, or dicts with `level` 0-4, `size` pt,
`bold`, `italic`, `font`, `color` hex, `link` URL for a hyperlink),
`background` (solid hex), `footer` (text; enables the layout's footer
placeholder), `slide_number` (true; enables the layout's slide-number
placeholder), `images` (path + left/top/width/height in inches), `tables`
(`rows` as list-of-lists), `shapes` (rectangle, rounded_rectangle, oval,
diamond, right_arrow, chevron, with `fill` hex + optional `text`),
`charts` (bar, bar_h, line, pie with `categories` + `series`), and
`notes` (speaker notes).

### 2. Read a deck

`pptx_read.py deck.pptx --outline` returns slide size, layout inventory,
and per slide: layout name, all shape texts, table cells, image inventory
(filename/ext/bytes), chart categories/series/values, and speaker notes.
Use `--images DIR` to dump embedded pictures to files, then
`vision_analyze` on any exported image if you need to see its content.

### 3. Edit a deck

`pptx_edit.py` combines operations in one pass; use `--output` to keep the
original. Text replacement scans slide shapes, table cells, and notes.
Image swap retargets the picture's relationship id so position and size
are preserved. Slide removal drops the relationship and the `<p:sldId>`
entry; reorder moves the `<p:sldId>` element within `<p:sldIdLst>`
(python-pptx has no public API for either, the script does the XML-level
work). `--duplicate-slide N` appends an independent deep copy of slide N:
shape XML plus image/media/hyperlink relationships are cloned and rIds
remapped, so editing the copy never touches the original. Chart slides
are refused (see Pitfalls). `--set-notes`/`--append-notes` edit speaker
notes; `--set-background`, `--hyperlink`, `--enable-slide-number`, and
`--set-footer` handle deck polish.

Chart updates take a JSON spec via `--chart-data`. Full replace:
`{"slide": 0, "chart": 0, "categories": [...], "series": {...}}`. For
surgical edits, pass `"ops"` instead, a list of
`{"op": "update_series", "name": ..., "values": [...]}`,
`add_series`, `remove_series`, `rename_category` (`from`/`to` or
`index`), and `set_title`. python-pptx can only swap a chart's entire
dataset (`replace_data`), so ops are implemented as read-existing →
modify → replace; the per-part UX is a wrapper, and any chart data not
expressible as categories + numeric series will be normalized by the
round-trip.

### 4. Build from a template

`pptx_from_template.py` opens a brand .pptx, replaces every
`{{token}}` from a values JSON across slides/tables/notes, and can append
new slides that use the template's own layouts (by layout name or index)
so they inherit the master's fonts and colors. Tip: to start from a
template with zero slides, delete existing ones afterward with
`pptx_edit.py --remove-slide`.

### 5. Visual verification

`pptx_render.py deck.pptx --outdir ./render` converts the deck to PDF
with `soffice --headless` and splits it into one PNG per slide with
`pdftoppm` (or `pdftocairo`). Output JSON lists the PNG paths, review
each with `vision_analyze`. When either tool is missing the script exits
0 with `{"rendered": false, "missing": [...]}` and guidance; fall back to
the JSON outline from `pptx_read.py`, which verifies content and
structure, just not visuals.

### 6. The design path (optional)

`scripts/pptx_design.js` is an alternative deck builder on PptxGenJS. It
has a small fixed slide grammar, `cover`, `cards`, `data` and `split`,
which is the point: it produces one coherent visual system and refuses
the text-dump pattern. It needs `npm install pptxgenjs` in the task
workspace and exits 2 with an install hint when the module is absent.
Reach for it when the deck is a designed artefact rather than a content
document; `pptx_create.py` remains the default, and a supplied company
template still goes through `pptx_from_template.py`.

## Converting to PDF

If LibreOffice is installed, export the finished deck to PDF directly:

```bash
soffice --headless --convert-to pdf --outdir ./out deck.pptx
```

The output lands at `./out/deck.pdf`. Fonts not installed on the host are
substituted, so render-verify (Procedure step 5) before shipping the PDF.
There is no offline pure-Python .pptx→PDF path; if `soffice` is absent,
say so rather than approximating.

## Arabic, Persian, Urdu, Hebrew (right-to-left)
`pptx_create.py` sets slide direction automatically (`"rtl": "auto"`, the
default): every paragraph containing RTL letters gets `a:pPr@rtl="1"` and is
right-aligned, table cells included. Without it python-pptx leaves the base
direction left-to-right, so an Arabic slide shows its punctuation on the wrong
side and its bullets and text hugging the left edge. Force it with
`"rtl": "on"`, disable with `"off"`; the CLI flag `--rtl` wins over the spec.
An edit script can call `pptx_common.apply_rtl(prs, "auto")` before saving.
Set an Arabic-capable font (Cairo, Noto Naskh Arabic, Amiri) on the runs, or
the glyphs come out of a fallback face.

## The deck is planned before it is built

`pptx_create.py` no longer builds exactly one slide per entry in the
spec. Each entry is planned first, and the plan does three things:

**It can choose the layout.** `"layout": "auto"` reads the content: stats
become a stat slide, steps a timeline, two columns a comparison, a short
quote with an attribution a quote, a sentence a statement, and a few
short parallel bullets a grid of cards rather than a list. A bullet list
is the last resort, not the default, because a deck that is a title over
a bullet list on every slide is the clearest tell there is.

**It refuses to build a layout the content cannot fill.** A statement of
twenty nine words is a paragraph, so it becomes a content slide. Three
options are cards, not a comparison. A timeline of two steps is a pair of
cards. The content is carried across when the layout changes, so a
degraded slide never arrives empty.

**It splits what does not fit.** Six cards become two slides of three, a
long bullet list becomes as many slides as it needs, and a continuation
slide repeats the title with `(continued)`, or `(تتمة)` in Arabic. A
chart or a table stays on the first page rather than being repeated
behind every continuation. Two budgets decide the split, not one: the
measured height of the text in its box, and the house reading limits of
five bullets and eighty five words a slide.

Every choice, degradation and split is reported under `plan` in the
output JSON. A deck that fits carries no `plan` key at all, because
nothing was changed.

## Two scripts on one slide

A paragraph has one base direction, its runs do not, and the deck format
makes that trap sharper than Word does. In WordprocessingML `w:rtl` is an
element whose absence means false. In DrawingML `rtl` is an attribute
whose absence means **inherit**, so a Latin run inside an Arabic
paragraph picks up the paragraph's own direction unless it is explicitly
told otherwise.

So the direction pass writes all three cases down: an Arabic run gets
`rtl="1"`, a Latin run `rtl="0"`, and a run of digits or punctuation
takes the paragraph's value because it has no script of its own. A slide
that is mostly Latin but quotes Arabic keeps its base direction and only
the Arabic runs are marked, so a centred title keeps the alignment it
inherited.

Table cells, grouped shapes at any depth and speaker notes are all
covered, and the pass never materialises a notes part it did not find.
Running it twice leaves the slide XML byte identical.

## Embedding the faces, so Arabic survives the trip

A .pptx carries a font NAME and the reader's machine resolves it. For
Arabic that is not polish: open the deck on a machine without the face
and the text renders in whatever gets substituted, or as empty boxes.

```bash
python scripts/pptx_embed_fonts.py report deck.pptx     # what it uses, what it would embed
python scripts/pptx_embed_fonts.py embed deck.pptx      # write the faces into the package
python scripts/pptx_embed_fonts.py verify deck.pptx     # parts, overrides and rels agree
```

It walks the slides, layouts, masters and theme for the families actually
used (resolving the theme tokens, so `+mn-lt` does not come back as a
family name), finds each face on this machine, and writes the
`ppt/fonts/fontN.fntdata` parts with their content types, relationships
and `p:embeddedFontLst` entries. Embedding is idempotent to the byte.

**There is a licence gate, and it is the point.** Embedding ships the
font bytes inside every deliverable, so a face whose licence file cannot
be found is refused, and `--allow-unlicensed` is the explicit override.
The OFL permits this use in as many words, "bundled, redistributed and/or
sold with any software", but a font binary cannot vouch for itself, so
the gate wants the licence file beside the face.

## House style is on by default
`pptx_create.py` lays the deck out on the house design system and reports
which one under `"theme"` in its JSON output; the key is `null` when the
sibling `house-style` skill is not installed beside this one. The pass
fills in only what the spec left unset, so an explicit size, color or
fill in the spec still wins.

Tables are ruled in both directions in a quiet grey, with a tinted header row and numbers right aligned. `{"theme": {"table_style": "rules"}}` switches to three horizontal rules and no vertical ones.

Change it or drop it with `"theme": "slate"`,
`"theme": {"name": "editorial", "accent": "1F4E79"}`, or
`"theme": false` in the spec, or `--no-theme` on the command line. The
env vars `HERMES_HOUSE_THEME` and `HERMES_HOUSE_ACCENT` set it globally.

What it changes in a deck:

- Placeholders re-laid-out on the house grid. The stock python-pptx
  template is 4:3, so on a 16:9 canvas the title and the body otherwise
  sit in a narrow centred column with air down both sides.
- Type from the deck scale: 42 pt titles, 56 pt on a cover, an 18 pt body
  floor for anything projected.
- The body column capped at 7.5 in so the measure stays readable, and
  stopped short of any shape the spec placed itself.
- An Arabic body column flush with the right margin, rather than
  right-aligned inside a left-hand box.
- Tables styled to the house rules, and charts stripped of gridlines and
  of the legend for a single series, with the numbers on the bars.

Order of passes is load-bearing: house style, then the RTL pass, then the
Arabic font pass (`arabic_style.style_pptx` from the herwork skill),
which owns the complex-script slot and must run last. `pptx_create.py`
already runs the first two in that order.

**Never type a bullet character into bullet text.** The placeholder draws its
own, so `"• Overview"` renders as `"• • Overview"`. `pptx_create.py` strips a
leading bullet glyph as a safety net, but the spec should not carry one.

## Comments on a deck

`scripts/pptx_comments.py` handles both comment systems PowerPoint has:
the legacy per slide comments and the modern threaded ones that current
PowerPoint and the web app write. It reads both and writes the modern
kind.

```bash
python scripts/pptx_comments.py list deck.pptx
python scripts/pptx_comments.py add deck.pptx --slide 3 \
    --text "Is this the closing figure?" --author Reviewer
python scripts/pptx_comments.py reply deck.pptx --id "{GUID}" \
    --text "Yes, from the Q3 close." --author Hermes
python scripts/pptx_comments.py resolve deck.pptx --id "{GUID}"
```

Each comment reports its slide, author, time, text, the shape it is
anchored to, its thread parent and whether the thread is resolved.
`reopen` clears the resolved mark, `delete` takes the thread and its
replies together.

## Pitfalls

- **Run splitting**: PowerPoint fragments paragraph text into runs at
  spell-check and edit boundaries. `--replace-text` first merges adjacent
  runs whose formatting is identical, so matches split across such runs
  are replaced with formatting fully preserved. Only when a match spans
  *genuinely differently-formatted* runs is the paragraph rewritten with
  the first run's formatting, verify those slides after replacement.
- **Chart slides cannot be duplicated**: each chart relationship embeds a
  separate XLSX workbook part; cloning that graph reliably is not
  supported, so `--duplicate-slide` refuses chart slides cleanly instead
  of corrupting the deck. Rebuild the chart on a new slide instead.
  External-hyperlink and image/media rels are carried over; layout and
  notes rels are recreated fresh.
- **Chart ops are a wrapper**: python-pptx replaces the whole dataset;
  `"ops"` round-trips existing plot data through `replace_data`, and
  changing chart *type* is not possible.
- **Reordering is XML-level**: python-pptx has no supported reorder API.
  `--move-slide` manipulates `<p:sldIdLst>` directly; safe for ordinary
  decks but re-read the deck afterward to confirm.
- **Copying slides between decks is unsupported**, duplication works
  only within one deck, where layouts and masters are shared.
- Footer/slide-number enablement copies the placeholder from the slide's
  layout; on layouts without those placeholders, `--set-footer` fails
  with a clear message (add a textbox instead).
- Hyperlinks apply to whole runs; `--hyperlink` links every run
  containing the given text on that slide.
- The default python-pptx template is 4:3; the create script sets 16:9
  unless the spec says otherwise. Custom templates keep their own size.
- Layout indexes vary by template. For brand templates, list layout names
  first: `pptx_read.py template.pptx --outline` (`layouts_available`).
- `slide.shapes.title` is None on blank layouts, the create script
  handles this, but remember it when writing ad-hoc python-pptx code.
- Always pass `encoding="utf-8"` when writing spec files; tokens like
  `{{city}}` may be filled with non-ASCII values.

## Verification

1. After any create/edit, run `pptx_read.py OUT.pptx --outline` and check
   slide count, texts, tables, notes, and chart values match intent.
2. `--images DIR` then file-size check confirms pictures embedded.
3. Render every slide with `pptx_render.py deck.pptx --outdir ./render`
   and review each PNG with `vision_analyze`, this catches overlapping
   shapes, truncated text, and color problems the outline cannot. If the
   render tools are missing, the script says so; rely on the outline.
4. Before delivering, lint the file:
   `python scripts/../../house-style/scripts/style_lint.py out.pptx`.
   A long dash is an error, not a warning.
5. The bundled test suite is the full contract:
   `python -m pytest tests/ -q` (requires python-pptx + pytest).
