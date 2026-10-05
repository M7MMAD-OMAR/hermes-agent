import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  $contextBreakdownBySession,
  _resetContextBreakdownForTests,
  contextBreakdownFor,
  refreshContextBreakdown
} from './context-breakdown'

const breakdown = {
  categories: [],
  context_max: 200_000,
  context_percent: 6,
  context_used: 12_000,
  estimated_total: 12_000
}

afterEach(() => {
  _resetContextBreakdownForTests()
  vi.restoreAllMocks()
})

describe('refreshContextBreakdown', () => {
  it('collapses concurrent callers onto one backend call', async () => {
    // Every surface showing the gauge wants the same session's breakdown at the
    // same moment (turn end). One RPC, not one each.
    const request = vi.fn().mockResolvedValue(breakdown)

    await Promise.all([
      refreshContextBreakdown('s1', request),
      refreshContextBreakdown('s1', request),
      refreshContextBreakdown('s1', request)
    ])

    expect(request).toHaveBeenCalledTimes(1)
    expect(contextBreakdownFor('s1').breakdown).toEqual(breakdown)
  })

  it('keeps sessions apart', async () => {
    const request = vi
      .fn()
      .mockImplementation((_method, params) =>
        Promise.resolve({ ...breakdown, context_used: params.session_id === 's1' ? 1 : 2 })
      )

    await Promise.all([refreshContextBreakdown('s1', request), refreshContextBreakdown('s2', request)])

    expect(contextBreakdownFor('s1').breakdown?.context_used).toBe(1)
    expect(contextBreakdownFor('s2').breakdown?.context_used).toBe(2)
  })

  it('holds the previous numbers when a refresh fails', async () => {
    await refreshContextBreakdown('s1', vi.fn().mockResolvedValue(breakdown))
    await refreshContextBreakdown('s1', vi.fn().mockRejectedValue(new Error('socket closed')))

    expect(contextBreakdownFor('s1').breakdown).toEqual(breakdown)
    expect(contextBreakdownFor('s1').loading).toBe(false)
  })

  it('releases the in-flight slot so a later turn can refetch', async () => {
    const request = vi.fn().mockResolvedValue(breakdown)

    await refreshContextBreakdown('s1', request)
    await refreshContextBreakdown('s1', request)

    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not cache a zeroed breakdown and reports it as untrusted', async () => {
    const zeroed = { ...breakdown, context_max: 0 }

    await expect(refreshContextBreakdown('s1', vi.fn().mockResolvedValue(zeroed))).resolves.toBe(false)
    expect(contextBreakdownFor('s1').breakdown).toBeNull()
  })

  it('lets a forced refresh supersede a request already in flight', async () => {
    let resolveStale: (value: typeof breakdown) => void = () => undefined
    const stale = vi.fn().mockReturnValue(new Promise<typeof breakdown>(resolve => (resolveStale = resolve)))
    const fresh = vi.fn().mockResolvedValue({ ...breakdown, context_used: 7 })

    const first = refreshContextBreakdown('s1', stale)
    await refreshContextBreakdown('s1', fresh, { force: true })
    resolveStale({ ...breakdown, context_used: 999 })
    await first

    expect(contextBreakdownFor('s1').breakdown?.context_used).toBe(7)
  })

  it('reports nothing for a session it has never seen', () => {
    expect(contextBreakdownFor(null)).toEqual({ breakdown: null, loading: false })
    expect($contextBreakdownBySession.get()).toEqual({})
  })
})
