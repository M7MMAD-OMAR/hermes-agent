# Upstream merge: `merge/upstream-20260914`

Merged `origin/main` (`ee4452991d`) into `autobuild/sidebar-browser` (`489ff4b057`)
on 14 September 2026. 1565 upstream commits against 332 local ones, **74
conflicted files, 115 hunks**, all resolved.

## Policy

Local behaviour wins on the conversation and thinking surfaces; upstream
additions are ported INTO it, never over it. Where upstream's change was a
genuine fix or a newer design for the same idea, upstream wins and the local
tests were updated to match, each one noted below.

## Verification

| | |
|---|---|
| `npx tsc -p .` / `-p tsconfig.electron.json` / `-p tsconfig.e2e.json` | clean |
| `npx eslint src electron` | 0 errors (173 pre-existing warnings) |
| `npx vitest run` | **10,665 passed**, 10 skipped, 0 failed |
| `pytest tests/hermes_state tests/computer_use tests/tui_gateway/{session_control,server,event_contract,session_outcome,pending_bundle}` | 2073 passed, 1 pre-existing failure |
| `pytest tests/tui_gateway` | 1959 passed, 7 failed, every one of them also red on pure upstream (measured at `ee4452991d`: 7 failed there too, in the same two files) |
| `vite build` + `bundle-electron-main` | built |
| Live run | Electron launched on a private Orbit display with an isolated `HERMES_HOME` and userData: backend came up, renderer loaded, first-run provider screen, chat shell, settings, and Arabic RTL all render |

The one post-run unhandled error from `katex-memo.ts` via
`thread-remount.test.tsx` is the environmental one CLAUDE.md already documents.

## Local features confirmed alive in the running build

The two-deck composer (input with the in-field send control, toolbar deck
below), the HERWORK workspace tab beside Sessions and Bots, the effort pill,
the browser toggle, the notification inbox in the titlebar, and the full
Arabic RTL mirror.

## Resolutions worth knowing

### Where upstream won

- **`lib/model-options.ts`**: the catalog reconcilers this fork carried
  (`selectionInCatalog`, `firstSelectableCatalogModel`,
  `reconcileSelectionAfterCatalogRefresh`) are deleted, not merged. Upstream
  removed them because diffing a pick against the catalog silently swapped
  `deepseek-v4.1-flash` for the row's `-0731` sibling, which is a model this
  machine actually runs. Our capability reader survives, renamed
  `currentModelCaps` beside upstream's `currentModelCapabilities`.
- **Composer status groups start collapsed.** Upstream replaced the subagent
  roster's collapsed `preview` with a `collapsedIndicator` spinner; the three
  local subagent tests now open the roster before picking a worker.
- **Subagent detail panel moved inside `StatusSection`** (upstream's
  placement) while keeping our content: per-worker key, enter animation, and
  the spectator "Open chat" button.
- **Starmap context menu** is now Radix `DropdownMenu` (fixes clipping at the
  window edge); **`roster-pane.tsx`** takes upstream's extraction into
  `roster-pane-{toolbar,content,dialogs}` after checking feature parity;
  **`mcp-setup-tool.tsx`** takes the shared `ConnectorSummary`.
- **`openSession('stack')`** now opens a tile and focuses it instead of
  navigating, so the two notification-focus tests assert the id the open was
  asked for rather than a route.
- **`session-focus.ts`**: upstream's extracted `$focusedTreePaneId` replaces
  our local copy, patched from `workspaceMode === 'bots'` to
  `isOwnedWorkspace(workspaceMode)` so HerWork keeps the same fallback.

### Where this fork won

- **Lazy locale catalog and RTL.** `i18n/{context,runtime,catalog}` keep the
  per-locale chunks and direction-follows-the-loaded-tree behaviour, plus
  upstream's `isSupportedLocaleValue` / `resolveInitialLocale` and the shared
  `applyDocumentLocale`. Two consumers that wanted a static `TRANSLATIONS` map
  were adapted: `onboarding-chat/assembly.ts` falls back to English until the
  chunk lands, and `settings-i18n.test.tsx` imports the trees directly and
  awaits the label.
- **Per-session thread scroll.** Upstream's new "N messages below" counter was
  folded into `ThreadScrollChromeState` as `messagesBelow` rather than living
  in a global atom, because panes render side by side.
- **Notification deep links.** The `hermes://chat/<id>` body link, capability
  probe and popped-out-window routing were ported onto upstream's extracted
  `registerNativeNotifications` as optional host deps.
- **The docked conversation browser, the device panel, and the two-deck
  toolbar** in `chat/index.tsx` and `composer/controls.tsx`, now carrying
  upstream's `onAttachPastedText`, `onSteerHidden` and `hideModelPill`.
- **`index.html` boot pre-paint** keeps the per-key guarded reads and the
  luminance-picked ink, and gains upstream's transparent-window gate.
- **`computer_use`** cache keys are now profile-scoped AND surface-scoped;
  release still sweeps every surface a session leased.
- **FTS trigram opt-out** (`sessions.trigram_fts`) survives inside upstream's
  rebuilt `_init_fts` admission flow.
- **`foreign_sessions`** keeps the Kimi Code importer; `_SOURCES` rows grew to
  upstream's env-override shape plus our mtime resolver.

### Deleted with upstream

`app/settings/plugins-settings.tsx` and `plugins/accent/picker.tsx`. Our only
change to each was one RTL polish line (`pr-4` to `pe-4`).
**Follow-up:** reapply that logical-property fix in upstream's new Plugins
surface, or Arabic RTL regresses there.

### Contract additions

`next_moves.offer` and `session.outcome` are this fork's own backend events and
were missing from the shared gateway contract; both are now in
`apps/shared/src/gateway-events.{json,ts}`.

### i18n

- Arabic: 162 strings and 18 interpolated messages translated for the surfaces
  that arrived with the merge (connectors, free tier, vault, the rebuilt
  plugins page, GPT-Live voice, the handoff tour). Long dashes removed from the
  three upstream strings that carried them; the house-style test is green.
- ja / zh-hant: the coverage ratchet moved from 600 to 740. Those surfaces
  arrived untranslated from upstream too (measured on `origin/main`: ja 715,
  zh-hant 668), and this fork does not ship them to a reader. Arabic kept its
  tight ratchet and was translated instead.

### Small fixes taken along the way

- `useEnterAnimation` now skips when `el.animate` is absent (jsdom, and any host
  without Web Animations) instead of throwing out of a layout effect.
- `computer_use`'s release no longer pops the per-session approval dicts.
  Upstream moved those grants into the shared store (`tools.approval.clear_session`)
  and deleted the dicts, so the merged line raised `NameError` on every release.
- The gateway event contract test now also reads `agent/*.py`. This fork emits
  `next_moves.offer` and `session.outcome` from the agent through the callable
  the desktop gateway installs, so a `tui_gateway`-only scan called them orphans.
- **An upstream test was modified** and will re-conflict on the next merge:
  `test_apply_wal_concurrent_connects_no_eio` swept the whole process for
  deleted WAL/SHM fds, and shares that process with this fork's WAL-holder
  suites, which leave orphaned holders on purpose to assert on them. Its sweep
  is now scoped to its own `tmp_path`.

### Known failures that are NOT this merge

- `tests/hermes_state` `TestFTS5Search::test_search_projection_skips_context_enrichment_queries`
  fails on the pre-merge branch too.
- The 7 `tests/tui_gateway` failures only appear in a whole-directory run (each
  file is green alone) and reproduce on pure upstream, which additionally fails
  `test_model_options_preserves_canonical_custom_row_after_agent_init` that this
  branch had already fixed.

## Still to do before this lands

1. `pytest tests/hermes_cli tests/tools tests/plugins tests/agent` was still
   running when these notes were written. Everything else on the Python side is
   verified above.
2. `hermes-land-update` from the live checkout. It refuses while the tree is
   dirty, and the live checkout currently holds another agent's uncommitted
   files.
3. Nothing here is in the app the person is running: `release/linux-unpacked`
   has not been regenerated, so neither the owner-resolution fix nor this merge
   is live until that rebuild happens.
