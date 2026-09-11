---
name: house-style
description: One type, color and writing system for office files.
version: 1.0.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design-system, typography, palette, house-style, writing, translation, office]
    category: productivity
    related_skills: [docx, powerpoint, xlsx, pdf, herwork, humanizer, diagrams]
---

# House Style

Every deliverable Hermes produces, a report, a deck, a workbook, a PDF,
is set in one system: one type scale, one neutral-dominant palette, one
spacing grid, and one standard for the writing inside it.

Two things live here:

| | |
|---|---|
| `scripts/house_style.py` | the design system as code, plus one applier per format |
| `scripts/style_lint.py` | reads a finished file back and reports what gives it away |
| `references/design-system.md` | why each number is what it is, with sources |
| `references/writing-and-translation.md` | the writing standard and the translation rules |

## When to Use

- Before writing the prose that goes into any deliverable. Read
  `references/writing-and-translation.md` first; it is short and it is
  the part a reader notices.
- When a deck, report or workbook came out looking like a template and
  you need to know which rule it broke.
- When a user asks for their own brand color or a different look.
- You do **not** need to invoke it to get the house look. The four office
  create scripts apply it by default.

## It is already on

`docx_create.py`, `pptx_create.py`, `xlsx_create.py` and `pdf_create.py`
apply the system themselves. There is nothing to remember:

```bash
python ../powerpoint/scripts/pptx_create.py deck.json out.pptx
# {"ok": true, "theme": "editorial", ...}
```

The `theme` key in the output says which system was applied, or `null`
when the skill was installed without this one beside it.

Change or drop it from the spec:

```jsonc
{"theme": "slate"}                                  // a different preset
{"theme": {"name": "editorial", "accent": "1F4E79"}} // a brand hue
{"theme": false}                                     // stock Office look
```

Or set `HERMES_HOUSE_THEME` and `HERMES_HOUSE_ACCENT` once, and every
deliverable the desk produces follows.

Three presets: `editorial` (warm neutrals, a red accent), `slate` (cool
neutrals, a blue accent), `mono` (grayscale, for anything that must not
look styled at all). An accent re-tints any of them: the neutrals stay
neutral, and only the accent, its tint, its readable text shade and the
first data series are rebuilt, so the result is still a designed palette.

## The rule that decides everything else

**The appliers fill in what the author left unset, and never overwrite an
explicit choice.** A bullet whose size the spec set keeps that size. This
is what makes the pass safe to run by default, and it is why a spec is
still the way to say "this one is different".

## Order of passes, which is load-bearing

```
build the document
  -> house style   (sizes, colors, spacing, layout, the Latin face)
  -> RTL pass      (direction: w:bidi / a:pPr rtl)
  -> Arabic pass   (arabic_style.style_docx / style_pptx: the complex-script face)
  -> save
```

The house pass sets the Latin font slot. The Arabic pass owns the
complex-script slot (`w:cs`, `a:cs`) and must run **after** it, or Arabic
text silently falls back to whatever the reader's machine picks. The
create scripts already run the first two in this order; herwork runs the
third.

## What the system actually says

The numbers and their derivations are in `references/design-system.md`.
The short version:

- **Type.** IBM Plex Sans, with IBM Plex Sans Arabic beside it. Deck:
  base 18 pt at ratio 1.333, so 56 / 42 / 32 / 24 / 18 / 14 / 10.
  Document: base 11 pt at 1.25, so 22 / 17 / 14 / 11 / 9. A slide title
  is at least twice its body size, and 18 pt is the body floor for
  anything projected.
- **A title that does not fit steps down the scale.** `fit_title` counts
  the lines the title takes at the content width and takes the next size
  down rather than overflowing, and the body column starts below whatever
  the title actually needed. A title printed over the first bullet was
  the first thing anyone noticed about the old decks.
- **Measure.** 40 to 65 characters a line on a slide, 60 to 85 in a
  document. Full-width body text on a 16:9 slide runs to 96 characters,
  which is why the body column is capped at 7.5 in.
- **Color.** Neutral dominant. Ink and paper carry 60 to 70 percent of
  the page, the accent is under 10 percent and never a slide background.
  Every text pair clears WCAG AA at 4.5:1, checkable with
  `python scripts/house_style.py --check-contrast`.
- **Spacing.** 4 pt atom, 8 pt step. A 16:9 slide is 960 x 540 pt, and
  540 is not divisible by 8, which is why the atom is 4.
- **Tables.** Ruled in both directions by default, in a grey light
  enough to sit under the text: a half point hairline inside, a full
  point around the edge, a tinted header band, a bold first column, a
  very quiet band on alternate rows once the table is long, and numbers
  right aligned under a right aligned header. Word's own "Table Grid" is
  not that: it rules every cell in near black, which is what makes a
  table shout.

  `{"theme": {"table_style": "rules"}}`, or `HERMES_HOUSE_TABLE=rules`,
  switches to the booktabs convention instead: three horizontal rules,
  nothing vertical, for a document that wants the quieter print look.
- **Asides.** A callout is a paragraph, not a box: a rule with a small
  caps label, or an indent with larger type, or a bold lead in phrase. A
  rounded rectangle with a fill and a border is the shape a reader
  recognises as generated before reading a word of it, so the docx
  callout block has no such style and the floating box lost its outline
  and its rounded corners.
- **Charts.** One accent hue unless the data has a real categorical
  dimension, no gridlines, no legend for a single series, numbers on the
  bars instead of a value axis.
- **Arabic.** IBM Plex Sans Arabic, which was drawn with a Latin
  companion so a bilingual line keeps one color. Line height about 1.45
  for body and 1.25 for a title: 1.7 is right for tashkeel-heavy text and
  reads as a hole in business Arabic. No italics, no tracking, no
  justification, and the column hugs the right margin rather than sitting
  right-aligned inside a left-hand box. An Arabic table keeps its own
  start edge instead of taking the Latin numeric alignment, which in RTL
  would push the numbers away from their header.

## Checking a deliverable before it ships

```bash
python scripts/style_lint.py report.docx deck.pptx book.xlsx
python scripts/style_lint.py draft.md --only prose --json
```

Errors fail the run: a long dash anywhere, a slide past the hard word
ceiling. Warnings are budgets worth a look: stock Office faces, six type
sizes in one deck, a spreadsheet still wearing its grey grid, prose that
hedges instead of saying.

A warning is a prompt to look, not a verdict. The word lists generalise
badly across industries and a good writer can use any word on them well.
The one rule with no exception is the dash: no em dash and no en dash in
any deliverable, in any language. Use a comma, a colon, or two sentences.

## Using the system from your own code

```python
import sys; sys.path.insert(0, "scripts")
from house_style import load_theme, theme_pptx, theme_docx, theme_xlsx, pdf_styles

theme = load_theme("editorial", accent="B4482E")
theme.deck["title"]        # 42
theme.color("accent")      # "B4482E"
theme_pptx(prs, theme)     # after the deck is built
styles, table_style = pdf_styles(theme)   # reportlab
```

`python scripts/house_style.py --check-contrast` prints the whole system
as JSON, which is the quickest way to hand the tokens to something that
is not Python, such as an HTML deck or a diagram.

## Reading a file somebody else made

`scripts/office_inspect.py` walks a .docx, .pptx, .xlsx or .pdf and
prints one report: what is in it, and the address of every editable
thing.

```bash
python scripts/office_inspect.py report.docx
python scripts/office_inspect.py deck.pptx --section targets
```

Six sections: `summary` (counts), `structure` (headings, slides, sheets,
pages), `inventory` (tables, charts, pictures with their sizes),
`review` (comments and tracked changes, threaded where the format has
threads), `targets` (the exact flag to hand an edit command, so a change
is a command and not a guess) and `lint` (the same findings
`style_lint.py` prints).

Comments come from the sibling skills' own comment scripts. When one is
not installed, the report says so under `review.source` rather than
reporting no comments: "none" and "could not look" are different answers
and only one of them is safe to act on.

## Pitfalls

- **Do not run an applier before the content exists.** It fonts what is
  in the document at call time; anything added afterwards keeps only the
  named style.
- **A font name is not a font.** Word and PowerPoint embed a family name
  and the reader's machine resolves it. `resolve_font` picks the first
  candidate actually installed here, and Aptos is deliberately not a
  candidate: it has no metric-compatible substitute in headless
  renderers, so an overflow check against it is wrong in both directions.
- **The lint reads the file, not your intentions.** Run it on the file
  you are about to deliver, not on the draft you rendered from.
- **Overflow is invisible to the lint.** It reads text and formatting,
  not geometry. Render the deck (`pptx_render.py`) and look at the PNGs;
  the commonest defect in generated output is text that runs past its
  box, and it passes every text check ever written.
