import { atom, computed } from 'nanostores'

import type { NativeNotificationKind } from './native-notifications'
import { $sessionStates, runtimeHasOpenSurface, storedSessionIdForRuntimeId } from './session-states'

/**
 * The in-app record of everything worth telling the user about, so a chat that
 * finished while they were reading another one is not simply lost.
 *
 * This is the list behind the titlebar bell. It is deliberately NOT the same
 * thing as the OS notification: the OS one interrupts, and is therefore
 * suppressed while the user is looking at the app or has that kind muted. Those
 * are exactly the events people asked to be able to find afterwards, so an
 * entry is recorded whether or not an OS notification was shown.
 *
 * Held in memory only. The sidebar's own unread dots already survive a restart
 * (`session-unread.ts` persists markers), so the durable "you have not read
 * this chat" answer exists; this list answers the narrower and shorter-lived
 * "what just happened while I was busy elsewhere".
 */
export interface InboxEntry {
  id: string
  /** ms since epoch. */
  at: number
  kind: NativeNotificationKind
  title: string
  body?: string
  /**
   * Durable chat identity, resolved when the entry is recorded rather than when
   * it is clicked. Runtime ids are ephemeral: a session evicted and resumed
   * gets a new one, so an entry holding a runtime id would quietly stop
   * resolving to its chat. Null for events not tied to a chat (plugins, credit
   * alerts).
   */
  storedSessionId: null | string
  read: boolean
}

/** Newest first. Capped so a long session cannot grow this without bound. */
const LIMIT = 50

/** Window in which the same event arriving twice is treated as one.
 *
 *  Necessary because recording happens above the dispatcher's own throttle: a
 *  gateway reconnect replays recent events, and several windows each run their
 *  own renderer, so the same completion can reach here more than once. Matching
 *  the dispatcher's 1s window keeps the two agreeing about what "the same
 *  event" means. */
const DEDUPE_MS = 1_000

export const $inbox = atom<InboxEntry[]>([])

export const $unreadInboxCount = computed($inbox, entries => entries.filter(entry => !entry.read).length)

let counter = 0

/** The chat an event belongs to, by durable id. Tiles claim their own stored
 *  id; the primary view is not a tile, so its runtime slice answers for it.
 *
 *  Exported because the OS notification needs the same answer for a different
 *  reason: the `hermes://chat/<id>` link it carries must name a chat that is
 *  still findable minutes later, and after the app has been closed and
 *  relaunched, which only the durable id is. */
export function durableChatId(runtimeId: string): null | string {
  return $sessionStates.get()[runtimeId]?.storedSessionId ?? storedSessionIdForRuntimeId(runtimeId)
}

export interface InboxRecordInput {
  kind: NativeNotificationKind
  title: string
  body?: string
  /** Runtime session id, as every gateway event carries it. */
  sessionId?: null | string
  /** Not tied to a chat (plugin runs, credit alerts). */
  global?: boolean
}

/**
 * Record an event, or decline it.
 *
 * The filter is `runtimeHasOpenSurface`: a chat with the primary view or a tile
 * in this window. It is the same predicate the OS notification uses, for the
 * same reason. A busy gateway runs sessions the user never opened (messaging,
 * kanban, cron, delegated subagents); listing those would bury the handful of
 * chats the user is actually waiting on, which is the complaint this list
 * exists to answer. Session-less events are always kept: nothing else reports
 * them.
 *
 * Returns the entry, or null when it was declined.
 */
export function recordInboxEntry(input: InboxRecordInput): InboxEntry | null {
  const runtimeId = input.sessionId?.trim() || ''

  if (!input.global && runtimeId && !runtimeHasOpenSurface(runtimeId)) {
    return null
  }

  const storedId = runtimeId ? durableChatId(runtimeId) : null

  const kindMatch = (entry: InboxEntry) =>
    entry.kind === input.kind && entry.title === input.title && entry.storedSessionId === storedId

  const now = Date.now()

  if ($inbox.get().some(entry => now - entry.at < DEDUPE_MS && kindMatch(entry))) {
    return null
  }

  counter += 1

  const entry: InboxEntry = {
    at: now,
    body: input.body,
    id: `inbox-${counter}`,
    kind: input.kind,
    read: false,
    storedSessionId: storedId,
    title: input.title
  }

  $inbox.set([entry, ...$inbox.get()].slice(0, LIMIT))

  return entry
}

export function markInboxEntryRead(id: string): void {
  $inbox.set($inbox.get().map(entry => (entry.id === id ? { ...entry, read: true } : entry)))
}

export function markAllInboxRead(): void {
  if ($unreadInboxCount.get() === 0) {
    return
  }

  $inbox.set($inbox.get().map(entry => (entry.read ? entry : { ...entry, read: true })))
}

export function clearInbox(): void {
  $inbox.set([])
}
