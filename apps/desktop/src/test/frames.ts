// jsdom has no compositor, so nothing ever asks for a frame. Code that treats
// frame ARRIVAL as a signal (lib/window-presented, lib/budgeted-loop, and the
// stream's deferred-commit measurement) therefore has to be driven by hand:
// the test decides when a frame lands and when the clock moves, which is the
// only way to write "the window left the screen" as a test at all.

import { vi } from 'vitest'

export interface FakeFrames {
  /** Frames requested and not yet run or cancelled. */
  pending: () => number
  /** Run every pending frame callback with the current clock value. */
  paint: () => void
  /** Move the clock WITHOUT painting: a window whose surface is not being
   *  presented, where timers keep their cadence and frames never arrive. */
  advance: (ms: number) => Promise<void>
  /** Move the clock and paint, at roughly display cadence: a window on screen. */
  advancePainting: (ms: number) => Promise<void>
  /** The current fake `performance.now()`. */
  clock: () => number
}

/**
 * Install a hand-driven `requestAnimationFrame` plus a fake `performance.now`.
 * Requires `vi.useFakeTimers()`; restore with `vi.restoreAllMocks()` as usual.
 *
 * Cancellation is honored, which matters: a leak that shows up as an ever
 * growing pending count is invisible to a stub that ignores
 * `cancelAnimationFrame`.
 */
export function installFakeFrames({ startAt = 1_000 }: { startAt?: number } = {}): FakeFrames {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextHandle = 1
  let clock = startAt

  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const handle = nextHandle++
    callbacks.set(handle, callback)

    return handle
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
    callbacks.delete(handle)
  })

  const paint = () => {
    const due = [...callbacks.values()]
    callbacks.clear()

    for (const callback of due) {
      callback(clock)
    }
  }

  const advance = async (ms: number) => {
    clock += ms
    await vi.advanceTimersByTimeAsync(ms)
  }

  return {
    clock: () => clock,
    pending: () => callbacks.size,
    paint,
    advance,
    advancePainting: async (ms: number) => {
      const step = 16

      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        await advance(Math.min(step, ms - elapsed))
        paint()
      }
    }
  }
}
