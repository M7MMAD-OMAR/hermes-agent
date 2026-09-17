/**
 * The last-known row for every pinned conversation.
 *
 * A pin is stored as an id (`$pinnedSessionIds`), and everything that needs to SHOW the pin
 * needs a row: the Pinned section renders one, and the push pass needs the row's `profile` to
 * route its PATCH. Both used to look for that row only in the loaded sidebar slices — recents,
 * cron, messaging — and a conversation the user pins is very often in none of them: a search
 * result, a row in a project lane (those lanes are fetched separately from the backend), or
 * anything past the first page of a long list.
 *
 * What happened then was the worst possible outcome. The id was in the local set, so every
 * list filtered the conversation out as "it lives in Pinned now"; the Pinned section could not
 * resolve it, so it rendered nothing; and the PATCH never fired, so the backend never recorded
 * the pin and could not back-fill the row on the next page either. The conversation vanished
 * from the sidebar entirely and stayed gone across restarts. Measured on a store of 1784
 * conversations: one pinned row in the database, and none of the user's pins visible.
 *
 * This module closes that gap. Any surface that renders session rows hands them here; the rows
 * whose pin id is currently pinned are kept, the rest are ignored, and an unpin drops its row.
 * The map is therefore bounded by the number of pins, not by the number of conversations.
 *
 * It is a CACHE, never an authority: a loaded row always wins over a remembered one, so a stale
 * title or flag cannot outlive the next page that carries the real row.
 */

import { atom } from 'nanostores'

import { $pinnedSessionIds } from '@/store/layout'
import { $cronSessions, $messagingSessions, $sessions, sessionPinId } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

/** Every row the sidebar's own fetches hold, across the three slices. */
function loadedSessionRows(): SessionInfo[] {
  return [...$sessions.get(), ...$cronSessions.get(), ...$messagingSessions.get()]
}

/** Remembered rows, keyed by the durable pin id (the lineage root). */
export const $pinnedSessionRows = atom<Readonly<Record<string, SessionInfo>>>({})

/** Every id a pin may be stored under for this row: its durable id and its live id. */
function pinKeysFor(session: SessionInfo): string[] {
  const pinId = sessionPinId(session)

  return pinId === session.id ? [pinId] : [pinId, session.id]
}

/**
 * Same row, field for field.
 *
 * Reference equality is not enough: a search result is rebuilt from the server payload on
 * every pass, so an unchanged conversation arrives as a fresh object each time. Publishing
 * those would churn this store — and with it the sidebar's Pinned memo and the pin sync's
 * reconcile — for no change at all. Rows are flat metadata (ids, counts, strings) and only
 * the pinned ones reach this, so a shallow compare is both correct and cheap.
 */
function sameRow(a: SessionInfo | undefined, b: SessionInfo): boolean {
  if (a === b) {
    return true
  }

  if (!a) {
    return false
  }

  const keys = Object.keys(b) as (keyof SessionInfo)[]

  return (
    keys.length === Object.keys(a).length &&
    keys.every(key => a[key] === b[key])
  )
}

/**
 * Keep the rows among `sessions` that are pinned right now.
 *
 * Callers pass whatever they are rendering; this picks. Publishes a new object only when
 * something actually changed, so a sidebar memo keyed on the store survives an ordinary
 * refresh.
 */
export function rememberPinnedSessionRows(sessions: readonly SessionInfo[]): void {
  if (!sessions.length) {
    return
  }

  const pinned = new Set($pinnedSessionIds.get())

  if (!pinned.size) {
    return
  }

  const current = $pinnedSessionRows.get()
  let next: Record<string, SessionInfo> | null = null

  for (const session of sessions) {
    for (const key of pinKeysFor(session)) {
      if (!pinned.has(key) || sameRow(current[key], session)) {
        continue
      }

      next ??= { ...current }
      next[key] = session
    }
  }

  if (next) {
    $pinnedSessionRows.set(next)
  }
}

/** The remembered row for a pin id, if one was ever seen. */
export function rememberedPinnedRow(pinId: string): SessionInfo | undefined {
  return $pinnedSessionRows.get()[pinId]
}

/** Drop rows for ids that are no longer pinned. Idempotent. */
export function prunePinnedSessionRows(): void {
  const current = $pinnedSessionRows.get()
  const keys = Object.keys(current)

  if (!keys.length) {
    return
  }

  const pinned = new Set($pinnedSessionIds.get())
  const stale = keys.filter(key => !pinned.has(key))

  if (!stale.length) {
    return
  }

  const next = { ...current }

  for (const key of stale) {
    delete next[key]
  }

  $pinnedSessionRows.set(next)
}

/** Test seam: forget every remembered row. */
export function resetPinnedSessionRows(): void {
  $pinnedSessionRows.set({})
}

/**
 * Keep this store fed and pruned. Call once per app, alongside `watchSessionPins`.
 *
 * Remembering the LOADED slices matters for the pin whose conversation is on screen today
 * and off the page tomorrow; the surfaces the slices never hold (search results, project
 * lanes) feed this store from the sidebar. It is deliberately wired here rather than inside
 * `session-pin-sync.reconcile`: that function listens to this store, and writing it from
 * there would push a notification cycle through nanostores' shared listener queue.
 */
export function watchPinnedSessionRows(): () => void {
  const remember = () => rememberPinnedSessionRows(loadedSessionRows())

  const stops = [
    $pinnedSessionIds.listen(() => {
      prunePinnedSessionRows()
      remember()
    }),
    $sessions.listen(remember),
    $cronSessions.listen(remember),
    $messagingSessions.listen(remember)
  ]

  remember()

  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}
