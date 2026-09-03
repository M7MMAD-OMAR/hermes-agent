import { atom } from 'nanostores'

import { getQueuedPrompts, isQueueParked } from '@/store/composer-queue'
import { hasBlockingPromptRequest } from '@/store/prompts'

/**
 * Post-turn next moves — the composer's ghost suggestion, fed by the backend's
 * `next_moves.offer` event. Design doc: `docs/design/next-moves.md`.
 *
 * NOT a pill on the suggestion bus. The bus is for ACTIONS you click (connect
 * this server, repair that connection); a next move is TEXT, and text belongs
 * where text goes — in the composer, greyed out where the placeholder sits,
 * accepted with Tab. Two surfaces showing one suggestion would be the same
 * mistake as two surfaces rendering one page.
 *
 * Accepting is a draft edit and nothing else: no submit, no delegation spawn,
 * no gateway call. Declining is not pressing Tab, and typing anything replaces
 * the ghost — which is only safe because acceptance is reversible.
 *
 * The offer is bound to the turn it describes. `noteTurnStarted` /
 * `noteTurnCompleted` keep a per-session counter, and an offer is published
 * only while the session is still sitting on the completion it belongs to.
 * That is what makes a REPLAYED frame harmless: the gateway buffers session
 * events and re-delivers everything past the client's watermark on reconnect,
 * through the same path as live ones, so an offer emitted while the socket was
 * down would otherwise arrive minutes and several turns later. Counting turns
 * rather than comparing clocks keeps it correct across a remote gateway, where
 * the two ends' clocks are not the same clock.
 */

export interface NextMove {
  kind: string
  label: string
  payload: string
  tip: string
}

/** The moves standing for each session, most-wanted first. The composer paints
 *  `[0]`; the rest exist so a move the renderer rejects (a skill that has since
 *  vanished, a payload that arrives empty) has a runner-up rather than
 *  collapsing the whole offer. Not a queue — there is no "next suggestion". */
export const $nextMovesBySession = atom<Record<string, NextMove[]>>({})

/** Mirrors `MOVE_KINDS` in `agent/next_moves.py`. Re-checked here because the
 *  wire is untrusted input, not because the backend is expected to lie. */
const MOVE_KINDS = new Set(['action', 'delegate', 'followup', 'skill'])

const LABEL_LIMIT = 48
const MAX_MOVES = 3

/** The ghost sits on one clipped line where the placeholder does. Past this it
 *  is all ellipsis and tells the user nothing, so the offer is dropped rather
 *  than shown as a shrug. */
const GHOST_LIMIT = 160

/** How long a standing offer survives with nothing happening.
 *
 *  Not decoration: `clearDraftSuggestions` spares event offerings by design,
 *  so without an expiry a conversation the user walks away from keeps its pill
 *  and repaints it on reopen — an offer about a turn they have forgotten. */
const OFFER_TTL_MS = 10 * 60_000

interface SessionOfferState {
  /** Turns this renderer has seen START for the session. */
  started: number
  /** The `started` value at the last completion, or null when the session is
   *  not sitting on one (mid-turn, an error path, or nothing seen yet). */
  awaiting: null | number
  expiry?: number
}

const clearExpiry = (state: SessionOfferState): void => {
  if (state.expiry !== undefined) {
    window.clearTimeout(state.expiry)
    state.expiry = undefined
  }
}

/** Self-bounding on purpose. Nothing in the renderer tells this module a
 *  session is over — importing the teardown sites would close a cycle through
 *  `prompts` → `session-states` — and two integers per session is not worth
 *  that. Oldest-first eviction, since a Map iterates in insertion order. */
const MAX_TRACKED_SESSIONS = 64

const states = new Map<string, SessionOfferState>()

const stateFor = (sessionId: string): SessionOfferState => {
  let state = states.get(sessionId)

  if (!state) {
    if (states.size >= MAX_TRACKED_SESSIONS) {
      const oldest = states.keys().next()

      if (!oldest.done) {
        const evicted = states.get(oldest.value)

        if (evicted) {
          clearExpiry(evicted)
        }

        states.delete(oldest.value)
      }
    }

    state = { awaiting: null, started: 0 }
    states.set(sessionId, state)
  }

  return state
}

/** Withdraw the session's standing offer. Safe to call when there isn't one. */
export function withdrawNextMoves(sessionId: null | string | undefined): void {
  if (!sessionId) {
    return
  }

  const state = states.get(sessionId)

  if (state) {
    clearExpiry(state)
    state.awaiting = null
  }

  const current = $nextMovesBySession.get()

  if (sessionId in current) {
    const { [sessionId]: _dropped, ...rest } = current

    $nextMovesBySession.set(rest)
  }
}

/** A turn began. Withdraws whatever stood, and moves the session off the
 *  completion any in-flight offer was generated for. */
export function noteTurnStarted(sessionId: null | string | undefined): void {
  if (!sessionId) {
    return
  }

  const state = stateFor(sessionId)

  state.started += 1
  withdrawNextMoves(sessionId)
}

/** A turn completed cleanly. Only now is the session willing to take an offer.
 *  The error path deliberately does NOT call this — it withdraws instead, so a
 *  late offer for a turn that failed can never land. */
export function noteTurnCompleted(sessionId: null | string | undefined): void {
  if (!sessionId) {
    return
  }

  const state = stateFor(sessionId)

  state.awaiting = state.started
}

/** Tests only: forget every session's turn accounting. */
export function resetNextMoveTracking(): void {
  for (const state of states.values()) {
    clearExpiry(state)
  }

  states.clear()
}

const clip = (text: unknown, limit: number): string => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`
}

/** Coerce the wire payload. Whole or nothing — a half-valid pack would render
 *  as a confident offer missing the useful half. */
export function readMoves(raw: unknown): NextMove[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return []
  }

  const moves: NextMove[] = []

  for (const entry of raw.slice(0, MAX_MOVES)) {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const row = entry as Record<string, unknown>
    const kind = String(row.kind ?? '')
    const label = clip(row.label, LABEL_LIMIT)
    const payload = String(row.payload ?? '').trim()

    if (!MOVE_KINDS.has(kind) || !label || !payload || payload.length > GHOST_LIMIT) {
      return []
    }

    moves.push({ kind, label, payload, tip: clip(row.tip, 240) })
  }

  return moves
}

/**
 * Publish an offer for the turn the session just finished.
 *
 * Returns whether it was published, so the handler can be tested on the drop
 * paths without reaching into the bus.
 */
export function offerNextMoves(sessionId: null | string | undefined, raw: unknown): boolean {
  // Never the `''` bucket: a falsy id means there is no session to offer to,
  // and that bucket is a shared drain `useSessionSlice` never reads back.
  if (!sessionId) {
    return false
  }

  const state = states.get(sessionId)

  // Not sitting on a completion. Covers the replayed frame, the offer that
  // lost the race to the next turn's start, and the turn that ended through
  // the error path.
  if (!state || state.awaiting === null || state.awaiting !== state.started) {
    return false
  }

  // A queued prompt auto-drains on the very edge that ended this turn, so the
  // next turn is already going. A PARKED queue is idle-not-draining and is a
  // fine moment to offer.
  if (getQueuedPrompts(sessionId).length > 0 && !isQueueParked(sessionId)) {
    return false
  }

  // The composer is parked on an approval/sudo/secret prompt and reroutes
  // typing to the queue, so a draft edit lands somewhere the user cannot send
  // from.
  if (hasBlockingPromptRequest(sessionId)) {
    return false
  }

  const moves = readMoves(raw)

  if (moves.length === 0) {
    return false
  }

  clearExpiry(state)
  $nextMovesBySession.set({ ...$nextMovesBySession.get(), [sessionId]: moves })
  state.expiry = window.setTimeout(() => withdrawNextMoves(sessionId), OFFER_TTL_MS)

  return true
}
