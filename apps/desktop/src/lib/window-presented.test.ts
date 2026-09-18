import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isWindowPresented,
  PRESENT_CHECK_MS,
  PRESENT_STALE_MS,
  resetWindowPresentedForTests,
  subscribeWindowPresented
} from './window-presented'

/** Drive rAF by hand: the whole point of the module is what happens when the
 *  compositor stops asking for frames while timers keep running. */
let frameCallbacks: Map<number, FrameRequestCallback>
let nextFrameHandle: number
let clock: number

const paintFrames = () => {
  const pending = [...frameCallbacks.entries()]
  frameCallbacks.clear()

  for (const [, callback] of pending) {
    callback(clock)
  }
}

const advance = async (ms: number) => {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
}

describe('window presentation detector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1_000
    nextFrameHandle = 1
    frameCallbacks = new Map()
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const handle = nextFrameHandle++
      frameCallbacks.set(handle, callback)

      return handle
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      frameCallbacks.delete(handle)
    })
  })

  afterEach(() => {
    resetWindowPresentedForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('answers presented before any frame has had the chance to arrive', () => {
    expect(isWindowPresented()).toBe(true)
  })

  it('stays presented while frames keep arriving', async () => {
    subscribeWindowPresented(() => undefined)

    for (let i = 0; i < 10; i++) {
      await advance(PRESENT_CHECK_MS)
      paintFrames()
    }

    expect(isWindowPresented()).toBe(true)
  })

  it('reports not presented once frames stop while timers keep running', async () => {
    const seen: boolean[] = []
    subscribeWindowPresented(presented => seen.push(presented))

    paintFrames()
    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
    expect(seen).toEqual([false])
  })

  it('recovers on the first frame after the window comes back', async () => {
    const seen: boolean[] = []
    subscribeWindowPresented(presented => seen.push(presented))

    paintFrames()
    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    expect(isWindowPresented()).toBe(false)

    // Coming back re-arms the chain that the stale check left pending.
    paintFrames()
    expect(isWindowPresented()).toBe(true)
    expect(seen).toEqual([false, true])
  })

  it('trusts a hidden document even while frames are still arriving', async () => {
    subscribeWindowPresented(() => undefined)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    paintFrames()
    await advance(PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
  })

  it('does not notify a listener that has unsubscribed', async () => {
    const seen: boolean[] = []
    const unsubscribe = subscribeWindowPresented(presented => seen.push(presented))

    paintFrames()
    unsubscribe()
    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
    expect(seen).toEqual([])
  })
})
