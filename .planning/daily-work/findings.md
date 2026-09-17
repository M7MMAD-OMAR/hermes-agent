# Findings
- Actual code root: /home/sbarah/.hermes/hermes-agent.
- Planning files are isolated in .planning/daily-work; never stage them with code.
- Default profile: 14 projects, 17 folders, four missing roots at last audit.
- Three client paths use stale Masaar and real Ma replacement exists. Extension
  replacement has not been verified.
- Existing edit RPC migrates saved cwd and repo metadata; refuses affected live
  running tasks. UI has saved drafts and native folder picker.
- Project list/get lack health metadata. Overview has ProjectMenu and row actions.
- Artifact registry is session-bound/in-memory and rebuilds from rendered history.
- Source registration does not enforce read-only permissions.
- Skills installed: dogfood, document-to-action-items, meeting-action-items,
  weekly-review-planning. QMD not installed as a skill at audit time.
- Private memories are historical context, never execution authority.
- Health list/get uses include_health opt-in to preserve existing RPC contracts.
  New health fields remain ephemeral; saves retain original path mapping.
- Health UI verified with actual ProjectDialog and ProjectHealthIndicator in
  isolated headless Playwright, mocked RPC transport only. Backend tests exercise
  real DB + filesystem separately. Full integrated live transport remains phase 8.
- Artifacts already have a dedicated /artifacts route and page, in addition to
  the in-memory content registry. Inspect artifact-utils before designing shelf.
- Existing route registration: src/app/contrib/surfaces.tsx and app/routes.ts.
- Progress receipt UI verified in actual Thread runtime: successful check visible,
  new patch marks previous check stale. 9 targeted tests pass; typechecks pass.
- Local file writes expose files_modified/resolved_path; patch can return
  no_change=true. Receipt must not claim a no-op as progress.
- Linux workstation has /usr/bin/bwrap; inspect LocalEnvironment execution before
  designing read-only reference enforcement. UI labels alone are insufficient.

- Existing /artifacts page currently loads session messages via
  loadArtifactsForSessions; this is the exact seam for a durable backend index.
- LocalEnvironment (tools/environments/local.py:685) executes each call in fresh
  bash, preserving env via snapshots and cwd via stdout markers. This makes an
  execution sandbox feasible; still inspect delegated/background/PTY paths.
- Goal-turn commits: 7fa647b212 health UI/RPC; e5957d6d78 progress receipt.
- No goal phase is fully signed off: health live repair pending; progress effort
  presets pending; shelf/search/workflows/inbox/readonly/integration pending.
- All temporary QA servers started this goal turn were stopped. User app was
  not interrupted. No new build installed yet.

### Durable results backend
- Existing artifacts page only scans 30 recent sessions and ships their complete
  transcripts into the renderer. It remains unchanged until the next UI slice.
- Added profile-owned discovery to projects.db, bounded state.db batches, an
  atomic persistent cursor, source database identity reset, and keyset listing.
  Discovery reads reported links/paths only, never source file bytes.
- Explicit capture saves content-addressed bytes with capture time, SHA-256,
  version number and per-version review state. This is a snapshot at capture
  time, not a claim that older reported outputs can be reconstructed.
- RPC methods extend projects.results.* without adding agent tool schemas.
  Historical index excludes user messages and failed structured tool outputs;
  oversized tool dumps are counted visibly and do not block later messages.
- Seven backend integration cases passed, plus 40 existing project/health cases.
  Added a further 36-session test to prove the recent-30 limitation is gone.
- A test initially seeded SessionDB through the test suite's patched global
  default instead of the requested home. Fixed the fixture to pass the scoped
  state.db path explicitly. Actual RPC profile isolation now passes.

### Results page integration
- Existing /artifacts now reads persisted metadata through projects.results.*,
  with explicit active connection/profile ownership and project filtering.
  It displays cached rows before bounded indexing and keeps rows on failure.
- Added version dialog with capture, independent review states, rollback when
  review persistence fails and opening the immutable file copy.
- File extraction includes Word, Excel, PowerPoint and HTML. Remote document
  URLs remain links so the UI does not offer local capture for a web URL.
- Real integration fixture used the actual gateway handlers, SessionDB,
  projects.db and files over an isolated local HTTP transport. Playwright
  verified two versions, independent approval, source snapshot opening,
  profile switching and project filter. Zero browser errors and no session RPCs.
- Restarted the actual QA backend process, then verified both versions and
  approval via the Arabic UI at 450px. Dialog fits the viewport.
- In-memory generated fenced HTML/SVG/code artifacts still use the transcript
  registry. Integrate these with durable results before signing off phase 3.
  File snapshots and image previews alone do not prove that additional path.

### Generated content and snapshot previews
- Added complete-fence extraction for substantial HTML, SVG and code, with
  stable source keys and content-hash deduplication. Text comes from state.db;
  the user does not need to re-open the chat to register it in the renderer.
- Existing projects DBs migrate an origin column additively. Index version 2
  backfills older messages once. A recent file-report fast path paints current
  outputs first without advancing the historical cursor or overwriting newer
  report metadata during backfill. Generated versions follow historical order.
- Snapshot preview resolves only a version owned by the current profile,
  verifies SHA-256, and reuses the existing HTML/SVG sandbox and source viewer.
  It refuses altered snapshots and foreign paths. Binary/large files still open
  through the original saved-file bridge; previews are explicitly bounded.
- Production build/typecheck and 28 UI tests passed. Backend result suite has
  12 passing tests; the existing 38 project RPC cases also passed earlier in
  this slice. Actual backend + browser rendered both historical generated HTML
  versions without a session RPC and proved the opaque iframe blocks access
  to the host document. Screenshot viewed: outputs/hermes-generated-preview.png.
- Scope limit to preserve in final documentation: a saved HTML file is not a
  bundle of referenced CSS, images or external pages. Captured bytes are exact;
  rendering external resources does not freeze those resources in time.
- QMD primary README rechecked at https://github.com/tobi/qmd on 2026-09-08:
  current package is @tobilu/qmd, supports bunx, keyword search and local
  semantic/rerank models. Use that verified package name in phase 4; evaluation
  is still pending. Do not install it into the Hermes repository dependency tree.

### Phase 5 integration reconnaissance
Existing desktop effort pill already controls model reasoning and fast mode with
rollback through lib/session-model-writes. Task approach presets should guide
scope/verification in the new task's user message, without silently changing the
model, price or cancelling a task after a time cap.
Project menu is apps/desktop/src/app/chat/sidebar/projects/project-menu.tsx.
requestStartWorkSession(path, draft, {openTab}) in store/projects.ts opens a new
workspace draft through app/contrib/wiring.tsx. It does not auto-submit. This is
an existing seam for reviewable project workflow drafts.
commands.catalog and command.dispatch already expose/execute installed skills.
Dispatch order: quick, plugin, bundle, skill, built-in. Skill invocation is a
normal user-message scaffold, not a system-prompt mutation. Bundles load ALL
members, so broad bundles are a poor default for a quick UI change.
Existing relevant skills include local-browser-preview, dogfood,
research-to-artifact-provenance, grounded-citations, adversarial-doc-review,
weekly-review-planning. Read their actual instructions before choosing a route;
dogfood's full app audit is too broad to run indiscriminately for a small fix.
No phase 5 code edits yet. Hermes context refreshed for workflow research.

### Phase 6 entry points
Native task store is hermes_cli/kanban_db.py:create_task. It accepts assignee=None
and initial_status='blocked' for a parked task; the default 'running' argument
actually resolves to dispatchable ready. Do not use the default for an inbox
acceptance that should not auto-execute. An assignee is an execution profile,
not a human owner extracted from meeting text. Keep those meanings separate.
Native desktop task UI is src/plugins/kanban, including api.ts, drawer.tsx,
board.tsx and plugin.tsx. Read its instructions before adding task-open links.
Use the native idempotency_key to protect inbox accept retries and keep citations
in the created task body. Two databases need an explicit recovery/idempotency
strategy; do not assume one transaction spans project proposals and native tasks.
