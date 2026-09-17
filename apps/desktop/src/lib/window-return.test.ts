import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
