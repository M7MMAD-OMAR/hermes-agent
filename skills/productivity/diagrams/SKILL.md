---
name: diagrams
description: Draw diagrams with Mermaid and render them to SVG and PNG for documents, decks and reports.
version: 1.0.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [diagrams, mermaid, flowchart, sequence, architecture, svg, png]
    category: productivity
    related_skills: [docx, powerpoint, xlsx, pdf]
---

# Diagrams Skill

Turn a described structure into a picture a deliverable can carry. Mermaid is
the source (plain text, reviewable, editable later), and the renderer writes
SVG for anything vector and PNG for Word and PowerPoint, which cannot place an
SVG reliably.

## When to Use

Use it when the answer has a shape: a flow with decisions, a sequence between
parties, a system's parts and how they connect, a schedule, a hierarchy. A
diagram earns its place when it says something a paragraph would take three
tries to say. Do not decorate a document with one.

Do not use it for data. A trend, a comparison, a share of a total is a chart:
build those with the xlsx skill (native Excel charts) or the powerpoint skill.

## Prerequisites

Node with `npx` on PATH, and a Chromium (`chromium-browser`, `chromium`, or
Chrome). The renderer finds one itself, runs it headless with a throwaway
profile, and never touches a real browser profile. The first run downloads the
Mermaid CLI into the npm cache; later runs are offline.

## How to Run

```bash
scripts/diagram_render.py flow.mmd out/flow.png --also-svg
scripts/diagram_render.py --code "flowchart LR; A[Order]-->B[Ship]" out/flow.svg
scripts/diagram_render.py flow.mmd out/flow.png --theme neutral --background white --scale 3
```

Answers with `{"ok": true, "outputs": [...], "rtl": bool}` on stdout.

| Flag | Meaning |
|---|---|
| `--code` | diagram text instead of a source file |
| `--theme` | `default`, `neutral`, `dark`, `forest`, `base` |
| `--background` | `transparent`, `white`, or a hex colour |
| `--scale` | PNG pixel density; 2 is crisp on screen, 3 for print |
| `--width` | render width in px; omit for the natural size |
| `--font` | override the family; auto-selected for right-to-left text |
| `--also-svg` / `--also-png` | write the sibling format too |

## Procedure

1. **Decide the diagram is worth drawing.** Name the one thing the reader
   should take from it. If you cannot, write the sentence instead.
2. **Pick the type from what you are showing**, not from habit:
   `flowchart` for a process with decisions, `sequenceDiagram` for who says
   what to whom in order, `erDiagram` for data and its relations,
   `stateDiagram-v2` for a lifecycle, `gantt` for a schedule, `mindmap` or
   `flowchart` for a hierarchy. `graph` is the old name for `flowchart`.
3. **Write the source into the workspace**, as a `.mmd` file beside the
   document it serves. It is the editable original; the PNG is a build output.
4. **Render**, then **look at the picture** before shipping it. Overlapping
   labels, a node whose text spills out, an edge label sitting on an arrowhead:
   these are visible in a second and invisible in the source.
5. **Place it.** Word and PowerPoint take the PNG (`images` in the docx and
   pptx specs). Anything web takes the SVG.

## Making it read well

- **Left to right for a flow with few steps, top to bottom for many.**
  `flowchart LR` fits a slide; `flowchart TD` fits a page.
- **Six to nine nodes.** Past that, split it into two diagrams or group with
  `subgraph`. A diagram nobody can follow is worse than a list.
- **Label every decision edge** (`B -- yes --> C`), and phrase node text as a
  short noun or verb phrase, never a sentence.
- **Do not colour by decoration.** Colour when it encodes something: a failure
  path, an external system, the part under discussion. Otherwise leave the
  theme alone.
- **`--background white` for anything going into a document**, transparent only
  where the destination's own background should show through.
- **No em dashes or en dashes in labels**, in any language. Use a comma, a
  colon, or two shorter labels.

## Arabic, Persian, Urdu, Hebrew (right-to-left)

Mermaid's default font stack carries no Arabic face, so an Arabic diagram
renders as empty boxes unless one is named. The renderer detects RTL letters in
the source and selects an installed face (Cairo, IBM Plex Sans Arabic, Noto
Naskh Arabic, Amiri, Almarai, in that order); `--font` overrides it.

Mermaid lays nodes out left to right regardless of the script. For an Arabic
flow that reads naturally, write it `flowchart RL` (right to left) or `TD`
(top down), not `LR`.

## Pitfalls

- **A label containing `(`, `)`, `:` or a quote breaks the parser.** Wrap the
  text in quotes: `A["Order (paid)"]`.
- **`<br/>` is the only line break** inside a node label.
- **PNG width comes from the content**, so a wide diagram in a narrow column
  is scaled down by the document, not by the renderer. Use `--width` when the
  destination has a fixed column.
- **The first render is slow** (the CLI downloads). Render early in the task,
  not at delivery time.
- **A `gantt` needs real dates**; relative durations alone silently produce an
  empty chart.

## Verification

Open the PNG and read it as a stranger would. Every label legible, no
overlap, arrows pointing where the process actually goes, and the one thing
you named in step 1 visible without explanation.
