# Producing Documents That Do Not Read As AI-Generated

**A codifiable reference for deck, document and spreadsheet generators**
Version 1.0 · compiled 11 September 2026

This is written to be executed, not admired. Every section ends in a block of hard assertions a generator can evaluate. Where a number is derived rather than cited, the arithmetic is shown so it can be re-derived for a different page size.

---

## 0. The governing idea

A document reads as machine-made for three reasons, in this order of damage:

| Layer | Symptom | Why the reader notices |
|---|---|---|
| **Structure** | Every template field is filled because it exists: kicker, heading, lead, a description under each card, a caption under each figure | A writer leaves a field empty when there is nothing to put in it. A generator does not |
| **Substance** | Sentences that are correct and contain no figure, place, date, name or source | Nothing can be checked, so nothing can be disagreed with |
| **Surface** | "world-class", "not just X but Y", long dashes, every sentence the same length | Median vocabulary and median rhythm, which is by definition what a language model emits |

Most effort goes to the third layer, which matters least. A deck with a perfect type scale and a decorative accent stripe under every title still reads as generated. Fix structure first.

The single strongest diagnostic, applicable to a slide, a card, a table caption or a paragraph, is the **substitution test**: replace the subject's name with a competitor's. If the sentence is still true, delete it. Source: the `institutional-copy` skill's `references/tells.md`, derived from blind review of real client copy.

---

## 1. How current AI deck tools structure a deck

### 1.1 What the tools actually converge on

| Tool | Generation model | What it enforces |
|---|---|---|
| **Gamma** | Prompt to outline to cards; each card is a flexible block, not a fixed slide frame | One main idea per card; visual hierarchy by size and spacing; consistent formatting across the deck. Its own material argues *away* from bullets, toward layout blocks ([Gamma, beyond bullet points](https://gamma.app/insights/beyond-bullet-points-smarter-slide-design-in-gamma)) |
| **Beautiful.ai** | Constraint-solved "Smart Slides": about 300 named layouts that realign, resize and rebalance as content is added | Layout rules cannot be overridden by the user. The system decides placement ([Smart Slides](https://www.beautiful.ai/smart-slides)) |
| **Microsoft Copilot in PowerPoint** | Generates into the *existing* template's layouts rather than inventing geometry | Brand template compliance; layout reuse ([Microsoft support](https://support.microsoft.com/en-us/powerpoint/copilot/create-a-new-presentation-with-copilot-in-powerpoint)) |
| **Canva Magic Design** | Template retrieval plus content fill | Pre-designed template families; brand kit application |
| **Claude `pptx` skill** | Code generation (`pptxgenjs`) plus render-and-inspect QA loop | Explicit anti-pattern list, palette selection, mandatory schema validation and visual QA of every rendered slide |
| **html2pptx-style approaches** | Author each slide as HTML at 1600 by 900 px, convert to native PPTX shapes | CSS layout discipline; text stays editable, not an image |

The convergent architecture across all six is the same three-stage pipeline, and a generator should copy it:

1. **Content plan first.** Outline to sections to one message per slide. No geometry yet.
2. **Layout selection second.** Map each message onto a named layout from a small fixed catalogue. Never map every message onto the same layout.
3. **Render, then inspect.** Rasterize and look. The `pptx` skill treats this as mandatory, and its rationale is worth quoting in spirit: after staring at the generating code you see what you expect rather than what rendered.

### 1.2 The layout catalogue

Ship a fixed, small set. Eight to twelve named layouts covers a business deck. Each has a declared text budget and a declared content arity.

| Layout | Arity | Title budget | Body budget |
|---|---|---|---|
| `title` | 1 | 6 words | 12 word subtitle |
| `section-divider` | 1 | 4 words | 0 to 8 words |
| `statement` (one sentence, large) | 1 | 0 | 14 words |
| `stat-hero` (one number, 60 to 72 pt) | 1 | 5 words | 10 word label plus 12 word source |
| `two-column` (text left, visual right) | 2 | 8 words | 55 words |
| `icon-rows` (3 to 5 rows, icon plus bold label plus line) | 3 to 5 | 8 words | 12 words per row |
| `grid-2x2` / `grid-2x3` | 4 to 6 | 8 words | 16 words per cell |
| `comparison` (before and after, option A and B) | 2 | 8 words | 30 words per side |
| `timeline` / `process` | 3 to 6 | 8 words | 10 words per step |
| `chart` (one chart, one takeaway title) | 1 | 12 words, as an assertion | 20 word annotation |
| `half-bleed-image` | 1 | 8 words | 25 words overlay |
| `closing` | 1 | 6 words | 20 words |

**The title is the finding, not the topic.** `Revenue grew 34% on two products` beats `Revenue overview`. This is the IBCS "message" principle and it is the highest-leverage single rule in deck generation ([IBCS](https://www.ibcs.com/)).

### 1.3 Text budgets

The legacy heuristic is **7x7** (max 7 bullets, max 7 words each). Treat it as historical, not as current practice: it optimizes for bullet lists, and every serious tool has moved away from bullets. Codify per-region word budgets instead, as in the table above, plus these ceilings:

- Total words on any slide: **60**, hard ceiling **85**, excluding source lines and speaker notes.
- Bullets per list: **max 5**, and only when the items are genuinely parallel and enumerable. Otherwise use `icon-rows` or `grid`.
- Words per bullet: **max 12**, target 6.
- A slide with more than 85 words is split, not shrunk.

**Everything cut goes to speaker notes**, not into a smaller font. `slide.addNotes()` in pptxgenjs, once per slide, plain text. Notes have no budget.

### 1.4 Visuals

- **Every slide carries a visual element**: image, chart, icon, or a deliberate expanse of one color. Text-only slides are the default failure mode of generated decks.
- **Exactly one visual idea per slide.** A chart plus a photo plus three icons is three ideas.
- **Charts are native chart objects**, never rendered images, for every chart type the target application can draw. Only forms the application has no native equivalent for (Sankey, chord, network) go in as images. Rendered-chart-as-PNG is instantly recognizable and unfixable by the recipient.
- **Images bleed or are framed consistently.** Pick one and repeat it: full-bleed half, or a rounded frame at a fixed radius. Mixed treatments read as assembled rather than designed.

### 1.5 Deck arc

```
title -> agenda (optional, only if >= 12 slides) -> [section-divider -> 3 to 6 content slides] x N -> synthesis -> closing/ask -> appendix
```

Dark background for title, section dividers and closing; light for content. That "sandwich" is a cheap, reliable signal of intentional design. Or commit to dark throughout. Do not alternate randomly.

### 1.6 Assertions

```
words_per_slide <= 85
bullets_per_list <= 5 and words_per_bullet <= 12
distinct_layouts_used >= min(5, slide_count)
max_consecutive_same_layout <= 2
slides_with_no_visual == 0
title_is_assertion(slide) for all content slides   # contains a verb
charts_as_images == 0 for native-supported chart types
accent_underline_under_title == 0                  # see 3.6
decorative_edge_stripes == 0                       # see 3.6
```

---

## 2. Typography

### 2.1 Slide geometry, in points

A 16:9 PowerPoint slide is **13.333 in by 7.5 in**. At 72 pt per inch:

```
width  = 13.333 * 72 = 960 pt
height =  7.5   * 72 = 540 pt
```

(1600 by 900 px at 120 px per inch is the same surface; px = pt * 5/3.)

Note for the grid section: 960 / 8 = 120 (integer), but **540 / 8 = 67.5 (not integer)**. The 8 pt grid does not close vertically on a 16:9 slide. 540 / 4 = 135, so **the 4 pt sub-grid is the one that closes**. Use 4 pt as the atom, 8 pt as the preferred step.

### 2.2 Modular scale

A modular scale multiplies a base size by a fixed ratio, so every step is derivable and no size is argued about ([Type scale systems](https://www.typographymaster.com/guide/type-scale-systems)). Two ratios cover practically everything:

- **1.250 (major third)** for dense, read-alone decks and documents. Restrained, small steps.
- **1.333 (perfect fourth)** for projected decks and editorial layouts. Clear hierarchy, larger jumps. This is the ratio the UAE Design System 2.0 uses for its heading scale ([designsystem.gov.ae](https://designsystem.gov.ae/guidelines/typography)).

**Deck scale, base 18 pt, ratio 1.333**, rounded to even points:

| Step | Raw | Use | Rounded |
|---|---|---|---|
| base x 1.333^4 | 56.8 | hero stat, cover title | **56** |
| x 1.333^3 | 42.6 | slide title | **42** |
| x 1.333^2 | 32.0 | section header, large callout | **32** |
| x 1.333 | 24.0 | subtitle, card heading | **24** |
| base | 18.0 | body | **18** |
| / 1.333 | 13.5 | caption, axis label | **14** |
| / 1.333^2 | 10.1 | source line, footnote | **10** |

**Read-alone deck (sent as a file, read at arm's length), base 16, ratio 1.25:** 16, 20, 25, 31, 39, 49, rounded to **16 / 20 / 24 / 32 / 40 / 48**.

The bundled `pptx` skill gives the empirical bands that these scales must land inside: slide title 36 to 44 pt bold, section header 20 to 24 pt bold, body 14 to 16 pt, captions 10 to 12 pt muted, and large stat callouts at 60 to 72 pt. Treat 14 pt as the absolute body floor for a file that is read, **18 pt as the floor for anything projected in a room**, and never go below 10 pt for a source line.

**Size contrast is non-negotiable.** title_pt / body_pt >= 2.0. A 24 pt title over 18 pt body reads as a word processor, not a slide.

### 2.3 Measure (line length)

Butterick: **45 to 90 characters per line including spaces**, and point size 10 to 12 pt in print ([Line length](https://practicaltypography.com/line-length.html), [Summary of key rules](https://practicaltypography.com/summary-of-key-rules.html)). The UAE system says 60 to 100 and no justification.

Estimator, good to about 5% for a humanist sans (average glyph advance is close to 0.5 em):

```
chars_per_line  ~=  text_width_pt / (0.5 * size_pt)
max_width_pt    ~=  0.5 * size_pt * target_chars
```

**On a slide**, target 40 to 60 chars, ceiling 65. At 18 pt body that is a text box of `0.5 * 18 * 60 = 540 pt` wide, ceiling 585 pt. The full content width of a 960 pt slide with 48 pt margins is 864 pt, which at 18 pt yields 96 chars: **too wide**. This is the arithmetic reason full-width body text on a slide looks wrong. Body text lives in a column, not across the slide.

### 2.4 Line height and paragraph spacing

- Body leading: **130 to 145%** of point size (Butterick's band is 120 to 145%; the top half suits screens). At 18 pt use **24 pt** exact leading, which is a multiple of 4 and so closes on the grid.
- Headings above 28 pt: **105 to 115%**. Large type needs less. At 42 pt use 46 pt.
- Space between paragraphs: **one half of the body leading** (12 pt at 24 pt leading), never a blank paragraph.
- Bulleted lists in PowerPoint: space with `paraSpaceAfter`, **not** `lineSpacing`. Setting `lineSpacing` on a bulleted list produces huge gaps (bundled `pptx` skill).

### 2.5 Font pairing

Two families maximum, plus an optional mono for code and figures. Three families is a tell.

The constraint nobody plans for: **the font name you write into a .pptx or .docx is rendered by the recipient's application, not by yours.** Headless QA (LibreOffice) substitutes missing faces with different metrics, so an overflow check can be wrong in both directions. The bundled `pptx` skill's classification is the practical guide:

- **Metrically reliable and shipped with Office**: Arial, Calibri, Cambria, Times New Roman, Courier New, Bookman Old Style, Century Schoolbook. Use these for body and anywhere fit matters.
- **QA-unreliable** (substitute has different widths): Georgia, Trebuchet MS, Impact, Arial Black, Garamond, Consolas, Palatino Linotype, Calibri Light. Fine for titles with about 10% size slack; do not trust automated fit checks on them.
- **Never default to Aptos.** Office's post-2023 default has no metric-compatible substitute in headless renderers and is absent from older Office installs.

Safe pairings that still look designed: a safe-list serif heading (Cambria, Century Schoolbook) over a safe-list sans body (Calibri, Arial). Weight contrast plus size contrast carries the hierarchy; a third family adds nothing.

Limit total weights to **three** per document (for example 400, 600, 700). The UAE system caps at five per page; three is tighter and reads cleaner.

### 2.6 Arabic and RTL

**Face selection.** Cairo, IBM Plex Sans Arabic, Tajawal, Noto Sans Arabic and Noto Kufi Arabic are the working set. Practical split:

| Role | Recommended | Why |
|---|---|---|
| UI and body, mixed Arabic and Latin | **IBM Plex Sans Arabic** | Designed alongside a Latin companion; consistent color between scripts |
| Headings, geometric or modern tone | **Cairo** | Strong at display sizes, wide weight range |
| Body, web-native, high familiarity | **Tajawal** | Common in Gulf digital work, even color |
| Government and formal | **Noto Kufi Arabic** | The UAE Design System 2.0 primary Arabic face |

Always declare the Arabic face **before** the Latin face in the cascade, so Arabic glyphs are never taken from a Latin font's fallback. In OOXML this means setting the complex-script font (`cs`, `w:cs`) explicitly, not just `latin`.

**Nominal size.** The sources disagree and neither is authoritative: one line of blog guidance says Arabic reads comfortably 1 to 2 px *smaller* than the Latin equivalent, another says increase by 10 to 15%. Do not pick a side. The rule that survives: **set Arabic at the Latin size, plus at most 1 pt, tuned per typeface by measuring rendered height**, because the variation between Cairo, Tajawal and Plex Arabic at the same nominal size is larger than the claimed Arabic-versus-Latin difference. Use the UAE Design System's scale as the default when you have no measurement.

**Line height is where Arabic genuinely differs.** Arabic needs **1.6 to 1.8** against 1.4 to 1.5 for Latin. Ascenders, descenders and optional tashkeel occupy more vertical range. The UAE system's floor is 1.5 for body; treat 1.5 as the minimum and 1.7 as the default. At 18 pt Arabic body that is **31 pt leading**, rounded to 32 to stay on the 4 pt grid.

**Things that are simply wrong in Arabic and must be hard-blocked:**

- **Letter-spacing or tracking on Arabic text.** Arabic is cursive; positive tracking breaks the joins. Set `charSpacing: 0`. (Note that in pptxgenjs the option is `charSpacing`; `letterSpacing` is silently ignored.)
- **Italics.** Arabic has no italic tradition. Emphasize with weight or color.
- **Synthetic bold.** Use a real heavier weight from the family.
- **All-caps and small-caps.** The concept does not exist in the Arabic script.
- **Full justification.** Proper Arabic justification uses kashida elongation, which Office implements inconsistently. Set text flush-right, ragged-left.
- **Latin-derived hyphenation.** Arabic does not hyphenate.

**Layout mirroring.** Set the direction flag at the paragraph and document level, not by right-aligning text: `<a:pPr rtl="1">` in PPTX, `<w:bidi/>` plus `<w:rtl/>` on the run properties in DOCX, `sheet_view.rightToLeft = True` in XLSX. Mirror the whole layout: reading order, column order, icon-before-text becomes icon-after-text, progress and process arrows point left, list indents flip.

**Do not mirror:** numerals, dates, mathematical expressions, code, chart value axes with numeric scales, and any Latin brand name. These stay left to right inside the RTL flow; the bidi algorithm handles this if you do not fight it with manual spacing.

**Digits.** Pick Western Arabic (0123) or Eastern Arabic-Indic (٠١٢٣) once per document and never mix. Western digits are the safe default for business documents in the Gulf and the Levant; Eastern for Egypt-facing formal publishing. State the choice in the document's config rather than deciding per string.

**Categorical axis direction in an all-Arabic document:** mirror it, so a time series reads right to left in line with the text. In a bilingual document keep time left to right and say so once. Consistency inside the document beats either convention.

**QA caveat:** Arabic faces are not on the metrically-reliable list, so automated overflow checks against them are approximate. Add 10 to 15% size slack to Arabic containers, and Arabic text runs roughly 20 to 25% shorter than English in character count but similar in rendered width, so a translated deck usually fits where a naive character count predicts it will not.

### 2.7 Assertions

```
size in TYPE_SCALE for every text run          # no off-scale sizes
title_pt / body_pt >= 2.0
body_pt >= 18 (projected) or >= 14 (read-alone)
caption_pt >= 10
leading_pt / size_pt in [1.30, 1.45] for body (Latin)
leading_pt / size_pt in [1.60, 1.80] for body (Arabic)
leading_pt / size_pt in [1.05, 1.15] for size_pt > 28
chars_per_line in [40, 65] on slides, [55, 80] in documents
font_families <= 2 (+1 mono)
font_weights <= 3
arabic: char_spacing == 0 and italic == false and all_caps == false
arabic: justified == false
```

---

## 3. Color

### 3.1 60-30-10, restated as a measurable rule

Measure fractions of **visible area**, not number of colors:

- **60 to 70%**: the dominant neutral (a near-white or a near-black surface, plus its one-step-off tints).
- **25 to 30%**: the secondary, usually the brand hue at a de-saturated or dark step, used for large blocks, headers and surfaces.
- **5 to 10%**: the accent. A chart's highlighted series, one key number, one call to action.

The bundled `pptx` skill states the same thing as a prohibition worth enforcing directly: **never give all colors equal weight.** A deck where three hues each occupy a third of the area is the signature of a generated palette.

### 3.2 Building a full palette from one brand hue

Work in **OKLCH**, not HSL. HSL lightness is not perceptual, so a "50% lightness" yellow and a "50% lightness" blue are nothing alike.

Given a brand hue `H` (0 to 360) and its chroma `C0`:

```
NEUTRALS  (carry 60 to 70% of the area)
  hue = H, chroma = 0.010 to 0.020   # a whisper of the brand hue, not pure gray
  L steps = [0.98, 0.95, 0.90, 0.82, 0.72, 0.60, 0.48, 0.36, 0.26, 0.18]
  -> surface, surface-raised, border, muted-ink, secondary-ink, primary-ink

BRAND RAMP (the 25 to 30%)
  hue = H (plus or minus 3 degrees max across the ramp)
  L steps = [0.95, 0.88, 0.78, 0.68, 0.58, 0.50, 0.42, 0.34, 0.26]
  chroma = min(C_max(L, H), C0)      # clamp to gamut; chroma must fall as L approaches 0 or 1

ACCENT (the 5 to 10%)
  hue = H + 180 (complement) or H +/- 150 (split complement)
  pick the step whose OKLCH L lands in [0.55, 0.70] on a light surface

STATUS (reserved, never reused as "series 4")
  good / warning / serious / critical, on steps deliberately distinct from
  every categorical slot, and always shipped with an icon and a label,
  never color alone.
```

Chroma floor for anything doing identity work: **C >= 0.10** in OKLCH. Below that a hue reads as gray and stops distinguishing anything.

Lightness band for chart marks: **L in [0.43, 0.77] on a light surface, [0.48, 0.67] on a dark one.**

### 3.3 Contrast, computed not eyeballed

WCAG 2.2 SC 1.4.3 Level AA: **4.5:1 for normal text, 3:1 for large text**, where large is 18 pt or larger, or 14 pt or larger when bold. Non-text UI components and graphical objects need 3:1 (SC 1.4.11). AAA is 7:1 and 4.5:1 ([W3C Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).

The formula, so a generator can check rather than assert:

```
# per channel, sRGB 8-bit value v
c = v / 255
c_lin = c / 12.92                if c <= 0.04045
        ((c + 0.055) / 1.055)^2.4 otherwise

L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin

contrast(a, b) = (max(La, Lb) + 0.05) / (min(La, Lb) + 0.05)
```

Slide type is nearly always "large" by the WCAG definition, so 3:1 is the legal floor, but **use 4.5:1 anyway for anything under 24 pt and for any text over a photograph.** Text over an image needs a scrim: a solid or gradient overlay at the opacity required to bring the measured contrast over threshold, computed against the brightest pixel region under the text, not the average.

### 3.4 Chart color: assign by the job it does

Four jobs, one rule each:

| Job | Encodes | Structure |
|---|---|---|
| **Categorical** | identity (which series) | up to 8 hues in a **fixed order, assigned in sequence, never cycled** |
| **Ordinal** | position in a sequence (funnel stage, tier, age band) | one hue, monotone lightness steps |
| **Sequential** | magnitude | one hue, light to dark. Never a rainbow |
| **Diverging** | polarity around a baseline | two opposite-temperature hues plus a **neutral gray** midpoint. Never a hue at the midpoint, never two cool hues as the two poles |
| **Status** | state | fixed reserved scale, icon plus label, never borrowed for a series |

Test for categorical versus ordinal: if reordering the categories would change the meaning, it is ordinal and takes a ramp. Products, teams and regions are nominal, and **a set of nominal bars all take the same slot-1 hue** because the bar length already encodes the value. Coloring nominal bars darker-where-bigger burns the identity channel re-encoding what is already shown.

Colorblind separation must be computed. Euclidean distance in OKLab times 100 under simulated protanopia and deuteranopia: **target Delta E >= 8, floor 6** (a result of 6 to 8 is legal only with a secondary encoding such as direct labels or texture), plus a **normal-vision floor of 15** on the worst pair, which is a hard failure with no exemption. For scatter, bubble, choropleth and small-multiples, where any two marks can touch, check **all pairs**, not just adjacent ones. That is a strictly harder test and it caps such charts at roughly three series.

Past eight categorical series there is no ninth color. Fold the tail into "Other", facet into small multiples, or change form.

### 3.5 Why the default Office theme colors read as "template"

Codifiable diagnosis, not aesthetics:

1. The six default accents are spread at roughly even hue intervals with roughly equal chroma and lightness, so **no color dominates**: the 60-30-10 ratio becomes 16-16-16-16-16-16.
2. Charts consume `accent1` through `accent6` **in order regardless of how many dimensions the data has**, so a four-series chart gets four unrelated hues at equal weight when the story usually needs one hue plus gray.
3. The defaults are recognizable. A reader who has seen the Office theme ten thousand times perceives "nobody chose this."

The rules that remove it:

```
theme_accents := derived_ramp(brand_hue)        # overwrite accent1..6, never inherit
hues_in_chart <= 1  unless the data has a genuine categorical dimension
hues_in_chart <= dimension_cardinality, and <= 8 always
highlight_one_series := true when the chart makes one point (gray the rest)
```

Also: **do not default to blue**, and do not default to warm-neutral backgrounds (`F5F5DC`, `FAF0E6`, `FAEBD7`, `FFF8E1`). Both are generator tells. When no brand is given, white or a committed dark.

### 3.6 The decoration prohibitions

From the bundled `pptx` skill's anti-pattern list, and they are the highest-signal visual tells of machine-made slides:

- **Never put an accent line or underline beneath a title.** Use whitespace or a background change.
- **Never add decorative color bars or accent stripes.** This includes header or footer bars spanning the slide, vertical sidebar stripes, thin stripes along one edge of a card, and single-side borders on rectangles. To set a card apart, use a subtle background tint, a shadow, or an icon.
- **Never draw a border around a chart mark to separate it from its neighbor.** Use a 2 px gap in the surface color instead.

### 3.7 Assertions

```
contrast(text, bg) >= 4.5  for size_pt < 24 or weight < 700
contrast(text, bg) >= 3.0  for size_pt >= 24
contrast(mark, surface) >= 3.0
area_share(dominant_neutral) in [0.55, 0.75]
area_share(accent) <= 0.12
distinct_hues_per_document <= 3 (+ neutrals + reserved status)
cvd_delta_e(adjacent_pairs) >= 8         # 6 to 8 only with secondary encoding
normal_vision_delta_e(worst_pair) >= 15  # hard gate
categorical_slots_used <= 8, never cycled
diverging_midpoint.chroma < 0.02         # gray
title_underline_shapes == 0
full_width_or_edge_stripe_shapes == 0
```

---

## 4. Grid and spacing

### 4.1 The spacing atom

The 8 pt grid constrains every margin, padding, gap and dimension to a multiple of 8 (8, 16, 24, 32, 48, 64, 96). It scales cleanly at 1x, 1.5x, 2x and 3x without fractional pixels, and 8 divides by 4 and 2 for half and quarter steps. IBM Carbon, Microsoft Fluent, Atlassian, Ant Design, Polaris and Primer all use it ([8-point grid](https://spec.fm/specifics/8-pt-grid), [4-point guide](https://www.thedesignership.com/blog/the-ultimate-spacing-guide-for-ui-designers)).

For slides, as derived in 2.1, 540 pt is not divisible by 8. **Use 4 pt as the atom and 8 pt as the preferred step.** Permitted spacing values: `4, 8, 12, 16, 24, 32, 48, 64, 96`.

### 4.2 Slide frame, derived

```
slide            960 x 540 pt
outer margin     48 pt   (0.667 in)    # minimum 36 pt = 0.5 in
content box      864 x 444 pt
columns          12
gutter           24 pt
column width     (864 - 11*24) / 12 = (864 - 264) / 12 = 50 pt

useful spans:    1/3  = 4 cols = 4*50 + 3*24 = 272 pt
                 1/2  = 6 cols = 6*50 + 5*24 = 420 pt
                 2/3  = 8 cols = 8*50 + 7*24 = 568 pt
                 check: 272 + 24 + 568 = 864  OK
```

Vertical bands, on the 4 pt atom:

```
title band       top 48, height 56    (42 pt title at 46 pt leading, plus slack)
gap              32
content band     top 136, height 356
source band      top 492, height 20   (10 pt, muted)
bottom margin    28  -> 492 + 20 + 28 = 540  OK
```

The `pptx` skill's empirical floors agree: **0.5 in minimum margins, 0.3 to 0.5 in between content blocks**, and pick one gap value and use it consistently rather than mixing.

Note that PowerPoint text boxes carry built-in internal padding. When text must align to a shape or line at the same x, set `margin: 0` on the text box or the optical alignment will be off by a few points on every slide.

### 4.3 Whitespace budget

Measure the fraction of the content box covered by ink-bearing bounding boxes:

- **Content slide: 45 to 65% occupied.** Below 45% the slide looks unfinished; above 65% it looks stuffed.
- **Statement or stat-hero slide: 15 to 35%.**
- **Section divider: under 20%.**

Consistency matters more than the exact number: occupancy varying wildly slide to slide reads as assembled rather than designed.

### 4.4 Alignment

- Every element's left edge (or right edge, in RTL) snaps to a column edge. No free-floating x values.
- Elements in a repeated row share a common baseline and a common height. Cards of unequal height in one row is the commonest generated-layout defect after overflow.
- Optical alignment overrides mathematical alignment for round shapes and for glyphs with overshoot, but only by 1 to 2 pt.
- **Never center body text.** Left-align paragraphs and lists (right-align in RTL); center only titles and short statements.

### 4.5 Assertions

```
all spacing values in {4,8,12,16,24,32,48,64,96}
min_distance(element, slide_edge) >= 36 pt
min_distance(element, element) >= 16 pt   (24 pt preferred between blocks)
element.x, element.x + element.w align to a column edge (tolerance 2 pt)
same_row_elements share top and height (tolerance 2 pt)
content_occupancy in [0.45, 0.65] for content layouts
overflowing_text_boxes == 0               # check first, it is the commonest defect
overlapping_bboxes == 0
```

---

## 5. Word documents

### 5.1 Measure, derived

The estimator from 2.3, run on real page setups:

```
US Letter 8.5 in = 612 pt
  1.00 in margins -> text width 432 pt
     at 11 pt: 432 / (0.5 * 11) = 78.5 chars
     at 12 pt: 432 / 6.0        = 72.0 chars
  1.25 in margins -> text width 342 pt
     at 11 pt: 342 / 5.5        = 62.2 chars
A4 8.27 in = 595 pt
  1.00 in margins -> text width 451 pt
     at 11 pt: 451 / 5.5        = 82.0 chars
```

So the Word default (Letter, 1 in, 11 pt) sits at roughly 79 characters: legal against Butterick's 45 to 90, but **near the top of the band**, and A4 with the same settings is at 82. That is why the default page reads as untypeset rather than as wrong. Moving to **1.25 in side margins, or keeping 1 in and setting the body at 12 pt**, lands the measure in the low 60s to low 70s, which is where a typeset report sits.

**Target: 60 to 75 characters. Ceiling 85.** If the content genuinely needs a wide page, use two columns rather than one 100-character line.

### 5.2 Page setup

| Parameter | Value |
|---|---|
| Page | Letter 12240 x 15840 DXA, or A4 11906 x 16838 DXA (1440 DXA = 1 in) |
| Margins | top 1.0 in, bottom 1.0 in, inside or left **1.25 in**, outside or right 1.25 in |
| Body | 11 pt serif or humanist sans, leading **exact 14 pt** (127%) |
| Paragraph spacing | 8 pt after, 0 before. **No first-line indent if using space-after; no space-after if using indent.** Never both |
| Alignment | flush left, ragged right. No justification without hyphenation, and Word's hyphenation is poor |
| Widow and orphan control | on |
| Keep-with-next | on for every heading |

Note for generators: docx-js defaults to A4. Set page size explicitly.

### 5.3 Heading hierarchy

Three levels, four at the outside. A document that needs five levels needs restructuring.

Scale at 1.25 from an 11 pt base: 11, 13.75, 17.2, 21.5, rounded to **11 / 14 / 17 / 22**.

| Level | Size | Weight | Space before | Space after |
|---|---|---|---|---|
| H1 (chapter) | 22 pt | 600 | 0 (page top) | 16 pt |
| H2 (section) | 17 pt | 600 | 24 pt | 8 pt |
| H3 (subsection) | 14 pt | 600 | 18 pt | 6 pt |
| H4 (run-in) | 11 pt | 700 or italic, same line as text | 12 pt | 0 |

Distinguish levels by **size and space, not by color**. Colored headings in a report are a template tell. Tufte's own books distinguish headings with italics and space rather than bold and color ([Book design advice](https://www.edwardtufte.com/notebook/book-design-advice-and-examples/)).

Always use the built-in heading styles (`HeadingLevel.*`), not manually formatted paragraphs, or the table of contents will not build and the document will be unnavigable.

### 5.4 Tables

The single biggest difference between a typeset report and a generated one. The booktabs convention:

- **No vertical rules at all.** They serve only to clutter.
- **Three horizontal rules**: above the header, below the header, below the last row. Nothing between body rows.
- Rule weights: top and bottom **1.0 pt**, the under-header rule **0.5 pt**. Use a light neutral (the 0.82 lightness step), not black.
- **No fills**, except an optional very light zebra at 3% tint when the table exceeds 12 rows.
- Header text: same size as body, 600 weight, **not** bold white on a brand color.
- **Numbers right-aligned**, text left-aligned, headers aligned to their column's content.
- Cell padding: 6 pt vertical, 8 pt horizontal.
- Caption **above** the table, figure caption **below** the figure.
- Units go in the column header (`Revenue (AED m)`), never repeated in every cell.

Generator gotchas: a table needs both `columnWidths` on the table and a `width` on every cell, both in DXA (percentages break in Google Docs), and column widths must sum to the table width. Use `ShadingType.CLEAR`, never `SOLID`, which renders black. Do not use a one-row table as a horizontal rule; use a paragraph bottom border.

### 5.5 What makes a report look typeset

- One consistent vertical rhythm: every block's height is a multiple of the body leading (14 pt), so the text sits on an invisible baseline grid.
- Figures and tables anchored at the top of a page or the top of a column, not floating mid-paragraph.
- Real small caps or spaced caps for running heads, never faux caps.
- Curly quotes and apostrophes, real ellipsis, non-breaking spaces before units and after abbreviations.
- Exactly one space after a period.
- Page numbers present, and a running head naming the section from page 2 onward.
- A cover page with four to six lines total, not a paragraph.

### 5.6 Assertions

```
chars_per_line in [60, 85]
leading_pt == 14 and all block heights % 14 == 0 (tolerance 1 pt)
heading_levels <= 4
heading_color == body_color  (no colored headings)
table.vertical_rules == 0
table.horizontal_rules == 3
table.header_fill == none
numeric_columns.alignment == "right"
paragraph.indent_first_line == 0 XOR paragraph.space_after == 0
widow_orphan_control == true
```

---

## 6. Spreadsheets

### 6.1 Structural rules

- **One table per sheet.** A sheet holds exactly one rectangular table with one header row. Two tables side by side breaks sorting, filtering, pivoting and every structured reference.
- **No merged cells anywhere in a data region.** They break sorting and formulas, and in openpyxl only the top-left anchor is writable at all.
- Row 1 is the header. Freeze panes at the first data cell.
- Separate **inputs, calculations and outputs** onto their own sheets, in that order, left to right.
- **Every assumption in its own labeled cell, referenced by the formulas that use it.** `=B5*(1+$B$6)`, never `=B5*1.05`. A hardcoded constant inside a formula is the defect that makes a model unauditable.
- Formulas consistent across every projection period. A single edited cell in the middle of a row is the commonest silent error in a model.
- **Named ranges** for anything referenced from more than one sheet, and for every scenario lever. A sheet name containing a space must be quoted in a cross-sheet reference (`='Assumptions Inputs'!$B$5`), or it evaluates to `#VALUE!`.
- Document every assumption and hardcoded number where the reader sees it, with a real source when one exists.

### 6.2 Visual treatment

- **Gridlines off.** This one change does more for perceived quality than anything else in a workbook.
- Header row: 600 weight, one **thin bottom border**, no fill. If a fill is required, use the 0.95 lightness neutral, not the brand color.
- Column widths sized to content plus 2 characters. No wrapped header text over three lines.
- Row height uniform; do not hand-tune individual rows.
- A single professional font throughout (Arial or Calibri), one size for data, one size for headers.
- Zebra striping only past 20 rows, and at 3% tint.
- **Conditional formatting: at most two rules per sheet.** A data bar or a color scale, not both, and never on a column that already carries a chart. Color scales use one hue light to dark, never red, yellow and green unless the values genuinely diverge around a meaningful midpoint.
- Borders only where they separate structural regions (a totals row gets a top border), never around every cell.

### 6.3 Number formats, literally

| Content | Format string |
|---|---|
| Currency, whole | `$#,##0;($#,##0);-` |
| Currency, cents | `$#,##0.00;($#,##0.00);-` |
| Plain count | `#,##0;(#,##0);-` |
| Percent (store the **fraction**: 0.15 renders 15.0%) | `0.0%;(0.0%);-` |
| Multiple | `0.0x` |
| Thousands-scaled | `#,##0,;(#,##0,);-` with `($000)` in the header |
| Date | `dd-mmm-yy` |
| Year | text (`"2024"`), never a number, or it renders `2,024` |

Rules: negatives in parentheses, zeros render as `-`, the unit is named in the column header (`Revenue ($mm)`) and never repeated in cells, and the currency symbol appears only on the first and last row of a schedule. Decimal places are uniform down a column.

### 6.4 Color convention for models

The industry convention, which reviewers actually rely on:

- **Blue text** (0,0,255): hardcoded inputs and scenario levers.
- **Black**: formulas.
- **Green** (0,128,0): links to another sheet.
- **Red** (255,0,0): links to another file.
- **Yellow fill** (255,255,0): key assumptions and cells the user must fill in.

A workbook you build for someone else to fill in needs a short legend naming which cells to edit, plus one example row of realistic values. Never add such a row to a file you were asked to edit.

### 6.5 Correctness gates

- **Zero formula errors on delivery.** Recalculate before shipping; openpyxl writes formulas with no cached values, so until a real engine computes them every formula cell reads back as `None` to pandas and to most previewers.
- A clean recalculation proves formulas *evaluate*, not that they are *right*. Write two or three formulas first and check they pull the values you expect before building out a grid.
- Avoid functions the verification engine cannot evaluate. Prefer the Excel 2007 set (`SUMIFS`, `INDEX`, `MATCH`, `IFERROR`, `SUMPRODUCT`). Six post-2007 functions need an `_xlfn.` prefix when written into XML directly: `TEXTJOIN`, `CONCAT`, `IFS`, `SWITCH`, `MAXIFS`, `MINIFS`. Avoid `XLOOKUP`, `SORT`, `FILTER`, `UNIQUE` and `SEQUENCE` entirely in generated files: they are spilling array functions and a hand-written file has no spill metadata, so only the top-left cell gets a value while the error count reads zero.
- Guard every denominator that can be zero.

### 6.6 Assertions

```
sheet.show_gridlines == false
tables_per_sheet == 1
merged_cells_in_data_region == 0
freeze_panes is set
header_row.fill in {none, neutral_95}
conditional_format_rules_per_sheet <= 2
numeric_cells_with_default_format == 0        # everything gets an explicit format
hardcoded_constants_inside_formulas == 0
formula_errors == 0
percent_cells_stored_as_fraction == true
fonts_per_workbook == 1
```

---

## 7. Data visualization

### 7.1 Form before color

Pick the chart from the data's job: magnitude, identity, polarity, change over time, or a single headline. **Sometimes the answer is not a chart.** One number is a stat tile, not a one-bar bar chart. Two values are not a pie.

Chart chosen, then marks, then color. Most bad charts pick color first.

### 7.2 The rules worth hard-coding

- **Never a dual-axis chart.** Two y-scales on one plot invent a correlation that is not in the data, because the alignment of the two scales is arbitrary. Two measures of different scale become two charts, small multiples, or both series indexed to 100 at t0 on one axis. This is the number one chart mistake.
- **Sort bars by value** unless the category has an inherent order (time, size tiers, funnel stages). An alphabetically sorted bar chart wastes the reader's main comparison.
- **Zero baseline on any bar or area chart.** Do not cut axes. Line charts of an index or a rate may use a non-zero baseline, labeled.
- **Time on the horizontal axis, left to right; structure on the vertical.** This covers roughly 95% of business charts (IBCS).
- **Consistent scaling** across charts that will be compared. Same unit, same scale.
- **Direct labels beat legends; legends beat a second axis.** Label the endpoint, the extreme, or the one series the story is about. **Never a number on every point**: a value beside every dot is chaos and goes unread.
- A legend is present whenever there are two or more series, so identity is never color alone. **A single series gets no legend box**: the title names it.
- **Text never wears the data color.** Bars, lines and dots carry the series hue; labels, values, legends and axis text use neutral ink with a colored swatch beside them. The exception is a label set inside a colored fill, where you pick white or ink by the fill's luminance.
- **The chart title is the finding.** `Churn concentrated in month 2`, not `Monthly churn`.
- Every chart carries a source line at 10 pt in the muted neutral: source, date, and what was excluded.

### 7.3 Mark specs

| Mark | Spec |
|---|---|
| Bar or column | **max 24 px thick** (cap it; leave the band's remainder as air), 4 px rounded data-end, square at the baseline |
| Line | **2 px**, round join and cap |
| Marker or end dot | **>= 8 px diameter**, filled with the series color |
| Area fill | series hue at about **10% opacity**, a wash, never a saturated block |
| Gridlines and axes | one step off the surface, **hairline 1 px, solid**, never dashed |

Two spacers do the separating, and they are surface-colored, not strokes: a **2 px gap** between touching fills (stacked segments and adjacent bars alike), and a **2 px ring** in the surface color around dots and end markers so they stay legible where they overlap.

Dashed gridlines are an anti-pattern: dashing reads as "projection" or "threshold" when it is just a grid.

### 7.4 Chart-junk checklist

Remove: 3D effects, shadows on bars, gradient fills on data marks, background fills inside the plot area, borders around the plot, dual axes, secondary gridlines, tick marks on both axes, legends for single series, decorative icons inside the plot, and the default chart title that repeats the sheet name.

In PowerPoint specifically, default charts render bare and dated: set the title, set data labels with an explicit position, set `chartColors` from your palette, and quiet the frame (muted axis label colors, a hairline value gridline, `catGridLine: none`, legend off for a single series). On a stacked bar, the data label position must be `ctr`, `inEnd` or `inBase`; `outEnd` corrupts the file.

### 7.5 Assertions

```
dual_axis_charts == 0
bar_charts.baseline == 0
categorical_bars.sorted_by_value == true unless category.has_natural_order
series_count <= 8 ; <= 3 for scatter/bubble/map/small-multiples
labelled_points / total_points <= 0.25
legend_present == (series_count >= 2)
gridline_style == "solid" and gridline_width == 1
bar_thickness <= 24 px
area_fill_opacity <= 0.15
chart_title.contains_verb == true
source_line_present == true
3d == false and shadow == false and gradient_on_marks == false
```

---

## 8. Writing style

### 8.1 The markers, ordered by damage

**Structural** (page level, invisible sentence by sentence):

- **The filled template.** Every field has content because the field exists.
- **Self-restatement.** A card's description restates its own label in longer words. *Catering and Meals for Residents / Catering and meal services for residential communities and workplaces.* Two independent blind reviewers named this the single strongest tell in real client copy, ahead of any word choice. A human writing a menu does not describe each item using the item's own name.
- **The announcement.** A section opens by saying what is about to follow, above cards that say exactly that.
- **The exhaustive list.** Five items ending in "or investment" because nothing may be left out. A person picks three and stops.
- **The justifying sentence.** A sentence whose only job is to explain why the previous sentence mattered.
- **Fractal summary.** A summary at page level, section level and card level. The reader is told the same thing four times at four scales.
- **Over-signposting.** "In this section we will examine...", "Having established X, we now turn to Y."

**Substance:**

- **The universal sentence.** True of every competitor. The master tell.
- **The unanchored figure.** A number with no year, unit, source or comparison. Good copy writes `AED 20.77 billion, revenue in 2025 (20% YoY growth)`. Weak copy writes "significant growth".
- **The explained figure.** A paragraph telling the reader what a number means. If the figure needs a paragraph, the wrong figure was chosen.
- **Intention in place of action.** `aims to`, `seeks to`, `is committed to`, `strives to`, `is designed to`, `works to`. Each converts something checkable into something unfalsifiable.
- **Vague attribution.** "Industry experts", "leading standards", "international best practice". Name the standard and its number or drop the claim.
- **Hedging stacks.** "may potentially help to somewhat improve".

**Rhythm:**

- **Uniform sentence length.** The most reliable statistical signature there is: 15 to 18 words, every time. Human writing lurches, a 25-word sentence then a 4-word one.
- **The tricolon reflex.** "Develops, manages, and operates." One is elegant; three per page is a pattern, and readers feel patterns before they identify them.
- **Anaphora across items.** Five cards each opening "Acme Group's...".
- **Synonym cycling.** Refusing to repeat a noun, so "communities" becomes "developments" becomes "residential assets" within one section. Repeat the noun. Repetition reads as confidence; cycling reads as a thesaurus.
- **Negative parallelism.** "Not just a developer, but a partner." Manufactured profundity through a reversal carrying no information.
- **Manufactured suspense.** "Here's what sets us apart." "The result?"
- **Long dash clusters.** A dense run of em dashes is a recognizable habit, and many clients ban them outright. House rule here bans them entirely.

**Surface vocabulary**, the layer everyone reaches for first and the one that matters least. The measured set, from analysis of 14.2 million PubMed abstracts and of scientific English before and after ChatGPT's release: *delve, intricate, commendable, meticulous, surpass, elevate, foster, tapestry, realm, navigate, landscape, pivotal, resonate, testament, underscore, showcasing, compelling, paramount, crucial, unwavering, alignment.* "Delves" appeared at roughly 25 times its expected rate after release, and at least 13.5% of 2024 PubMed abstracts show these fingerprints ([arXiv 2412.11385](https://arxiv.org/pdf/2412.11385), [medRxiv 2024.05.14.24307373](https://www.medrxiv.org/content/10.1101/2024.05.14.24307373.full.pdf), [FSU News](https://news.fsu.edu/news/science-technology/2025/02/17/why-does-chatgpt-delve-so-much-fsu-researchers-begin-to-uncover-why-chatgpt-overuses-certain-words/)).

Corporate and institutional writing has its own set, which the academic lists miss entirely: *world-class, best-in-class, state-of-the-art, cutting-edge, unparalleled, seamless, robust, holistic, vibrant, bespoke; leverage, utilise, empower, unlock, harness, drive, enable, facilitate, spearhead; committed to excellence, dedicated to delivering, we pride ourselves on, our mission is to; in today's, in an era of, moreover, furthermore, it's worth noting, when it comes to; serves as, stands as, plays a pivotal role, positions itself as; journey, ecosystem, redefining, reimagining, at the heart of, more than just;* and false ranges such as *"from strategy to execution"*, whose endpoints are not a real spectrum.

Two cautions on any word list. It generalizes badly across industries: "delve" and "tapestry" never appear in property copy, so a checker built on the academic list will pass a page that is nothing of the kind. And a good writer can use a listed word well. **Treat a hit as a prompt to look, not a verdict.**

### 8.2 What is not a tell

Over-correction produces its own artificial voice. These are fine, and a checker must not flag them:

- A short page. Terseness is the target.
- A repeated noun. That is discipline.
- A sentence fragment. `Held long term, operated in-house.` One blind reviewer named fragments as evidence of a *human* writer, because a machine adds the verb.
- A technical term a general reader will not know, when the audience is not general.
- A bare list with no descriptions. Major groups list five divisions as five words.
- A number with no adjective. `95,161 beds` needs nothing.
- Plain "is". Not every "is" needs upgrading to "serves as".

### 8.3 The rules that remove it

1. **Substitution test on every sentence.** Swap in a competitor's name. Still true, delete it.
2. **Self-restatement test on every card, list item and caption.** Cover the description, read the label. If the description adds nothing, delete the field. Do not reword it; put a fact there or remove it.
3. **Layer count.** Ceiling is kicker, heading, one sentence. If the cards carry their own labels, the section usually gets no lead sentence at all. Verify this against the sector: it held absolutely across four institutional property groups and in UK facilities management, but three of four private credit funds did have a lead, so the structural prohibition is sector-specific even though the underlying fault (the lead saying what the cards say) is universal.
4. **Vary sentence length deliberately.** Put a five-word sentence next to a twenty-word one. Enforce it: standard deviation of sentence length **>= 6 words** over any 10-sentence window.
5. **Present tense, and the verb the organization actually performs.** No `aims to`, no `is committed to`.
6. **Do not open consecutive items with the same words.**
7. **Repeat nouns rather than cycling synonyms.**
8. **Write three independent drafts from different entry points** (figure-first, place-first, reader-first) and judge them, rather than editing one draft repeatedly. An edited draft converges on the voice it started in, which is the voice being rejected.
9. **Never invent a figure to fill a slot.** A number a client must correct is an embarrassment; a number a journalist can disprove is a liability. If a figure is unavailable, leave the slot out or say so visibly.
10. **No em dashes and no en dashes.** Use a comma, a colon, a semicolon, or split the sentence. Write ranges as `45 to 90`.

### 8.4 Runnable checks

```regex
# academic and general LLM lexicon
/\b(delve[sd]?|delving|intricate|commendable|meticulous(ly)?|surpass|elevate|
   foster|tapestry|realm|navigate|landscape of|pivotal|resonate|testament to|
   underscore[sd]?|showcasing|compelling|paramount|unwavering)\b/i

# corporate lexicon
/\b(world-class|best-in-class|state-of-the-art|cutting-edge|seamless(ly)?|robust|
   holistic|bespoke|leverage|utilis[ez]e|empower|unlock|harness|spearhead)\b/i

# intention instead of action
/\b(aims? to|seeks? to|strives? to|is committed to|is designed to|works? to)\b/i

# negative parallelism
/\bnot (just|only|merely) [^.,;]{2,60}[,;]? but\b/i
/\bit'?s not (just )?(about )?[^.]{2,60}[,;] it'?s\b/i

# openers and bridges
/\bIn today'?s [a-z-]+ (world|landscape|environment|market)\b/i
/^(Moreover|Furthermore|Additionally|In conclusion|It'?s worth noting)\b/im

# manufactured suspense
/\b(Here'?s what sets .{2,40} apart|The result\?|But here'?s the thing)\b/i

# pompous copulas
/\b(serves as|stands as|plays a (key|vital|pivotal|crucial) role|positions itself as)\b/i

# long dashes (banned outright): match by codepoint, never by literal glyph
/[\u2013\u2014]/

# vague attribution
/\b(industry experts|leading standards|international best practice|studies show)\b(?![^.]*\[)/i
```

Statistical checks, which catch what regexes cannot:

```
sentence_length_stdev(window=10) >= 6.0
paragraph_length_stdev >= 25 words             # uniform paragraphs are a tell
tricolon_count_per_400_words <= 1              # /\b\w+, \w+,? and \w+\b/ patterns
repeated_opening_bigram_across_siblings == 0   # cards, bullets, list items
type_token_ratio_on_key_nouns:  prefer repetition, flag synonym chains
claims_without_figure / total_claims <= 0.5
figures_without_unit_or_date == 0
long_dash_count == 0
```

### 8.5 Translation, English and Arabic

The failure mode of machine translation in documents is not mistranslation, it is **a target text with source-language syntax**, which reads as foreign to a native reader even when every word is correct.

**The governing principle.** Translate meaning for the target reader, not form (dynamic rather than formal equivalence). Formal equivalence produces confusing results for idioms and for culturally loaded text; the purpose of the target document decides how far to go ([equivalence in English-Arabic idiom translation](https://awej-tls.org/wp-content/uploads/2024/10/9.pdf), [relevance theory and translated Arabic idioms](https://www.nature.com/articles/s41599-024-02961-2)).

**Rules, in order of application:**

1. **Translate the unit of meaning, not the sentence.** A clause may become a sentence; two sentences may merge. Preserving sentence boundaries one to one is the primary cause of translationese.
2. **Idiom handling, in this order:** (a) an existing target idiom with the same sense, even if the image differs; (b) a target idiom with a different image but the same force; (c) plain non-idiomatic paraphrase of the sense; (d) literal rendering plus a gloss, only for religious, legal or literary text where the source image matters. Never a literal calque of an image the target culture does not use.
3. **Re-write for the target reader's expectations, not the source's.** English business prose is short-sentenced, subject-first, and light on connectives. Formal Arabic tolerates and expects longer periods, more coordination with و and ف, and a more elaborate register. A one-to-one rendering makes English sound choppy in Arabic and makes Arabic sound bloated in English.
4. **English to Arabic: raise the register, not the word count.** Business Arabic is more formal than business English but should not be more verbose. Cut English filler entirely rather than finding Arabic equivalents for it. Expect the Arabic to run **20 to 25% fewer characters** and about the same rendered width.
5. **Arabic to English: cut coordination and hedging.** Split long coordinated periods into separate sentences. Drop honorific and ceremonial formulas that carry no information in English. Convert the Arabic preference for nominal constructions (المصدر) into English verbs: `تم إجراء تقييم` becomes `We assessed`, not `An assessment was conducted`.
6. **Never translate names, standards, units or figures.** Keep the Latin brand name in Latin script, keep standard codes as they are, keep the numeral system consistent with the document's declared choice.
7. **Localize the non-linguistic content too.** Date format, currency, decimal separator, measurement units, examples, and the direction of any process diagram.
8. **Re-set the typography for the target script.** Line height goes from 1.4 to 1.7, containers get 10 to 15% slack, italics become weight, tracking goes to zero. See 2.6.
9. **Back-translation is a check, not a method.** Back-translate the ten highest-stakes sentences (figures, obligations, claims) and compare meaning, not wording. A back-translation that matches word for word means you translated formally, which is the failure, not the success.
10. **Terminology is fixed once, in a glossary, before translation starts.** Cycling Arabic synonyms for one English term across a document is the same tell as synonym cycling in monolingual copy, and in a technical document it is also an error.

**Checks:**

```
sentence_count_ratio(target, source) != 1.00    # exact parity is suspicious
avg_sentence_length(target) within target-language norm, not source's
glossary_terms rendered identically every occurrence
figures, units, dates, proper nouns: byte-identical or correctly localized, never paraphrased
no calqued idiom: flag literal renderings of source-culture images
arabic output: char_spacing == 0, italic == false, justified == false
digit_system consistent document-wide
```

---

## 9. The generator's pipeline

```
1  PLAN      outline -> sections -> one message per slide or section
             every message is an assertion containing a verb
2  SOURCE    attach a figure, date, name or source to each message
             messages with none are candidates for deletion, not for padding
3  TOKENIZE  resolve the design tokens: page geometry, type scale, spacing scale,
             palette derived from one brand hue, status palette
4  VALIDATE  contrast, CVD separation, scale membership   [before any rendering]
5  LAYOUT    map each message to a named layout; enforce layout variety
6  WRITE     content into the layout, under the region word budgets
7  PROSE QA  regex set plus statistical checks of section 8; substitution and
             self-restatement tests on every card, caption and list item
8  RENDER    produce the file, then rasterize it
9  VISUAL QA overflow first, then overlaps, gaps, alignment, margins, contrast,
             leftover placeholder text
10 FILE QA   schema validation; formula recalculation for workbooks
11 FIX       fix in the generator, never by hand-editing the output
```

Steps 4, 7, 9 and 10 are the ones that separate this from a template filler. Step 9 is not optional: the first render of generated output nearly always contains real defects, and text overflow is the most common and the most visible.

---

## Sources

- [Gamma, Beyond bullet points: smarter slide design](https://gamma.app/insights/beyond-bullet-points-smarter-slide-design-in-gamma)
- [Gamma, How many slides should you have in a presentation](https://gamma.app/insights/how-many-slides-per-presentation)
- [Beautiful.ai, Smart Slides](https://www.beautiful.ai/smart-slides)
- [Microsoft, Create a new presentation with Copilot in PowerPoint](https://support.microsoft.com/en-us/powerpoint/copilot/create-a-new-presentation-with-copilot-in-powerpoint)
- [Butterick, Summary of key rules](https://practicaltypography.com/summary-of-key-rules.html)
- [Butterick, Line length](https://practicaltypography.com/line-length.html)
- [Butterick, Line spacing](https://practicaltypography.com/line-spacing.html)
- [Typography Master, Type scale systems](https://www.typographymaster.com/guide/type-scale-systems)
- [UAE Design System 2.0, Typography guidelines](https://designsystem.gov.ae/guidelines/typography)
- [Google Fonts, IBM Plex Sans Arabic](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic)
- [W3C WAI, Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [Spec FM, The 8-point grid](https://spec.fm/specifics/8-pt-grid)
- [The Designership, The 4-point grid system](https://www.thedesignership.com/blog/the-ultimate-spacing-guide-for-ui-designers)
- [IBCS, International Business Communication Standards](https://www.ibcs.com/)
- [Edward Tufte, Book design: advice and examples](https://www.edwardtufte.com/notebook/book-design-advice-and-examples/)
- [Tufte-LaTeX sample book (booktabs table convention)](https://ctan.math.washington.edu/tex-archive/macros/latex/contrib/tufte-latex/sample-book.pdf)
- [The FAST Standard for financial model design](https://www.fast-standard.org/)
- [Wall Street Oasis, Financial model number formatting](https://www.wallstreetoasis.com/resources/financial-modeling/financial-model-formatting-numbers)
- [arXiv 2412.11385, Why Does ChatGPT "Delve" So Much?](https://arxiv.org/pdf/2412.11385)
- [medRxiv, Delving into PubMed records: terms in medical writing after ChatGPT](https://www.medrxiv.org/content/10.1101/2024.05.14.24307373.full.pdf)
- [FSU News, Why does ChatGPT delve so much](https://news.fsu.edu/news/science-technology/2025/02/17/why-does-chatgpt-delve-so-much-fsu-researchers-begin-to-uncover-why-chatgpt-overuses-certain-words/)
- [Reuters Institute, How AI-generated prose diverges from human writing](https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters)
- [tropes.fyi trope directory](https://tropes.fyi/directory)
- [AWEJ-TLS, Equivalence in English-Arabic idiom translation](https://awej-tls.org/wp-content/uploads/2024/10/9.pdf)
- [Humanities and Social Sciences Communications, Recreating relevance: translated Arabic idioms](https://www.nature.com/articles/s41599-024-02961-2)

**Primary sources read on this machine** (not public URLs): the bundled Claude `pptx`, `xlsx` and `docx` skills (`SKILL.md` in each), the bundled `dataviz` skill (`references/color-formula.md`, `references/marks-and-anatomy.md`, `references/anti-patterns.md`), and the local `institutional-copy` skill (`SKILL.md` and `references/tells.md`). The deck anti-pattern list in 3.6, the mark specs in 7.3, the color checks in 3.4, the Excel formats in 6.3 and the tells catalogue in 8.1 come from those files directly.


---

## 10. Adopted practice, recorded September 2026

Three rules taken from a study of a bilingual deck generator built for
Arabic first, kept here because they are mechanisms rather than looks.

**Measure the text, do not count its characters.** A character count says
an Arabic line and a Latin line of the same length are the same width,
and they are not. The house system measures against the installed face
and, where the imaging library has raqm, the Arabic is shaped before it
is measured. Everything that fits, grows or paginates reads from that one
measurement, so the builder and the lint never disagree.

**Fit in the model, never in the renderer.** PowerPoint's own shrink on
overflow recomputes its scale factor when the file opens, so the deck
that ships is not the deck that was checked. The type size is resolved
before the file is written.

**Grow as well as shrink, and snap to the scale.** A short line in a
large frame reads as a caption that got lost. Growing is capped by the
next role up the type scale rather than by a continuous factor, because
a factor gives 51 pt, which is on no role of anything and is exactly the
size soup the lint reports.

Three more rules, for any future feature that reads a brand out of an
image, taken from the same study's literature sweep:

- Analyze one image per call and merge the answers deterministically.
  Vision models aggregate several images badly.
- Never let a model free-type a hex value. Measure the colors from the
  pixels and let the model only assign roles to what was measured.
- Never let a model name a font. Have it return a typographic attribute
  vector and match that against a curated table with a deterministic
  scorer, then fix contrast afterwards by nudging lightness only.
