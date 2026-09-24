import type {
  ThreadListResult,
  ThreadState,
  ThreadStateCounts,
  ThreadSummary,
  ThreadTranscriptResult
} from '@hermes/shared'
import { atom, map } from 'nanostores'

import { activeGateway, ensureActiveGatewayOpen } from '@/store/gateway'
import { $activeGatewayProfile, ALL_PROFILES, normalizeProfileKey } from '@/store/profile'

import { $subagentsBySession, type SubagentProgress, type SubagentStatus } from './subagents'
import { messageForThread, routeMessage, type RouteReason } from './thread-routing'

/**
 * Threads: the delegated subagent sessions the sidebar hides.
 *
 * Two sources describe the same work and neither is sufficient alone:
 *
 * - `thread.list` is DURABLE. It answers for threads whose turn ended, whose
 *   backend restarted, or whose conversation was closed and reopened. It is
 *   the only source that knows a thread exists at all after the fact.
 * - `subagent.*` events are LIVE. They carry the current step, the active tool
 *   and sub-agent structure, and they arrive seconds before the child's
 *   session row is durable enough to list.
 *
 * `mergeThreadRows` is the join, on the child's own session id. It is pure so
 * the merge rules are tested directly rather than through a rendered panel.
 */

export type { ThreadState }

/** One row as the dock renders it: the durable record plus any live overlay. */
export interface ThreadRow {
  sessionId: string
  coordinatorSessionId: null | string
  label: string
  state: ThreadState
  startedAt: number
  /** Unset while the thread is still open. */
  endedAt: null | number
  messageCount: number
  toolCallCount: number
  model: null | string
  /** True while `subagent.*` events are still arriving for this row. */
  live: boolean
  /** The child's live step, e.g. the tool it is inside. Live rows only. */
  activity?: string
  /** The live subagent id, which is what `subagent.steer` addresses. */
  subagentId?: string
  /** Children of this thread, for the sub-agent count badge. */
  childCount: number
}

export const THREAD_STATES: readonly ThreadState[] = ['working', 'resolved', 'failed']

const EMPTY_COUNTS: ThreadStateCounts = { failed: 0, resolved: 0, working: 0 }

/** Durable rows keyed by coordinator session id. */
export const $threadsByCoordinator = map<Record<string, ThreadSummary[]>>({})
/** Whole-scope counts keyed by coordinator session id, for the inbox headers. */
export const $threadCountsByCoordinator = map<Record<string, ThreadStateCounts>>({})
/** Coordinators with a `thread.list` request in flight, so the dock can say so. */
export const $threadsLoading = atom<ReadonlySet<string>>(new Set())

/**
 * A live subagent's state as a thread state.
 *
 * `interrupted` is a failure and not a resolution: the work did not finish on
 * its own terms, and calling it resolved tells the user something landed that
 * did not. This mirrors the backend's treatment of a reaped session.
 */
export function threadStateForSubagent(status: SubagentStatus): ThreadState {
  if (status === 'running' || status === 'queued') {
    return 'working'
  }

  return status === 'completed' ? 'resolved' : 'failed'
}

function liveActivity(item: SubagentProgress): string | undefined {
  if (item.currentTool) {
    return item.currentTool
  }

  const last = item.stream.at(-1)

  return last?.text || undefined
}

function rowFromDurable(summary: ThreadSummary): ThreadRow {
  return {
    childCount: 0,
    coordinatorSessionId: summary.coordinator_session_id ?? null,
    endedAt: summary.ended_at ?? null,
    label: summary.label,
    live: false,
    messageCount: summary.message_count ?? 0,
    model: summary.model ?? null,
    sessionId: summary.session_id,
    startedAt: summary.started_at ?? 0,
    state: summary.state,
    toolCallCount: summary.tool_call_count ?? 0
  }
}

function rowFromLive(item: SubagentProgress, coordinatorSessionId: null | string): ThreadRow {
  return {
    activity: liveActivity(item),
    childCount: 0,
    coordinatorSessionId,
    endedAt: null,
    // A child that has not written its goal turn yet still has to render as
    // something, and its id is the only thing guaranteed to exist.
    label: item.goal || item.sessionId || item.id,
    live: true,
    messageCount: 0,
    model: item.model ?? null,
    sessionId: item.sessionId || item.id,
    startedAt: item.startedAt,
    state: threadStateForSubagent(item.status),
    subagentId: item.id,
    toolCallCount: item.toolCount ?? 0
  }
}

/**
 * Join durable rows with the live roster.
 *
 * Rules, in the order they matter:
 *
 * 1. One row per child. The join key is the child's own session id, which both
 *    sources carry (`SubagentProgress.sessionId`, `ThreadSummary.session_id`).
 *    Emitting the same child twice is the failure this function exists to stop.
 * 2. A live match wins on state and supplies the activity line. A child that is
 *    still running has an open session row, so the durable state would say
 *    `working` too, but the live row knows WHAT it is doing.
 * 3. A live child with no durable row yet is still shown. Its session row lands
 *    a moment later, and a thread that is invisible for its first seconds reads
 *    as a dropped request.
 * 4. A durable row keeps its own label when the live goal is absent, and takes
 *    the live goal only when it has nothing better. A titled thread must not be
 *    renamed back to its raw goal by a live event.
 * 5. Newest first, matching the backend's ordering, so a refresh does not
 *    reshuffle the list.
 */
export function mergeThreadRows(
  durable: readonly ThreadSummary[],
  live: readonly SubagentProgress[],
  coordinatorSessionId: null | string = null
): ThreadRow[] {
  const liveBySession = new Map<string, SubagentProgress>()

  for (const item of live) {
    const key = item.sessionId || item.id

    if (key) {
      liveBySession.set(key, item)
    }
  }

  // Sub-agent counts come from the live tree: a child's own children are its
  // parentId edges, and only the live roster carries them.
  const childCounts = new Map<string, number>()

  for (const item of live) {
    if (!item.parentId) {
      continue
    }

    const parent = live.find(candidate => candidate.id === item.parentId)
    const key = parent?.sessionId || parent?.id

    if (key) {
      childCounts.set(key, (childCounts.get(key) ?? 0) + 1)
    }
  }

  const rows: ThreadRow[] = []
  const claimed = new Set<string>()

  for (const summary of durable) {
    const row = rowFromDurable(summary)
    const match = liveBySession.get(row.sessionId)

    if (match) {
      claimed.add(row.sessionId)
      row.live = true
      row.state = threadStateForSubagent(match.status)
      row.activity = liveActivity(match)
      row.subagentId = match.id
      // Rule 4: the durable label is the better name whenever it exists.
      row.label = summary.label || match.goal || row.label
      row.toolCallCount = Math.max(row.toolCallCount, match.toolCount ?? 0)
      // A live row is still open regardless of what the durable snapshot said:
      // the snapshot may predate this run's restart.
      row.endedAt = null
    }

    row.childCount = childCounts.get(row.sessionId) ?? 0
    rows.push(row)
  }

  for (const item of live) {
    const key = item.sessionId || item.id

    // A child of another child is structure inside a thread, not a thread of
    // its own: it is counted on its parent's badge and must not become a row.
    if (!key || claimed.has(key) || item.parentId) {
      continue
    }

    const row = rowFromLive(item, coordinatorSessionId)

    row.childCount = childCounts.get(key) ?? 0
    rows.push(row)
  }

  return rows.sort((a, b) => b.startedAt - a.startedAt || a.sessionId.localeCompare(b.sessionId))
}

/**
 * How long a thread ran, in seconds, or null while it is still running.
 *
 * There is no `n/m` plan ring here, and that is a measurement rather than an
 * omission: across 299 delegated threads and roughly 15,000 tool calls on a
 * live machine, the `todo_list` tool has been called zero times. A child gets
 * one focused goal and does it rather than planning a checklist, so a ring fed
 * by `TodoState` would render a permanent `0/0`. What a finished thread can
 * honestly report is how much work it did and how long it took, and both are
 * already durable on its session row.
 */
export function threadDuration(row: ThreadRow): null | number {
  if (row.live || row.endedAt == null || !row.startedAt) {
    return null
  }

  return Math.max(0, Math.round(row.endedAt - row.startedAt))
}

/** Group merged rows into the inbox's sections, preserving row order. */
export function groupThreadRows(rows: readonly ThreadRow[]): Record<ThreadState, ThreadRow[]> {
  const grouped: Record<ThreadState, ThreadRow[]> = { failed: [], resolved: [], working: [] }

  for (const row of rows) {
    grouped[row.state].push(row)
  }

  return grouped
}

/**
 * Counts for the inbox headers.
 *
 * The backend's whole-scope counts are authoritative for what exists, but a
 * live child with no durable row yet is real and visible, so it is added on
 * top. Without this the header says zero while a row is on screen.
 */
export function threadCounts(
  rows: readonly ThreadRow[],
  durableCounts: ThreadStateCounts = EMPTY_COUNTS
): ThreadStateCounts {
  const counts: ThreadStateCounts = { ...durableCounts }

  for (const row of rows) {
    if (row.live && row.messageCount === 0 && !row.toolCallCount) {
      counts[row.state] = (counts[row.state] ?? 0) + 1
    }
  }

  return counts
}

function setLoading(coordinatorSessionId: string, loading: boolean): void {
  const next = new Set($threadsLoading.get())

  if (loading) {
    next.add(coordinatorSessionId)
  } else {
    next.delete(coordinatorSessionId)
  }

  $threadsLoading.set(next)
}

export function clearThreads(coordinatorSessionId: string): void {
  const threads = { ...$threadsByCoordinator.get() }
  const counts = { ...$threadCountsByCoordinator.get() }

  delete threads[coordinatorSessionId]
  delete counts[coordinatorSessionId]
  $threadsByCoordinator.set(threads)
  $threadCountsByCoordinator.set(counts)
  setLoading(coordinatorSessionId, false)
}

export function resetThreadStore(): void {
  $threadsByCoordinator.set({})
  $threadCountsByCoordinator.set({})
  $threadsLoading.set(new Set())
  // Routing state is part of the store: a receipt or an undo that survived a
  // reset would leak one test's routed message into the next.
  $requestedThreadSessionId.set(null)
  $threadRouteReceipt.set(null)
  $threadRouteUndo.set(null)
}

/**
 * Load a coordinator's durable threads.
 *
 * `request` is injected so the caller owns gateway routing (profile scope,
 * reconnect) and this module stays a pure store with a testable seam.
 *
 * A failed read leaves the previous rows in place rather than blanking the
 * dock: stale threads are far more useful than an empty panel, and the live
 * rows on top are unaffected by a durable read failing.
 */
export async function refreshThreads(
  coordinatorSessionId: string,
  request: (method: string, params: Record<string, unknown>) => Promise<ThreadListResult>,
  params: Record<string, unknown> = {}
): Promise<boolean> {
  if (!coordinatorSessionId) {
    return false
  }

  setLoading(coordinatorSessionId, true)

  try {
    const result = await request('thread.list', {
      coordinator_session_id: coordinatorSessionId,
      ...params
    })

    $threadsByCoordinator.setKey(coordinatorSessionId, result.threads ?? [])
    $threadCountsByCoordinator.setKey(coordinatorSessionId, result.counts ?? EMPTY_COUNTS)

    return true
  } catch {
    return false
  } finally {
    setLoading(coordinatorSessionId, false)
  }
}

/** Durable rows for one coordinator, or an empty list. */
export function threadsFor(coordinatorSessionId: null | string | undefined): ThreadSummary[] {
  return coordinatorSessionId ? ($threadsByCoordinator.get()[coordinatorSessionId] ?? []) : []
}

/** Whole-scope durable counts for one coordinator. */
export function threadCountsFor(coordinatorSessionId: null | string | undefined): ThreadStateCounts {
  return coordinatorSessionId
    ? ($threadCountsByCoordinator.get()[coordinatorSessionId] ?? EMPTY_COUNTS)
    : EMPTY_COUNTS
}

// ── Gateway-bound layer ─────────────────────────────────────────────────────
// Everything above is pure and takes an injected request. These are the real
// callers, kept at the bottom so the merge rules stay testable without a socket.

/** Issue a thread request on the active gateway, reconnecting once if the
 *  socket dropped. Threads belong to a profile's state.db, so the request
 *  carries the active profile the same way the session list does. */
async function threadGatewayRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let gateway = activeGateway()

  if (!gateway || gateway.connectionState !== 'open') {
    gateway = await ensureActiveGatewayOpen()
  }

  if (!gateway) {
    throw new Error('Sbar Rafiq gateway is not connected')
  }

  const profile = normalizeProfileKey($activeGatewayProfile.get())

  // A profile of ALL is a sidebar filter, not a database. The backend reads the
  // launch profile when none is named, which is the right default here.
  return gateway.request<T>(method, profile && profile !== ALL_PROFILES ? { profile, ...params } : params)
}

/** Load one coordinator's durable threads from the live gateway. */
export function refreshThreadsForSession(coordinatorSessionId: string): Promise<boolean> {
  return refreshThreads(coordinatorSessionId, (method, params) =>
    threadGatewayRequest<ThreadListResult>(method, params)
  )
}

/** One thread's durable transcript, or null when it cannot be read. */
export async function fetchThreadTranscript(sessionId: string): Promise<null | ThreadTranscriptResult> {
  if (!sessionId) {
    return null
  }

  try {
    return await threadGatewayRequest<ThreadTranscriptResult>('thread.transcript', { session_id: sessionId })
  } catch {
    return null
  }
}

export type SteerOutcome = 'finished' | 'sent' | 'unreachable'

/**
 * Send an instruction into a running thread.
 *
 * Steering goes through the existing `subagent.steer`, not a second runtime:
 * a thread that is not live has no worker to receive anything, which is
 * `finished` rather than a failure. The caller distinguishes the two because
 * "this thread is done" and "we could not reach it" mean different things to
 * someone who just typed a sentence.
 */
export async function steerThread(row: ThreadRow, text: string, ownerSessionId: string): Promise<SteerOutcome> {
  if (!row.live || !row.subagentId) {
    return 'finished'
  }

  const body = text.trim()

  if (!body) {
    return 'finished'
  }

  try {
    await threadGatewayRequest('subagent.steer', {
      session_id: ownerSessionId,
      subagent_id: row.subagentId,
      text: body
    })

    return 'sent'
  } catch {
    return 'unreachable'
  }
}

// ── Inline thread references ────────────────────────────────────────────────
// An agent writes `@session:<profile>/<id>` and the markdown renderer turns it
// into a link. When that id belongs to a delegated thread the chip should say
// so: a thread is not a conversation you switch to, it is work you look in on.

/** A thread the dock has been asked to open, or null. Set by an inline chip,
 *  cleared once the dock has honoured it. */
export const $requestedThreadSessionId = atom<null | string>(null)

/** Ask the Threads dock to open one thread. */
export function requestThread(sessionId: string): void {
  $requestedThreadSessionId.set(sessionId || null)
}

export function clearThreadRequest(): void {
  $requestedThreadSessionId.set(null)
}

/**
 * Find a loaded thread by its session id, across every coordinator.
 *
 * Returns null for an id nobody has loaded, which is the common case for a
 * chip in an old message. The caller renders a plain session link then, rather
 * than a thread chip that cannot say anything true about state.
 */
export function findLoadedThread(
  sessionId: string,
  byCoordinator: Record<string, ThreadSummary[]> = $threadsByCoordinator.get()
): null | ThreadSummary {
  if (!sessionId) {
    return null
  }

  for (const rows of Object.values(byCoordinator)) {
    const match = rows.find(row => row.session_id === sessionId)

    if (match) {
      return match
    }
  }

  return null
}

// ── Routing a typed message into a running thread ───────────────────────────

/** What the composer shows after a message went to a thread instead of to the
 *  conversation. It exists so the redirect is never silent. */
export interface ThreadRouteReceipt {
  at: number
  /** The words as typed, so undo can hand them back intact. */
  originalText: string
  reason: RouteReason
  threadLabel: string
  threadSessionId: string
}

export const $threadRouteReceipt = atom<null | ThreadRouteReceipt>(null)

export function clearThreadRouteReceipt(): void {
  $threadRouteReceipt.set(null)
}

/**
 * Send a typed message to a running thread, if it was explicitly addressed at
 * one. Returns true when the message was taken, so the caller skips its turn.
 *
 * Nothing routes without an explicit address (see `thread-routing.ts`), so an
 * ordinary message never reaches this branch at all. The receipt is set
 * BEFORE the steer resolves: the user must see where their words went
 * immediately, not after a round trip.
 */
export function tryRouteToThread(
  text: string,
  ownerSessionId: string,
  send: (row: ThreadRow, body: string, owner: string) => Promise<SteerOutcome> = steerThread
): boolean {
  if (!text.trim() || !ownerSessionId) {
    return false
  }

  // Live rows are taken for THIS conversation only, never the flattened roster.
  // `mergeThreadRows` promotes a live child with no durable match into a row and
  // stamps it with the coordinator it was handed, so feeding it every session's
  // subagents would let a worker belonging to conversation A qualify as the sole
  // running thread of conversation B, and steer B's message into A. That is the
  // exact harm this module exists to prevent.
  const rows = mergeThreadRows(
    threadsFor(ownerSessionId),
    $subagentsBySession.get()[ownerSessionId] ?? [],
    ownerSessionId
  )

  const decision = routeMessage(text, rows)

  if (decision.kind !== 'route') {
    return false
  }

  $threadRouteReceipt.set({
    at: Date.now(),
    originalText: text,
    reason: decision.reason,
    threadLabel: decision.row.label,
    threadSessionId: decision.row.sessionId
  })

  void send(decision.row, messageForThread(text), ownerSessionId).then(outcome => {
    // A steer that did not land must not leave a receipt claiming it did. The
    // receipt is dropped and the words are handed back to the composer, which
    // is the same contract a rejected submit already has.
    if (outcome !== 'sent') {
      $threadRouteReceipt.set(null)
      $threadRouteUndo.set(text)
    }
  })

  return true
}

/** Text the composer should reload: either an undo the user asked for, or a
 *  steer that failed after the receipt was shown. */
export const $threadRouteUndo = atom<null | string>(null)

/** Take the routed words back. The thread keeps what it already received; this
 *  returns the message to the composer so it can be sent to the conversation. */
export function undoThreadRoute(): void {
  const receipt = $threadRouteReceipt.get()

  if (receipt) {
    $threadRouteUndo.set(receipt.originalText)
    $threadRouteReceipt.set(null)
  }
}

export function consumeThreadRouteUndo(): null | string {
  const text = $threadRouteUndo.get()

  if (text !== null) {
    $threadRouteUndo.set(null)
  }

  return text
}
