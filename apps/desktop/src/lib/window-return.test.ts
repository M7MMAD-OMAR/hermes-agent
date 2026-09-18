import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeFrames } from '@/test/frames'

import { PRESENT_CHECK_MS, PRESENT_STALE_MS, resetWindowPresentedForTests } from './window-presented'
import {
  resetWindowReturnForTests,
  subscribeWindowReturn,
  WINDOW_RETURN_COALESCE_MS,
  windowReturnCount
} from './window-return'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

// Two frames + a task, the way afterPaint schedules deferred listeners.
async function settleReturn() {
  await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)
  await vi.advanceTimersByTimeAsync(64)
}

function comeBack() {
  setVisibility('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 16))
  setVisibility('visible')
})

afterEach(() => {
  resetWindowReturnForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('subscribeWindowReturn', () => {
  it('collapses focus and visibilitychange into one callback per return', async () => {
    const handler = vi.fn()
    subscribeWindowReturn(handler)

    comeBack()
    await settleReturn()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(windowReturnCount()).toBe(1)
  })

  it('runs deferred listeners after the coalesce window, not on the raw event', async () => {
    const handler = vi.fn()
    subscribeWindowReturn(handler)

    window.dispatchEvent(new Event('focus'))
    expect(handler).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS - 1)
    expect(handler).not.toHaveBeenCalled()

    await settleReturn()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('runs immediate listeners as soon as the return is dispatched', async () => {
    const immediate = vi.fn()
    const deferred = vi.fn()
    subscribeWindowReturn(immediate, { immediate: true })
    subscribeWindowReturn(deferred)

    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)

    expect(immediate).toHaveBeenCalledTimes(1)
    expect(deferred).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(64)
    expect(deferred).toHaveBeenCalledTimes(1)
  })

  it('ignores returns while the document is hidden', async () => {
    const handler = vi.fn()
    subscribeWindowReturn(handler)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await settleReturn()

    expect(handler).not.toHaveBeenCalled()

    comeBack()
    await settleReturn()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('skips a listener whose minIntervalMs has not elapsed, without starving the others', async () => {
    const stale = vi.fn()
    const eager = vi.fn()
    subscribeWindowReturn(stale, { minIntervalMs: 10_000 })
    subscribeWindowReturn(eager)

    comeBack()
    await settleReturn()
    comeBack()
    await settleReturn()

    expect(stale).toHaveBeenCalledTimes(1)
    expect(eager).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(10_000)
    comeBack()
    await settleReturn()

    expect(stale).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes cleanly and detaches the document listeners with the last subscriber', async () => {
    const handler = vi.fn()
    const off = subscribeWindowReturn(handler)
    off()

    comeBack()
    await settleReturn()

    expect(handler).not.toHaveBeenCalled()
    expect(windowReturnCount()).toBe(0)
  })

  it('keeps the other listeners running when one throws', async () => {
    const boom = vi.fn(() => {
      throw new Error('boom')
    })

    const fine = vi.fn()
    subscribeWindowReturn(boom)
    subscribeWindowReturn(fine)

    comeBack()
    await settleReturn()

    expect(boom).toHaveBeenCalledTimes(1)
    expect(fine).toHaveBeenCalledTimes(1)
  })
})

describe('a compositor that says nothing at all', () => {
  it('treats the first frame back as a return', async () => {
    // Wayland: leaving a workspace changes no visibility state and the reveal
    // need not focus the window, so neither raw event fires. Every listener
    // here would otherwise still be showing what was on screen before the user
    // left. See lib/window-presented.
    resetWindowPresentedForTests()
    const frames = installFakeFrames()
    const handler = vi.fn()
    subscribeWindowReturn(handler, { immediate: true })

    frames.paint()
    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    expect(handler).not.toHaveBeenCalled()

    // Back on screen: a frame, and nothing else.
    frames.paint()
    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)

    expect(handler).toHaveBeenCalledTimes(1)
    resetWindowPresentedForTests()
  })
})

describe('the presentation backstop', () => {
  it('stays quiet when the platform already reported the return', async () => {
    // sway focuses the window on a workspace switch, so the frame lands after
    // a return this module has already dispatched. Counting it again is the
    // duplicate-refresh burst the coalescing exists to prevent.
    resetWindowPresentedForTests()
    const frames = installFakeFrames()
    const handler = vi.fn()
    subscribeWindowReturn(handler, { immediate: true })

    frames.paint()
    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)

    comeBack()
    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)
    expect(handler).toHaveBeenCalledTimes(1)

    // The probe's frame arrives a cycle later, inside the grace window.
    frames.paint()
    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)

    expect(handler).toHaveBeenCalledTimes(1)
    resetWindowPresentedForTests()
  })
})
