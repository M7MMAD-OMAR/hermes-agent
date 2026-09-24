# Threads, Artifacts and Routines: feasibility and implementation plan

Source: a 58 second screen recording of Claude desktop (Riley Brown, 19 Sep
2026, 2:58 PM to 3:05 PM), analysed frame by frame. This document maps every
mechanic in that recording onto a Hermes primitive, states what is missing,
and gives a phased plan with tests.

The short verdict: the hard part is already built, and more of it than
expected. Hermes has durable background delegation with a restart safe
delivery outbox, a live subagent RPC and event surface, a subagent tree panel
with steering, a full project system, a full scheduler, and (verified against
the live `state.db`) 297 delegated child sessions already carrying full
transcripts. What is missing is a thin product layer (a title, an inbox
state, a read path that reveals rows the sidebar deliberately hides) and one
genuinely new mechanism (a child that can ask the user a question).

The three tab dock the video shows lands across the plan: the Threads tab in
phase 1, its inbox in phase 2, the Artifacts and Routines tabs in phase 6.

## Status

Updated 20 Sep 2026.

| Phase | State | Note |
|---|---|---|
| 0, verify the engine | done | 35 tests, including a real process-restart run |
| 1, reveal the thread | done | dock, detail view, steer composer, all reachable |
| 2, the per thread plan | done, differently | the `n/m` ring is not buildable; see below |
| 3, coordinator routing | done | inline chips, and a router that refuses to guess |
| 4, sibling and project context | done | bounded by tokens, not characters |
| 5, Waiting on you | done, OFF by default | enabling it is the operator's call |
| 6a, durable artifacts | done | the store existed and was dead; one guard revived it |
| 6b, the deck editor | not started | deliberately, see below |

225 new tests, all passing, plus the suites they sit in.

### What each phase actually turned out to be

Three phases were not what the plan assumed, and the measurements are the
reason the work is smaller and the claims narrower.

**Phase 2: there is no plan to render.** The `n/m` ring in the recording is fed
by a todo list. Across 299 delegated threads and roughly 15,000 tool calls on
this machine, the `todo_list` tool has been called **zero times**, by threads
and by ordinary sessions alike: a child gets one focused goal and does it. A
ring fed by `TodoState` would render a permanent `0/0`. The row shows what a
thread honestly did instead, its tool calls and its runtime, both already
durable on its session row.

**Phase 5: the mechanism exists, the decision is not ours.** A delegated child
installs a non-interactive approval callback on purpose. Routing that to a
human converts a bounded automatic refusal into a blocking request, so it ships
behind `delegation.subagent_ask_user`, **default off**. With the flag off the
callback is the same object as before, asserted by identity rather than by
behaviour. Turning it on is the operator's decision.

**Phase 6a: the store was already built, and dead.** `project_results` in
`projects.db` is a durable, project-scoped artifact store with versions,
snapshots and review state, and its indexer already covers thread sessions. It
held **zero rows**, because `hermes_cli/project_results.py::_artifact` called
`urlparse` unguarded: any `scheme://[` that does not close into a valid IPv6
host raises `ValueError("Invalid IPv6 URL")`, and one such string anywhere in
history aborted the entire scan. Transcripts are full of them.

### Four bugs found and fixed

**The artifact index was dead on real data.** Measured on a copy of the live
945 MB `state.db`: before the guard the indexer crashed and indexed nothing;
after it, 128,000 messages scanned, **9,537 artifacts indexed, 533 of them
produced by delegated threads**. Pinned by
`test_a_malformed_url_in_a_transcript_does_not_abort_the_whole_index`, verified
to fail with the fix stashed.

**The dock queried the wrong session identity.** `$activeSessionId` holds a
RUNTIME id; a thread is stamped with its parent's DURABLE id
(`model_config.$._delegate_from` = `parent_agent.session_id`). Handing the
runtime id to `thread.list` queries a key the backend never writes, so every
conversation would have looked thread-less and the router would never have
fired, silently. `apps/desktop/src/store/thread-identity.test.ts` pins the
contract; the repo already carried this exact scar in
`docs/plans/browser-session-isolation.md`.

**The router could steer another conversation's worker.** `tryRouteToThread`
scoped its durable rows to the coordinator but took the live roster flattened
across every session, and `mergeThreadRows` promotes an unmatched live child
into a row stamped with whatever coordinator it was handed. One thread running
in conversation A, a `@thread` typed in conversation B, and B's words went to
A's worker: precisely the harm the module exists to prevent. Live rows are now
taken for the owning conversation only, pinned by two tests in
`thread-route-entry.test.ts` that fail against the flattened version.

**`thread.list` read the wrong profile's database.** The first cut went through
`server._get_db()`, which is pinned to the import-time LAUNCH home process wide
and on purpose (#102526). `@profile_scoped` binds HERMES_HOME for config and
secrets but does not redirect the session store, so every profile's thread list
was answered from the launch profile's database. `TestProfileScope` pins it:
four of its tests fail against the old implementation, verified by reverting
`_thread_db` and re-running.

### What is deliberately not built

- **`Waiting on you` as a dock section.** The asking mechanism is built and
  tested, but a thread's question surfaces in the existing approval UI, where
  approvals already live, and it is off by default. A dock section that can
  never fill while the flag is off would promise a channel that is not open.
- **6b, the editable deck.** It is the largest single piece of net new UI in
  the recording and a product of its own. The plan gated it on 1 through 5, and
  a request to build everything does not un-gate it: shipping a half-built
  editor would be worse than shipping none.

### Safety of the routing change

`tryRouteToThread` sits in the composer's user-typed submit path. It returns
false for anything not carrying an explicit thread address (`@thread`, "tell
the X thread", "thread:"), so an ordinary message never takes that branch. Two
matching threads resolve to inline, a finished thread resolves to inline, and
attachments never route. The receipt is shown before the steer resolves and
carries an undo; a steer that fails hands the words back to the composer.
27 routing tests, 24 of which assert that a message stays where it was typed.

### Files

| Phase | Files |
|---|---|
| 1 | `hermes_state_threads.py`, `tui_gateway/methods_threads.py`, `tui_gateway/contracts/threads.py`, `apps/desktop/src/store/threads.ts`, `apps/desktop/src/app/threads/` |
| 1 | titles: `tools/delegate_tool.py:281`, `run_agent.py::_title_delegated_thread`, `agent/title_generator.py` |
| 3 | `apps/desktop/src/store/thread-routing.ts`, `app/threads/thread-ref-link.tsx`, `app/threads/route-receipt.tsx`, `components/assistant-ui/session-or-thread-ref.tsx`, `app/chat/composer/hooks/use-composer-submit.ts` |
| 4 | `tools/delegation_sibling_context.py` |
| 5 | `tools/delegation_ask_user.py`, `tools/delegate_tool_config.py` |
| 6a | `hermes_cli/project_results.py` |

### Test counts

| Suite | Tests |
|---|---|
| `tests/hermes_state/test_threads.py` | 24 |
| `tests/hermes_state/test_thread_titles.py` | 13 |
| `tests/gateway/test_threads_rpc.py` | 24 |
| `tests/tools/test_delegation_sibling_context.py` | 21 |
| `tests/tools/test_delegation_ask_user.py` | 21 |
| `tests/tui_gateway/test_project_results.py` | 2 new |
| `apps/desktop/src/store/threads.test.ts` | 32 |
| `apps/desktop/src/store/thread-routing.test.ts` | 27 |
| `apps/desktop/src/store/thread-route-entry.test.ts` | 14 |
| `apps/desktop/src/store/thread-identity.test.ts` | 4 |
| `apps/desktop/src/app/threads/index.test.tsx` | 14 |
| `apps/desktop/src/app/threads/thread-detail.test.tsx` | 25 |

One pre-existing failure was confirmed in `tests/hermes_state/`, not caused by
this work: `test_search_projection_skips_context_enrichment_queries` fails
identically with the `hermes_state.py` change stashed.

The running desktop app was never restarted or rebuilt, and no live database
was written: the artifact index was measured on temporary copies.

One thing to expect after the next restart: the live `projects.db` still holds
zero results, so the first `projects.results.refresh` run will scan roughly
128,000 messages and write about 9,500 rows. It is batched and self-paces, but
the first pass is not instant.

## 1. What the recording actually shows

### 1.1 Sidebar

`New`, `Projects (Beta)`, `Artifacts`, `Routines`, `Customize`, `More`, then
`Pinned`, then project folders, each with its own new chat, search and filter
affordances, then loose chats under `No folder`.

### 1.2 The Threads dock (right side)

A dock with three tabs: threads, artifacts, a clock (history or routines).
The threads tab is an inbox:

| Section | Copy in the recording | Meaning |
|---|---|---|
| `Waiting on you` | "Decisions, reviews, and permissions only you can give." | the thread is blocked on a human |
| `Working` | count, e.g. 4 | running |
| `Resolved` | "Completed threads file here." | finished and archived |

Each row carries: title, a live one line status ("Reading the reference
plate's conventions", "Tracing three lineages in parallel"), a progress ring
with `n/m` steps, a sub-agent count badge, and a relative age (`now`, `1m`,
`7m`).

### 1.3 The coordinator model

The main conversation is the project chat. Work fans out:

1. User: "I want you to also make a new thread that tries to recreate these
   types of charts".
2. Assistant: "Yes, starting a thread for that now." followed by an inline
   thread chip that shows live status.
3. Assistant prose then references the thread as a first class link:
   "Noted in `Field-diagram charts for agent products`, it will leave the
   conventions behind as a reusable style guide, not just the figures."

The main chat stays fully interactive while four threads run. The user asks
"what is the style called?" and gets an immediate answer.

### 1.4 Message routing

A user message in the project chat can be answered inline, or routed into a
running thread. The recording shows the receipt `Sent to one thread` under
two separate user messages. This is the subtlest mechanic in the video.

### 1.5 Inline thread chips

`● History of the style` appears inside assistant prose. Hovering shows a
card with status, progress, reply count, age and the current step. Clicking
opens the thread in the dock.

### 1.6 Thread detail

Breadcrumb `Threads > Claude Projects presentation` with a sub-agent badge.
Body contains:

- a plan checklist with per step state: done, waiting on you, pending
  ("Built a second sample in the archival/technical look" done, "Waiting on
  which direction to use" blocked, "Build the remaining slides" pending,
  "Export the full deck to PDF", "Publish it on the site as a resource")
- the thread's own transcript, including inline artifact cards
- a collapsible `Message received from coordinator >` entry
- its own composer, `Steer this thread...`, with its own model and effort
- a resolve control in the titlebar

### 1.7 Shared project context

A thread's status line reads "Read the sibling threads and project context".
Threads are not isolated workers; they read each other and the project.

### 1.8 Artifacts

Frame 28 shows a real editable slide deck: text, image, table and shape
tools, download, present, split view, zoom, a slide thumbnail strip with add
slide, pin, comment and share. The deck is referenced from a thread as a chip
(`the deck`). This is an authoring surface, not a viewer.

### 1.9 Routines

The deck in frame 28 describes the model in its own words:
"PROJECT CHAT: everyone posts here. Nothing is lost, nothing waits for a
meeting." fanning out to "Thread, fix the checkout bug", "Thread, the launch
deck", "Thread, Monday numbers: runs itself every week and posts the result".
That last one is a routine, a thread on a schedule.

## 2. What Hermes already has

Evidence, not inference. Everything below was read in this checkout, and the
three load bearing facts were verified against the live `state.db`.

### 2.1 Durable background delegation (the thread engine)

`delegate_task` (`tools/delegate_tool.py:417`) takes `goal`, `tasks[]`,
`background`, `output_schema`, `images`, and control actions
`list | steer | stop`.

`_dispatch_background` (`tools/delegate_tool_dispatch.py:389`) detaches every
child from the parent, hands units to the async registry, and returns a
dispatch handle. The parent turn ends. The result re enters the conversation
later as a new message.

That path is durable, which is the fact everything else rests on:

| Concern | Implementation |
|---|---|
| dispatch persisted | `tools/async_delegation.py:135` `_persist_dispatch` |
| completion persisted | `tools/async_delegation.py:184` `_persist_completion` |
| survives a backend crash | `tools/async_delegation.py:224` `recover_abandoned_delegations` |
| undelivered results replayed | `tools/async_delegation.py:267` `restore_undelivered_completions` |
| delivery outbox with claims | `claim`/`defer`/`drop`/`complete` at `:321` to `:406` |
| routing origin kept | `_capture_routing_origin` at `:124` |
| table | `async_delegations`, `hermes_state_common.py:576` |

Verified empirically against `~/.hermes/state.db` on 20 Sep 2026: 51 rows,
44 `completed`/`delivered`, 1 `completed`/`pending`, plus error and dropped
rows. This is in production use on this machine, not dormant code.

### 2.2 Live control surface

RPC (`apps/shared/src/gateway-contract.generated.ts:4895` to `:4901`):
`subagent.list`, `subagent.steer`, `subagent.interrupt`, `subagent.tail`.
Backed by `tools/delegate_tool_registry.py:124` `steer_subagent`, `:92`
`interrupt_subagent`, `:173` `list_active_subagents`, registered in
`tui_gateway/methods_subagents.py:92`.

Events (`gateway-contract.generated.ts:5357` to `:5367`):
`subagent.spawn_requested`, `subagent.start`, `subagent.progress`,
`subagent.thinking`, `subagent.tool`, `subagent.complete`.

A formal lifecycle object already exists with a public contract version,
capability tokens and `reconnect()`: `agent/subagent_lifecycle.py`
(`SubagentHandle` at `:64`, `reconnect` at `:328`).

### 2.3 A subagent panel that is most of the Threads dock

`apps/desktop/src/app/agents/index.tsx` (439 lines) renders a live subagent
tree with status glyphs, activity timers and steer entries. Its store,
`apps/desktop/src/store/subagents.ts`, already has `upsertSubagent` (`:404`),
`buildSubagentTree` (`:436`), `reconcileSubagentSnapshot` (`:238`),
`recordSubagentSteer` (`:300`), `activeSubagentCount` (`:464`) and
`failedSubagentCount` (`:467`).

It is live only, keyed by session, presented as an overlay panel. It has no
durable history, no inbox grouping and no thread naming.

### 2.4 Plans

`TodoState` and `TodoUpdatedPayload`
(`gateway-contract.generated.ts:2823`, `:4237`) carry an authoritative todo
snapshot with a revision. This is the `n/m` checklist substrate.

### 2.5 Projects

Stronger than what the recording shows. `ProjectInfo`
(`apps/desktop/src/types/hermes.ts:1082`) with slug, icon, colour, board
slug, primary path, folders. `apps/desktop/src/store/projects.ts` has
`enterProject`, project trees, cross profile reads, `moveSessionToProject`,
repo discovery scanning, and project brief and idea generation
(`app/artifacts/project-brief-dialog.tsx`).

### 2.6 Artifacts, partially

Two unrelated systems share the name:

- `apps/desktop/src/store/artifacts.ts`: detection from assistant output,
  a version list (`ArtifactVersion` at `:24`), `upsertArtifact` (`:115`),
  `openArtifact` (`:190`). In memory, session scoped, lost on restart.
- `apps/desktop/src/app/artifacts/`: a page that scavenges images, files and
  links out of session messages (`artifact-utils.ts`), with a result version
  dialog and a project filter.

Rendering exists for html, svg and code in
`app/chat/right-rail/preview-artifact.tsx`. Nothing is editable, nothing is
durably project scoped, and there is no deck or document type.

### 2.7 Routines

A complete scheduler already lives in `cron/`: `scheduler.py`, `jobs.py`,
`occurrences.py`, `executions.py`, `delivery_queue.py`, `incidents.py`,
`blueprint_catalog.py`, `suggestions.py`, plus the `cron.manage` RPC
(`gateway-contract.generated.ts:4549`) and a desktop surface at
`apps/desktop/src/app/cron/`.

## 3. The three gaps, stated precisely

### Gap A: a thread has no title, no inbox status and no link to its session

This gap is much smaller than it first looks, and the first reading of the
data was wrong. Correcting it here because it drives the whole plan.

Delegated children **already get a full `sessions` row with a full
transcript.** Verified against `~/.hermes/state.db` on 20 Sep 2026:

| Query | Result |
|---|---|
| sessions with a `parent_session_id` | 298 |
| of those, carrying the `$._delegate_from` marker | 297 |
| one sample child (`20260920_151610_9dd6d4`) | 86 messages: 1 user goal, 27 assistant, 58 tool |
| delegate children carrying a title | 8 of 297 |

The marker is written at `tools/delegate_tool.py:276`
(`child._session_init_model_config["_delegate_from"] = parent_sid`), and the
comment there states the intent plainly: "Sidebar marker: subagent sessions
stay out of session pickers even when a parent delete orphans them".

Every consumer is already guarded, so there is no blast radius to audit:

| Consumer | Guard |
|---|---|
| session listing | `hermes_state_sessions.py:103`, `:1040` exclude `_delegate_from` rows |
| cascade delete | `hermes_state_sessions.py:131` walks delegate children recursively |
| compression child lookup | `hermes_state_compression.py:33` excludes `_delegate_from` |
| session reset children | `hermes_state_sessions.py:469` excludes `_delegate_from` and `source='tool'` |
| parent routing inheritance | `_INHERIT_PARENT_ROUTING_SQL` is gated on `p.end_reason = 'compression'`, so it cannot fire for a thread |
| parent metadata inheritance | `_INHERIT_PARENT_META_SQL` applies cwd, repo root, branch and profile to any child, which is what a thread wants |

So durability, transcript, search, cascade delete and parent linkage are all
already correct. What is genuinely missing is small:

1. a **title**: only 8 of 297 children have one, and `display_name` is null
2. a **thread state** for the inbox (working, resolved, failed, waiting)
3. a **link** from `async_delegations` to the child `session_id`
4. a **read path** that deliberately lifts the `_delegate_from IS NULL`
   filter, so the same rows the sidebar hides become the Threads dock

The seven day live log (`tools/delegation_live_log.py`,
`LIVE_RETENTION_DAYS = 7`) is a tailing convenience, not the record of
truth. The record of truth is `messages`, and it does not expire.

### Gap B: a child cannot ask the user anything

`tools/delegate_tool_child_run.py:727` is explicit: the worker "installs a
non-interactive approval callback (deny/approve per
`delegation.subagent_auto_approve`)". A child auto approves or auto denies.

The mechanism to fix this already exists and even anticipates the case.
`tools/approval_gateway_wait.py` blocks a thread on its own
`threading.Event` while the gateway notifies the user, and its module
docstring says: "Multiple threads (parallel subagents, execute_code RPC
handlers) can block concurrently". Children already carry an
`owner_transport` and an `owner_session_id` for steering
(`tools/delegate_tool_child_run.py:330` to `:335`).

So `Waiting on you` is a re-route of an existing blocking primitive onto an
authority the child already holds. It is real work with real safety
implications, and it does not belong in phase 1.

### Gap C: artifacts are read only and not durable

Covered in 2.6. The slide editor in frame 28 is the largest single piece of
net new UI in the whole video, and it must not be allowed to set phase 1
scope.

## 4. Feasibility verdict

| Feature from the video | Hermes primitive | New work | Verdict |
|---|---|---|---|
| Background thread that outlives the turn | `_dispatch_background` + `async_delegations` | none | already works |
| Thread survives a backend restart | `recover_abandoned_delegations`, `restore_undelivered_completions` | none | already works |
| Result posts back into the chat later | delivery outbox + wake routing | none | already works |
| Live status, progress, tool line | `subagent.*` events, `store/subagents.ts` | re-present | small |
| Steer a running thread | `subagent.steer` RPC | a composer | small |
| Stop / interrupt a thread | `subagent.interrupt` | a button | trivial |
| Sub-threads with a count badge | `buildSubagentTree`, depth limits | a badge | trivial |
| Durable thread transcript | child `sessions` row + `messages`, already written | none | already works |
| Named thread with an inbox state | title plus two `async_delegations` columns | small schema + a read path | small |
| Inbox: Working / Resolved | derived from thread status | a panel | small |
| Inbox: Waiting on you | `approval_gateway_wait` re-route | new channel | medium, do late |
| Inline thread chips in prose | markdown renderer + thread store | a component | small |
| "Sent to one thread" routing | `subagent.steer` + a router step | routing policy | small, high value |
| Plan checklist per thread | `TodoState` / `TodoUpdatedPayload` | per thread scope | small |
| Sibling and project context | `agent/delegation_context.py`, project brief | context assembly | medium |
| Routines (scheduled thread) | `cron.manage` + full scheduler | thread identity | small |
| Artifacts: render html/svg/code | `preview-artifact.tsx` | none | already works |
| Artifacts: versions | `store/artifacts.ts` | none | already works |
| Artifacts: durable, project scoped | nothing | persistence | medium |
| Artifacts: editable deck / document | nothing | a full editor | large, separate track |

Nothing in the recording is blocked by a Hermes architectural limitation.

## 5. The hierarchy

```
Profile
└── Project                          store/projects.ts, ProjectInfo
    ├── Project context              brief, idea, SOUL, primary path
    ├── Conversation (coordinator)   sessions row, source='desktop'
    │   ├── Thread                   sessions row, source='thread',
    │   │   │                        parent_session_id = coordinator
    │   │   ├── Plan                 TodoState scoped to the thread
    │   │   ├── Transcript           messages rows (free once it is a session)
    │   │   ├── Sub-threads          delegate depth, buildSubagentTree
    │   │   ├── Coordinator inbox    subagent.steer
    │   │   └── Artifacts produced   artifact rows keyed by thread
    │   └── Inline thread chips      rendered from the thread store
    ├── Artifacts (project scoped)
    └── Routines                     cron job whose run opens a thread
```

**A thread is already a session.** Delegated children carry a `sessions` row
with `parent_session_id` set to the coordinator and `$._delegate_from` in
`model_config` (see Gap A). The plan does not create this, it reveals it.

Everything expensive is therefore already built and already correct for
these rows:

- transcript storage and paging: `hermes_state_messages.py`
- full text search: `hermes_state_fts.py`
- automatic titling: `hermes_state_titles.py` (present, not yet applied)
- timeline and rewind: `hermes_state_timeline.py`, `hermes_state_rewind.py`
- usage and cost accounting: `hermes_state_usage.py`
- cascade delete with the parent: `hermes_state_sessions.py:131`
- `idx_sessions_parent` (`hermes_state_common.py:608`)

Do not introduce a new `source` value. `_delegate_from` is the existing,
already honoured provenance marker; a new source string would need every
guard in the Gap A table re-audited for no benefit.

The alternative, a bespoke `threads` table, duplicates all of the above and
is the wrong call.

## 6. Phases

Ordered by dependability and output quality first, visual polish last.

### Phase 0: instrument what exists (half a day)

No product change. Prove the engine does what section 2.1 claims.

- a script that dispatches a background delegation, kills the backend,
  restarts it, and asserts the completion is still delivered
- assert `cache/delegation/live/<id>/` is written and tailable
- record baseline timings for dispatch, first progress event, completion

Exit criterion: a restart-survival run that passes twice in a row.

### Phase 1: reveal the thread

The thin vertical slice. Smaller than expected, because Gap A showed the
durable session and transcript already exist. No new `sessions` writes, no
new `source` value, no consumer audit.

1. Backend: title the child session at dispatch. Set `display_name` from the
   goal immediately (so a row is never nameless) and let
   `hermes_state_titles.py` refine it. Today 8 of 297 children have a title.
2. Backend: add `thread_session_id` and `thread_state` columns to
   `async_delegations`. Canonical DDL goes in `hermes_state_common.py` only,
   never a second hand maintained shape (see the drift note at
   `hermes_state_schema.py:1362`).
3. Backend: new RPC `thread.list`, a read that deliberately lifts the
   `_delegate_from IS NULL` filter used at `hermes_state_sessions.py:103`
   and joins `async_delegations` for state. Scoped by coordinator session and
   by project. The sidebar read path is untouched, so threads stay out of the
   session picker exactly as they are today.
4. Backend: new RPC `thread.transcript`, which is `messages` for that session
   id. No new storage.
5. Desktop: a `Threads` tab in the right dock, fed by `thread.list` for
   history and the existing `subagent.*` events for live rows, reusing the
   reconciliation already in `store/subagents.ts:238`.
6. Desktop: a `Steer this thread...` composer wired to the existing
   `subagent.steer` RPC.

Acceptance: name a thread from chat, close the conversation, restart the
backend, reopen it. The thread is listed with its full transcript, still
running or correctly resolved, and can be steered.

### Phase 2: the inbox and the plan

1. Derive `Working` and `Resolved` sections from `thread_state`.
2. Scope `TodoState` per thread and render the `n/m` ring and the checklist.
3. Resolve and archive controls.
4. Relative age and the live status line.

`Waiting on you` renders as an empty section in this phase. Do not fake it.

### Phase 3: coordinator routing

The highest value per line of code in the whole plan.

1. `Sent to one thread`: when a user message in the project chat matches a
   running thread, route it there via `subagent.steer` and render the
   receipt instead of answering inline.
2. Inline thread chips in assistant prose, with a hover card
   (status, progress, replies, current step) and click to open.
3. `Message received from coordinator` as a collapsible transcript entry.

Routing must be explicit and reversible. A misrouted message is worse than
an inline answer, so render the receipt with an undo affordance and never
route silently when confidence is low.

### Phase 4: shared project context

1. Assemble thread context from: project brief, primary path, sibling thread
   titles and their latest summaries.
2. Bound it. Sibling context is a summary list, never full transcripts, or
   the context budget dies at four threads.
3. Extend `agent/delegation_context.py` rather than inventing a parallel
   context path.

### Phase 5: Waiting on you

1. Route a child's approval request through its `owner_transport` instead of
   the non-interactive callback at `tools/delegate_tool_child_run.py:727`.
2. Make it opt in per thread and bounded by a timeout that falls back to the
   current auto policy, so an unattended run can never wedge forever.
3. Surface the pending question as a `Waiting on you` row and as a blocked
   step in the plan.
4. Keep `delegation.subagent_auto_approve` as the default for cron and
   headless contexts. A routine must never block on a human.

This phase changes safety behaviour, so it gets its own review.

### Phase 6: Routines and Artifacts

Routines (small): a cron job whose execution opens a thread in the target
project and posts its result back. `cron.manage` and the scheduler already
do the hard part.

Artifacts, split into two tracks:

- 6a (medium): durable, project scoped artifact persistence. Promote
  `store/artifacts.ts` to a table keyed by project, thread and version.
  Keep the existing detection and the existing html, svg and code renderers.
- 6b (large, separate track): an editable deck or document surface. This is
  a product of its own. It should not be started until 1 through 5 ship.

## 7. Test plan

### 7.1 Commands

Per this checkout's `CLAUDE.md`, never run bare `pytest` over directories and
never run `tests/` unscoped.

```bash
scripts/run_tests.sh tests/tools/ -j 8 -q
```

```bash
scripts/run_tests.sh tests/gateway/ -j 8 -q
```

```bash
cd apps/desktop && npx vitest run
```

Two failures are environmental and must be reproduced on a clean checkout
before being chased:
`test_model_options_preserves_canonical_custom_row_after_agent_init`, and a
post run unhandled error from `katex-memo.ts` via `thread-remount.test.tsx`
(exit code still 0).

### 7.2 Phase 0

| Test | Asserts |
|---|---|
| background dispatch returns a handle | `status='dispatched'`, a `delegation_id` |
| row is persisted at dispatch | `async_delegations` has the row before completion |
| restart survival | kill backend mid flight, restart, completion is delivered exactly once |
| outbox is idempotent | a replayed completion does not double post |
| live log is tailable | `cache/delegation/live/<id>/task-0.log` grows during the run |

### 7.3 Phase 1

Python, `tests/tools/` and `tests/gateway/`:

- a delegated child's session row carries `$._delegate_from` and a non null
  `display_name` at dispatch time, not only after the run ends
- `thread.list` returns finished threads, not only live ones, and survives a
  backend restart
- `thread.list` lifts the `_delegate_from` filter, and the ordinary session
  list still hides the same rows (assert both in one test, because the value
  of the first is exactly that the second does not change)
- `thread_session_id` links the delegation row to the session row, and a
  delegation whose session was cascade deleted returns a tombstone rather
  than throwing
- schema reconciliation is idempotent: run `reconcile_state_schema` twice,
  the shape is identical (this is the exact drift bug of `#94691`)
- a thread row is never treated as a compression rotation: assert
  `find_live_compression_child` ignores it (`hermes_state_compression.py:33`
  already excludes `_delegate_from`, so this is a regression guard on an
  existing guarantee, not new behaviour)
- deleting a coordinator cascades to its threads
  (`hermes_state_sessions.py:131`)

Desktop, vitest:

- the Threads tab merges a durable `thread.list` row with a live
  `subagent.progress` event without duplicating the row
- steering from the thread composer calls `subagent.steer` with the right id
- a thread that completes while the dock is closed shows as resolved when it
  reopens

### 7.4 Phase 2

- `n/m` matches the thread's `TodoState.revision` snapshot, and a stale
  revision never overwrites a newer one
- resolve moves a row from `Working` to `Resolved` and it survives a reload
- a failed thread renders as failed, not as resolved

### 7.5 Phase 3

- a message routed to a thread produces a steer and no assistant turn in the
  coordinator
- a message not matching any thread is answered inline, with no steer
- undo on the receipt re-delivers the message to the coordinator
- an inline chip for a deleted thread degrades to plain text, it does not
  throw

### 7.6 Phase 4

- thread context includes the project brief and sibling titles
- sibling context is truncated at the configured bound, asserted by token
  count, not by string length
- a thread with no project still runs

### 7.7 Phase 5

- an opt in thread's approval request reaches the owner transport
- a cron or headless thread never blocks, it uses the auto policy
- the approval timeout falls back to the auto policy and the thread proceeds
- two threads blocked at once each resolve independently (the concurrency
  the `approval_gateway_wait` docstring already promises)

### 7.8 Cross cutting

- multi profile: per this workstation's memory, session and routing work is
  tested with two profiles, never one
- a thread must not leak across profiles in `thread.list`
- concurrency: dispatch at `delegation.max_concurrent_children` and one over,
  assert the documented inline fallback rather than a silent drop
- performance: the Threads dock with 20 threads must not regress the
  transcript frame budget (use the desktop perf rig)

## 8. Risks

| Risk | Mitigation |
|---|---|
| A thread row treated as a compression rotation | already excluded at `hermes_state_compression.py:33`; regression guard in 7.3 |
| A new `source` value breaking an existing guard | do not add one, use the existing `_delegate_from` marker |
| `async_delegations` schema drift | canonical DDL in `hermes_state_common.py` only, per `#94691` |
| Context budget blows up with several threads | bound sibling context to summaries, assert by token count |
| Silent misrouting in phase 3 | explicit receipt, undo affordance, no routing at low confidence |
| Phase 5 weakens the approval boundary | opt in per thread, timeout falls back to auto, own review |
| The slide editor swallows the roadmap | 6b is a separate track, gated on 1 through 5 shipping |
| Other agents share this checkout | phases land as separate commits touching only their own paths |

## 9. What this plan does not do

It does not port the sidebar layout, the welcome sparkline, or the deck
editor chrome. Those are presentation. The value in the recording is the
coordinator model: work fans out, nothing blocks, nothing is lost, and the
user is asked only for what only they can decide. Hermes can do that now.
