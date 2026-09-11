---
name: research-report
description: Turn a question into a sourced, decidable report.
version: 1.0.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [research, report, market, competitors, evidence, sources, docx]
    category: research
    related_skills: [diagrams, docx, grounded-citations, herwork, house-style]
---

# Research Report Skill

A repeatable shape for the long deliverable that keeps coming back: a question,
real sources, a comparison, and a document someone acts on. It is the structure
and the discipline, not a script; the files are produced by the `docx`,
`diagrams` and `xlsx` skills.

## When to Use

A question whose answer is not in the model: what the competitors actually
charge, whether a market has room, which of three approaches to take, what a
regulation requires. Anything where being wrong is expensive and the reader
will ask "how do you know".

Not for: a summary of documents already in hand (just write it), a factual
lookup (answer it), an academic paper (`research-paper-writing`).

## The rule that makes it worth reading

**Every claim that could be checked carries where it came from.** A number
without a source is an opinion wearing a number's clothes. When you could not
verify something, say so in the sentence, not in a footnote nobody reads.

## Procedure

1. **Sharpen the question.** Write it in one sentence, and write the decision
   it feeds. "Should we build X" is not a question; "at what price does X clear
   its costs against the three tools people already pay for" is. Show it to the
   user before spending an hour on the wrong one.

2. **List what would answer it.** Four to eight specific things to find out,
   each one checkable. This list is the report's spine and the todo list the
   user watches.

3. **Gather, one source at a time.** Open each source in the browser and read
   it. Photograph what matters (`drive_preview action="look"`) when the layout
   is the information: a pricing table, a chart, a dashboard. Save the page or
   the file it offers into `work/`.

   Keep `work/sources.md` as you go, one row per source:

   ```
   | # | source | date read | what it establishes | confidence |
   ```

   Confidence is `verified` (read it directly), `reported` (a secondary source
   says so), or `estimated` (you inferred it). Never leave it blank.

4. **Build the comparison before the prose.** Most of these reports have a
   table at their centre: options against criteria. Build that table first, in
   a sheet if the numbers move, and let it tell you what the prose has to
   explain. A report whose table and text disagree is worse than either alone.

5. **Draw the one picture that helps.** A flow, a positioning map, a timeline.
   One, not five. `diagrams` skill.

6. **Write it in this order**, because it is the order a reader needs it:

   | Section | What goes in it |
   |---|---|
   | Answer | The question, answered, in three sentences. Before anything else. |
   | What it rests on | The three or four findings that drive the answer. |
   | The comparison | The table, with a sentence saying how to read it. |
   | Detail | One section per item from step 2, each ending in what it means. |
   | What would change this | The assumptions that, if wrong, flip the answer. |
   | Sources | The table from step 3, in full. |

   "What would change this" is the section that makes the report trustworthy.
   Write it honestly or leave it out.

7. **Attack it before the reader does.** Load `adversarial-doc-review` and run
   it against the draft, or at minimum answer these yourself: which number is
   weakest, which source is a vendor talking about itself, and what a reader
   who disagrees would say first.

8. **Deliver.** A `.docx` plus its PDF sibling. Keep `work/sources.md` and the
   saved pages; the evidence outlives the conversation and the next revision
   starts from it.

## Length

A decision report is 4 to 8 pages. Past that the reader skims and the answer
is lost. If the material genuinely needs more, the extra goes in an appendix
after the sources, not in the body.

## Pitfalls

- **Vendor pages are marketing.** A competitor's own pricing page is evidence
  of what they advertise, not what they charge. Mark it `reported`.
- **A date on every source.** Prices, headcounts and features go stale in
  weeks, and a report that does not say when it was true cannot be reused.
- **Do not average away disagreement.** When two good sources conflict, show
  both and say which you trust and why.
- **No em dashes or en dashes**, in any language. Use a comma, a colon, or a
  new sentence.
- **Arabic reports need the direction pass** (`docx` skill, `"rtl": "auto"`)
  and an Arabic-capable font, or every full stop lands on the wrong side.
