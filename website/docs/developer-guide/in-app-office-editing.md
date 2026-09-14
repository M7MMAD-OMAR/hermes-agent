# In-App Office Editing, or why the rail stops at "Open in app"

Status: feasibility study (not implemented, no code written). Written 2026-09-11
on `autobuild/sidebar-browser`; every anchor below was verified against that
branch.
Surfaces: `apps/desktop` renderer (`src/components/office`, right rail),
`apps/desktop/electron` (fs IPC, LibreOffice bridge), `apps/shared`.

The rail already draws a spreadsheet as a spreadsheet, a deck as slides and a
Word document as pages. It draws all of them read only, and every one of them
ends at the same button: "Open in app", which hands the file to LibreOffice and
the user to another window. This document asks what it would cost to end that
handoff, and answers that the cost is wildly different per format: for
spreadsheets almost everything is already installed, for decks half of it is,
for Word and PDF none of it is.

## Part 1. What already exists (reuse, do not rebuild)

| Element | Already exists | Anchor |
|---|---|---|
| Preview kind per path | `previewKind: 'binary' \| 'html' \| 'image' \| 'pdf' \| 'sheet' \| 'slides' \| 'text' \| 'word'` | `src/store/preview.ts:43`, assigned at `:173`, office repair at `:183` |
| Family table, one per process | `OFFICE_FAMILY_BY_EXTENSION`, `officeFamilyForPath`, `officeNeedsConversion` | `apps/shared/src/office-format.ts:19,40,46` |
| Office dispatch out of the file preview | `isOfficePreviewKind` gate, then `<OfficePreview>` | `src/app/chat/right-rail/preview-file.tsx:663,990` |
| One entry point for all three viewers | `OfficePreview`, lazy per format | `src/components/office/office-preview.tsx:30,71` |
| Spreadsheet grid: headers, frozen panes, merges, formula bar, sheet tabs | `SheetView` | `src/components/office/sheet-view.tsx` |
| Workbook to grid reduction | `readSheetBook` | `src/components/office/sheet-model.ts:339` |
| Number and date formatting, formula evaluation for display | `formatCellValue`, `evaluateFormula` | `src/components/office/excel-format.ts`, `excel-formula.ts` |
| Deck to one sanitised SVG per slide | `readDeck`, `renderSlideToSvg` | `src/components/office/slides-model.ts:11,12` |
| Word render | `docx-preview` | `src/components/office/word-view.tsx` |
| Word exact pages | LibreOffice to PDF, shown in an iframe | `src/components/office/office-preview.tsx:207,279` |
| PDF view | Chromium's own viewer over a blob URL | `preview-file.tsx:1043`, `src/lib/pdf-blob.ts` |
| OOXML bytes for any office path, converting first when needed | `readDesktopOfficeBytes` | `src/lib/desktop-fs.ts:153` |
| LibreOffice discovery and conversion | `findSoffice`, `sofficeSearchDirs`, `officeConvertForIpc` | `electron/office-preview.ts:94,120,155` |
| The conversion door | `hermes:officeConvert` | `electron/preload.ts:235`, `src/lib/desktop-fs.ts:126` |
| The escape hatch we want to stop using | `openDesktopFileExternally` to `shell.openPath` | `src/lib/desktop-fs.ts:143`, button at `office-preview.tsx:245,258` |
| Text save, hardened, local and remote | `hermes:fs:writeText`, `writeDesktopFileText` | `electron/fs-ipc.ts:187`, `electron/preload.ts:339`, `src/lib/desktop-fs.ts:97` |
| Path hardening (syntax and `~`, not a root allowlist) | `resolveRequestedPathForIpc` | `electron/hardening.ts:357` |
| Renderer hands bytes to main, main writes a file | `hermes:saveImageBuffer`, `writeComposerImage` | `electron/main.ts:17334,6200` |
| The editing pattern to copy wholesale | CodeMirror editor in the rail | `src/app/chat/right-rail/preview-file.tsx:455` to `:980` |
| Deliverables list that opens office files | `host.openPreview(entry.path)` | `src/plugins/hermes-herwork/pane.tsx:222` |

Nothing in Part 4 is a new subsystem for spreadsheets. It is one new IPC
channel, one retained object in an existing parser, and a copy of an editing
pattern that already ships.

## Part 2. What the rail can do today, per format

All four are read only. There is no writable office surface anywhere in the app.

| Format | Viewer | Library | State |
|---|---|---|---|
| `.xlsx`, `.xls`, `.ods` | `sheet-view.tsx` | `@office-kit/xlsx` 0.11.0 | A real grid: the workbook's own fills, fonts, widths, merges and freeze panes, a formula bar, one tab per sheet. Zero `input` and zero `contentEditable` in the file. |
| `.pptx`, `.ppt`, `.odp` | `slides-view.tsx` | `@office-kit/pptx` 0.12.0 and `@office-kit/pptx-preview` 0.9.1 | One sanitised SVG string per slide, rendered lazily through a queue, plus title and notes. |
| `.docx`, `.doc`, `.odt`, `.rtf` | `word-view.tsx` | `docx-preview` 0.4.0 | Flowing render, plus a "Pages" mode that is LibreOffice's PDF in an iframe (`office-preview.tsx:207`). |
| `.pdf` | none of ours | none | Chromium's built in viewer over a blob URL. No pdfjs, no pdf-lib in the tree. |

Legacy and OpenDocument files never reach a viewer in their own form. They are
converted to their OOXML sibling by LibreOffice first, and only the conversion
is parsed: `readDesktopOfficeBytes` at `src/lib/desktop-fs.ts:153` branches on
`officeNeedsConversion`. Remember this; Part 5 turns it into a trap.

The herwork pane is a consumer of all of the above and adds nothing to it. Its
Delivered section lists `output/` newest first and, for a previewable name,
calls `host.openPreview(entry.path)`, falling back to `revealPath`
(`src/plugins/hermes-herwork/pane.tsx:215` to `:235`). The three desk folders
open in the OS file manager (`pane.tsx:270`). So the desk's whole answer to
"the job produced a spreadsheet" is today "here is a picture of it, and here is
LibreOffice".

## Part 3. The editing pattern that already ships

`src/app/chat/right-rail/preview-file.tsx` already contains a complete,
conflict-aware file editor for text, backed by CodeMirror 6. It is the template,
and an office editor that does not copy it will be worse in specific, known
ways.

| Behaviour | Where |
|---|---|
| `dirty` held in a ref, one render flip at the clean to dirty boundary | `:641`, `:647`, `:810` |
| Tab close guard told about unsaved work | `setPreviewDirty(target.url, editing && dirty)` at `:822` |
| Stale on disk check: re-read, compare against the baseline the user started from | `:901` to `:915` |
| Conflict banner with Overwrite and Discard, `force` re-entry | `:918`, `:945` to `:965` |
| Write, then reset baseline, clear dirty, leave edit mode | `:918` to `:924` |
| Tell the workspace and reload self | `notifyWorkspaceChanged()`, `setSelfReload` at `:923` |
| Save and Cancel controls in the same fixed height header as the read view | `EditControls` at `:455`, note at `:935` |

The stale on disk check is not decoration. In this app an agent can be writing
the same file while the user has it open, and that check is what stops a save
from silently reverting an agent's work. Any office editor inherits that hazard
the moment it can write.

Kanban (`src/plugins/kanban/`) is the other editable surface, but it writes
through the backend REST API (`src/plugins/kanban/api.ts:287`), not the
filesystem, so it is not a model here.

## Part 4. The one missing primitive: a binary write

There is no way for the renderer to write bytes to an arbitrary path.
`hermes:fs:writeText` is UTF-8 only, caps content at 1,000,000 characters, and
requires the parent directory to exist (`electron/fs-ipc.ts:187` to `:209`).
Every option in Part 5, including the cheapest one, is blocked on this and
nothing else.

Three facts make it a small addition rather than a policy argument:

1. **Reads already cross IPC as bytes.** `readDesktopFileDataUrl`
   (`src/lib/desktop-fs.ts:113`) returns a base64 data URL and `dataUrlBytes`
   (`:168`) decodes it. The write is the mirror of a door that is already open.
2. **Bytes from the renderer are already written to disk.**
   `hermes:saveImageBuffer` takes renderer supplied data, `Buffer.from`s it and
   writes it (`electron/main.ts:17334` to `:17344`, `writeComposerImage` at
   `:6200`). The pattern is accepted; that handler just cannot be reused,
   because it forces the destination into `userData/composer-images`.
3. **Hardening does not stand in the way.** `resolveRequestedPathForIpc`
   (`electron/hardening.ts:357`) rejects unsafe path syntax and expands `~`. It
   is not a root allowlist, so a byte write reusing it reaches the herwork
   `output/` directory, or wherever else the user's file already sits, with no
   new policy.

The shape to add, next to the text write in the same file:

- `ipcMain.handle('hermes:fs:writeBytes', ...)` in `electron/fs-ipc.ts`, mirroring
  `writeText` exactly: same `resolveRequestedPathForIpc`, same parent must exist
  rule, a size cap sized for documents rather than for notes, and a write of a
  `Buffer` instead of a UTF-8 string.
- `writeBytesFile` on the preload bridge beside `writeTextFile`
  (`electron/preload.ts:339`).
- `writeDesktopFileBytes` in `src/lib/desktop-fs.ts` beside
  `writeDesktopFileText` (`:97`), including the decision about remote mode
  described in Part 5.

## Part 5. Three options, with real cost

### Option A. Light in-app editing

Edit the document's own model in the rail and write the file back. For
spreadsheets, every library piece is already installed.
`@office-kit/xlsx` exports the mutation surface (`setCell`, `setCellByCoord`,
`setCellValue`, `setFormula`, `setRangeValues`, `mergeCells`, `setColumnWidth`
and the rest, in `dist/worksheet/index.d.ts` and `dist/cell/index.d.ts`) and the
serialization surface (`saveWorkbook`, `workbookToBytes`, `toBlob`, in
`dist/io/index.d.ts`). The grid, the selection and the formula bar exist. What is
missing is cell entry in `sheet-view.tsx`, the binary write of Part 4, and the
Part 3 pattern wired into the office toolbar.

Estimate for spreadsheets alone: roughly 1 to 2 weeks including the four traps
below, not counting the polish of undo and multi-cell paste.

### Option B. Full WYSIWYG

For Word this means a new writer dependency plus a bidirectional model between
OOXML and a rich text editor. Neither TipTap nor ProseMirror is installed; the
only editor in the tree is CodeMirror, and the only rich rendering is Markdown
(`streamdown`, `remend`). `docx-preview` is a renderer and cannot write. The hard
part is not the UI, it is round-tripping features the model does not understand
without quietly dropping them. For decks it additionally means replacing the SVG
rasterizer with a hit-testable scene graph. This is months and a different
product, and it is not the next step.

### Option C. An external engine, which is two options at two prices

- **Cheap.** Keep using the LibreOffice machinery that already exists
  (`electron/office-preview.ts:94,120,155`), but drive it on the way out as well
  as on the way in: edit as OOXML in the app, convert back to `.ods`, `.doc` or
  `.odp` on save. This is the honest fix for the legacy and ODF trap below, and
  it costs little beyond a second direction in an existing handler. Note that
  LibreOffice is not guaranteed present; `convertDesktopOffice` already surfaces
  that case (`src/lib/desktop-fs.ts:133`).
- **Expensive.** Collabora or OnlyOffice embedded over WOPI. The window and embed
  plumbing exists (`electron/browser-windows.ts`, `electron/embed-referer.ts`,
  `electron/preview-reach.ts`), but there is no WOPI host code at all and it
  needs a server process shipped or hosted. That is a different order of
  magnitude and it changes how the app is distributed.

## Part 6. Four traps on the spreadsheet path

1. **Legacy and ODF must be refused, or become Save As.**
   `readDesktopOfficeBytes` (`src/lib/desktop-fs.ts:153`) hands the viewer
   LibreOffice's converted OOXML for `.xls`, `.ods`, `.doc`, `.odt` and `.ppt`.
   Writing those bytes back to the original path replaces an ODS with an XLSX
   that is still named `.ods`. `officeNeedsConversion()`
   (`apps/shared/src/office-format.ts:46`) is the exact gate: either disable
   editing for those files, or route the save through the cheap half of Option C.
2. **Mutate the `Workbook`, never the grid.** `readSheetBook`
   (`src/components/office/sheet-model.ts:339`) loads a `Workbook`, reduces it to
   a flat per sheet grid and then discards the workbook. The reduction is lossy by
   design and it truncates at `SHEET_MAX_COLUMNS = 256` and
   `SHEET_MAX_CELLS = 400,000` (`sheet-model.ts:29,38`). Re-serializing from the
   grid would silently delete charts, pivots, validations and every row past the
   cap. Concretely: `readSheetBook` must return the workbook handle alongside the
   `SheetBook`, edits apply to the workbook, and the grid is re-derived from it.
3. **Remote mode.** `writeDesktopFileText` already has a remote branch, a POST to
   `/api/fs/write-text` (`src/lib/desktop-fs.ts:105`), and spreadsheet reads do
   work remotely through `read-data-url`. But `convertDesktopOffice` throws
   "local connections only" (`:126` to `:133`). So an editor must either gain a
   gateway write-bytes endpoint or refuse to edit when
   `isDesktopFsRemoteMode()` (`:47`) is true. Refuse first, ship, add the
   endpoint after.
4. **Formulas.** `src/components/office/excel-formula.ts` is a 626 line
   evaluator built for display, reading cached values where it can. Editing
   forces a decision the viewer never had to make: recompute dependents in the
   renderer, or write a cell whose cached value is now stale and let the next
   real spreadsheet recompute it. The second is defensible and much cheaper, but
   it must be a decision, not an accident.

## Part 7. Decks, and why on-canvas editing is blocked

`@office-kit/pptx` already ships the mutation and save surface that decks need:
`setShapeText`, `setShapeRunText`, `setSlideTitle`, `setSlideBody`,
`setTableCellText`, `replaceTextInSlide`, and `savePresentation`. The model side
of deck editing is, like spreadsheets, already in `node_modules`.

The view side is not. `readDeck` renders each slide to an SVG string through
`renderSlideToSvg` and the component inserts that markup
(`src/components/office/slides-model.ts:11,12`). The result is a picture: there
is no mapping from a pixel the user clicked back to the shape that produced it,
and the SVG is additionally scrubbed of elements and handlers before insertion
(`slides-model.ts:33` onward), so attaching behaviour to it is against the grain
of the sanitiser.

Therefore deck editing should be a side panel, not a canvas: list the slide's
shapes and placeholders as text fields, edit the text there, write through
`setShapeText` and friends, then re-render that one slide's SVG. The user gets
"fix the wording on slide 4" without the app pretending to be PowerPoint.

## Part 8. Recommendation, in phases, with what each one does not give

**Phase 1: spreadsheet cell editing.** Add `hermes:fs:writeBytes`, retain the
`Workbook` in `sheet-model.ts`, make cells editable in `sheet-view.tsx`, and wire
the Part 3 dirty, baseline, conflict and save pattern into the office toolbar.
Gate on local mode and on `officeNeedsConversion`.
What it does not give: no `.ods` or `.xls` editing, no editing over a remote
connection, no row and column insertion, no chart or pivot authoring, no
recalculation of dependents beyond whatever Part 6 trap 4 decides, and nothing at
all for Word, decks or PDF.

**Phase 2: deck text through a side panel.** Shape list per slide, text edits
through `setShapeText` and `setSlideTitle`, `savePresentation` through the same
write channel, one slide re-rendered on save.
What it does not give: no moving, resizing, restyling or adding shapes, no
editing on the slide itself, no image or chart work, no new slides.

**Phase 3: Word.** This is where the cheap options run out. It needs a writer
dependency that does not exist in the tree today and a model that survives
round-tripping. Treat it as its own design document, and do not start it before
Phases 1 and 2 have been used in anger.
What it does not give, even when done: PDF stays read only, because nothing in
the tree can author a PDF and Chromium's viewer is not ours to extend.

## Out of scope, deliberately

- **PDF editing and annotation.** No pdfjs, no pdf-lib, and the viewer is
  Chromium's. A separate decision with a separate dependency.
- **Collaborative or multi-cursor editing.** The rail is a single user surface
  and the conflict model here is "an agent touched the file", solved by the
  baseline check, not by CRDTs.
- **Replacing LibreOffice as the conversion engine.** It stays the way legacy and
  ODF files are read, and under Option C it may also become the way they are
  written.
- **Changing the herwork pane.** It calls `host.openPreview` and inherits every
  improvement to the rail for free (`src/plugins/hermes-herwork/pane.tsx:222`).
  No plugin change is required by any phase above.
- **A general purpose "save as" dialog.** Phase 1 writes back to the file that
  was opened. Anything else is a separate surface.
