# Workspace-following terminal and file tree

Date: 16 September 2026
Branch: autobuild/sidebar-browser

## The ask

Working across several projects, one conversation per project (each with its own
folder). Switching conversation should make the side panel and the terminal
follow that conversation's workspace:

1. Opening the terminal (Ctrl+`, the rail, the pane becoming visible) must land
   in the active conversation's directory.
2. A project that already has a terminal must be REUSED, never duplicated, and
   the terminal belonging to another project must never be stopped.
3. The files panel must show the new conversation's tree immediately on switch,
   with no slowdown.

## Current behaviour (verified in source)

### Terminals

`apps/desktop/src/app/right-sidebar/terminal/terminals.ts`

- `TerminalEntry.cwd` is snapshotted once at creation; `restoreCwd` tracks the
  live shell cwd (OSC 7 probe). `terminalCwd()` prefers `restoreCwd`.
- `$currentCwd.listen` (L240 area) re-SELECTS a user tab already pointed at the
  new cwd. It deliberately never creates, never closes, never reveals the pane.
- `ensureTerminal()` (L215) runs when the pane becomes visible
  (`persistent.tsx:80`) and only guarantees that AT LEAST ONE tab exists. It
  ignores which project that tab points at.

Gap: opening the terminal in project B while the only tab lives in project A
leaves you in project A. Nothing creates a shell for B.

### Files panel

`apps/desktop/src/app/right-sidebar/files/use-project-tree.ts`

- One global `$projectTree` atom holds exactly one root.
- `loadRoot()` sets `keepVisible = current.cwd === cwd && !reset`, so a root
  change throws away `data`, `openState` and `resolvedCwd` and repaints empty
  until the read resolves.
- The hook's return memo zeroes everything again when `state.cwd !== cwd`.

Gap: every switch is a cold read plus a blank frame, and all expansion state is
lost. Switching back and forth pays the full cost each time.

Not a gap: the blank-during-transition gate in `right-sidebar/index.tsx`
(`hasWorkspace`) is fine. `$workspaceCwdOwner` is claimed on the same tick as
the selection on both resume paths
(`use-session-actions/utils.ts:1824` cold, `index.ts:1214` warm), so the owner
does not lag.

## Design

### T1. Workspace-aware `ensureTerminal()`

Widen `ensureTerminal()` from "create if zero tabs" to:

1. Read the OWNED workspace cwd (see T3). Empty means a detached conversation:
   fall back to today's behaviour, create one only if no tab exists at all.
2. If the active tab is a user tab already at that cwd, no-op.
3. Else if any user tab is at that cwd, select it.
4. Else `createTerminal(cwd)`.

Dedupe key is the normalized cwd, not the conversation id: two conversations in
the same folder share one terminal, which is what "do not open a new terminal"
asks for. Existing terminals are never closed.

The `$currentCwd.listen` block stays selection-only. Passive conversation
browsing must not mint PTYs; the trigger is the explicit open.

Doors that reach this: `view.showTerminal` (Ctrl+`) and the rail both end at
`togglePaneVisible('terminal')` then `PersistentTerminal`'s ensure effect, so
one function covers both. `view.newTerminal` keeps creating unconditionally.

### T2. Per-root file tree cache

In `use-project-tree.ts`, add a bounded LRU (8 roots) of
`{ data, openState, resolvedCwd, collapseNonce }`.

- Keyed by `` `${connectionKey}::${cwd}` ``, NOT by path alone. Same path on a
  different backend must not paint the other machine's tree.
- `loadRoot` snapshots the outgoing root into the cache before switching.
- On a cache hit, paint synchronously (`loaded: true`, `rootLoading: false`)
  and reconcile in the background through the existing
  `revalidateTree(cwd, { dirs: [], full: true }, connectionKey)` path, which is
  already non-destructive and keeps expansion.
- On a miss, today's path unchanged.
- `resetProjectTreeState()` and the connection-change branch drop the cache.

Cost is bounded: at most 8 trees of already-loaded nodes, no extra polling, no
extra IPC on the hot path (the background reconcile replaces the cold read that
was happening anyway).

### T3. Shared owned-workspace selector

`right-sidebar/index.tsx` computes `hasWorkspace` inline from `$currentCwd`,
`$workspaceCwdOwner` and `$selectedStoredSessionId`. Extract that into a
computed atom in `store/session.ts` (`$ownedWorkspaceCwd`, '' when un-owned) and
consume it from both the files pane and T1, so the terminal cannot create a
shell in the previous conversation's folder during a transition.

## Tasks

| # | Task | Files |
|---|---|---|
| T3 | `$ownedWorkspaceCwd` computed, adopt in files pane | `store/session.ts`, `right-sidebar/index.tsx` |
| T1 | Workspace-aware `ensureTerminal()` | `right-sidebar/terminal/terminals.ts` |
| T2 | Per-root tree cache with background reconcile | `right-sidebar/files/use-project-tree.ts` |
| T4 | Tests extended in place | `terminal/terminals.test.ts`, `files/use-project-tree.test.ts`, `right-sidebar/index.test.tsx` |

## Verification

- `cd apps/desktop && npx vitest run src/app/right-sidebar src/store` first.
- Then the full `npx vitest run` (~9,600 tests, ~4 min).
- The two failures recorded in `CLAUDE.md` are environmental; confirm on a clean
  checkout before chasing.
- No `hermes desktop`, `hermes update` or `hermes-land-update`: the running copy
  must not be disturbed. vitest needs no build.
- Commit only the paths above. The tree carried 9 unrelated dirty entries at the
  start of this session; they belong to another agent.

## Result (16 September 2026)

All four tasks implemented.

| File | Change |
|---|---|
| `src/store/session.ts` | New `$ownedWorkspaceCwd` computed: the live cwd, but only while the selected conversation owns it. |
| `src/app/right-sidebar/index.tsx` | Files pane consumes it instead of re-deriving the ownership comparison. |
| `src/app/right-sidebar/terminal/terminals.ts` | `ensureTerminal()` is workspace-aware: no-op if the active tab is already at the workspace, select a matching tab if one exists, else create one there. Detached conversations keep the old one-tab rule. `createTerminal()`'s default cwd now prefers the owned workspace so `view.newTerminal` cannot open a shell in the previous project. |
| `src/app/right-sidebar/terminal/persistent.tsx` | While the pane is genuinely on screen, a workspace change re-runs the ensure, so switching conversation follows the project. Gated on real visibility, not the takeover flag. |
| `src/app/right-sidebar/files/use-project-tree.ts` | Bounded LRU (8 roots) of `{data, openState, resolvedCwd, collapseNonce}`, keyed by connection AND path. A revisited root paints synchronously, then reconciles the root only. |
| `terminals.test.ts`, `use-project-tree.test.ts`, `persistent.test.tsx` | 12 new cases. |

The `$currentCwd.listen` block in `terminals.ts` stays selection-only on purpose:
a passive conversation switch must never mint a PTY.

### Two corrections made during review

1. The first cut reconciled a restored root through `revalidateTree(full: true)`,
   which recurses over every loaded directory. Measured with a test: returning to
   a root with 10 folders expanded cost 11 `readDir` calls where the cold path it
   replaced cost 1. Narrowed to a targeted re-read of the root alone, which keeps
   loaded subtrees through the existing merge and leaves deeper staleness to
   `$workspaceChangeTick`. The test asserts exactly 1 read, so a regression back
   to fan-out fails loudly.
2. `rememberTree` banked nodes whose children were still the synthetic
   "Loading…" row. Leaving a root calls `inflight.clear()`, so that read never
   lands, and the restored tree would show a spinner nothing was coming back to
   clear. `settleForCache` un-resolves those nodes so they re-read on next expand.

### Deliberate behaviour worth knowing

- Re-opening the pane re-homes you to the current conversation's project even if
  you had manually parked on another project's tab. Recorded in the comment.
- A detached conversation never triggers a re-home, and never opens a shell in
  whatever directory the process happens to sit in.

### Verification

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx eslint` on the touched paths: 0 errors (5 pre-existing warnings in files
  not changed here).
- `npx vitest run`: 1053 files, 10,680 passed, 6 skipped, 195s. One unrelated
  failure, `artifacts/result-version-preview.test.tsx`, a 12s timeout under
  parallel load; it passes in isolation and passed in the earlier full run. The
  `katex-memo` error listed in `CLAUDE.md` did not reproduce.
- The new `persistent.test.tsx` case was mutation-checked: deleting the
  `ensureTerminal()` call makes it fail.

No build, no `hermes desktop`, no `hermes-land-update`. The running copy was
never touched. Changes are left uncommitted; the tree also carries unrelated
work from another agent.
