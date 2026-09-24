import { reconnectBackoffDelayMs } from '@hermes/shared'

/**
 * Liveness-probe force-close policy for the primary gateway socket (#95327).
 *
 * Why this exists
 * ───────────────
 * Every window-lifecycle recovery signal (power resume, network online,
 * focus, visibility) nudges `reconnectNow()`. When the socket still reports
 * open, that path probes liveness with a short-bounded ping and FORCE-CLOSES
 * the socket when the ping times out — "a half-open TCP connection must not
 * swallow the user's next submit".
 *
 * A ping timeout proves a dead TRANSPORT, but it also fires for a live,
 * BUSY backend: a long silent tool call (a quiet build, an OCR worker, a
 * large download) starves the gateway's event loop past the 5s probe budget
 * (#74874's GIL-stall family, amplified on Windows by AV/filter-driver
 * latency). Tearing down the renderer↔backend WebSocket at that moment is a
 * false kill: the gateway sees its client vanish mid-turn, the
 * `ws_orphan_reap` grace expires, and the running turn is interrupted into a
 * bare "Operation interrupted." placeholder — the exact #95327 report.
 *
 * Policy
 * ──────
 * Three signals decide, strongest first.
 *
 * 1. A RECENT INBOUND FRAME is positive proof the transport is alive. Any
 *    frame counts — a stream delta, an event, a late response. A ping timeout
 *    alongside a frame from a second ago describes a busy backend, not a dead
 *    socket, so this defers outright and is never overridden by a streak.
 * 2. While any session reports working, backend silence is EXPECTED, so a
 *    probe timeout is inconclusive. Failures are tolerated until the total
 *    deferral BUDGET (`LIVENESS_MAX_DEFERRAL_MS`) is spent, re-probing on an
 *    exponential backoff rather than a fixed tick — a 200-second tool call
 *    must not be pinged 60 times, and a genuinely dead socket must still be
 *    rebuilt within a bounded wall-clock time.
 * 3. With no work in flight, silence has no innocent explanation: close on
 *    the first failure, exactly as before this policy existed.
 *
 * Replacing the old fixed streak (2 failures ≈ 3 seconds of grace) with a
 * budget is the substantive change: 3 seconds was never going to cover the
 * stalls this was written for.
 *
 * Pure and Electron-free so the boundaries are assertable directly
 * (mirroring gateway-liveness usage in use-gateway-boot).
 */

/** Ping budget for a liveness probe (primary and secondary sockets share it). */
export const LIVENESS_PROBE_TIMEOUT_MS = 5_000

/** How long after the FIRST deferred probe we try again (bounded, coalesced). */
export const LIVENESS_REPROBE_DELAY_MS = 3_000

/** Ceiling for one backoff step, so a long stall still gets periodic checks. */
export const LIVENESS_MAX_REPROBE_DELAY_MS = 30_000

/**
 * Total time a busy-but-silent socket may be given before it is rebuilt anyway.
 *
 * Sized against the gateway's own patience rather than picked round. While the socket stays up
 * the backend schedules no orphan reap at all, and once one is scheduled it still defers while
 * turn activity is fresh — `ws_orphan_activity_stale_s`, 600s by default, five times this
 * budget. So holding on for two minutes cannot strand a session, while a socket that has
 * delivered nothing for two minutes with a turn supposedly running has stopped being plausibly
 * alive and is worth rebuilding.
 */
export const LIVENESS_MAX_DEFERRAL_MS = 120_000

/**
 * How recently a frame must have arrived to count as proof of a live transport.
 *
 * Comfortably longer than the probe timeout so the two cannot disagree about the same moment,
 * and short enough that a socket which went quiet minutes ago is not credited for it.
 */
export const LIVENESS_RECENT_FRAME_MS = 15_000

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export interface LivenessForceCloseInput {
  /**
   * How many sessions currently report working (mid-turn). Zero means no
   * turn is riding this socket, so silence has no innocent explanation.
   */
  workingSessionCount: number
  /**
   * Milliseconds since the last inbound frame on this socket, or `null` when
   * nothing has arrived yet / the caller cannot tell. `null` simply forgoes the
   * strongest signal; it never argues for closing.
   */
  msSinceLastFrame?: number | null
  /**
   * Milliseconds since the FIRST failure of the current streak. Non-finite is treated as zero
   * elapsed — a malformed clock must not spend the whole budget on the first failure.
   */
  deferredForMs: number
}

export type LivenessForceCloseReason =
  | 'in-flight-work-deferred'
  | 'recent-frame-deferred'
  | 'deferral-budget-exhausted'
  | 'no-in-flight-work'

export interface LivenessForceCloseDecision {
  close: boolean
  reason: LivenessForceCloseReason
}

/**
 * Decide whether one liveness-probe failure should force the socket down.
 *
 * - No work in flight                 → close immediately (a dead idle socket
 *                                       buys nothing by waiting).
 * - Recent inbound frame              → keep ('recent-frame-deferred'): the
 *                                       transport provably carried bytes.
 * - Work in flight, inside budget     → keep ('in-flight-work-deferred'); the
 *                                       caller schedules a backed-off re-probe.
 * - Work in flight, budget spent      → close ('deferral-budget-exhausted').
 */
export function decideLivenessForceClose(input: LivenessForceCloseInput): LivenessForceCloseDecision {
  // NaN/Infinity must land on "close", not sneak through a comparison that is false for NaN:
  // a malformed counter is not evidence that work is in flight, and deferring on garbage would
  // keep a genuinely dead socket alive.
  const workingSessionCount = isFiniteNumber(input.workingSessionCount)
    ? Math.max(0, Math.floor(input.workingSessionCount))
    : 0

  if (workingSessionCount <= 0) {
    return { close: true, reason: 'no-in-flight-work' }
  }

  // Positive proof beats every negative inference: bytes arrived, so the socket is not dead.
  // Checked before the budget so a stall that keeps streaming is never torn down for age alone.
  if (isFiniteNumber(input.msSinceLastFrame) && input.msSinceLastFrame < LIVENESS_RECENT_FRAME_MS) {
    return { close: false, reason: 'recent-frame-deferred' }
  }

  const deferredForMs = isFiniteNumber(input.deferredForMs) ? input.deferredForMs : 0

  return deferredForMs >= LIVENESS_MAX_DEFERRAL_MS
    ? { close: true, reason: 'deferral-budget-exhausted' }
    : { close: false, reason: 'in-flight-work-deferred' }
}

/**
 * Delay before the next re-probe, doubling per consecutive failure up to the cap.
 *
 * Exponential rather than fixed because the two things being distinguished live on different
 * scales: a transient event-loop stall resolves in seconds, a long tool call runs for minutes.
 * Polling the second at the first's rate is pure waste on a backend already short of loop time.
 */
export function livenessReprobeDelayMs(consecutiveFailures: number): number {
  // Guarded before delegating: `reconnectBackoffDelayMs(NaN)` returns NaN, and a NaN delay makes
  // `setTimeout` fire immediately — spinning probes at a backend already short of loop time.
  const failures = isFiniteNumber(consecutiveFailures) ? Math.max(1, Math.floor(consecutiveFailures)) : 1

  return reconnectBackoffDelayMs(failures - 1, {
    baseDelayMs: LIVENESS_REPROBE_DELAY_MS,
    capMs: LIVENESS_MAX_REPROBE_DELAY_MS,
    jitter: false
  })
}
