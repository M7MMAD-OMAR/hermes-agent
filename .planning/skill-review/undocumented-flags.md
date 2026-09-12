# Undocumented command line surface in the office skills

Read only audit, 12 Sept 2026. Branch `autobuild/sidebar-browser`.

Scope: every script under `skills/productivity/{docx,powerpoint,xlsx,pdf,house-style}/scripts/*.py`,
excluding the shared helper modules `house_common.py`, `docx_common.py`, `pptx_common.py` and
`pdf/scripts/_raster.py`, which carry no command line of their own: `_raster.py` is the shared
pypdfium2 and pdftoppm fallback behind `pdf_page_image.py` and prints nothing for `--help`.

Method: each script was run with `venv/bin/python <script> --help`, and each real subcommand
with `<script> <sub> --help`. Flags were taken from the `usage:` block, so text that only looks
like a flag in a description or an epilogue is not counted. `-h` and `--help` are excluded.

Rules used for the `documented` column, applied the same way everywhere:

1. A flag counts as documented when its exact spelling appears anywhere in that skill's
   `SKILL.md`, in prose or in a fenced example, matched with a right hand boundary so that
   `--font` is not credited by `--font-size`.
2. `-o` and `--output` are one option, so a script's output flag counts as documented when
   either spelling appears anywhere in that `SKILL.md`.
3. Only `SKILL.md` counts. A flag that is documented in a file under `references/` is listed
   here as undocumented, and the rows where that happens say so.

One script takes no optional flag at all and so contributes no row: `docx_validate.py`, which
takes a path and nothing else. The same is true of these subcommands, which take only their
positional file: `docx_embed_fonts.py verify`, `pptx_embed_fonts.py verify`,
`docx_revisions.py list`, `pptx_comments.py list` and `xlsx_comments.py list`.

## Counts

| skill | flags on the command line | undocumented | undocumented, repeated facts collapsed |
|---|---|---|---|
| docx | 66 | 4 | 4 |
| powerpoint | 46 | 9 | 8 |
| xlsx | 73 | 16 | 10 |
| pdf | 106 | 24 | 21 |
| house-style | 8 | 4 | 4 |
| total | 299 | 57 | 47 |

The collapsed column merges rows that are one fact repeated across subcommands: the seven
`xlsx_comments.py` output flags are one omission, `--icon-size` on three `pdf_annotate.py`
subcommands is one, `--no-popup` on two is one, and `--family` on two `pptx_embed_fonts.py`
subcommands is one.

# Part 1: the complete inventory

## docx
| script | subcommand | flag | documented | what the flag does |
|---|---|---|---|---|
| `docx_comments.py` | list | `--json` | yes | flat list (default) or a thread tree |
| `docx_comments.py` | add | `--target` | yes | anchor: first occurrence of this text |
| `docx_comments.py` | add | `--text` | yes | comment body |
| `docx_comments.py` | add | `--author` | yes | author name recorded on the comment |
| `docx_comments.py` | add | `--initials` | no | initials shown on the comment bubble |
| `docx_comments.py` | add | `--xml` | no | force the XML fallback (skip native API) |
| `docx_comments.py` | add | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_comments.py` | reply | `--id` | yes | comment id to reply to |
| `docx_comments.py` | reply | `--text` | yes | reply body |
| `docx_comments.py` | reply | `--author` | yes | author name recorded on the comment |
| `docx_comments.py` | reply | `--initials` | no | initials shown on the comment bubble |
| `docx_comments.py` | reply | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_comments.py` | resolve | `--id` | yes | any comment id in the thread |
| `docx_comments.py` | resolve | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_comments.py` | reopen | `--id` | yes | any comment id in the thread |
| `docx_comments.py` | reopen | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_comments.py` | delete | `--id` | yes | comment id |
| `docx_comments.py` | delete | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_comments.py` | delete-thread | `--id` | yes | any comment id in the thread |
| `docx_comments.py` | delete-thread | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_create.py` | (none) | `--rtl` | yes | build the file right to left for Arabic |
| `docx_create.py` | (none) | `--no-theme` | yes | build on Word's stock template instead of the house design system |
| `docx_edit.py` | replace | `--find` | yes | text to search for |
| `docx_edit.py` | replace | `--replace` | yes | replacement text |
| `docx_edit.py` | replace | `--body-only` | yes | skip headers/footers |
| `docx_edit.py` | replace | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | set-cell | `--table` | yes | table index |
| `docx_edit.py` | set-cell | `--row` | yes | row index inside the table |
| `docx_edit.py` | set-cell | `--col` | yes | column index inside the table |
| `docx_edit.py` | set-cell | `--text` | yes | the text to write |
| `docx_edit.py` | set-cell | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | insert | `--index` | yes | paragraph index to act on |
| `docx_edit.py` | insert | `--text` | yes | the text to write |
| `docx_edit.py` | insert | `--style` | yes | paragraph style name to apply |
| `docx_edit.py` | insert | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | delete | `--index` | yes | paragraph index to act on |
| `docx_edit.py` | delete | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | style | `--index` | yes | paragraph index to act on |
| `docx_edit.py` | style | `--style` | yes | paragraph style name to apply |
| `docx_edit.py` | style | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | normalize | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | direction | `--mode` | yes | text direction: auto, on or off |
| `docx_edit.py` | direction | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | toc | `--index` | yes | body paragraph index to insert before (default 0) |
| `docx_edit.py` | toc | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_edit.py` | page-numbers | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_embed_fonts.py` | embed | `--family` | yes | restrict to this family, repeatable |
| `docx_embed_fonts.py` | embed | `--allow-unlicensed` | yes | embed a face whose licence file was not found |
| `docx_embed_fonts.py` | embed | `--report` | no | report only, write nothing |
| `docx_embed_fonts.py` | embed | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_embed_fonts.py` | report | `--family` | yes | restrict to this font family, repeatable |
| `docx_embed_fonts.py` | report | `--allow-unlicensed` | yes | embed a face whose licence file was not found |
| `docx_graphics.py` | (none) | `--into` | yes | an existing .docx to append to |
| `docx_graphics.py` | (none) | `--no-theme` | yes | build on Word's stock template instead of the house design system |
| `docx_read.py` | (none) | `--text` | yes | extract all text as JSON |
| `docx_read.py` | (none) | `--structure` | yes | outline JSON |
| `docx_read.py` | (none) | `--styles` | yes | styles used, JSON |
| `docx_read.py` | (none) | `--images` | yes | extract images to DIR |
| `docx_read.py` | (none) | `--revisions` | yes | detect tracked changes / comments |
| `docx_revisions.py` | accept-all | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_revisions.py` | reject-all | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_revisions.py` | accept | `--id` | yes | revision id (w:id) |
| `docx_revisions.py` | accept | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_revisions.py` | reject | `--id` | yes | revision id (w:id) |
| `docx_revisions.py` | reject | `-o/--output` | yes | write to this path instead of editing in place |
| `docx_template.py` | (none) | `--strict` | yes | fail if any token remains unfilled |

## powerpoint
| script | subcommand | flag | documented | what the flag does |
|---|---|---|---|---|
| `pptx_comments.py` | add | `--slide` | yes | slide number, 1 based |
| `pptx_comments.py` | add | `--text` | yes | the text to write |
| `pptx_comments.py` | add | `--author` | yes | author name recorded on the comment |
| `pptx_comments.py` | add | `--initials` | no | initials shown on the comment bubble |
| `pptx_comments.py` | add | `--shape` | no | anchor to this shape name or id |
| `pptx_comments.py` | add | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_comments.py` | reply | `--id` | yes | thread or reply id |
| `pptx_comments.py` | reply | `--text` | yes | the text to write |
| `pptx_comments.py` | reply | `--author` | yes | author name recorded on the comment |
| `pptx_comments.py` | reply | `--initials` | no | initials shown on the comment bubble |
| `pptx_comments.py` | reply | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_comments.py` | resolve | `--id` | yes | id of the item to act on |
| `pptx_comments.py` | resolve | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_comments.py` | reopen | `--id` | yes | id of the item to act on |
| `pptx_comments.py` | reopen | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_comments.py` | delete | `--id` | yes | id of the item to act on |
| `pptx_comments.py` | delete | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_create.py` | (none) | `--rtl` | yes | build the file right to left for Arabic |
| `pptx_create.py` | (none) | `--no-theme` | yes | build on the stock Office template instead of the house design system |
| `pptx_edit.py` | (none) | `--output` | yes | save to this path instead of overwriting the input |
| `pptx_edit.py` | (none) | `--replace-text` | yes | replace text across the deck |
| `pptx_edit.py` | (none) | `--chart-data` | yes | rewrite a chart's data |
| `pptx_edit.py` | (none) | `--swap-image` | yes | swap a picture for another file |
| `pptx_edit.py` | (none) | `--remove-slide` | yes | delete a slide |
| `pptx_edit.py` | (none) | `--move-slide` | yes | move a slide to another position |
| `pptx_edit.py` | (none) | `--duplicate-slide` | yes | duplicate a slide |
| `pptx_edit.py` | (none) | `--set-background` | yes | set a slide background |
| `pptx_edit.py` | (none) | `--hyperlink` | yes | set a hyperlink on a cell |
| `pptx_edit.py` | (none) | `--enable-slide-number` | yes | turn on slide numbering |
| `pptx_edit.py` | (none) | `--set-footer` | yes | set the footer text |
| `pptx_edit.py` | (none) | `--set-notes` | yes | replace the speaker notes |
| `pptx_edit.py` | (none) | `--append-notes` | yes | add to the speaker notes |
| `pptx_embed_fonts.py` | embed | `--family` | no | restrict to this family, repeatable |
| `pptx_embed_fonts.py` | embed | `--allow-unlicensed` | yes | embed a face whose licence file was not found |
| `pptx_embed_fonts.py` | embed | `--report` | no | report only, write nothing |
| `pptx_embed_fonts.py` | embed | `-o/--output` | yes | write to this path instead of editing in place |
| `pptx_embed_fonts.py` | report | `--family` | no | restrict to this font family, repeatable |
| `pptx_embed_fonts.py` | report | `--allow-unlicensed` | yes | embed a face whose licence file was not found |
| `pptx_from_template.py` | (none) | `--values` | yes | JSON file mapping token -> replacement value |
| `pptx_from_template.py` | (none) | `--add-slides` | no | JSON spec of slides to append |
| `pptx_read.py` | (none) | `--outline` | yes | print full JSON outline (default) |
| `pptx_read.py` | (none) | `--notes` | yes | print speaker notes only |
| `pptx_read.py` | (none) | `--images` | yes | export embedded images into DIR |
| `pptx_render.py` | (none) | `--outdir` | yes | directory for PNGs (default: ./render) |
| `pptx_render.py` | (none) | `--prefix` | no | PNG filename prefix (default: slide) |
| `pptx_render.py` | (none) | `--dpi` | no | render resolution (default: 100) |

## xlsx
| script | subcommand | flag | documented | what the flag does |
|---|---|---|---|---|
| `csv_to_xlsx.py` | (none) | `--sheet-name` | no | name given to the sheet that is created |
| `csv_to_xlsx.py` | (none) | `--encoding` | yes | CSV file encoding (default utf-8) |
| `csv_to_xlsx.py` | (none) | `--delimiter` | yes | field delimiter |
| `csv_to_xlsx.py` | (none) | `--no-infer` | no | keep every cell as a string |
| `csv_to_xlsx.py` | (none) | `--plain` | no | skip header styling / freeze / autofilter |
| `xlsx_comments.py` | add | `--sheet` | yes | target sheet |
| `xlsx_comments.py` | add | `--cell` | yes | target cell address |
| `xlsx_comments.py` | add | `--text` | yes | the text to write |
| `xlsx_comments.py` | add | `--author` | yes | author name recorded on the thread |
| `xlsx_comments.py` | add | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | reply | `--id` | yes | thread or reply id |
| `xlsx_comments.py` | reply | `--text` | yes | the text to write |
| `xlsx_comments.py` | reply | `--author` | yes | author name recorded on the comment |
| `xlsx_comments.py` | reply | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | resolve | `--id` | yes | id of the item to act on |
| `xlsx_comments.py` | resolve | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | reopen | `--id` | yes | id of the item to act on |
| `xlsx_comments.py` | reopen | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | delete | `--id` | yes | id of the item to act on |
| `xlsx_comments.py` | delete | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | add-note | `--sheet` | yes | target sheet |
| `xlsx_comments.py` | add-note | `--cell` | yes | target cell address |
| `xlsx_comments.py` | add-note | `--text` | yes | the text to write |
| `xlsx_comments.py` | add-note | `--author` | yes | author name recorded on the comment |
| `xlsx_comments.py` | add-note | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_comments.py` | delete-note | `--sheet` | yes | target sheet |
| `xlsx_comments.py` | delete-note | `--cell` | yes | target cell address |
| `xlsx_comments.py` | delete-note | `-o/--output` | no | write to this path instead of editing in place |
| `xlsx_create.py` | (none) | `--rtl` | yes | build the file right to left for Arabic |
| `xlsx_create.py` | (none) | `--no-theme` | yes | leave the workbook on openpyxl's defaults instead of the house design system |
| `xlsx_edit.py` | (none) | `--sheet` | yes | target sheet (default: active) |
| `xlsx_edit.py` | (none) | `--out` | yes | output path (default: edit in place) |
| `xlsx_edit.py` | (none) | `--rename-sheet` | yes | rename a sheet, OLD:NEW |
| `xlsx_edit.py` | (none) | `--copy-sheet` | yes | copy a sheet, SRC:NEW |
| `xlsx_edit.py` | (none) | `--insert-rows` | yes | insert rows at IDX |
| `xlsx_edit.py` | (none) | `--delete-rows` | no | delete rows at IDX |
| `xlsx_edit.py` | (none) | `--insert-cols` | no | insert columns at COL |
| `xlsx_edit.py` | (none) | `--delete-cols` | yes | delete columns at COL |
| `xlsx_edit.py` | (none) | `--set` | yes | set one cell, CELL=VALUE |
| `xlsx_edit.py` | (none) | `--append` | yes | append a row given as JSON |
| `xlsx_edit.py` | (none) | `--add-table` | yes | create a native table, NAME:RANGE |
| `xlsx_edit.py` | (none) | `--table-append` | yes | append a row to a native table |
| `xlsx_edit.py` | (none) | `--list-tables` | yes | print tables on the target sheet and exit |
| `xlsx_edit.py` | (none) | `--define-name` | yes | define a workbook name, NAME=REF |
| `xlsx_edit.py` | (none) | `--delete-name` | yes | delete a workbook name |
| `xlsx_edit.py` | (none) | `--hyperlink` | yes | set a hyperlink on a cell |
| `xlsx_edit.py` | (none) | `--note` | yes | write a legacy note on a cell |
| `xlsx_edit.py` | (none) | `--clear-note` | no | remove the legacy note on a cell |
| `xlsx_edit.py` | (none) | `--protect` | yes | protect the target sheet (integrity signal only, NOT security) |
| `xlsx_edit.py` | (none) | `--unlock` | yes | cell range left editable under --protect |
| `xlsx_edit.py` | (none) | `--recalc` | yes | force full recalculation when the file is opened |
| `xlsx_read.py` | (none) | `--sheets` | yes | list the sheet names |
| `xlsx_read.py` | (none) | `--json` | yes | JSON output |
| `xlsx_read.py` | (none) | `--csv` | yes | CSV output |
| `xlsx_read.py` | (none) | `--formulas` | yes | print formula strings |
| `xlsx_read.py` | (none) | `--notes` | yes | print cell notes |
| `xlsx_read.py` | (none) | `--names` | yes | print defined names |
| `xlsx_read.py` | (none) | `--sheet` | yes | sheet name (default: active) |
| `xlsx_read.py` | (none) | `--data-only` | yes | return cached formula results (see module docstring) |
| `xlsx_read.py` | (none) | `--encoding` | yes | text encoding |
| `xlsx_read.py` | (none) | `--out` | yes | output file for --csv |
| `xlsx_recalc.py` | (none) | `--out` | yes | output path (default: replace input) |
| `xlsx_recalc.py` | (none) | `--timeout` | no | seconds to wait for soffice (default 180) |
| `xlsx_restructure.py` | (none) | `--sheet` | yes | target sheet (default: active) |
| `xlsx_restructure.py` | (none) | `--out` | yes | output path (default: edit in place) |
| `xlsx_restructure.py` | (none) | `--insert-rows` | yes | insert rows at IDX |
| `xlsx_restructure.py` | (none) | `--delete-rows` | no | delete rows at IDX |
| `xlsx_restructure.py` | (none) | `--insert-cols` | no | COL is a letter (B) or 1-based number |
| `xlsx_restructure.py` | (none) | `--delete-cols` | yes | delete columns at COL |
| `xlsx_to_csv.py` | (none) | `--sheet` | yes | sheet name (default: active) |
| `xlsx_to_csv.py` | (none) | `--encoding` | yes | CSV output encoding (default utf-8) |
| `xlsx_to_csv.py` | (none) | `--delimiter` | yes | field delimiter |
| `xlsx_to_csv.py` | (none) | `--data-only` | yes | cached formula results instead of formula strings |

## pdf
| script | subcommand | flag | documented | what the flag does |
|---|---|---|---|---|
| `extract_marker.py` | (none) | `--output_dir` | no | Directory to save extracted images |
| `extract_marker.py` | (none) | `--json` | no | Structured JSON output instead of markdown |
| `extract_marker.py` | (none) | `--use_llm` | no | LLM-boosted accuracy |
| `extract_marker.py` | (none) | `--check` | no | Check disk space requirements and exit |
| `extract_pymupdf.py` | (none) | `--pages` | yes | Page selection: N or START-END (0-indexed) |
| `extract_pymupdf.py` | (none) | `--markdown` | no | Markdown output via pymupdf4llm |
| `extract_pymupdf.py` | (none) | `--tables` | yes | Extract tables as markdown |
| `extract_pymupdf.py` | (none) | `--images` | no | Extract embedded images to OUTPUT_DIR (default ./images) |
| `extract_pymupdf.py` | (none) | `--metadata` | no | Show document metadata as JSON |
| `pdf_annotate.py` | list | `--password` | yes | Password if the input is encrypted |
| `pdf_annotate.py` | list | `--include-widgets` | no | Also list /Widget form fields and /Popup windows |
| `pdf_annotate.py` | list | `--no-quote` | no | Skip recovering the text under a markup annotation |
| `pdf_annotate.py` | add | `--password` | yes | Password if the input is encrypted |
| `pdf_annotate.py` | add | `--contents` | yes | Comment text |
| `pdf_annotate.py` | add | `--type` | yes | Sticky note (default) or highlight |
| `pdf_annotate.py` | add | `--page` | yes | Page number, 1 based |
| `pdf_annotate.py` | add | `--rect` | yes | Rectangle in PDF points, origin bottom left |
| `pdf_annotate.py` | add | `--anchor-text` | yes | Anchor to the first match of this text |
| `pdf_annotate.py` | add | `--occurrence` | no | Which match of --anchor-text to use, 1 based |
| `pdf_annotate.py` | add | `--author` | yes | Author name, written to /T |
| `pdf_annotate.py` | add | `--subject` | no | subject line written to /Subj |
| `pdf_annotate.py` | add | `--color` | yes | Highlight colour as hex, default ffff00 |
| `pdf_annotate.py` | add | `--icon-size` | no | Sticky note icon size in points, default 20 |
| `pdf_annotate.py` | add | `--no-popup` | no | Do not attach a popup window |
| `pdf_annotate.py` | add | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_annotate.py` | reply | `--password` | yes | Password if the input is encrypted |
| `pdf_annotate.py` | reply | `--id` | yes | Id of the annotation answered |
| `pdf_annotate.py` | reply | `--contents` | yes | Reply text |
| `pdf_annotate.py` | reply | `--author` | yes | Author name, written to /T |
| `pdf_annotate.py` | reply | `--icon-size` | no | Reply icon size in points, default 20 |
| `pdf_annotate.py` | reply | `--no-popup` | no | Do not attach a popup window |
| `pdf_annotate.py` | reply | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_annotate.py` | resolve | `--password` | yes | Password if the input is encrypted |
| `pdf_annotate.py` | resolve | `--id` | yes | Id of the thread's first comment |
| `pdf_annotate.py` | resolve | `--state` | no | Review state, default Accepted |
| `pdf_annotate.py` | resolve | `--author` | yes | Author name, written to /T |
| `pdf_annotate.py` | resolve | `--contents` | yes | Optional note beside the state |
| `pdf_annotate.py` | resolve | `--icon-size` | no | State marker size in points, default 20 |
| `pdf_annotate.py` | resolve | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_annotate.py` | delete | `--password` | yes | Password if the input is encrypted |
| `pdf_annotate.py` | delete | `--id` | yes | Id of the annotation to delete |
| `pdf_annotate.py` | delete | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_create.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_fill_form.py` | (none) | `--fields-json` | yes | UTF-8 JSON file of field values |
| `pdf_fill_form.py` | (none) | `--flatten` | yes | Make fields read-only and burn appearances into the page |
| `pdf_fill_form.py` | (none) | `--password` | yes | Password if the input is encrypted |
| `pdf_fill_form.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_form_layout.py` | (none) | `--pdf` | yes | Existing PDF to rasterize under the overlay (blank page if omitted) |
| `pdf_form_layout.py` | (none) | `--render-overlay` | yes | Write an annotated PNG for visual review |
| `pdf_form_layout.py` | (none) | `--overlay-page` | no | 1-based page (default 1) |
| `pdf_form_layout.py` | (none) | `--dpi` | yes | Overlay render DPI (default 100) |
| `pdf_make_form.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_merge.py` | (none) | `--bookmarks` | yes | Add a top-level bookmark per input file (its basename) |
| `pdf_merge.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_meta.py` | (none) | `--set-meta` | yes | Set metadata fields |
| `pdf_meta.py` | (none) | `--clear-meta` | yes | Remove all DocInfo metadata |
| `pdf_meta.py` | (none) | `--attach` | yes | Embed FILE as an attachment |
| `pdf_meta.py` | (none) | `--list-attachments` | yes | List attachment names |
| `pdf_meta.py` | (none) | `--extract-attachments` | yes | Extract attachments into DIR |
| `pdf_meta.py` | (none) | `--title` | yes | Title DocInfo field |
| `pdf_meta.py` | (none) | `--author` | yes | Author DocInfo field |
| `pdf_meta.py` | (none) | `--subject` | no | Subject DocInfo field |
| `pdf_meta.py` | (none) | `--keywords` | no | Keywords DocInfo field |
| `pdf_meta.py` | (none) | `--password` | yes | Password if the input is encrypted |
| `pdf_meta.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_page_image.py` | (none) | `--pages` | yes | 1-based ranges, e.g. '1-3,5' (default: all) |
| `pdf_page_image.py` | (none) | `--dpi` | yes | Render DPI (default 150) |
| `pdf_page_image.py` | (none) | `--out-dir` | yes | Directory for PNG files |
| `pdf_page_image.py` | (none) | `--prefix` | no | Output filename prefix (default 'page') |
| `pdf_page_image.py` | (none) | `--password` | yes | Password for encrypted PDFs |
| `pdf_read.py` | (none) | `--text` | yes | Per-page text as JSON |
| `pdf_read.py` | (none) | `--tables` | yes | Tables as JSON (optionally CSV via --csv-dir) |
| `pdf_read.py` | (none) | `--meta` | yes | Metadata, page sizes, encrypted/scanned flags |
| `pdf_read.py` | (none) | `--fields` | yes | AcroForm fields with types and values |
| `pdf_read.py` | (none) | `--csv-dir` | yes | Also write each table as a CSV file into this directory |
| `pdf_read.py` | (none) | `--password` | yes | Password for encrypted PDFs |
| `pdf_secure.py` | (none) | `--encrypt` | yes | Encrypt the PDF |
| `pdf_secure.py` | (none) | `--decrypt` | yes | Remove encryption (password required) |
| `pdf_secure.py` | (none) | `--user-password` | yes | User (open) password for --encrypt |
| `pdf_secure.py` | (none) | `--owner-password` | no | Owner password for --encrypt (defaults to user password) |
| `pdf_secure.py` | (none) | `--password` | yes | Known password for --decrypt |
| `pdf_secure.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_split.py` | (none) | `--pages` | yes | 1-based page spec, e.g. '1-3,5,9-' |
| `pdf_split.py` | (none) | `--rotate` | yes | Rotate extracted pages clockwise (multiple of 90) |
| `pdf_split.py` | (none) | `--compress` | yes | Deflate content streams (modest savings; does not recompress images) |
| `pdf_split.py` | (none) | `--password` | yes | Password if the input is encrypted |
| `pdf_split.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_stamp.py` | (none) | `--text` | yes | Text to stamp |
| `pdf_stamp.py` | (none) | `--image` | yes | Image file to stamp (PNG/JPEG) |
| `pdf_stamp.py` | (none) | `--x` | yes | X in points (origin bottom-left) |
| `pdf_stamp.py` | (none) | `--y` | yes | Y in points |
| `pdf_stamp.py` | (none) | `--pages` | yes | 1-based ranges, e.g. '1-3,5' (default: all) |
| `pdf_stamp.py` | (none) | `--font` | no | Font name (default Helvetica) |
| `pdf_stamp.py` | (none) | `--font-size` | yes | Font size in points |
| `pdf_stamp.py` | (none) | `--color` | yes | Text color as #RRGGBB |
| `pdf_stamp.py` | (none) | `--rotation` | yes | Degrees counterclockwise |
| `pdf_stamp.py` | (none) | `--opacity` | yes | 0.0-1.0 (default 1.0) |
| `pdf_stamp.py` | (none) | `--width` | yes | Image width in points |
| `pdf_stamp.py` | (none) | `--height` | no | Image height in points |
| `pdf_stamp.py` | (none) | `--under` | yes | Place the stamp under existing content instead of over it |
| `pdf_stamp.py` | (none) | `--password` | yes | Password if the input is encrypted |
| `pdf_stamp.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |
| `pdf_watermark.py` | (none) | `--stamp` | yes | One-page PDF to apply (page 1 is used) |
| `pdf_watermark.py` | (none) | `--under` | yes | Place stamp under the page content (background watermark) |
| `pdf_watermark.py` | (none) | `--password` | yes | Password if the input is encrypted |
| `pdf_watermark.py` | (none) | `-o/--output` | yes | write to this path instead of editing in place |

## house-style
| script | subcommand | flag | documented | what the flag does |
|---|---|---|---|---|
| `house_style.py` | (none) | `--theme` | no | pick the theme: editorial, slate or mono |
| `house_style.py` | (none) | `--accent` | no | brand hue, RRGGBB |
| `house_style.py` | (none) | `--check-contrast` | yes | report the contrast ratios that matter |
| `office_inspect.py` | (none) | `--section` | yes | print only these sections (repeatable) |
| `office_inspect.py` | (none) | `--no-lint` | no | skip the house style pass |
| `style_lint.py` | (none) | `--json` | yes | JSON output |
| `style_lint.py` | (none) | `--only` | yes | limit the lint to one group: all, prose, design or geometry |
| `style_lint.py` | (none) | `--strict` | no | fail on warnings too |

# Part 2: the ranked shortlist

Ordered by how much capability the agent loses while the flag stays out of `SKILL.md`.
A flag that changes an exit code or opens a mode outranks a cosmetic default.

### 1. `house_style.py --theme`, house-style

Line to add, under "Using the system from your own code", right after the Python block:

    From the command line the same two knobs are flags: `python scripts/house_style.py --theme slate --accent B4482E` prints that theme as JSON.

Why it matters: the theme is the entire look of every deliverable the five skills produce, and
`SKILL.md` shows only the Python entry point `load_theme("editorial", accent=...)`. An agent
that is shelling out, which is what every other example in these skills does, has no way to
learn that `editorial`, `slate` and `mono` can be selected at all.

### 2. `house_style.py --accent`, house-style

Covered by the same line above, listed separately because it is a separate flag.

Why it matters: the accent is the one brand specific value a client hands over. Without the
flag the agent has to write Python, or set `HERMES_HOUSE_THEME` and `HERMES_HOUSE_ACCENT`,
neither of which is mentioned in the house-style `SKILL.md` either.

### 3. `pptx_from_template.py --add-slides`, powerpoint

Line to add, in the template section near line 151:

    `--add-slides spec.json` additionally appends slides built from the template's own layouts, referenced by layout name or index, so new slides inherit the brand master: `{"slides": [{"layout": "Title and Content", "title": "New", "bullets": ["a"], "notes": "..."}]}`.

Why it matters: this is a whole second mode of the script, not a modifier. `SKILL.md` shows
`--values` only, so an agent asked to add a slide to a brand deck will build a fresh deck and
lose the master, which is exactly the failure the template path exists to prevent.

### 4. `style_lint.py --strict`, house-style

Line to add, under "Checking a deliverable before it ships":

    Add `--strict` to fail the run on warnings too, which is what a release gate wants.

Why it matters: it changes the exit code, so it is the difference between a lint that gates a
deliverable and a lint that prints. Nothing else in the skill exposes that switch.

### 5. `xlsx_comments.py -o`, xlsx, on all seven subcommands

Line to add, after the fenced example in "Comments and notes":

    Every subcommand edits the workbook in place unless `-o out.xlsx` is given.

Why it matters: this is the only comment script of the five whose `SKILL.md` never shows an
output path. An agent following the examples overwrites the reviewer's original workbook and
cannot produce a side by side before and after.

### 6. `pdf_annotate.py resolve --state`, pdf

Line to add, in the comments section after the `resolve` example:

    `--state` picks the review state written: `Accepted` is the default, and `Rejected`, `Cancelled`, `Completed` or `None` are also valid.

Why it matters: without it every resolution is an acceptance. An agent asked to reject a
reviewer's suggestion has no documented way to record that, and the wrong state is a
substantive error in a contract review, not a cosmetic one.

### 7. `xlsx_edit.py --clear-note`, xlsx

Line to add, to the task table beside the existing `--note` row:

    | Remove a cell note | `xlsx_edit.py f.xlsx --clear-note B2` |

Why it matters: `--note` is documented, its inverse is not, so the documented surface can
create state it cannot remove. The alternative, `xlsx_comments.py delete-note`, is also
undocumented, so removing a note is currently unreachable from `SKILL.md`.

### 8. `office_inspect.py --no-lint`, house-style

Line to add, after the `office_inspect.py` example:

    `--no-lint` skips the house style pass when only the structure is wanted.

Why it matters: the lint pass is the slow part of the report, and an agent that just wants
the `targets` section pays for it on every call. It is also the flag that makes the script
usable on a file the agent did not write and is not judging.

### 9. `pdf_annotate.py add --occurrence`, pdf

Line to add, after the sentence about `--anchor-text`:

    `--occurrence N` picks the Nth match instead of the first, which is how a word that repeats gets an annotation on the right line.

Why it matters: `--anchor-text` is documented but silently means "first match". In a contract
the anchor word almost always repeats, so the documented surface can only ever comment on the
first occurrence.

### 10. `pptx_render.py --dpi`, powerpoint

Line to add, beside the existing render example:

    `--dpi` sets the render resolution, default 100; raise it when the PNG is going to a vision check.

Why it matters: the deck review loop in this skill ends with rendering slides and looking at
them. At the default resolution small type is unreadable, so the check quietly gets weaker,
and the agent has no documented way to ask for more.

### 11. `pdf_secure.py --owner-password`, pdf

Line to add, beside the encrypt example:

    `--owner-password` sets the permissions password separately; it defaults to the user password when omitted.

Why it matters: user password and owner password are different capabilities in the PDF
specification. With only `--user-password` documented, every encrypted file the agent produces
has the same password for opening and for changing permissions, which defeats the point of
restricting a document that still has to be readable.

### 12. `csv_to_xlsx.py --no-infer`, xlsx

Line to add, beside the CSV interop note:

    `--no-infer` keeps every cell as a string, which is what a column of leading zero ids, phone numbers or part codes needs; `--plain` skips the header styling, the freeze and the autofilter.

Why it matters: the default coerces types, so a leading zero id loses its zero and a code that
looks like a date becomes one. `SKILL.md` documents only `--encoding` and `--delimiter` on this
script, so the agent has no documented way to stop a silent data corruption.

Deliberately left off the list: `--initials` on the docx and pptx comment scripts, `--shape` on
`pptx_comments.py add`, `--icon-size` and `--no-popup` on `pdf_annotate.py`, `--prefix` on
`pptx_render.py` and `pdf_page_image.py`, `--font` and `--height` on `pdf_stamp.py`, `--timeout`
on `xlsx_recalc.py`, and `--report` on the two font embedders, which is already reachable
through the documented `report` subcommand. The remaining undocumented rows are defaults, or a
knob on a behaviour the prose already describes, or the second half of a documented pair:
`--delete-rows` and `--insert-cols` on `xlsx_edit.py` and `xlsx_restructure.py` sit beside a
documented `--insert-rows` and `--delete-cols`, and `--subject` and `--keywords` on `pdf_meta.py`
are named in the prose at step 7 without their flag spelling.
The `extract_marker.py` and `extract_pymupdf.py` flags are also left off: they are undocumented
in `SKILL.md` by the rule above, but `pdf/SKILL.md` points at `references/ocr-extraction.md`,
which shows all of them.

# Subcommands entirely absent from their SKILL.md

A missing subcommand is worse than a missing flag, because the agent cannot even guess that the
capability exists. Six were found, verified by searching the whole `SKILL.md` for the name.

| skill | script | subcommand | what it does |
|---|---|---|---|
| xlsx | `xlsx_comments.py` | `add-note` | write a legacy note on a cell |
| xlsx | `xlsx_comments.py` | `delete-note` | remove a legacy note |
| xlsx | `xlsx_comments.py` | `delete` | delete a thread or a legacy note |
| xlsx | `xlsx_comments.py` | `reopen` | make a resolved thread open again |
| docx | `docx_comments.py` | `reopen` | clear a thread's resolved mark |
| pdf | `pdf_annotate.py` | `delete` | delete an annotation and its replies |

The xlsx case is the sharpest. `xlsx/SKILL.md` says the script "covers both kinds a workbook
can carry", the legacy note and the threaded comment, and then every example is a threaded
comment. Both note subcommands, the delete path and the reopen path are invisible, so half of
the capability the prose promises has no way to be invoked.

`docx_comments.py reopen` is the mirror of the documented `resolve`, and `pdf_annotate.py
delete` is the only way to remove a PDF annotation. Neither name occurs in its `SKILL.md`.

For contrast, `pptx_comments.py` documents all six of its subcommands, including `reopen` and
`delete`, so the powerpoint comment section is the model the other three should copy.
