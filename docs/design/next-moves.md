# Next Moves — post-turn suggestions in the desktop

Status: implemented (`54fc5dd08`, `7a136e374`, `319cf04ba`), on by default
Blockers: landed first — see below
Surfaces: `apps/desktop` renderer + `agent/` + `tui_gateway/`
Anchors below were verified against `autobuild/sidebar-browser`.

When a turn ends, offer the user 1–3 concrete next moves derived from what that
turn actually did — a follow-up prompt, a skill they have, a delegation, or a
retry of the step that failed. One click edits the draft. Nothing sends.

## Reuse, don't rebuild

| Element | Already exists | Anchor |
|---|---|---|
| Pill strip above the composer | `SuggestionPills` | `apps/desktop/src/app/chat/composer/suggestion-pills.tsx:44` |
| Session-scoped suggestion bus | `offerSuggestions` (event half) | `apps/desktop/src/store/composer-suggestions.ts:149` |
| Event-provider precedent | `repair` | `apps/desktop/src/store/suggestion-providers/repair.ts:101` |
| Post-turn aux-model call | `title_generator` | `agent/title_generator.py:403` |
| Post-turn hook + snapshot | `_spawn_background_review` | `agent/turn_finalizer.py:824` |
| Cancellation token | `_BackgroundReviewRun` | `agent/background_review.py:37` |
| Provider/model/timeout/cost routing | `call_llm(task=…)` | `agent/auxiliary_client.py:10186` |
| Result → renderer lane | `session.title` emit + handler | `tui_gateway/server.py:13482` → `gateway-event/session-info.ts:446` |
| One-window-only claim | `ownsAmbientCue` | `apps/desktop/src/store/ambient.ts:6` |

Nothing here is a new subsystem. It is a sixth provider on an existing bus, fed
by a new auxiliary task on an existing router.

## The decision

Three architectures were designed and compared.

| | Generation quality | Cost/turn | Determinism | New contract surface |
|---|---|---|---|---|
| **A. Backend aux task** *(chosen)* | good — sees the full snapshot | 1 small call | fallback is deterministic | 1 gateway event |
| B. Renderer rule table | poor — reconstructs from wreckage | 0 | total | none |
| C. Agent emits a tool call | best — holds the reasoning | 0 (in-turn tokens) | none — model may never call it | tool + capability advertisement |

**Chosen: A, with B's rule table as its offline fallback, in the same module.**

- B loses on quality, and for a structural reason: the renderer destroys the
  best post-turn evidence inside the very handler that would trigger it.
  Unfinished todos are dropped by `clearActiveSessionTodos`
  (`apps/desktop/src/store/todos.ts:140`, called from
  `gateway-event/message-stream.ts:328`, and the `todoListActive` guard at
  `todos.ts:142` means it is specifically the *unfinished* half that dies).
  Clarify is cleared one line earlier at `message-stream.ts:324`. The
  compaction flag is read-**and-cleared** at `use-message-stream/index.ts:785`.
  A renderer generator builds from the wreckage of its own trigger.
- C loses on reliability, not on merit. Its failure mode is silence: a model
  that never calls the tool produces no suggestions and no error. Three further
  seams make it worse than it looks — `desktop_ui.emit` falls back to
  `os.environ` then `""` (`gateway/session_context.py:393`), delegated children
  inherit the whole `desktop_ui` toolset because `_strip_blocked_tools` only
  drops a toolset when *every* tool in it is blocked
  (`tools/delegate_tool.py:1374`), and the tool's `check_fn` is TTL-cached for
  30s with a 60s false-after-true grace (`tools/registry.py:273`), so turning
  the feature off leaves it advertised for up to a minute.
- A's fallback is not a consolation prize. `auxiliary.next_moves.enabled: false`
  yields the rule table alone: zero cost, still useful, same UI. That is B,
  shipped as a mode rather than as a competing implementation.

## Blockers — five defects that must land before the feature

**Status: all five landed** (`14bd215ad`, `9674f7afa`, `cd6e95580`, `5512fd491`,
`55c2324bc`). Kept here because each one explains a constraint the feature is
built on top of.

These were pre-existing. Each one silently breaks Next Moves, and the last one
was already a live bug in three shipped providers.

### 1. Cap eviction is recorded as a user decline

`publish` breaks at `MAX_SUGGESTIONS` and then hands the **truncated** array to
`recordWithdrawals`, which strikes every previously-shown key missing from it.

```
composer-suggestions.ts:235   if (merged.length >= MAX_SUGGESTIONS) break
composer-suggestions.ts:240   recordWithdrawals(key, merged)   // ← truncated
composer-suggestions.ts:207   counts.set(key, (counts.get(key) ?? 0) + 1)
```

Three cap losses reach `IGNORED_LIMIT = 3` (`:184`) and `quieted` (`:195`)
silences that key for the session. A post-turn pill that loses the slot race to
a standing `repair` offer is dead in three turns, having never been seen.

**Fix:** pass the pre-truncation candidate set to `recordWithdrawals`. Own
change, own test — it affects all five existing providers.

### 2. A re-offer that changes only `invoke` keeps the stale closure

`RENDERED` omits `id`, `provider` and `invoke` (`:77`), and `write` bails when
every rendered field matches (`:102`). Re-offering the same key with new
behaviour and identical text keeps last turn's action.

**Fix — smaller than it first read.** The sibling store takes the identical
trade-off deliberately and says so: `run` is excluded from the micro-action
comparison because it is a fresh closure on every resolve, so including it
would make every comparison false and defeat the bail-out
(`store/composer-actions.ts`). The suggestion bus took the same trade-off
silently, and its existing test covers only the case where a rendered field
*did* change — so "re-offering swaps in the fresh invoke closure" read as
unconditional when it is not.

So this is a documentation-and-pin change, not a behaviour change: state the
invariant where the comparison lives, and pin the other half of it. Providers
comply by folding a moving target into the id — `action:<slug(payload)>`, not a
bare `action` — which this design already does (see *Declined ledger*).

### 3. Nothing clears the bus on session teardown

Six module maps — `eventOfferings` (`:144`), `draftOfferings` (`:172`),
`ignoredCounts` (`:185`), `shown` (`:186`), `sampleTimers` (`:252`),
`sampleGenerations` (`:253`) — have no per-session eviction.
`clearDraftSuggestions` (`:300`) deliberately spares event offerings, and says
so in its own docstring (`:297`).

Confirmed: nothing clears them on delete
(`use-session-actions/index.ts:2450`), on reclaim (`gateway-event/lifecycle.ts:94`),
on Stop (`session-tile-actions.ts:348`), or on profile switch — where
`clearAllSessionStates` (`session-states.ts:555`) drops everything *else*.

**Fix:** add `forgetSessionSuggestions(sessionId)` clearing all six, and call it
from delete, runtime-gone (`runtime-gone.ts:108`) and the profile switch. Same
shape as `forgetPreviewTab`.

A runtime id dies through **three** channels, not two. `markRuntimeGone` covers
the 4001 pull verdict and the `session.reclaimed` push. The third is
`resetTileRuntimeBindings` (`session-states.ts:1213`), which drops every tile's
binding on reconnect without going through either — and a respawned backend
re-mints ids, so those sessions strand. Evict there too, for the tiles actually
dropped.

### 4. Model-authored text needs bidi isolation

The label is a bare `<span className="truncate">{label}</span>`
(`suggestion-pills.tsx:154`) and the tip a bare `<Tip label={tip}>` (`:132`).
An Arabic label under an LTR document resolves the wrong base direction and
`truncate` clips its logical start.

**Fix:** `dir="auto"` on both, before any model text reaches the strip.

### 5. Clicking a pill in an unfocused tile writes into another conversation

`requestComposerInsert` defaults `target = 'active'`
(`app/chat/composer/focus.ts:249`) → `resolveActive()` (`:138`) → whatever
composer last received editor **focus**. `markActiveComposer` fires on
`onFocus` only (`composer/index.tsx:1089`), and clicking a pill *button* does
not focus that tile's editor. Verified: `skill.ts:202`, `github.ts:88` and
`cron.ts:73` all call it with no `target`.

In a split layout, clicking a suggestion in a tile prefixes a **different
chat's draft**. This is the exact cross-conversation bleed the feature is
required not to have, and it is already shipping.

**Fix:** thread the pill's `ComposerTarget` through `invoke`'s context
(`ComposerSuggestion.invoke` at `:46`) and pass it explicitly. Fix the three
existing providers in the same change. Make the field **required**, not
optional — that is what turns "a provider might forget" into a compile error,
and it found every call site by itself.

Size check: `scope.target` is already in hand at the render site —
`const scope = useComposerScope()` (`composer/index.tsx:161`) in the same
component that renders `<SuggestionPills sessionId={statusSessionId} />`
(`:1190`). So this is one new prop plus one context field, not a
prop-threading change through the composer tree. `ActionBadges` (`:1189`) sits
on the same line with the same exposure but has no instance to fix: core ships
no micro-actions, and `ComposerMicroActionContext` is documented as "a standing
compatibility promise to the plugins using it". A contributed action that edits
the draft will need the target; expanding that contract for zero current callers
is not a bug fix.

## Contract

Event `next_moves.offer`, emitted through `_emit(type, sid, payload)`
(`tui_gateway/server.py:2617`), which stamps `session_id` via `_event_frame`
(`:2609`).

```jsonc
{
  "session_id": "<runtime sid, never empty>",
  "turn_id":    "<the value finalize_turn passes to on_session_end>",
  "source":     "model" | "heuristic",
  "moves": [                       // 1..3, schema-validated at the boundary
    { "kind": "followup" | "skill" | "delegate" | "action",
      "label": "…",                // model-authored, <= 48 chars
      "tip":   "…",                // model-authored, why this is offered
      "payload": "…" }             // the text inserted into the draft
  ]
}
```

New optional fields go on `GatewayEventPayload`
(`apps/desktop/src/lib/chat-messages/types.ts:160`), beside `session_id`/`title`.

Renderer: new handler `gateway-event/next-moves.ts`, appended to `HANDLERS`
(`gateway-event/index.ts:83`); new provider
`store/suggestion-providers/next-move.ts` calling
`offerSuggestions(sessionId, 'nextmove', …)`.

**Every kind resolves to a draft edit.** `followup` and `action` insert their
prompt text; `skill` inserts a server-resolved `/command`; `delegate` inserts a
`delegate_task` prompt the user still has to send. No `invoke` on this provider
may submit, spawn, or make a gateway call. See *One click* below.

## Generation

New module `agent/next_moves.py`.

**Staged** at `agent/turn_finalizer.py`, beside the background-review gate
(`:815`–`:824`): a `list(messages)` snapshot plus locally-computed evidence.
Staging is LLM-free and side-effect-free.

**Dispatched** from the gateway post-turn seam at `tui_gateway/server.py:13760`
— the block where `/goal`, `/loop` and `pending_title` already run, immediately
after `_emit("message.complete", sid, payload)` at `:13758`. Staging cannot
dispatch: `finalize_turn` runs *before* the desktop is told the turn ended
(`run_conversation` returns at `:13487`).

A `threading.Thread(daemon=True, name="next-moves")` — the auto-title shape
(`agent/title_generator.py:750`). The foreground never waits, and unlike
`cancel_background_review_for_live_turn` it never blocks on cancel: there is no
fork and no tools, so cancellation is a fence checked twice (before the call,
before the emit) and the in-flight request is simply discarded.

**Input** — a bounded digest, never the raw transcript:
- `build_recap(messages, …)` (`hermes_cli/session_recap.py:244`) — pure local,
  no LLM, no prompt-cache touch (`:11`).
- The `<available_skills>` block lifted from the agent's **own** system prompt
  with `_SKILLS_BLOCK_RE` (`agent/context_breakdown.py:17`, applied `:216`).
  Not a fresh scan — see *Isolation*.
- Budgets copied from `agent/side_question.py:45` (2000 chars/message, 24000
  total).

**Call** — one `call_llm(task="next_moves", …, extra_body={"response_format":
_MOVES_RESPONSE_FORMAT})`, mirroring `agent/title_generator.py:403`–`:412`.
Strict JSON schema, `additionalProperties: false`, `maxItems: 3`.

**Fallback** — `call_llm` *raises* on exhaustion, it never returns None
(`agent/auxiliary_client.py:5236`). Every precedent wraps it; title generation
catches and returns None (`agent/title_generator.py:434`). So:
`except Exception: moves = _heuristic_moves(evidence)`.

The heuristic emits **at most one** move, from evidence already in hand:

| Evidence | Move |
|---|---|
| a failed tool call in the snapshot | `action` — retry that step |
| file edits (`_FILE_EDIT_TOOLS`, `session_recap.py:41`) + a test runner in the recap | `action` — run the tests |
| a skill from the extracted block named in the user's last message, not yet invoked | `skill` |

Never `delegate` — too costly to propose blind. If the heuristic is also empty,
**nothing is emitted**: no event, no empty strip. Same terminal shape as the
titler (`agent/title_generator.py:640`).

Malformed model output — non-dict, missing `moves`, unknown `kind`, empty
`label`, >3 entries — all route to the heuristic. A `skill` move naming a skill
absent from the extracted block is **dropped**: the model may not invent a
skill the user does not have.

**Name:** `next_moves`, not `suggestions`. `/suggestions` already resolves to
the cron-automation proposal store (`hermes_cli/suggestions_cmd.py:1`).

## Trigger and suppression

Fires once per turn, at `tui_gateway/server.py:13760`. Every row is a hard gate.

### Stage-time (backend, `turn_finalizer.py`)

| Case | Gate |
|---|---|
| No final response | reuse the background-review predicate (`:815`) |
| Interrupted | `interrupted` — the renderer also early-returns at `use-message-stream/index.ts:575` |
| cron / subagent platform | `_NO_NEXT_MOVES_PLATFORMS`, a copy of `_UNTITLED_PLATFORMS` (`agent/turn_context.py:263`, checked `:278`) — without it, N delegated children pay N calls |
| CLI / ACP / messaging surfaces | `agent._next_moves_dispatch`, set by the gateway on the agent it owns. The dispatcher lives at one seam; every other surface sharing `finalize_turn` would otherwise extract evidence on every turn for a consumer that does not exist there |
| Reading the skill index | fills in **after** the triviality gate. `_skill_names` rebuilds the agent's system prompt to read the block out of it — far too much to spend on a turn about to be discarded |
| Trivial turn | `< min_turn_tool_calls` tool calls **and** a short response — the interval-gating idea `_should_review_skills` uses (`turn_finalizer.py:795`) |

### Dispatch-time (backend)

| Case | Gate |
|---|---|
| `status != "complete"` | no dispatch. A failed turn is the same `message.complete` distinguished by `payload.status === 'error'` (`message-stream.ts:343`) |
| Billing wall | `payload.billing` present (`message-stream.ts:355`) |
| Partial failure | **not separable at this seam, and shipped folded into `error`.** `partial` is not on the `message.complete` payload the gateway builds, so a turn that produced real output and then errored is indistinguishable from a clean failure here. The plan called it a third class and it should be; making that true means plumbing the flag onto the payload first |
| Agent-continued turn | see below — needs a provenance field, not just a predicate |
| Feature disabled | `auxiliary.next_moves.enabled` |
| Managed local runtime | `skip_managed_local` — a **skip**, not a defer. `agent/review_idle_queue.py:1` documents that a post-turn job monopolizes the GPU the next prompt needs; a suggestion 40s late is worthless, so the deferral constants there are the wrong medicine |

#### The agent-continued gate needs a new field

`/goal` continuation, `/loop` ticks, wakeups and batch drains all resubmit
through `_run_prompt_submit`, which its own comment calls "the ONE chokepoint
every fresh turn source must" pass (`tui_gateway/server.py:13090`). One user
prompt therefore yields N `message.complete` events, and a user who drove none
of them gets a pack after every internal tick.

The gate cannot be read at dispatch time on the *current* turn: `goal_followup`
is acted on at `tui_gateway/server.py:14086`, **after** the emit at `:13758`. It
is the *next* turn that must know it was agent-initiated.

The chokepoint already carries a partial answer — `display_kind="auto_continue"`
is passed at `tui_gateway/server.py:10336` — but the goal continuation at
`:14095`, the wakeup at `:12350` and the batch drain at `:12588` pass nothing.
So: add an explicit `initiator` kwarg to `_run_prompt_submit`, default
`"user"`, set to `"agent"` at every non-`prompt.submit` caller, and record it on
the session for the dispatcher to read and clear. This is a real edit, not a
predicate over existing state — budget it into step 2 of the build order.

### Renderer-side drops (handler)

| Case | Detected by | Required behaviour |
|---|---|---|
| Empty session id | handler entry | Hard-return. Never write the `''` bucket (`composer-suggestions.ts:68`) — `useSessionSlice` never reads it back (`use-session-slice.ts:29`), so the write is invisible and permanent |
| Unscoped frame | `gatewayEventRequiresSessionId` (`lib/gateway-events.ts:61`) | **Add `next_moves.offer` to it.** Staying out of `UNSCOPED_STREAM_EVENT_TYPES` is *not* enough: `resolveGatewayEventSessionId` falls through to `activeSessionId` for any unscoped non-`subagent.*` event (`:151`) |
| Stale turn | `turn_id` vs the session's last completed turn | Drop. The bus carries no turn identity today (`offerSuggestions` writes unconditionally, `:149`) |
| Session busy again | `ClientSessionState.busy` (cleared at `use-message-stream/index.ts:764`, re-armed by `message.start`) | Drop |
| **Replayed on reconnect** | every session frame is stamped and buffered 512-deep (`tui_gateway/event_replay.py:52`) and re-requested past the client watermark (`apps/shared/src/json-rpc-gateway.ts:585`), dispatched through the same path as live frames | Drop on `turn_id` mismatch. Seq dedupe cannot detect staleness — an offer emitted while the socket was down arrives minutes later |
| Queue about to drain | `shouldAutoDrain = !isBusy && !parked && queueLength > 0` (`composer-queue.ts:497`) fires on the *identical* edge as turn end | Suppress. But a **parked** queue is idle-not-draining and is a valid moment to offer, and an **exhausted** queue (`MAX_AUTO_DRAIN_ATTEMPTS = 4`, `:502`) must count as idle or the feature goes permanently silent for that session |
| Blocking prompt open | `sessionBlockingPrompt` parks the composer and reroutes typing to the queue (`composer/index.tsx:174`) | No offer, and withdraw a visible one — a draft edit into a composer the user cannot send from is a dead end |
| Runtime id no longer live | `markRuntimeGone` (`runtime-gone.ts:108`) | Drop, and tear down that id's bus state |
| Transcript evicted | `releaseSessionTranscript` empties `state.messages` (`session-states.ts:507`) | Backend generation is immune; any renderer-side rule must treat empty-after-a-turn as **unknown**, not as "never happened" |
| Adopted / spectated turn | `adoptedRunningTurn` (`use-message-stream/index.ts:744`); watch windows resume without an agent (`store/windows.ts:61`) | Render what the backend published; never generate locally, never invoke on a session this window only spectates |

### Withdrawal points

An offer must be withdrawn — not merely not-renewed — on each of:

| Trigger | Anchor |
|---|---|
| `message.start` (next turn begins) | `gateway-event/message-stream.ts:83` |
| The `error` event path, which never emits `message.complete` | `gateway-event/status.ts:169` |
| Stop / interrupt, beside the other per-session teardowns | `session-tile-actions.ts:348` |
| Rewind, edit, regenerate — before the truncation lands | `use-prompt-actions/rewind.ts:646` |
| A `compacted` edge on an idle session (manual `/compress` rewrites the transcript the label quotes) | `gateway-event/status.ts:50` |
| Session delete (and *not* on a delete RPC that rolls back) | `use-session-actions/index.ts:2450` |
| Reclaim | `gateway-event/lifecycle.ts:94` |
| Wall-clock age | none exists — see below |

Two of those rows have no gateway event behind them: Stop
(`session-tile-actions.ts:348`) and rewind/edit/regenerate
(`use-prompt-actions/rewind.ts:646`) are renderer call sites. They must import
and call the provider's `withdrawNextMoves(sessionId)` directly, which means the
provider is fed from three places, not one — its handler, those two sites, and
the age timer. Name that in the provider's docstring; a comment claiming the
handler is the sole entry point would be the same false-chokepoint mistake this
codebase has already paid for once.

**Age is not optional.** `clearDraftSuggestions` spares event offerings by
design (`composer-suggestions.ts:297`), so a conversation the user leaves keeps
its standing offer in the store indefinitely and repaints it on reopen, hours
later, describing a turn they have forgotten. Expire on age (10 minutes) in the
provider; the bus contract forbids doing it for you.

**Never trigger on the store's busy→idle edge** (`session-states.ts:408`).
`reconcileBusyStatesOnReconnect` (`:604`) force-publishes `busy:false` for every
previously-busy session on reconnect, manufacturing that edge across every
conversation at once — a suggestion burst across unrelated chats, which is
precisely the forbidden bleed. Turn end comes from the gateway event layer only.

**Never gate on `isActiveEvent`** (`gateway-event/index.ts:197`): it compares
against the primary column, so a turn finishing in the tile the user is watching
reads as inactive. Where focus matters, use `$focusedRuntimeId`
(`session-states.ts:1932`).

## One click

Every `invoke` on this provider is a **draft edit and nothing else**. No submit,
no `delegate_task` spawn, no gateway call.

The bus's own contract cannot enforce this — `invoke` is arbitrary async work
(`composer-suggestions.ts:46`) and `requestComposerSubmit` is importable by any
provider — so the provider enforces it and a test asserts it.

The reason is the escape hatch. The strip has no dismiss affordance, on purpose
(`suggestion-pills.tsx:24`): the only way to decline is not to click. That is
safe for a reversible draft edit and unsafe for anything that spends money or
starts a process. A `delegate` move therefore fills the composer with the
delegation prompt and stops; the user presses Enter.

Related: `_get_max_concurrent_children` defaults to 10
(`tools/delegate_tool.py:903`) while the tool schema's own comment says 3
(`:5269`). Anyone budgeting a delegate-shaped suggestion from the schema is
reading the wrong number. Worth fixing separately.

## Isolation

**Conversation.** The generator runs on the agent object that just finished the
turn, over that agent's own snapshot — the ownership `_spawn_background_review`
already has (`turn_finalizer.py:824`). The emit closes over the turn's `sid`,
matching the title callback (`tui_gateway/server.py:13482`). There is no
`$activeSessionId`, no `$currentCwd`, no module-global cache anywhere on the
backend path. The renderer writes through `offerSuggestions(sessionId, …)`
using the event's routed id — never the active one — and hard-returns on falsy.

It does **not** copy the `session.title` handler shape
(`gateway-event/session-info.ts:452`), which patches the global sessions store
with no `isActiveEvent` gate: correct for an idempotent scalar on a known row,
wrong for a per-conversation payload.

**Project.** This is where the backend is structurally better, because the
renderer cannot ask the right question:

- `getSkills()` sends only `{connectionId, profile}` (`apps/desktop/src/api/skills.ts:14`)
  — no cwd, no session, no project.
- `_profile_scope` (`hermes_cli/web_server.py:15307`) retargets `HERMES_HOME`
  and the `SKILLS_DIR` module globals and nothing else, so project-local skills
  in that list reflect the web-server process's cwd, identically for every chat.
- The existing skill provider caches in a module global keyed by nothing with a
  5-minute TTL (`suggestion-providers/skill.ts:22`, `:30`), invalidated from
  exactly one place (`gateway-event/tools.ts:102`).
- Its only cwd guard reads `$currentCwd` raw (`skill.ts:223`, applied `:225`) —
  the atom the codebase itself documents as holding the *previous*
  conversation's folder through a switch (`store/session.ts:1093`, #71254) —
  without calling `workspaceCwdBelongsToSelectedSession()` (`:1419`), which
  exists for exactly that window.

Next Moves touches none of it. Its skill universe is the `<available_skills>`
block from the agent's own prompt, built with a `skills_dir_override` derived
from the agent's session_db path precisely so a build thread cannot leak one
profile's skills into another's (`agent/prompt_builder.py:1886`, rendered
`:2237`). Project scope is inherited from the prompt the model was actually
given for this session.

There is no project field on the wire — `_event_frame` carries exactly
`{type, session_id, payload}` (`tui_gateway/server.py:2609`) — so project
isolation must be enforced when *building* the suggestion. Nothing downstream
will do it.

**Agents.** There is no agent catalog to isolate. `DELEGATE_TASK_SCHEMA` carries
`goal`/`context`/`output_schema` only; the per-task `role` is legacy and
explicitly ignored (`tools/delegate_tool.py:5271`). `agents.list` lists terminal
process-registry sessions, not agents (`tui_gateway/methods_tools.py:1728`).
"The agents the user has" therefore means "does this session hold the delegation
capability" — `"delegate_task" in agent.valid_tool_names`. A `delegate` move is
offered only when it does.

## The declined ledger

The ledger keys on `${provider}:${id}` (`composer-suggestions.ts:60`, `:185`),
and neither obvious id scheme works:

- A single stable id (`'followup'`) accrues one strike per turn the user simply
  typed instead of clicking. Three turns and the feature is silent for the rest
  of the session, with no way back.
- A per-turn id makes `quieted` structurally unreachable — it nags forever — and
  writes one dead `ignoredCounts` entry per slot per turn, which nothing prunes
  (`markSuggestionInvoked` at `:190` is the only deletion path).

**Decision: per-target ids.** `skill:<command>`, `delegate:<slug(goal)>`,
`action:<slug(payload)>`, `followup:<sha1(prompt)[:8]>`. Offering the same skill
three turns running and being ignored quiets *that skill* for the session — a
real decline with a real meaning — while a different move next turn is a
different key and is still offered. Per-target ids also change whenever the
action changes, which sidesteps blocker #2 for free.

Bounded by blocker #3's per-session eviction, so the maps cannot grow across a
long-lived process.

## Ranking

Event offerings are flattened in **Map insertion order**
(`composer-suggestions.ts:222`, `:227`), and withdrawing deletes the provider
key (`:162`) so re-offering re-inserts it last. `repair` holds its offer until a
success withdraws it (`repair.ts:88`). Two stranded MCP servers therefore occupy
both slots forever and a per-turn `nextmove` loses the race every single turn.

`ComposerSuggestion` has no weight field. Add one, or give `nextmove` a reserved
slot. Leaving this to Map insertion order is not a decision, it is a coin flip.

At `MAX_SUGGESTIONS = 2` the practical answer is one reserved slot each: repair
keeps priority (it reports a broken thing), `nextmove` takes the second.
Raising the cap is a separate question — pills are `shrink-0 max-w-56` in a
`flex-wrap` lane with no `overflow-x` (`components/chat/composer-dock.ts:70`),
inside an `overflow-hidden` chat surface (`app/chat/index.tsx:655`), and panes
floor at `MIN_PANE_PX = 80`. Below roughly 224px of pane the strip clips on both
sides with no scroll affordance. Cap the label at 48 chars at the producer and
define the narrow-pane behaviour (drop to one pill) rather than letting it clip.

## i18n

Chrome strings — `workingLabel`, `workingTip`, `doneLabel`, `doneTip` — go
through `translateNow('composer.nextMoveSuggestions.…')` like every other
provider, needing a `nextMoveSuggestions` block on `Translations`
(`apps/desktop/src/i18n/types.ts:2225`) and `en.ts`.

`label` and `tip` are model-authored and cannot be translated. The repo's
existing answer is the per-task `language` knob (`title_generation.language`,
`hermes_cli/config_defaults.py:1270`); `auxiliary.next_moves.language` follows
it, defaulting to the conversation's language. Combined with blocker #4's
`dir="auto"`, an Arabic conversation gets Arabic pills that render correctly.

Note the existing `*Suggestions` i18n blocks are present in `en`/`ru`/`zh` and
**absent** from `ar`/`ja`/`zh-hant`. Adding a sixth block without filling `ar`
leaves an Arabic user with English chrome around Arabic labels.

## Config and cost

```yaml
auxiliary:
  next_moves:
    enabled: true
    provider: auto
    model: ""
    prefer_fast_model: true
    timeout: 20
    language: ""
    min_turn_tool_calls: 1
    skip_managed_local: true
    max_concurrency: 1
```

Added to `DEFAULT_CONFIG["auxiliary"]` at `hermes_cli/config_defaults.py:1160`,
mirroring the `title_generation` block at `:1262`. No `_config_version` bump —
defaults deep-merge at read time (`hermes_cli/config.py:2937`) and sub-keys
under `auxiliary` are never validated (only root keys, `_KNOWN_ROOT_KEYS`
`:2346`). `get_missing_config_fields()` (`hermes_cli/config.py:1488`) announces
the new keys to the user, which is the wanted discoverability.

**Three more registrations, or the task is invisible and mis-routed:**

1. `hermes_cli/main.py:4345` `_AUX_TASKS` — drives `hermes model → Configure auxiliary models`.
2. `hermes_cli/web_server.py:7475` `_AUX_TASK_SLOTS` — drives the dashboard Models page.
   Its own comment says "keep in sync with `DEFAULT_CONFIG["auxiliary"]`" and points at
   `config.py`; the dict actually lives in `config_defaults.py`. Repo drift — fix the comment.
3. `agent/auxiliary_client.py:1247` `_FAST_MODEL_TASKS` — currently
   `frozenset({"title_generation"})`. **Without adding `next_moves` here,
   `provider: auto` resolves to the user's main model — one Opus call per turn.**
   Shipping enabled-by-default without this edit is the single most expensive
   mistake available in this design.

**Per turn when it fires:** one auxiliary call. Input is a bounded digest — a
few thousand tokens; output ~200 against a strict schema. Not a fork: the
background review's fork is an order of magnitude more.

**Critical path:** zero. Staging is a list copy; dispatch is a daemon thread
start. The foreground never waits.

**Latency to pills:** one fast-tier round trip, ~1–3s after the bubble settles,
bounded by `timeout: 20`. The pop-in is the design's main perceptual cost.

**Spend visibility:** the worker calls `set_conversation_context` and
`set_accounting_context` before the call, exactly as the background titler does
(`agent/title_generator.py:622`, `:625`), so `session_model_usage` records
`task='next_moves'` and the cost appears on every billing surface. Skipping this
is what would make a recurring per-turn cost invisible.

**Default is on, focused and unfocused alike.** Background turns emit into their
own session's bucket and paint when that chat is opened — no focus gate is
wanted, because `isActiveEvent` is the wrong test anyway. The cost consequence is
real: an unfocused background turn still pays a call. The alternative —
suppressing unfocused sessions — halves typical spend and costs the feature its
best moment, opening a chat that finished while you were away. Revisit with
`session_model_usage` numbers rather than by guessing; the knob to flip is a
`$focusedRuntimeId` check in the dispatch gate.

## Multi-window

Backend generation fires once per turn regardless of how many windows are open —
this is a further reason not to generate in the renderer, where the HUD and every
peer window would each build a pack and each call `getSkills()`.

What still diverges is per-process state: `PillPhase` is component-local
(`suggestion-pills.tsx:33`) and `ignoredCounts` is a module map, so clicking in
one window leaves another showing an idle pill and doubles the strike rate.
Accepted and documented. If it becomes a real complaint, the primitive already
exists: `ownsAmbientCue` (`store/ambient.ts:6`), the single-claim bridge
`playCompletionSound` uses so only one window beeps
(`gateway-event/message-stream.ts:334`).

## Test surface

Renderer, all deterministic, no fixture model:

- Handler drops: empty sid, stale `turn_id`, busy session, replayed frame,
  unparked non-empty queue, exhausted queue (must **not** drop), open blocking
  prompt, dead runtime id.
- Withdrawal: each of the eight rows in the withdrawal table.
- Isolation: an offer for session B never appears in session A's strip; the
  `''` bucket is never written; a pill clicked in an unfocused tile inserts into
  **its own** composer (blocker #5).
- Ledger: cap eviction earns no strike (blocker #1); a per-target id quiets that
  target only; per-session eviction empties all six maps (blocker #3).
- Contract: `invoke` edits the draft and nothing else — asserted by spying on
  `requestComposerSubmit` and the gateway `request` in a test that runs every
  move kind, plus an eslint `no-restricted-imports` rule on the provider file so
  a later edit cannot quietly import a submit path.
- Arity/shape: 0, 1, 3 and 20 moves; unknown `kind`; empty label; a `skill`
  naming a skill that is not installed.

Backend (run with `venv/bin/python -m pytest` — the system interpreter is
missing this project's dependencies):

- Stage gates: no final response, interrupted, cron/subagent platform, a
  surface that cannot dispatch, trivial turn.
- The skill index is not read for a turn the triviality gate discards.
- Dispatch gates: error status, billing, partial failure → heuristic only,
  agent-continued turn.
- `call_llm` raising → heuristic; heuristic empty → no emit at all.
- Cancellation: a new live turn before the call returns emits nothing.
- Emit refuses a falsy sid.

The capability guard test (`tests/agent/test_desktop_capabilities_are_advertised.py`)
does **not** need a new entry: it reads `registry.tsx`, `artifact-detect.ts` and
`transcript-directives.ts` only, and its directive check is a single hard-coded
literal at `:204`. A gateway event with a renderer handler is outside its scope.
Worth noting separately that this means any *directive*-based feature would ship
unadvertised with the suite green.

## Not solved

- `find_project_root()` reads `TERMINAL_CWD` / `Path.cwd()`
  (`agent/skill_utils.py:758`), not the `_SESSION_CWD` contextvar
  (`agent/runtime_cwd.py:44`). On a gateway serving two workspaces, the
  project-local half of the skill index was already resolved against the process
  cwd at prompt-build time. Reading the built block is strictly better than
  re-scanning — it is at least the universe the model reasoned from — but it is
  not a true per-session project scope, and this design does not claim one.
- Per-window ledger divergence, above.
- Suggestion quality is only measurable with an eval battery, not a unit test.
- **Ranking.** `nextmove` still has no reserved slot. Two stranded MCP servers
  hold both pills and this provider loses every turn. The cap-eviction fix
  (`14bd215ad`) means losing that race no longer *silences* it, which was the
  urgent half; giving it a slot needs a weight field on `ComposerSuggestion`.

## Build order — all landed

1. ~~Blockers 1–5, each its own commit with its own test.~~ **Done.**
2. Backend: `agent/next_moves.py` with the **heuristic only**, staged and
   dispatched, behind `enabled: false`. Full gate matrix, no LLM.
3. Renderer: event, handler, provider, i18n, drops and withdrawals. Feature is
   now end-to-end and deterministic.
4. Add the `call_llm` path and the three registrations. Flip both switches on.

## What shipped differently from this plan

- **Two switches, not one.** `auxiliary.next_moves.enabled` is the feature;
  `use_model` is whether a turn spends an auxiliary call. With `use_model`
  false the rule table is the whole feature — the plan described that as a
  fallback, and it is cleaner as a mode.
- **Staleness is counted, not timed.** The plan offered "turn identity and/or
  emission timestamp". The renderer counts turn starts and completions per
  session instead: a clock comparison would have drifted against a remote
  gateway, where the two ends are not the same clock.
- **The agent-continued gate needed a new field**, as flagged. `initiator` on
  `_run_prompt_submit`, defaulting to `"user"`, passed as `"agent"` by all ten
  synthesized callers. The queued-prompt drain keeps the default.
- **The heuristic emits at most one move**, not up to three. A rule cannot tell
  which of its own outputs is the interesting one.
- **`ComposerSuggestion` gained no weight field.** The ranking problem is real
  and unfixed: `repair` holds standing offers and wins on Map insertion order.
  Deferred rather than solved — see *Not solved*.
- **Partial failures are folded into errors**, because the flag the plan
  assumed is not on the wire at the dispatch seam. See the table above.
- **`prefer_fast_model` ships ON**, unlike `title_generation`, which ships it
  off. Titling is once per session; this is once per turn, and that is the cost
  profile that justifies overriding the documented "auto = the main model"
  contract. Users whose main model is already a cheap tier should set it false
  — otherwise the fast tier can mean a different vendor for no saving.
