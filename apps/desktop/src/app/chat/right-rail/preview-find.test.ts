import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPreviewSearch,
  type FoundInPageEvent,
  type PreviewFindTarget,
  previewFindTarget,
  registerPreviewFind,
  resetPreviewFindForTest,
  searchPreview
} from './preview-find'

/** A stand-in for Electron's <webview>: findInPage answers later, on the event. */
function fakeGuest(script: { activeMatchOrdinal: number; finalUpdate?: boolean; matches: number }[]) {
  const listeners = new Set<(event: FoundInPageEvent) => void>()
  const calls: { text: string; options?: { forward?: boolean; findNext?: boolean } }[] = []
  let stopped: string | null = null

  const target: PreviewFindTarget = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    findInPage: (text, options) => {
      calls.push({ options, text })

      // Chromium emits several results per query as it walks the document.
      for (const result of script) {
        for (const listener of [...listeners]) {
          listener({ result })
        }
      }

      return 1
    },
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    stopFindInPage: action => {
      stopped = action
    }
  }

  return { calls, listenerCount: () => listeners.size, stopped: () => stopped, target }
}

beforeEach(() => {
  resetPreviewFindForTest()
})

describe('the registry', () => {
  it('answers for the tab that registered, and forgets it on release', () => {
    const { target } = fakeGuest([])
    const release = registerPreviewFind('tab-a', target)

    expect(previewFindTarget('tab-a')).toBe(target)
    expect(previewFindTarget('tab-b')).toBeNull()
    expect(previewFindTarget(null)).toBeNull()

    release()
    expect(previewFindTarget('tab-a')).toBeNull()
  })

  it('a stale release cannot unregister the tab\'s current guest', () => {
    const first = fakeGuest([])
    const second = fakeGuest([])
    const releaseFirst = registerPreviewFind('tab-a', first.target)

    registerPreviewFind('tab-a', second.target)
    releaseFirst()

    expect(previewFindTarget('tab-a')).toBe(second.target)
  })
})

describe('searching a guest', () => {
  it('resolves with the FINAL count, not the first partial one', async () => {
    // Resolving on the first event reported a count that then kept changing
    // under the user as Chromium finished walking the page.
    const guest = fakeGuest([
      { activeMatchOrdinal: 1, matches: 2 },
      { activeMatchOrdinal: 1, finalUpdate: true, matches: 7 }
    ])

    const result = await searchPreview(guest.target, 'khadamat')

    expect(result).toEqual({ activeOrdinal: 1, count: 7 })
    expect(guest.calls).toEqual([{ options: { findNext: false, forward: true }, text: 'khadamat' }])
  })

  it('unsubscribes so repeated searches cannot stack listeners', async () => {
    const guest = fakeGuest([{ activeMatchOrdinal: 1, finalUpdate: true, matches: 1 }])

    await searchPreview(guest.target, 'one')
    await searchPreview(guest.target, 'two')

    expect(guest.listenerCount()).toBe(0)
  })

  it('carries the step direction through to the guest', async () => {
    const guest = fakeGuest([{ activeMatchOrdinal: 3, finalUpdate: true, matches: 7 }])

    await searchPreview(guest.target, 'khadamat', { findNext: true, forward: false })

    expect(guest.calls[0]?.options).toEqual({ findNext: true, forward: false })
  })

  it('stops the search instead of asking Chromium to match an empty string', async () => {
    const guest = fakeGuest([])

    const result = await searchPreview(guest.target, '')

    expect(result).toEqual({ activeOrdinal: 0, count: 0 })
    expect(guest.calls).toEqual([])
    expect(guest.stopped()).toBe('clearSelection')
  })

  it('falls back to the last partial result when no final update arrives', async () => {
    vi.useFakeTimers()

    try {
      const guest = fakeGuest([{ activeMatchOrdinal: 2, matches: 4 }])
      const pending = searchPreview(guest.target, 'khadamat', {}, 1_000)

      await vi.advanceTimersByTimeAsync(1_000)

      expect(await pending).toEqual({ activeOrdinal: 2, count: 4 })
      expect(guest.listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports no matches rather than throwing into the keystroke handler', async () => {
    const target: PreviewFindTarget = {
      addEventListener: () => undefined,
      findInPage: () => {
        throw new Error('guest was torn down')
      },
      removeEventListener: () => undefined,
      stopFindInPage: () => undefined
    }

    expect(await searchPreview(target, 'khadamat')).toEqual({ activeOrdinal: 0, count: 0 })
  })

  it('clearing a torn-down guest is a no-op', () => {
    expect(() =>
      clearPreviewSearch({
        addEventListener: () => undefined,
        findInPage: () => 0,
        removeEventListener: () => undefined,
        stopFindInPage: () => {
          throw new Error('gone')
        }
      })
    ).not.toThrow()
  })
})
