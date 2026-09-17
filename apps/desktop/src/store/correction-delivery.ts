import { map } from 'nanostores'

import type { CorrectionDelivery } from '@/app/types'

/**
 * Where each session's most recent mid-turn correction is, until it lands.
 *
 * The symptom this exists for: you type a follow-up while a turn is running, the bubble appears,
 * and then nothing happens for a long time. The correction WAS accepted, but it is queued behind
 * a tool batch that may itself be blocked on a command that cannot be handed to the background,
 * and the UI had no way to say so. "Accepted" and "delivered" looked the same, so a normal wait
 * was indistinguishable from the message being eaten.
 *
 * Deliberately NOT persisted: it describes a moment inside one live turn. A value restored from
 * a previous session would claim a correction is pending against a turn that ended long ago.
 */

export interface PendingCorrection {
  /** What the person typed, so the row can show it rather than a bare status. */
  text: string
  delivery: CorrectionDelivery
}

type CorrectionState = Record<string, PendingCorrection | undefined>

export const $pendingCorrections = map<CorrectionState>({})

/** Record that ``sessionId``'s correction was accepted and how it will arrive. */
export function setPendingCorrection(sessionId: string, text: string, delivery: CorrectionDelivery): void {
  if (!sessionId) {
    return
  }

  $pendingCorrections.setKey(sessionId, { delivery, text })
}

/**
 * Clear ``sessionId``'s pending correction.
 *
 * Called when the correction can no longer be in flight: the turn settled, the session was
 * stopped, or a newer correction replaced it. Clearing a session with nothing pending is a
 * no-op rather than an error, because every caller is a lifecycle event that fires whether or
 * not a correction happened to be outstanding.
 */
export function clearPendingCorrection(sessionId: string): void {
  if (!sessionId || !$pendingCorrections.get()[sessionId]) {
    return
  }

  $pendingCorrections.setKey(sessionId, undefined)
}

/** Drop every session's pending correction at once. */
export function clearAllPendingCorrections(): void {
  $pendingCorrections.set({})
}

/**
 * Whether a pending correction is waiting on something rather than already delivered.
 *
 * `model_cancelled` means the correction is already inside the rebuilt turn, so there is
 * nothing to tell the person about; only the two waiting modes are worth a status row.
 */
export function isCorrectionWaiting(pending: PendingCorrection | undefined): boolean {
  return pending?.delivery === 'tool_boundary' || pending?.delivery === 'tool_boundary_blocked'
}
