import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notifySessionsChanged } from '@/store/live-sync'

import { useEnteredProjectRefresh } from './use-entered-project-refresh'

// The entered project's snapshot is fetched once per entry; the render-time
// overlay only refreshes rows that are also on the flat `$sessions` page. These
// tests pin the missing half: the snapshot re-hydrates when the backend
// broadcasts sessions.changed — throttled, trailing-edge, and silent once the
// user leaves the project.

describe('useEnteredProjectRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-fetches when a sessions.changed tick lands', () => {
    const refresh = vi.fn()
    renderHook(() => useEnteredProjectRefresh('p_zero', true, refresh))

    // Mounting alone does not fetch — the entry effect owns the first load.
    expect(refresh).not.toHaveBeenCalled()

    act(() => {
      notifySessionsChanged()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('p_zero')
  })

  it('coalesces a streaming-turn burst to one trailing fetch per gap', () => {
    // sessions.changed is floored to 2s server-side and fires on every
    // state.db write during a turn; the heavy per-project scan must run at
    // most once per gap, with the burst's last write landing.
    const refresh = vi.fn()
    renderHook(() => useEnteredProjectRefresh('p_zero', true, refresh))

    act(() => {
      notifySessionsChanged()
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(2_000)
      notifySessionsChanged()
    })
    act(() => {
      vi.advanceTimersByTime(2_000)
      notifySessionsChanged()
    })

    // Inside the gap: coalesced, not run yet.
    expect(refresh).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    // The trailing timer fired exactly once when the gap closed.
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('stays silent after unmount — listener gone AND pending trailing timer cancelled', () => {
    const refresh = vi.fn()
    const { unmount } = renderHook(() => useEnteredProjectRefresh('p_zero', true, refresh))

    act(() => {
      notifySessionsChanged()
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(2_000)
      notifySessionsChanged() // arms the trailing timer
    })
    unmount()

    act(() => {
      vi.advanceTimersByTime(20_000)
      notifySessionsChanged()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('follows the entered project: a tick after a switch fetches the new id', () => {
    const refresh = vi.fn()

    const { rerender } = renderHook(
      ({ projectId }) => useEnteredProjectRefresh(projectId, true, refresh),
      { initialProps: { projectId: 'p_zero' as null | string } }
    )

    act(() => {
      notifySessionsChanged()
    })
    expect(refresh).toHaveBeenCalledWith('p_zero')

    rerender({ projectId: 'p_other' })

    act(() => {
      vi.advanceTimersByTime(20_000)
      notifySessionsChanged()
    })

    expect(refresh).toHaveBeenLastCalledWith('p_other')
  })

  it('does nothing while disabled, and picks up once enabled', () => {
    const refresh = vi.fn()

    const { rerender } = renderHook(
      ({ enabled }) => useEnteredProjectRefresh('p_zero', enabled, refresh),
      { initialProps: { enabled: false } }
    )

    act(() => {
      notifySessionsChanged()
      vi.advanceTimersByTime(30_000)
      notifySessionsChanged()
    })

    expect(refresh).not.toHaveBeenCalled()

    rerender({ enabled: true })

    act(() => {
      notifySessionsChanged()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('p_zero')
  })
})
