# Progress

## Goal turn 1
- Revalidated clean worktree and active unbudgeted goal.
- Re-read accepted review and retrieved current Hermes context.
- Began phase 1. Other seven phases remain required.
- Health backend: 40 tests passed (health + existing project RPC suite).
- Avoid relative repo paths when invoking desktop commands; one plan update was
  attempted from apps/desktop and failed harmlessly. Use absolute plan paths.
- Health UI: 64 tests passed. Existing profile test updated for include_health.
- TypeScript checks passed. Headless UI proved sidebar warning -> edit ->
  suggested reconnect -> Save keeps original_path; no page errors.
- Screenshot: outputs/hermes-health.png. First Playwright selector expected exact
  text on a status node containing a button; changed locator to scoped status.
- Phase 1 implementation is ready for integration; live repair and restart checks
  remain, so phase 1 is not yet complete.
- Phase 1 committed as 7fa647b212. Not installed yet; integrated release later.
- Started phase 2: progress receipts derive actual successful checks, file-tool
  changes, todo state, unresolved errors, repeated operations. No model guesses.
- First progress-model test caught a test assertion requiring an absent optional
  key; adjusted to test the error evidence itself. Added real files_modified
  output support after inspecting file tool result classes.
- Guard against false successful checks from echo text or shell failure masking.
- Progress receipt: 9 tests pass. Headless browser verified latest actual patch
  and stale prior check with no page errors at desktop and narrow viewports.
  Screenshots outputs/hermes-progress.png and hermes-progress-narrow.png.
- Progress receipt is only part of phase 2. Effort presets remain in phase 5;
  integrated verification and live lifecycle checks remain required.

### Results persistence backend slice
Implemented project_results.py and additive projects.db tables for indexed
reported artifacts and immutable captured file versions. Added profile-scoped
refresh/list/versions/capture/review RPCs, routed off the websocket reader.
Validation: real SessionDB + projects DB + filesystem tests cover batched cursor
resume, reopen, deleted original, independent version approval, missing source,
secret symlink refusal, profile isolation, rollback/retry and oversized dumps.
The renderer has NOT been switched yet, and this slice is NOT installed.
Next: use this backend in the existing artifacts page with explicit owner scope,
project filtering, incremental visible indexing, capture/version/review actions,
and headless browser QA. Preserve source navigation and authenticated remote
media handling. Then complete the remaining phases, not just results.

### Results page integration slice
- 19 frontend behavioral tests passed, including legacy artifact extraction,
  authenticated remote opening, saved-first publication, cancelled stale owner
  responses, snapshot opening and failed-review rollback.
- 8 backend integration tests passed after correcting remote URL kind handling.
- TypeScript passed after an explicitly typed test request parameter.
- Headless real-handler integration passed in English and Arabic after backend
  process restart. Screenshots: outputs/hermes-results.png,
  outputs/hermes-results-versions.png, outputs/hermes-results-ar.png, all viewed.
- Test harness fixes: TSX generic arrow needs trailing comma; JSDOM lacks
  scrollIntoView; Arabic fixture needed configClient=null so stored config does
  not override its initialLocale. None required product workarounds.
- Build pending completion. Changes not installed in the live desktop yet.
- Next: finish inline generated artifact persistence and version previews,
  then evidence search/project brief and remaining phases. Keep goal active.

- Production build passed, including renderer, Electron bundles and dist check.

### Generated content and snapshot previews slice
Implemented persisted inline generated outputs, recent-file bootstrap, verified
version previews and an explicit selected-version label. Integration used the
same real RPC/DB/filesystem fixture as the previous slice, including its existing
older schema/index. Two generated versions preview correctly with sandbox
isolation, and existing file captures keep their own approval states.
No model calls, no core tool changes, no per-conversation prompt mutation.
Goal remains active. Live installation, live path repair, large-history timings,
brief/search, workflows/action inbox and read-only references remain outstanding.
Next work is phase 4, a cited project brief and useful local reference search,
including PDF/Word extraction, Arabic/English and a bounded QMD evaluation.

## Phase 4: cited project brief and reference search
Implemented profile-scoped reference tables and FTS5, immutable extracted text
versions, file scan/index batches, and RPCs for brief/search/citation. Existing
read_extract now preserves real PDF pages and Word paragraphs/comments without
hosted OCR or dependency installation. Missing/changed sources retire current
citations but preserve history; malformed files and OCR gaps are explicit.
The existing Artifacts project filter opens the brief dialog, edits the existing
description, shows approved result source tasks, searches Arabic/English, copies
citations and opens current source files. Old versions are opt-in. Scoped dialog
unmounts on profile/connection changes. Error retry and stale search guards tested.

Validation: 57 reference/extraction Python tests passed, 3 optional existing
extractor tests skipped; existing project RPC suite 38 passed. Two UI tests pass,
TypeScript and targeted lint pass. Full desktop build passed; final build refresh
is pending only routine completion. Real backend-handler browser fixture passes
Arabic search, source open request, version history, persisted summary, profile
switch and 450px RTL layout with no errors. Screenshots in outputs.
Five real Sdeira Markdown documents (100010 bytes), six curated queries: expected
file ranked first in all six; median local search 0.142 to 0.357 ms, indexing
0.027 seconds. This is keyword smoke evaluation, not general semantic quality.
QMD 2.8.3 dependency installation stalled twice under Bun. Owned processes stopped.
Direct tarball download worked. No QMD search/model benchmark completed, no skill
installed and no superiority claim. See outputs/hermes-reference-search-validation.md.

No changes installed into the live desktop yet. Whole goal remains active with
workflows, action inbox, filesystem enforcement, effort presets, live repairs and
integrated runtime QA still required. QMD remains a documented evaluation gap;
continue independent phases rather than holding the UI feature on its installer.
Final phase 4 build completed successfully. Commit ad59a69bd1 contains the cited
reference search slice. QA backend and Vite servers stopped; QMD installer
attempts stopped. Working tree has only the existing untracked .planning area.

## Phase 5: workflow drafts and task approaches
Implemented projects.workflow behind the existing profile-scoped project RPC
wrapper. Four recipes: quick-ui, client-delivery, research, weekly-review. Each
produces a reviewable task draft, validates its primary source folder and
resolves the selected existing skill command in that profile. Missing skills
are explicit; no automatic install or execution. Quick/standard/thorough guide
scope and checks without changing model settings or applying timeouts.
Project kebab and context menus share the workflow dialog. Selected owner is
captured through the RPC and subsequent task-open intent. A stale response after
profile/connection switches cannot open a task in the new context.
Found and fixed an existing seam: requestStartWorkSession with openTab and draft
used to create a tile but insert into main. openNewSessionTile now seeds the
new durable session draft before mounting, preserving the previous chat text.

Validation: 2 actual project/skill-dispatch backend tests passed. Existing menu
and session-action UI suites: 100 passed, including new durable-draft ownership
case. TypeScript, targeted lint and full desktop build passed. Isolated browser
with real gateway handlers passed draft-only creation, source cwd/skill route,
failed request retry preserving task text, delayed response after profile switch,
Arabic RTL controls and narrow layout, no browser errors. Screenshots viewed.
The fixture records the native task-open intent; the hook test proves seeding
on the returned durable id. No LLM task was auto-submitted during QA. Real model
execution and installed runtime checks remain in phase 8.

Corrected the installed default-profile local-browser-preview skill: removed
stale Sdeira paths/ports, fixed-profile headed browser assumptions and repeated
unsupported-tool advice. It now follows current project runtime, headless
isolation, scoped verification and existing authorization. Backup is work/
local-browser-preview-before.md. Skill-creator validation passed. This resource
update is live for future skill loads; live agent prompts were not rebuilt.
No desktop renderer/backend build changes installed into the running app yet.

QA backend exit 143 was observed and confirmed via dead tool handle and free
port. Restarted only that owned fixture and Vite; rerun passed. QMD remains
unmeasured after two dependency resolution stalls, no QMD processes running.
The same stale local-browser-preview skill existed byte-for-byte in builder,
herwork and quant. Each matching copy was backed up separately and updated.
Differing profile content would have been preserved; no config inheritance or
cross-profile runtime coupling was introduced.
Phase 5 committed as ff2f74d514. QA servers stopped. Prior goal turn and this turn
both made authoritative progress; no blocked condition applies to the full goal.
Next: cited action inbox, native parked-task acceptance, then reference write
protection and integrated live runtime validation. No desktop build installed yet.

Phase 6 backend verification update:
- Added tests/tui_gateway/test_project_actions.py using real isolated projects, reference and native kanban databases.
- Verified parked status, no assignee, evidence preserved, retry after reopen, quote/owner/date validation, explicit edits and dismissals.
- Simulated failure after native commit before project receipt, then retried without duplicate task. Concurrent acceptance also produces one task.
- Updated native connection import to kanban_db_connect rather than deprecated compatibility export.
- Canonical runner: 11 tests passed across project_actions and project_references.
- Phase 6 remains uncommitted and incomplete: CLI evidence/proposal import, RPC, review UI and actual extraction workflow still needed. Phase 7 enforcement and phase 8 live installation remain pending.

Phase 6 review surface implementation:
- Extended existing project CLI with sources, bounded single-document evidence and propose-actions JSON import. No new model tools.
- Added profile-scoped actions list/draft/edit/dismiss/accept RPC handlers in long-running catalog.
- Added document-actions workflow routed through installed document-to-action-items when available; draft-only and no automatic task acceptance.
- Added project brief review section with source selection, cited quote/version, editable title/owner/raw due date, dismiss, explicit parked native task acceptance and retry. All six locale strings included.
- Real headless renderer plus actual isolated RPC/backend test passed edit-save-accept, reload persistence, quote visibility, profile switch closure and Arabic 450px overflow. Screenshots outputs/hermes-document-actions.png and -ar.png. Arabic screenshot inspected.
- 14 Python tests passed including CLI evidence -> proposal -> RPC edit -> actual native kanban task. Typecheck and production build passed before final text-only localization and read-only owner/date visibility addition; final typecheck running handle66119.
- QA servers handles26340/23535 explicitly stopped, exit130.
- Still required: direct native board/task navigation, bounded/paginated proposal history, full semantic LLM extraction run and delayed/failure UI test coverage. Phase7 read-only enforcement and phase8 installation remain incomplete.

Phase 6 history/navigation and phase 7 initial enforcement:
- Paginated project actions (50 default, 100 cap) with timestamp/id cursor and supporting index; UI load-more. Tie timestamp and cross-project cursor tests passed.
- Native kanban task hash link now selects explicit board and opens its drawer. Review row links when kanban plugin is loaded. Parser tests passed; integrated rendered board navigation still needs validation.
- Added read_only project folder metadata and preserved it across reconnect/edit. Editor checkbox with six locales and visible new-terminal applicability hint.
- LocalEnvironment wraps foreground/file-operation shells in bubblewrap with read-only canonical mounts, new PID namespace/procfs, private devfs, all capabilities dropped. Background spawn wraps the actual user command too. Existing terminal permission snapshots remain fixed; no active task interruption or prompt mutation.
- Unsupported nonlocal backends refuse known protected project roots. Linux bubblewrap availability was verified by actual execution. Symbolic source roots preserve initial canonical target plus current alias resolution.
- Real temp tests verified file-tool, foreground, relative, symlink and background write denial while primary output writes succeed. 16 backend tests passed, plus 40 RPC/health tests, plus 10 UI tests and typecheck. Lint/diff checks passed.
- Still required: render checkbox and deep task link in actual UI; expanded readonly fail-closed/missing/alias/profile/patch/subprocess checks and review bypass boundaries; integrated semantic extraction with actual LLM; phase8 live path repair, install and runtime verification. Do not claim whole goal complete.

Phase 8 live integration and installation:
- Added actual patch, nested Python subprocess, changed-cwd, missing protection tool/source and profile/alias ownership checks. 3 read-only tests passed. Commit f634be80ab.
- Actual configured auxiliary model extraction succeeded in 9.03 seconds through anthropic/claude-sonnet-5. Two commitments from Arabic meeting evidence, explicit Sara/Thursday preserved, unspecified owner/date null, completed work and unapproved possibility excluded. Proposals saved pending with exact quoted citations, zero native tasks. Evidence outputs/hermes-semantic-actions-check.json. This proves semantic extraction through the installed skill procedure, not yet the full main-agent CLI workflow tool loop.
- Live paths repaired for sdeira-group, Fujairah Design System, DigitalNext Word from Masaar to Ma, including saved history cwd metadata. Snapshot backup of projects.db and state.db in work/path-repair-backup; session/message counts unchanged. Output receipt hermes-project-path-repair.json.
- User confirmed Hermes Browser Extension was deleted and old conversations may remain folderless. Removed its stale project folder reference. No sessions matched its old cwd; all messages preserved. Do not ask again for its path.
- Full build and official Bun electron-builder stage completed successfully, clean build stamp f634be80ab. Packaged Electron 40.10.2 launched with --headless --ozone-platform=headless, isolated fresh HERMES_HOME/userData, no DISPLAY and no credentials. Real native bridge -> actual backend WebSocket -> projects.list succeeded (empty isolated project DB). Screenshot was captured at setup loading 97%, so full settled boot and final interactive flows still need validation.
- QA Electron exited but git update-check descendants held the Playwright pipes. Confirmed those exact descendants by HERMES_DESKTOP_USER_DATA_DIR=/tmp/hermes-packaged-qa-vOF2Gs/userdata, then terminated only those QA git/git-remote-http processes. Handle2051 finished0. No user process killed. Investigate lifecycle if relevant; do not treat initial screenshot as completed app startup.
- Installed full staged package via reversible directory rename to apps/desktop/release/linux-unpacked. Prior package retained in work/hermes-package-before. Verified Linux ELF executable, index matches build, untorn module assets, installed stamp clean and _desktop_build_needed returnsFalse. outputs/hermes-install-receipt.json. Desktop was not running. Messaging gateway PID2487 was left running.
- IMPORTANT: New package is now installed. Do not repeat prior message that it is uninstalled. Newly launched desktop backend will load current code; existing messaging gateway was not restarted.
- Remaining: settled installed native UI with editor readonly and exact board/task navigation; main-agent workflow run with skill/CLI; broader realistic-history/failure/performance audit; QMD comparison remains unmeasured after two dependency resolution stalls (native keyword benchmark passed). Keep full goal active.

Final installed validation and completion audit:
- Settled installed Electron boot passed. Native editor read-only checkbox saved and survived reopen.
- Actual project action link opened the correct native task drawer and loaded the matching board card. Zero page errors. Screenshot inspected. The earlier failure was a test locator assuming role=dialog; this drawer uses a heading. No production fix was required.
- Real main AIAgent document workflow passed through installed skill dispatch and five tool operations in 68.71 seconds. Two cited Arabic proposals saved, missing owner/date unspecified, zero native tasks automatically created. Isolated databases only.
- Real 20,000-message database benchmark recovered all 4,000 results without duplicates: first bounded batch 14.89 ms, median batch 16.35 ms, max 19.24 ms, median page 0.21 ms. This measures backend indexing/paging, not full transcript rendering.
- Existing live transcript transition, failures/retry, profile isolation, RTL, reference provenance and actual filesystem enforcement checks were audited from prior evidence. No redundant test suite reruns or source changes were needed.
- QMD evaluation concluded with an unsuccessful installation trial. Do not ship or claim semantic integration. Existing native keyword search is verified; optional QMD adoption is explicitly excluded and documented.
- Final report: outputs/hermes-delivery-validation.md. Installed package remains clean f634be80ab. git diff --check passed; only this untracked planning directory remains. QA native handles finished. Existing user messaging gateway was not interrupted.
- All delivered feature acceptance areas are complete. Community QMD semantic benchmarking remains unvalidated and excluded, not silently represented as delivered.
