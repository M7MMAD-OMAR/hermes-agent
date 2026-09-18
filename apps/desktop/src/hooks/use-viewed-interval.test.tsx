import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRESENT_CHECK_MS, PRESENT_STALE_MS, resetWindowPresentedForTests } from '@/lib/window-presented'
import { type FakeFrames, installFakeFrames } from '@/test/frames'

import { useViewedInterval } from './use-viewed-interval'

let frames: FakeFrames

const advance = async (ms: number) => {
  await act(async () => {
    await frames.advance(ms)
  })
}

const paint = () => act(() => frames.paint())

describe('useViewedInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    frames = installFakeFrames()
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
      paint()
    }

    expect(tick.mock.calls.length).toBeGreaterThan(afterMount)
  })

  it('parks once the window stops being painted', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000))
    paint()

    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    const parked = tick.mock.calls.length

    await advance(5_000)

    expect(tick.mock.calls.length).toBe(parked)
  })

  it('catches the label up on the first frame after the window returns', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000))
    paint()

    await advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    const parked = tick.mock.calls.length

    paint()

    expect(tick.mock.calls.length).toBe(parked + 1)
  })

  it('runs nothing while disabled', async () => {
    const tick = vi.fn()
    renderHook(() => useViewedInterval(tick, 1_000, false))

    await advance(5_000)
    paint()

    expect(tick).not.toHaveBeenCalled()
  })
})
