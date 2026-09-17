# Turning a client status deck into a closure report

Use when someone hands over their own weekly project deck and asks for it to be
brought up to date, closed out, or made "proper": every item finished, dates
that hold up, one tidy artifact.

## Read it before you touch it

```bash
python <house-style>/scripts/office_inspect.py theirs.pptx
python <powerpoint>/scripts/pptx_read.py theirs.pptx --outline > src-outline.json
python <powerpoint>/scripts/pptx_render.py theirs.pptx --outdir render
```

Then look at every slide. The text outline does not tell you that a week strip
wraps `W10` onto two lines, that a legend advertises three statuses nothing uses
anymore, or that a Gantt's bars contradict its own status table. Copy the file
into `work/`, edit the copy in place with python-pptx, and never rebuild a
corporate deck from a spec: the template carries the Gantt, the merged cells and
the brand faces, and a rebuild loses all three.

## Re-baselining is a decision, not a default

"Everything is finished" and "the dates must be real" pull against each other:
the tail of a plan usually sits in the future. Ask which one wins before you
write anything. A closed-project report needs every completion date on or before
today, which means moving the future milestones back, not relabelling them.
Then keep one rule and keep it everywhere: the status table, both Gantts, and the
meeting plan must give the same date for the same item, and no row may finish
before the item it depends on.

Before rewriting a date, look for the deck's own justification for it. A
decision shown as completed in September often has the meeting that produced it
in the stakeholder table in July; move it to that week and the change explains
itself.

## The pieces that always need attention

- **Week strip.** Its arrows overflow or wrap once the label count changes. Rebuild
  the strip from the plan's own week columns (one chevron per week, last one
  highlighted), set `wrap="none"` and zero the left/right insets, and drop the
  font one or two points: the chevron's text rectangle is inset by its own notch,
  which is why `W10` wrapped in the original.
- **Legend.** A status legend that no row uses is noise. Leave the one colour that
  is still true and delete the rest, widening the label if the shorter word is
  actually longer.
- **Gantt bars.** They are usually cell fills, not shapes. Clear the week cells
  and redraw each row as a contiguous bar from its start week to its completion
  week, so the picture and the table agree. Move the "We are here" connector and
  its label to the closing week, and clamp the label inside the table's right
  edge.
- **Dead tail columns.** If a second Gantt runs weeks past the closing date, trim
  the trailing columns and widen the remaining ones so the table keeps its width;
  drop three `gridCol` entries, three `tc` per row, and decrement the header's
  `gridSpan` by the same number.
- **Panels.** "Upcoming week" becomes "final week", and both side panels should
  list what actually closed, matching the table's dates.

## Verify, then look

`style_lint.py` gates the deck, and its word ceiling counts the week strip's
labels as words: a ten-line activity box plus fourteen chevrons lands near 70,
so trim the box rather than the table. The lint also fails on an en dash in the
client's own titles, which is the house rule, so fix it in the copy. Render all
slides and read them; the defects above are visual, and a text read passes every
one of them.
