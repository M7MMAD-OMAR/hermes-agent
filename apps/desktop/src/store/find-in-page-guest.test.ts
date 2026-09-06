/**
 * Which surface Cmd+F searches.
 *
 * The embedded browser's page lives in a <webview> guest: the renderer-side
 * walker the chat uses cannot see into it, and Electron's window-level
 * findInPage searches the host document instead. So a search started with the
 * browser focused has to be handed to Chromium inside that guest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const focusedPreviewTabId = vi.fn<() => null | string>(() => null)
const captureFindScope = vi.fn()
const releaseFindScope = vi.fn()
const performScopedFind = vi.fn(() => ({ activeOrdinal: 0, count: 0 }))
const currentFindScope = vi.fn<() => unknown>(() => null)

vi.mock('@/app/chat/right-rail/preview-nav', () => ({ focusedPreviewTabId }))
vi.mock('@/lib/find-in-page-scope', () => ({
  captureFindScope,
  currentFindScope,
  performScopedFind,
  releaseFindScope
}))

const { registerPreviewFind, resetPreviewFindForTest } = await import('@/app/chat/right-rail/preview-find')

const { $findInPage, closeFindBar, findInPageIsSearchingGuest, findNext, openFindBar, setFindQuery } = await import(
  './find-in-page'
)

function guest(matches: number, activeMatchOrdinal = 1) {
  const listeners = new Set<(event: { result?: Record<string, unknown> }) => void>()
  const stops: string[] = []
  const calls: { findNext?: boolean; forward?: boolean }[] = []

  return {
    calls,
    stops,
    target: {
      addEventListener: (_t: string, l: (event: { result?: Record<string, unknown> }) => void) => void listeners.add(l),
      findInPage: (_text: string, options?: { findNext?: boolean; forward?: boolean }) => {
        calls.push(options ?? {})

        for (const l of [...listeners]) {
          l({ result: { activeMatchOrdinal, finalUpdate: true, matches } })
        }

        return 1
      },
      removeEventListener: (_t: string, l: (event: { result?: Record<string, unknown> }) => void) =>
        void listeners.delete(l),
      stopFindInPage: (action: string) => void stops.push(action)
    }
  }
}

beforeEach(() => {
  closeFindBar()
  resetPreviewFindForTest()
  vi.clearAllMocks()
  focusedPreviewTabId.mockReturnValue(null)
  currentFindScope.mockReturnValue(null)
})

describe('with the embedded browser focused', () => {
  it('searches the web page and reports Chromium\'s counts', async () => {
    const browser = guest(7, 3)
    registerPreviewFind('tab-a', browser.target)
    focusedPreviewTabId.mockReturnValue('tab-a')

    openFindBar()
    expect(findInPageIsSearchingGuest()).toBe(true)
    // The chat walker must not also claim the search.
    expect(captureFindScope).not.toHaveBeenCalled()

    await setFindQuery('khadamat')

    expect($findInPage.get()).toMatchObject({ matchCount: 7, matchOrdinal: 3, query: 'khadamat' })
    expect(performScopedFind).not.toHaveBeenCalled()
  })

  it('steps through matches inside the page', async () => {
    const browser = guest(7, 4)
    registerPreviewFind('tab-a', browser.target)
    focusedPreviewTabId.mockReturnValue('tab-a')

    openFindBar()
    await setFindQuery('khadamat')
    findNext()
    await vi.waitFor(() => expect(browser.calls).toHaveLength(2))

    expect(browser.calls[1]).toEqual({ findNext: true, forward: true })
  })

  it('clears the page highlights when the bar closes', async () => {
    const browser = guest(2)
    registerPreviewFind('tab-a', browser.target)
    focusedPreviewTabId.mockReturnValue('tab-a')

    openFindBar()
    await setFindQuery('khadamat')
    closeFindBar()

    expect(browser.stops).toContain('clearSelection')
    expect(findInPageIsSearchingGuest()).toBe(false)
    // A chat search never started, so its scope must not be released either.
    expect(releaseFindScope).not.toHaveBeenCalled()
  })

  it('a late answer never repaints a bar the user already closed', async () => {
    const browser = guest(9)
    registerPreviewFind('tab-a', browser.target)
    focusedPreviewTabId.mockReturnValue('tab-a')

    openFindBar()
    const pending = setFindQuery('khadamat')
    closeFindBar()
    await pending

    expect($findInPage.get().matchCount).toBe(0)
  })
})

describe('with the chat focused', () => {
  it('leaves the existing chat search untouched', async () => {
    registerPreviewFind('tab-a', guest(7).target)
    focusedPreviewTabId.mockReturnValue(null) // focus is not in the browser
    currentFindScope.mockReturnValue({})
    performScopedFind.mockReturnValue({ activeOrdinal: 1, count: 4 })

    openFindBar()
    expect(findInPageIsSearchingGuest()).toBe(false)
    expect(captureFindScope).toHaveBeenCalled()

    await setFindQuery('khadamat')

    expect(performScopedFind).toHaveBeenCalled()
    expect($findInPage.get()).toMatchObject({ matchCount: 4, matchOrdinal: 1 })

    closeFindBar()
    expect(releaseFindScope).toHaveBeenCalled()
  })

  it('a browser pane that is open but NOT focused does not capture the search', () => {
    registerPreviewFind('tab-a', guest(7).target)
    focusedPreviewTabId.mockReturnValue(null)

    openFindBar()

    expect(findInPageIsSearchingGuest()).toBe(false)
  })
})
