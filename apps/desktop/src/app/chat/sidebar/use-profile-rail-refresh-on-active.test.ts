import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetWindowReturnForTests, WINDOW_RETURN_COALESCE_MS } from '@/lib/window-return'

const { refreshActiveProfile } = vi.hoisted(() => ({
  refreshActiveProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/profile', () => ({ refreshActiveProfile }))

import { useProfileRailRefreshOnActive } from './use-profile-rail-refresh-on-active'

// The shared return signal coalesces the raw events and runs after a paint.
async function settleReturn() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WINDOW_RETURN_COALESCE_MS + 1)
    await vi.advanceTimersByTimeAsync(64)
  })
}

describe('useProfileRailRefreshOnActive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 16))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })

  afterEach(() => {
    refreshActiveProfile.mockClear()
    resetWindowReturnForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('refreshes once on mount', () => {
    renderHook(() => useProfileRailRefreshOnActive())

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('refreshes again when the window regains focus', async () => {
    renderHook(() => useProfileRailRefreshOnActive())
    refreshActiveProfile.mockClear()

    window.dispatchEvent(new Event('focus'))
    await settleReturn()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('refreshes when visibilitychange fires while the document is visible', async () => {
    renderHook(() => useProfileRailRefreshOnActive())
    refreshActiveProfile.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await settleReturn()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('collapses focus and visibilitychange of one return into a single refresh', async () => {
    renderHook(() => useProfileRailRefreshOnActive())
    refreshActiveProfile.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    await settleReturn()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('does NOT refresh when visibilitychange fires while the document is hidden', async () => {
    // Backgrounding/tab-switching away must not trigger a redundant refresh
    // -- only becoming visible/focused again should.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    renderHook(() => useProfileRailRefreshOnActive())
    refreshActiveProfile.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await settleReturn()

    expect(refreshActiveProfile).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount, so a later return does not refresh', async () => {
    const { unmount } = renderHook(() => useProfileRailRefreshOnActive())
    refreshActiveProfile.mockClear()
    unmount()

    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settleReturn()

    expect(refreshActiveProfile).not.toHaveBeenCalled()
  })
})
