# HerWork Workspace, and a Turn Outcome the user can always read

Status: design proposal (not yet implemented). Written 2026-09-10 on
`autobuild/sidebar-browser`; every anchor below was verified against that branch.
Surfaces: `apps/desktop` renderer, `agent/`, `tui_gateway/`, `~/.hermes/skill-bundles`.

Two features, one document, because they are asked for together and the second
one is what makes the first one worth using. A work desk whose sessions end in a
pile of transcript is not a desk.

1. **HerWork as a third workspace** beside Sessions and Bots: a tab with its own
   accent, whose new chats open on the `herwork` profile with cwd `~/herwork`
   and the `herwork` bundle already loaded.
2. **Turn Outcome**: a short, model-written account of what a turn achieved,
   pinned to the end of the turn and never folded away: what was delivered,
   what failed, what is still open.

## Part 1. What already exists (reuse, don't rebuild)

The whole shape of a third workspace is already in the codebase. Bot Mode was
built as a bundled plugin against a small core primitive, and that primitive is
the thing to extend, not the plugin.

| Element | Already exists | Anchor |
|---|---|---|
| Workspace mode type | `WorkspaceMode = 'sessions' \| 'bots'` | `src/contrib/types.ts:18` |
| Mode store, owner key, `+` routing target | `$workspaceMode`, `$workspaceOwnerKey`, `$workspaceNewSessionTarget`, `setWorkspaceScope` | `src/components/pane-shell/workspace-scope.ts` |
| Per-workspace active-pane memory | `workspaceScopeKey`, `rememberActivePane` | same file |
| Per-workspace active-pane memory in the strip (a SIGNAL, never a filter) | `tree-group.tsx:252,274` reads `$workspaceMode` only to key remembered panes | `src/components/pane-shell/tree/renderer/tree-group.tsx` |
| Persisted tile scope | `workspaceMode` on stored tiles | `src/store/session-states.ts:880` |
| Plugin-side open with a profile route | `sdk.openSession(..., { workspaceMode, workspaceOwnerKey })` | `src/sdk/index.ts:866` |
| `+` honouring the workspace route | `openNewSessionTab` | `src/app/contrib/wiring.tsx:942` |
| Bundled plugin auto-registration | vite glob over `src/plugins/*/plugin.tsx` | `src/contrib/plugins.ts` |
| Reference plugin doing all of the above | `hermes-bots` | `src/plugins/hermes-bots/plugin.tsx:98` |
| The HerWork profile | `~/.hermes/profiles/herwork/` (model, skills, own state.db) | on disk |
| The HerWork mode | bundle `herwork` (loads skill + mode instruction) | `~/.hermes/skill-bundles/herwork.yaml` |
| The desk and its rules | `~/herwork/{inbox,work,output}`, `AGENTS.md` | on disk |
| Theme retint from one seed | `retintTheme(theme, hex)` | `src/themes/retint.ts`, used at `context.tsx:477` |
| Post-turn aux model call, fast lane | `call_llm(task=...)`, `_FAST_MODEL_TASKS` | `agent/auxiliary_client.py:789` |
| Post-turn stage + dispatch split | `finalize_turn` stages, gateway dispatches after `message.complete` | `agent/turn_finalizer.py`, `docs/design/next-moves.md` |
| Backend → renderer lane for post-turn data | `session.title` emit + handler | `tui_gateway/server.py` → `gateway-event/session-info.ts:446` |
| Fold of a turn's working under one line | `TurnDigest` | `src/components/assistant-ui/thread/turn-digest.tsx` |

Nothing below is a new subsystem. Part 1 is a third value for an existing enum
plus a plugin that mirrors an existing one. Part 2 is a third fast auxiliary
task on an existing router, delivered on an existing event lane, rendered by a
component that already owns the end of the turn.

## Part 2. The map: 45 branches on `'bots'`, and what each one means for a third mode

`grep -rn "'bots'" src` (tests excluded) gives 45 sites in 13 files. They fall
into four kinds, and only the first kind is real work.

| Kind | Sites | Files | Change |
|---|---|---|---|
| **Core, semantic**: decides behaviour by mode | 19 | `store/session-states.ts` | Read each; most become `mode !== 'sessions'` or a lookup keyed by mode |
| **Core, routing**: `+`, open, scope key | 7 | `wiring.tsx:946,952`, `open-session.ts:98`, `workspace-scope.ts:69,114,115`, and `use-session-actions/index.ts:777` | Six generalise to "an owned workspace"; `:777` (`hidden: true`) stays bots-only, see below |
| **SDK surface** | 9 | `sdk/index.ts:868..1213` | Same generalisation; the SDK must not know the list of plugins |
| **Bot plugin internals** | 8 | `plugins/hermes-bots/*` | Untouched. They mean "am I in MY workspace", which stays `'bots'`. Three more `'bots'` hits in that tree (`roster-pane.tsx:404,812`, `types.ts:303`, `i18n.ts:328`) are roster filters and plural forms, not `WorkspaceMode` |
| **Type definition** | 2 | `contrib/types.ts:14,18` | The enum itself |

The 19 core sites, read one by one:

- `880, 882` (rehydrate stored tiles): the `raw.workspaceMode === 'bots' ? 'bots' : 'sessions'`
  coercion is the one line that would silently **drop** a persisted `'herwork'`
  tile back to Sessions on restart. It becomes a validated parse over the enum.
- `901, 902, 920, 921, 967, 968` (partition tiles): three copies of
  `sessionTiles = filter(mode !== 'bots')` / `botTiles = filter(mode === 'bots')`.
  These already treat "not bots" as the default bucket. Generalised to
  "sessions vs owned" they need no third copy.
- `1195` (`isBotChat`): hides canonical Bot Chats from the Sessions sidebar.
  **HerWork sessions are NOT hidden**: they are ordinary sessions that happen
  to live in a workspace, so this stays `=== 'bots'`, deliberately. The same
  holds for `use-session-actions/index.ts:777`, which creates the session
  `hidden: true` for Bot Mode; generalising it would hide every HerWork chat.
  These two are the only bots-only sites outside the bots plugin.
- `workspace-scope.ts:78` `workspaceScopeKey` returns `bots:<owner>` for ANY
  non-sessions mode, and `:114,115` `setWorkspaceScope` nulls the owner key and
  the `+` target for any non-bots mode. As written, HerWork's route would be
  dropped on the floor and its pane memory would collide with a bot's. Both
  generalise through `isOwnedWorkspace`; the key becomes `${mode}:${owner}`.
- `1238, 1244, 1245, 1530, 1551`: owner key, owner route, tab title only
  travel for owned workspaces. Generalise.
- `1692, 1726, 1729` (focus an owned tile): keyed by owner key; generalise.
- `1947, 2018`: tree placement of owned tiles. Generalise.

Everything HerWork needs from core is therefore one predicate:

```ts
// src/components/pane-shell/workspace-scope.ts
export type WorkspaceMode = 'sessions' | 'bots' | 'herwork'
export const isOwnedWorkspace = (mode: WorkspaceMode): boolean => mode !== 'sessions'
```

and the 25 core + SDK sites choose between "still means Bot Mode specifically"
(`1195`, and any `'bots'` that reaches for a bot roster) and "means any owned
workspace" (the rest). No site gains an `|| mode === 'herwork'`: that is the
copy that rots.

## Part 3. HerWork as a plugin (`src/plugins/hermes-herwork/`)

Mirror `hermes-bots` at a fraction of its size. It has no roster, no group
chats, no cron pane. It has one owner: the desk.

**Registers**

- A sidebar contribution in the same area Bot Mode uses for its workspace
  entry, labelled HerWork, with the desk glyph. Selecting it calls
  `setWorkspaceScope('herwork', HERWORK_OWNER_KEY, { kind: 'route', route })`
  where `route` is the local connection on the `herwork` profile
  (`connectionId` from the active gateway, `profile: 'herwork'`,
  `targetProfile: 'herwork'`), resolved the way `sdk/index.ts:866` builds an
  `ownerRoute` today.
- `HERWORK_OWNER_KEY = 'herwork:desk'`: one exact opaque string. Owner keys are
  never parsed (`workspace-scope.ts` header), so this is a constant, not a
  format.
- A `CHAT_EMPTY_AREA` contribution: the empty state for a new HerWork chat
  lists `inbox/` (count of files), `output/` (last three from `MANIFEST.md`),
  and one line of the desk rules. Bot Mode's `chat-empty.tsx` is the template.
- `ctx.i18n.register` for its strings in all six locales, like
  `hermes-bots/i18n.ts`.

**On opening a chat in the workspace**

- The `+` already routes through `openNewSessionTab` to the workspace's
  `newSessionTarget`, so the session is created on the `herwork` profile.
- cwd: NOT through `resolveNewSessionCwd()` (`store/projects.ts:152`). That
  function also serves `createBackendSessionForSend` (`use-session-actions:560`),
  so a workspace branch there would give the main chat `~/herwork` while it is
  created on the active gateway profile, and it would leave the literal `~` in
  renderer stores that compare paths. Instead `WorkspaceSessionRoute` gains an
  optional absolute `cwd`, and `openNewSessionTab` (`wiring.tsx:947`) passes it
  as `options.cwd` to `openNewSessionTile`, which already accepts one
  (`wiring.tsx:571`). Projects stays untouched.
- Mode injection has two preconditions the current tree does not meet:
  1. **Resolution under the profile home.** A herwork-profile turn runs with
     `set_hermes_home_override(profile_home)` (`prompt_turn.py:447`), and
     bundles resolve from `<HERMES_HOME>/skill-bundles` (`skill_bundles.py:28`).
     `~/.hermes/profiles/herwork/skill-bundles/` does not exist, so today
     `build_bundle_invocation_message('/herwork')` returns `None` there
     (verified: `bundles under profile home: []`). Step 4 starts by placing
     `herwork.yaml` in the profile home; the skill itself is already installed
     there (`profiles/herwork/skills/productivity/herwork`).
  2. **The right seam.** `session.create` (`methods_session.py:304`) carries no
     message, so there is nothing to prefix at create time. The pattern is
     `pending_hidden` (`methods_session.py:325`): a one-shot `pending_bundle`
     flag on the session dict, consumed by `_prepare_turn_input`
     (`prompt_turn.py:475`, where `prompt = text`) on the first user prompt
     only, prefixing exactly what a typed `/herwork` produces.
  Caching: this touches no system prompt and keeps role alternation; it is the
  shape of a typed `/herwork`. Size is ~11 KB (9 KB skill + 2 KB instruction),
  which lands in the cached prefix after turn one. Rehydration is safe:
  `session_history.py:226` projects user-row scaffolding away.
- `~/herwork/AGENTS.md` is picked up automatically because cwd is the desk.

**Theme**

`retintTheme` exists and is production-safe (it is an identity when the seed
matches). `$accentOverride` is dev-only by design and must stay so
(`accent-override.ts` header), so HerWork does not use it. Instead the theme
context gains one input: `$workspaceAccent`, `null` for Sessions and Bots,
a fixed seed for HerWork. `context.tsx:477` composes it the same way it composes
the dev override today, dev override winning when both are set (it is a
scratch control, so it must be able to show any colour). The seed is a
property of the workspace, so it lives in the plugin. `retintTheme`
(`retint.ts:170`) is ~20 OKLCH conversions and is memoised on
`[activeTheme, seed]`; the real cost is the `applyTheme` CSS-variable write,
which forces one document style recalc per workspace switch (hundreds of ms on
a 1,300-message thread, per `list.tsx`'s own measurements). Acceptable for a
deliberate tab switch; never on a hot path.

**Not in scope, on purpose**

- No hidden canonical chat. HerWork sessions are visible, listed, and titled by
  the normal title generator.
- No per-workspace session browser, and **no filtering of the tab strip by
  workspace**. `workspace-scope.ts` is explicit that the mode is a signal, not
  a filter, and that scoping panes by workspace is how the main zone once
  vanished when Bot Mode's last chat closed. HerWork tabs sit in the one main
  strip beside session tabs, like bot chats do.
- No preview-rail or file-pane changes. The desk's `output/` is a folder;
  Projects already owns folders.

## Part 4. Turn Outcome

### The problem, precisely

`TurnDigest` folds every settled assistant message before the tail under one
line, and that line is a **tally**: `summarizeToolRun` says "Edited 12 files,
ran 30 commands" (`turn-digest.tsx:141`). The tail message stays, so a reply
that ends "done, here is the file" is visible. But three things the user
actually wants at the end of a long turn have no home at all:

- what was **delivered** (the thing, not the count of edits that produced it),
- what **failed** or was skipped, and why,
- what is **still open** for them to do.

`next_moves` proposes one next action as ghost text; it is a suggestion, not a
record. `turn_summary.py` is the CLI's tally line. Neither is an outcome. And
the model's own final message is unreliable for this: it is prose, often long,
sometimes a question, and it is exactly what gets skimmed.

### The decision

Same architecture as Next Moves, for the same reasons (`next-moves.md`, "The
decision"): **a backend auxiliary task on the fast lane, staged in
`finalize_turn`, dispatched after `message.complete`, delivered on a new
`session.outcome` event, rendered by `TurnDigest`.** The renderer cannot build
this itself: `next-moves.md` documents that the best post-turn evidence
(unfinished todos, clarify state) is destroyed inside the very handler that
would trigger it.

The rule-table fallback is the tally we already have. With the aux call off or
failed, the outcome row shows `summarizeToolRun` plus the count of tool errors,
and nothing is invented.

### Contract

```json
{
  "type": "session.outcome",
  "session_id": "...",
  "turn_id": "<client turn id the desktop sent with session.prompt>",
  "outcome": {
    "delivered": ["q3-report.docx and its PDF in output/"],
    "failed":    ["xlsx totals: soffice missing, sheet not converted"],
    "open":      ["review the Arabic headings on slide 4"],
    "source":    "model" | "rules"
  }
}
```

- Each list holds 0 to 3 items, each one sentence, no markdown, max 140 chars,
  in the session's reply language (`_title_language()` already resolves it).
- `delivered` may be empty (a research turn). `failed` empty means nothing
  failed, not "unknown"; the rules fallback fills it from tool errors.
- **Turn identity is the open design question, and it changes the backend
  contract, so Parts 4's backend and renderer are designed together.** The
  backend mints `turn_id` as `session:task:uuid8` (`turn_context.py:423`) and
  the renderer never consumes it: `gateway-event/next-moves.ts` ignores the
  payload's `turn_id`, and `store/next-moves.ts` binds offers to the session's
  latest turn with start/complete counters instead. `TurnDigest`'s `turnId` is
  an assistant-ui client message id (`thread/list.tsx:251`), unknown to the
  backend. Two options: (a) bind like Next Moves, to the session's latest
  completed turn group under the same counter fence, which makes "late event
  for a turn no longer on screen" a counter mismatch; or (b) have the desktop
  send a client turn id with `session.prompt`, echoed back through the existing
  `_relay_pending_turn_id` seam (`turn_context.py:423`). **Choose (b)**: it is
  the only binding that survives two turns finishing close together, and the
  seam already exists. Next Moves does not need it because it shows one offer
  at a time; an outcome per turn does.
- Text is model-authored: rendered with bidi isolation (`next-moves.md`,
  blocker 4) and never as markdown.

### Generation (`agent/turn_outcome.py`, new, ~150 lines)

Staging reads what `finalize_turn` already holds: the turn's messages, the
tool results with `is_error`, and the todo list from `agent._todo_store`
(backend state; the renderer's own todo clear never touches it). Prompt: the last
assistant text, the list of tool calls with error flags, the todo list, and the
user's request; ask for the three lists as JSON. Same size class as
`title_generation`; add `"turn_outcome"` to `_FAST_MODEL_TASKS`. Note the
lane is **opt-in**: membership only permits fast routing, and the default is
the main model unless `auxiliary.turn_outcome.prefer_fast_model: true`
(`auxiliary_client.py:785`). Ship it on, or the cost estimate is wrong.

Three things Next Moves does that this must copy, not reinvent:

- The dispatch gate `agent._next_moves_dispatch` (`next_moves.py:534`, set at
  `server.py:2312`): without an equivalent, every CLI, cron and subagent turn
  stages an outcome for nobody.
- The generation fence `cancel_next_moves` (`prompt_turn.py:770`): a new turn
  starting must cancel an in-flight outcome for the previous one.
- Todo state is available: `agent._todo_store` (`agent_init.py:1162`) is on
  the agent `finalize_turn` receives; the renderer's clear is irrelevant
  backend-side. Elapsed time is NOT available in `finalize_turn`
  (`_turn_started_monotonic` lives in `prompt_turn.py:775`); gate on evidence
  instead, the way `MIN_RESPONSE_CHARS` does (`next_moves.py:66,560`).

Suppression: a turn with no tool calls and a final response under
`MIN_RESPONSE_CHARS` is a chat reply and gets no outcome, the same evidence
gate Next Moves uses (`next_moves.py:560`). Elapsed time is not the gate; it
is not available where staging runs. A turn that ended in an error still gets
one; that is when `failed` matters most.

Config: `auxiliary.turn_outcome.enabled` (default true), `use_model` (default
true), mirroring `auxiliary.next_moves.*`.

### Rendering

`TurnDigest` already owns the end of the turn and already knows when a turn is
live vs settled. The outcome renders as a `ScaffoldRow`-styled block **below the
digest header and above the tail**, or below the tail when nothing folded, with
three short labelled lines (Delivered / Failed / Open), each list as one line.
Failed carries the destructive tone; Open carries the accent.

It is **never folded**: it sits outside the `expanded` body. Folding is for
the working; the outcome is the point. It appears once the event lands and
stays for the life of the thread. Until then the digest header's tally stands
alone, which is today's behaviour; there is no renderer-side stand-in (see
"One fallback, not two" below).

Four renderer constraints, each with its anchor:

- **Keep the outcome out of `useTurnDigest`.** Its signature cache
  (`turn-digest.tsx:160`) exists so text deltas do not re-render the turn.
  The outcome lives in its own per-key store, `$turnOutcome(sessionId, turnId)`,
  read with `useStore` the way `$toolDisclosureOpen(disclosureId)` is at `:198`,
  so it re-renders only when an outcome changes.
- **One fallback, not two.** The backend emits `source: "rules"` when the model
  call is off or fails; the renderer does not compute its own tally for the
  outcome row. Until an event lands, the row is absent and the digest header's
  tally stands alone, which is today's behaviour.
- **Persist it.** `session.title` is stored in the DB
  (`methods_session.py:949`, `prompt_turn.py:545`); an outcome that is only in
  renderer memory is gone on reload, and "stays when I scroll back later"
  would be false. It is written beside the turn in the session DB and
  rehydrated with history. Replay is 512 frames deep on reconnect
  (`event_replay.py`), so the handler is idempotent per (session, turn).
- **Scope it.** `'session.outcome'` joins `SESSION_SCOPED_EVENT_TYPES`
  (`lib/gateway-events.ts:63`) so an unscoped frame is dropped, never landed
  on the focused chat; the handler registers in `gateway-event/index.ts:87`
  and the type union in `gateway-event/types.ts`. Eviction follows the session:
  delete, runtime-gone, profile switch (`clearAllSessionStates`), the paths
  Next Moves' blocker 3 enumerates. No TTL: this must outlive the session's
  screen time, unlike a suggestion.

Of Next Moves' five blockers, 3 (teardown) applies and is covered above; 4
(bidi isolation) applies to every model-authored line; 1, 2 and 5 do not,
because the outcome is not on the suggestion bus and has no click.

`DESIGN.md` gets one bullet under "Chat, tools & boot surfaces": the outcome is
the one thing in a settled turn that never folds, and it answers "what did I
get, what broke, what is left", never "how many tools ran".

## Part 5. User stories, each with its acceptance tests

Tests name their files. Vitest for the renderer, pytest for the backend.
Every story has at least one test that fails before the change.

### S1. Open HerWork and start a chat on the desk

> As a user I click HerWork in the sidebar and press `+`, and I am in a chat
> that already knows the desk.

- `plugins/hermes-herwork/plugin.test.tsx`: selecting the entry calls
  `setWorkspaceScope('herwork', 'herwork:desk', { kind: 'route', route })`
  with `profile === 'herwork'`.
- `store/projects.test.ts`: `resolveNewSessionCwd()` returns `~/herwork`
  when `$workspaceMode` is `'herwork'`, and its previous answer otherwise.
- `tests/tui_gateway/test_prompt_turn_pending_bundle.py`: with `pending_bundle`
  set, the FIRST user prompt is prefixed with the `/herwork` invocation and the
  flag is cleared; the second prompt is not prefixed; with the flag unset
  nothing is prefixed. Runs with the herwork profile home override active and
  a `skill-bundles/herwork.yaml` present there, because that is where it
  resolves in production.
- `app/contrib/wiring.test.tsx` (new file; none exists today): `+` in HerWork
  opens a tile scoped `'herwork'` with `options.cwd` set to the desk, `listed`,
  not `hidden`, on the routed profile.

### S2. Switch away and back without losing my place

> As a user I go to Sessions, then return to HerWork, and the tab I was on is
> the tab I get.

- `workspace-scope.test.ts`: `workspaceScopeKey('herwork', 'herwork:desk')`
  is `herwork:herwork:desk`, distinct from `'sessions'` and from every
  `bots:*` key (today it would be `bots:herwork:desk`, the regression this
  pins); `setWorkspaceScope('herwork', key, target)` keeps the owner key and
  the `+` target (today both are nulled); `resolveRememberedActivePane`
  restores the remembered HerWork pane.
- No tab-strip filtering test. The strip is not filtered by workspace, by
  design; the existing `tree-group` tests stay as they are.

### S3. Restart keeps my HerWork tabs in HerWork

> As a user I quit with three HerWork tabs open and reopen the app to find
> them in HerWork, not moved into Sessions.

- `session-states.test.ts`: a stored tile with `workspaceMode: 'herwork'`
  rehydrates as `'herwork'` (the `:880` coercion is the regression this pins),
  an unknown mode still falls back to `'sessions'`.
- **Bucket decision, pinned by test:** owned tiles persist in the shared
  cross-profile bucket (`BOTS_TILE_BUCKET`, `:827`, renamed to an
  owned-workspace bucket), not the per-gateway-profile bucket (`:943`). A
  HerWork tile carries `ownerRoute.profile: 'herwork'` while the gateway
  profile may be `default`; in the profile bucket it would vanish after a
  profile switch. Survival across profile deletion goes through `ownerMatches`
  (`:1900`), so every HerWork tile MUST carry an `ownerRoute`; the test
  asserts both. The existing `'bots'` assertions at `:183-275` are updated in
  the same commit.

### S4. Bots are untouched

> As a Bot Mode user nothing changes.

- The whole existing `plugins/hermes-bots/*.test.*` suite passes unchanged.
- `canonical-chat-registry.test.ts` still proves the open path reads no
  stored pointer; `hide-bot-chats.test.ts` still proves canonical chats are
  hidden while a HerWork session in the same store is not.

### S5. The desk looks like the desk

> As a user HerWork has its own accent, and Sessions and Bots keep theirs.

- `themes/context.test.tsx`: with `$workspaceAccent` set the resolved theme
  equals `retintTheme(active, seed)`; with `null` it is the active theme by
  identity (no repaint). `$accentOverride` remains `null` in production
  builds throughout (new assertion; no test references it today), and when both
  are set the dev override wins.

### S6. I can read what a turn achieved, always

> As a user, when a long turn finishes I see three short lines: what I got,
> what failed, what is left. They stay there when I scroll back later, and
> they are never hidden under the summary fold.

- `tests/agent/test_turn_outcome.py`: staging from a snapshot with two tool
  errors and one unfinished todo yields `failed` naming both errors and `open`
  naming the todo; a tool-less 1.2 s turn yields no outcome; a turn ending in
  an error still yields one.
- `tests/agent/test_turn_outcome.py`: model output that is not the JSON shape
  is discarded and `source` is `"rules"`; lists are capped at 3 and items at
  140 chars; text is in the resolved reply language.
- `tests/tui_gateway/test_session_outcome_event.py`: the event fires after
  `message.complete`, never before, carrying the client turn id the desktop
  sent with `session.prompt` (echoed via `_relay_pending_turn_id`); the
  outcome row is written to the session DB and returned with history; a
  replayed frame does not duplicate it.
- `tests/agent/test_turn_outcome.py`: staging is a no-op when the dispatch
  gate is off (CLI, cron, subagent turns); a new turn starting cancels an
  in-flight outcome for the previous one.
- `turn-digest.test.tsx`: with an outcome present the three lines render
  outside `[data-turn-digest-body]`, remain rendered when the fold is
  collapsed, and swap from `source: rules` text to `source: model` text
  in place without remount. Model text is inside a bidi-isolated element.
  A text delta on the tail message does NOT re-render the outcome row (the
  per-key store, not the digest signature cache).
- `gateway-event/outcome.test.ts`: an unscoped `session.outcome` frame is
  dropped; one for a session not on screen is stored, not painted; delete,
  runtime-gone and profile switch evict it; an outcome rehydrated with history
  renders without any live event.
- `turn-digest.test.tsx` (existing): the digest header still says the tally,
  so the two are not confused.

### S7. HerWork ends its jobs the way its skill promises

> As a HerWork user the outcome's `delivered` line names files in `output/`.

- Not a unit test: an e2e run in `apps/desktop/e2e/` (visual lane exists) that
  drives one small deliverable and asserts the outcome row names the produced
  path and `MANIFEST.md` gained a row. Runs on demand, not in the default lane.

## Part 6. Order of work, and the gates between steps

1. **Core predicate + rehydrate fix + partition helper** (`workspace-scope.ts`,
   `session-states.ts`). Gate: S3 and S4 tests green, full desktop suite at
   baseline (10,107 + new).
2. **Generalise the 6 routing sites (not `:777`) and 9 SDK sites.** Gate: S1 `+` test, S4.
3. **`hermes-herwork` plugin: entry, empty state, i18n.** Gate: S1, S2.
4. **Desk cwd on the workspace route + `pending_bundle` on first prompt.**
   Precondition on this machine: `herwork.yaml` placed in
   `~/.hermes/profiles/herwork/skill-bundles/`, or the bundle never resolves.
   Gate: S1 backend test under the profile home.
5. **Workspace accent.** Gate: S5.
6. **Turn Outcome contract first**: the client turn id round-trip
   (`session.prompt` -> `_relay_pending_turn_id` -> `session.outcome`), the
   DB column, the scoped event type. Backend and renderer halves of this step
   land together because the id binding is shared. Gate: S6 backend tests.
7. **Turn Outcome generation and rendering** (`turn_outcome.py`, aux task,
   dispatch gate and fence, `$turnOutcome` store, `TurnDigest` row).
   Depends on step 6 only, not on steps 1 to 5. Gate: S6 renderer tests.
8. `DESIGN.md` and `src/AGENTS.md` (a HerWork section beside Bot Mode's).
9. Rebuild with `hermes desktop --build-only --force-build`, then a live
   pass on this machine: open HerWork, run one deliverable, read the outcome.

Each step is one commit. Steps 1 and 2 touch the two most-shared files on the
branch (`session-states.ts`, `wiring.tsx`), so they land first and small,
before any other session edits them further.

## Part 7. Risks and the decision each one needs

- **Persisted tiles from before this change** carry no `'herwork'` and are
  unaffected. Tiles written by this build and then opened by an older build
  would be coerced to Sessions by the old `:880` line. Acceptable on a
  single-user fork; noted so a downgrade is not mistaken for data loss.
- **Aux spend**: one more fast-lane call per non-trivial turn. `next_moves`
  set the precedent and the kill switch shape. Default on, per the request.
- **Two post-turn calls in flight** (`next_moves`, `turn_outcome`) race
  nothing: both are staged from the same snapshot and dispatched on the same
  seam; they carry different event types and touch different surfaces.
- **The fold and the outcome could disagree** (tally says 30 commands ran,
  outcome says nothing delivered). That is correct and informative; the tests
  in S6 keep them visually distinct so it reads as two facts, not a bug.
- **Two fallbacks would drift.** If the renderer ever grows its own outcome
  tally, it and the backend's `source: rules` text will disagree in edge cases
  and the user sees the row flicker between two truths. One producer, the
  backend.
- **The riskiest step is 4**, not 1: three of the review's findings landed on
  it (bundle resolution under the profile home, the injection seam, the cwd
  seam), and each one fails silently on this machine rather than loudly.
- **Owner key for HerWork is a constant.** If a second desk is ever wanted, the
  key becomes a per-desk value and the plugin grows a picker; nothing in core
  changes, which is the point of keeping keys opaque.
