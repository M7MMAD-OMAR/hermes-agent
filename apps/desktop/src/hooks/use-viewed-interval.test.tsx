import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRESENT_CHECK_MS, PRESENT_STALE_MS, resetWindowPresentedForTests } from '@/lib/window-presented'

import { useViewedInterval } from './use-viewed-interval'

let frames: FrameRequestCallback[]
let clock: number

const paint = () => {
  const pending = frames.splice(0)

  for (const callback of pending) {
    callback(clock)
  }
}

const advance = async (ms: number) => {
  clock += ms
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useViewedInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1_000
    frames = []
    resetWindowPresentedForTests()
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)

      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    resetWindowPresentedForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps counting on a window that is painted but not focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000))

    const afterMount = tick.mock.calls.length

    for (let i = 0; i < 3; i++) {
      await advance(1_000)
      act(() => paint())
    }

    expect(tick.mock.calls.length).toBeGreaterThan(afterMount)
  })

  it('parks once the window stops being painted', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000))
    act(() => paint())

    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    const parked = tick.mock.calls.length

    await advance(5_000)

    expect(tick.mock.calls.length).toBe(parked)
  })

  it('catches the label up on the first frame after the window returns', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000))
    act(() => paint())

    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    const parked = tick.mock.calls.length

    act(() => paint())

    expect(tick.mock.calls.length).toBe(parked + 1)
  })

  it('runs nothing while disabled', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000, false))

    await advance(5_000)
    act(() => paint())

    expect(tick).not.toHaveBeenCalled()
  })
})
