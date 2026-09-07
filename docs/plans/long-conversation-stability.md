# Long conversation stability: two reported symptoms, one confirmed

Reported 2026-09-07 with several long chats open as tabs.

## Symptom 2, confirmed and fixed: the transcript loses every earlier turn after compaction

Evidence (state.db, session `20260906_121936_1e14af`): 2282 rows, 372 active,
1501 compacted. In-place compaction at 12:28:51 PM wrote the summary row
(`_compressed_summary = 1`) and then COPIED the protected tail (230 rows,
ids 286082 to 286311) as a new generation: same role, content and timestamp,
new `messages.id`; the previous copies were retired as `compacted`. The display
projection (`_dedupe_display_generations`) prefers the live copy, so the next
tail page named every recent row by an id the renderer had never seen.

The renderer's tail hydrate (`hydrateFromStoredSession` on the `compacted`
edge and on turn settle) grafts the newest page onto the in-memory transcript
by anchoring the page's first row inside it. The anchor matched by durable row
id or rendered id only. Neither matched after compaction, so the page was taken
as authoritative: the whole transcript was replaced by its newest 120 rows, the
list re-keyed, and the view jumped to the bottom.

Fix: `apps/desktop/src/app/chat/transcript-backfill.ts` matches a row by a
third rung, the same (role, content, timestamp, tool call ids) identity the
backend dedupes on. The graft anchors on a generation copy and keeps the older
prefix; the older-page backfill dedupes generation copies the same way, so a
"Show earlier" page fetched after compaction cannot duplicate rows already on
screen. Tests: `transcript-backfill.test.ts`, the four compaction cases fail on
the previous code.

## Symptom 1, not reproduced: another chat's text sent along with mine

The oracle disagrees with the report. `messages` holds the message in question
(`bmcbrand.zip` attachment plus the Arabic text, row 286508, 12:33:58 PM)
exactly once, in one session (`20260907_033105_2ffd58`). agent.log shows one
`tui prompt accepted` for that window, for that session. No user text appears
in two root sessions today. Same-second pairs in the DB are delegate children
(`_delegate_from` in `model_config`) spawned by an agent, not composer sends.

What was checked and holds: the draft stash is keyed per session and repaints
the editor on every swap (`paintDraft` clears an empty draft); the submit path
resolves its target from the composer's own scope and aborts on drift; the
optimistic bubble is written to the shared view only when the target is the
current view; queue drains carry `storedSessionId`; hydrate calls all pass an
explicit runtime id; no unmarked child session exists that the REST redirect
could have followed. Open tabs are the primary view switching selection (one
`session-tile` pane persisted), not separate composers.

Remaining candidates need a live reproduction: a dictation client typing into
whichever composer holds keyboard focus after a tab switch, or the shared view
painting a background session's optimistic message. Neither is fixed here
because neither is shown.

## Turn digest: what a long turn looks like once it is over

Asked for 2026-09-07: while a turn runs, show what it is doing; when it ends,
fold the working away and leave the reply and any question for the user.

Hermes already folded each run of tool calls under its own summary line with a
one-line ticker while live (`ToolRun` in `tool/fallback.tsx`). What stayed on
screen after a turn was every sealed interim paragraph ("Now the navigation
block") and one header per run, so a two-hour turn read as a wall of working
above a reply.

`thread/turn-digest.tsx` folds at the turn level. A turn is the user message
plus the assistant messages that follow it (`buildGroups` in `list.tsx`); every
assistant message before the last one folds under one header. The header is
the whole turn's tool summary in the past tense ("Edited 12 files, ran 30
commands"), or the count of sealed notes when no tool ran, with the timeline
range on the right. Settled, the header is a toggle remembered per turn
(`turn-digest:<user message id>` in the tool disclosure store). Live, the
header shimmers and cannot be opened; the tail message below it is the live
ticker and current step, unchanged.

Never folded: the tail (so an approval, clarify or MCP setup card, which only
exists on a pending tool, is never behind the header), and a message that
ended in an error, which also stops the fold so the messages after it render
in place. Inside the reply, tool runs keep their own per-run folding as before.

Chosen over folding inside a single message because the live view and the
rehydrated view both shape a turn as several assistant messages (one per
assistant row), so a message-level fold is the same code for both and needs no
per-part rendering hooks in assistant-ui.
