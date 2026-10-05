import { atom } from 'nanostores'

import type { ContextBreakdown } from '@/types/hermes'

export type GatewayRequest = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

export interface ContextBreakdownEntry {
  breakdown: ContextBreakdown | null
  loading: boolean
}

const EMPTY: ContextBreakdownEntry = { breakdown: null, loading: false }

/**
 * Per-session context breakdown, shared by every surface that shows the gauge.
 *
 * Today that is the statusbar item alone, refetched on every turn end and every
 * session switch. The store rather than a per-caller `useState` because the RPC
 * is not free on the backend — it rebuilds the system prompt from disk and walks
 * the transcript — so a second gauge must not double it: one in-flight request
 * per session, every subscriber reading the same answer, and the numbers survive
 * a remount.
 */
export const $contextBreakdownBySession = atom<Record<string, ContextBreakdownEntry>>({})

const inFlight = new Map<string, { promise: Promise<boolean>; token: symbol }>()

function patch(sessionId: string, entry: Partial<ContextBreakdownEntry>): void {
  const current = $contextBreakdownBySession.get()

  $contextBreakdownBySession.set({
    ...current,
    [sessionId]: { ...(current[sessionId] ?? EMPTY), ...entry }
  })
}

/** The entry for a session, or a stable empty one.
 *
 *  Keyed by the session it describes, so switching sessions drops the previous
 *  numbers instead of painting them under the new session's name. `bySession`
 *  is a parameter so a React caller can pass the snapshot it is already
 *  subscribed to rather than reading the atom a second time. */
export function contextBreakdownFor(
  sessionId: null | string,
  bySession: Record<string, ContextBreakdownEntry> = $contextBreakdownBySession.get()
): ContextBreakdownEntry {
  return (sessionId && bySession[sessionId]) || EMPTY
}

/** A breakdown the backend computed from a live agent carries a real
 *  context_max (the compressor's context_length). Zero means the
 *  `agent is None` branch answered from empty metadata: not data. */
export function isZeroedBreakdown(breakdown: ContextBreakdown): boolean {
  return !(breakdown.context_max > 0)
}

/** Drop a session's cached numbers, e.g. when a turn starts (the idle snapshot
 *  is stale from then on) or when retries are exhausted (a dark gauge is
 *  honest; stale numbers are not). */
export function evictContextBreakdown(sessionId: string): void {
  const current = $contextBreakdownBySession.get()

  if (current[sessionId]?.breakdown) {
    $contextBreakdownBySession.set({ ...current, [sessionId]: { ...current[sessionId], breakdown: null } })
  }
}

/** Fetch and cache a session's breakdown. Resolves true when the backend
 *  answered with trustworthy numbers (cached), false on a failure or a zeroed
 *  answer (not cached; the previous numbers are left for the caller to evict).
 *
 *  Concurrent callers share one request per session. `force` starts a new one
 *  even if a request is in flight, for callers that know the transcript just
 *  changed (compression), so a pre-change answer cannot satisfy them. */
export async function refreshContextBreakdown(
  sessionId: string,
  request: GatewayRequest,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  const pending = inFlight.get(sessionId)

  if (pending && !force) {
    return pending.promise
  }

  patch(sessionId, { loading: true })

  // Identifies this request; a later forced request replaces it, and then this
  // one's answer is stale and must not touch the entry.
  const token = Symbol(sessionId)
  const slot = { promise: Promise.resolve(false), token }
  const owns = () => inFlight.get(sessionId)?.token === token

  // Registered before the request starts so every branch below can ask `owns()`.
  inFlight.set(sessionId, slot)

  slot.promise = (async () => {
    try {
      const breakdown = await request<ContextBreakdown>('session.context_breakdown', { session_id: sessionId })

      if (!owns()) {
        return false
      }

      if (breakdown && !isZeroedBreakdown(breakdown)) {
        patch(sessionId, { breakdown, loading: false })

        return true
      }

      patch(sessionId, { loading: false })

      return false
    } catch {
      // Transient socket loss: keep the previous numbers rather than blanking
      // the gauge; the caller decides whether to retry or evict.
      if (owns()) {
        patch(sessionId, { loading: false })
      }

      return false
    } finally {
      if (owns()) {
        inFlight.delete(sessionId)
      }
    }
  })()

  return slot.promise
}

/** Test seam — module state outlives any single component. */
export function _resetContextBreakdownForTests(): void {
  inFlight.clear()
  $contextBreakdownBySession.set({})
}
