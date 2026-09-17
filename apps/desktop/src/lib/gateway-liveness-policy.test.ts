import { describe, expect, it } from 'vitest'

import {
  decideLivenessForceClose,
  LIVENESS_MAX_DEFERRAL_MS,
  LIVENESS_MAX_REPROBE_DELAY_MS,
  LIVENESS_RECENT_FRAME_MS,
  LIVENESS_REPROBE_DELAY_MS,
  livenessReprobeDelayMs
} from './gateway-liveness-policy'

describe('decideLivenessForceClose', () => {
  // The regression this file exists for (#95327): a long silent tool call starves the backend's
  // event loop past the probe budget, the renderer tears the socket down, the gateway's orphan
  // reap fires, and the running turn dies as a bare "Operation interrupted.".

  it('keeps the socket on the first timeout while a turn is in flight', () => {
    const decision = decideLivenessForceClose({ deferredForMs: 0, workingSessionCount: 1 })

    expect(decision).toEqual({ close: false, reason: 'in-flight-work-deferred' })
  })

  it('defers for every busy session count, not just one', () => {
    for (const workingSessionCount of [1, 2, 7]) {
      expect(decideLivenessForceClose({ deferredForMs: 0, workingSessionCount })).toEqual({
        close: false,
        reason: 'in-flight-work-deferred'
      })
    }
  })

  it('closes immediately with no work in flight (legacy shape unchanged)', () => {
    const decision = decideLivenessForceClose({ deferredForMs: 0, workingSessionCount: 0 })

    expect(decision).toEqual({ close: true, reason: 'no-in-flight-work' })
  })

  it('an idle socket closes on the first failure even with a fresh frame', () => {
    // Nothing is riding it, so there is nothing to protect and a half-open socket would only
    // swallow the next submit.
    const decision = decideLivenessForceClose({
      deferredForMs: 0,
      msSinceLastFrame: 10,
      workingSessionCount: 0
    })

    expect(decision).toEqual({ close: true, reason: 'no-in-flight-work' })
  })

  it('coerces a malformed session count defensively instead of throwing', () => {
    // A malformed counter is not evidence that work is in flight; fail closed.
    expect(decideLivenessForceClose({ deferredForMs: 0, workingSessionCount: Number.NaN })).toEqual({
      close: true,
      reason: 'no-in-flight-work'
    })
    expect(decideLivenessForceClose({ deferredForMs: 0, workingSessionCount: -3 })).toEqual({
      close: true,
      reason: 'no-in-flight-work'
    })
  })
})

describe('decideLivenessForceClose timing signals', () => {
  it('defers outright when a frame arrived recently, whatever the budget says', () => {
    // Positive proof beats every negative inference: bytes moved, so the transport is alive.
    const decision = decideLivenessForceClose({
      deferredForMs: LIVENESS_MAX_DEFERRAL_MS * 10,
      msSinceLastFrame: 1_000,
      workingSessionCount: 1
    })

    expect(decision).toEqual({ close: false, reason: 'recent-frame-deferred' })
  })

  it('stops crediting a frame once it is stale', () => {
    const decision = decideLivenessForceClose({
      deferredForMs: 0,
      msSinceLastFrame: LIVENESS_RECENT_FRAME_MS + 1,
      workingSessionCount: 1
    })

    expect(decision).toEqual({ close: false, reason: 'in-flight-work-deferred' })
  })

  it('defers well past the old two-probe streak while the budget holds', () => {
    // 30 seconds in, the legacy policy had long since closed and killed the turn.
    const decision = decideLivenessForceClose({
      deferredForMs: 30_000,
      msSinceLastFrame: null,
      workingSessionCount: 1
    })

    expect(decision).toEqual({ close: false, reason: 'in-flight-work-deferred' })
  })

  it('still closes a socket that has been silent for the whole budget', () => {
    const decision = decideLivenessForceClose({
      deferredForMs: LIVENESS_MAX_DEFERRAL_MS,
      msSinceLastFrame: null,
      workingSessionCount: 1
    })

    expect(decision).toEqual({ close: true, reason: 'deferral-budget-exhausted' })
  })

  it('treats a non-finite elapsed time as no time spent rather than as the whole budget', () => {
    // A malformed clock must not tear down a live turn on its first failure.
    for (const bogus of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        decideLivenessForceClose({ deferredForMs: bogus, msSinceLastFrame: null, workingSessionCount: 1 })
      ).toEqual({ close: false, reason: 'in-flight-work-deferred' })
    }
  })

  it('ignores a non-finite frame age rather than trusting it', () => {
    expect(
      decideLivenessForceClose({ deferredForMs: 0, msSinceLastFrame: Number.NaN, workingSessionCount: 1 })
    ).toEqual({ close: false, reason: 'in-flight-work-deferred' })
  })
})

describe('livenessReprobeDelayMs', () => {
  it('starts at the base delay and doubles', () => {
    expect(livenessReprobeDelayMs(1)).toBe(LIVENESS_REPROBE_DELAY_MS)
    expect(livenessReprobeDelayMs(2)).toBe(LIVENESS_REPROBE_DELAY_MS * 2)
    expect(livenessReprobeDelayMs(3)).toBe(LIVENESS_REPROBE_DELAY_MS * 4)
  })

  it('caps so a long stall is still checked periodically', () => {
    expect(livenessReprobeDelayMs(50)).toBe(LIVENESS_MAX_REPROBE_DELAY_MS)
  })

  it('never returns a non-positive delay for garbage input', () => {
    // A zero or NaN delay makes setTimeout fire immediately, spinning probes at a backend
    // that already has no loop time to answer them.
    for (const failures of [0, -5, Number.NaN]) {
      expect(livenessReprobeDelayMs(failures)).toBeGreaterThan(0)
    }
  })

  it('reaches the cap well inside the deferral budget, so the budget is what ends it', () => {
    // Otherwise the backoff, not the policy, would decide when a dead socket is rebuilt.
    let elapsed = 0
    let probes = 0

    while (elapsed < LIVENESS_MAX_DEFERRAL_MS && probes < 100) {
      probes += 1
      elapsed += livenessReprobeDelayMs(probes)
    }

    expect(elapsed).toBeGreaterThanOrEqual(LIVENESS_MAX_DEFERRAL_MS)
    expect(probes).toBeLessThan(12)
  })
})
