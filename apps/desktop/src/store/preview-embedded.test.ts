import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $rightRailActiveTabId, selectRightRailTab } from './layout'
import {
  $browserSessionId,
  $dockedPreviewTabs,
  $embeddedBrowserExpanded,
  $embeddedBrowserHosts,
  $embeddedBrowserSessions,
  $poppedBrowserTabIds,
  $previewTabs,
  adoptDraftBrowserSession,
  closeBrowserTabsForSession,
  closeRightRail,
  closeRightRailTab,
  DRAFT_BROWSER_SESSION_ID,
  markBrowserTabPopped,
  newBrowserTab,
  openPreview,
  type PreviewTab,
  type PreviewTarget,
  registerEmbeddedBrowserHost,
  setEmbeddedBrowserSession,
  toggleEmbeddedBrowser
} from './preview'

function fileTarget(source: string): PreviewTarget {
  return { kind: 'file', label: source, path: source, previewKind: 'html', source, url: `file://${source}` }
}

function urlTarget(source: string): PreviewTarget {
  return { kind: 'url', label: source, source, url: source }
}

const browserTabs = (tabs: PreviewTab[]) => tabs.filter(tab => tab.target.kind === 'url')

describe('embedded browser store', () => {
  beforeEach(() => {
    $previewTabs.set([])
    $poppedBrowserTabIds.set(new Set())
    $embeddedBrowserSessions.set(new Set())
    $embeddedBrowserExpanded.set(new Set())
    $browserSessionId.set(null)
    $embeddedBrowserHosts.set(new Set())
    closeRightRail()
    window.localStorage.clear()
  })

  afterEach(() => {
    $previewTabs.set([])
    $poppedBrowserTabIds.set(new Set())
    $embeddedBrowserSessions.set(new Set())
    $embeddedBrowserExpanded.set(new Set())
    $browserSessionId.set(null)
    $embeddedBrowserHosts.set(new Set())
    closeRightRail()
    window.localStorage.clear()
  })

  // The panel registers itself as a host for as long as it is in the tree, and
  // it is in the tree for every chat surface. Toggling a session with NO host
  // is the black-hole case and has its own test below, so every other case has
  // to stand one up first.
  const withHost = (sessionId: string) => registerEmbeddedBrowserHost(sessionId)

  // CONTRACT CHANGE (2026-09-02). This used to assert `toggleEmbeddedBrowser(null)`
  // does nothing — which is precisely the reported bug: a NEW chat has no runtime
  // id until its first turn, so the globe was inert on every empty conversation.
  // A draft is a conversation; it just does not have its id yet.
  it('opens the DRAFT conversation browser when there is no runtime id yet', () => {
    withHost(DRAFT_BROWSER_SESSION_ID)
    toggleEmbeddedBrowser(null)

    expect($embeddedBrowserSessions.get().has(DRAFT_BROWSER_SESSION_ID)).toBe(true)
    expect($embeddedBrowserExpanded.get().has(DRAFT_BROWSER_SESSION_ID)).toBe(true)
    expect(browserTabs($previewTabs.get())).toHaveLength(1)
    expect($previewTabs.get()[0].owner).toBe(DRAFT_BROWSER_SESSION_ID)
  })

  it('hands the draft browser to the real session without closing the tab', () => {
    withHost(DRAFT_BROWSER_SESSION_ID)
    toggleEmbeddedBrowser(null)

    const before = $previewTabs.get()[0].id

    adoptDraftBrowserSession('runtime-9')

    // Same tab id: the pane and the live page inside it survive the handover.
    // Closing and reopening here would destroy the page the user just loaded.
    expect($previewTabs.get()[0].id).toBe(before)
    expect($previewTabs.get()[0].owner).toBe('runtime-9')
    expect($embeddedBrowserSessions.get().has('runtime-9')).toBe(true)
    expect($embeddedBrowserSessions.get().has(DRAFT_BROWSER_SESSION_ID)).toBe(false)
    expect($embeddedBrowserExpanded.get().has('runtime-9')).toBe(true)
  })

  it('carries a PARKED draft browser over as parked, not re-expanded', () => {
    withHost(DRAFT_BROWSER_SESSION_ID)
    toggleEmbeddedBrowser(null)
    toggleEmbeddedBrowser(null) // park it

    expect($embeddedBrowserExpanded.get().has(DRAFT_BROWSER_SESSION_ID)).toBe(false)

    adoptDraftBrowserSession('runtime-9')

    expect($embeddedBrowserSessions.get().has('runtime-9')).toBe(true)
    expect($embeddedBrowserExpanded.get().has('runtime-9')).toBe(false)
  })

  // The BLACK HOLE this guard exists to prevent: a tab minted for a session
  // whose surface renders no panel is dropped from the strip (the focused
  // conversation's tabs are hidden there on purpose) and hosted nowhere — it
  // exists and is invisible. Falling back to the strip keeps the page reachable.
  it('falls back to the strip when the conversation has no panel to host a page', () => {
    toggleEmbeddedBrowser('sess-no-panel')

    expect($embeddedBrowserSessions.get().has('sess-no-panel')).toBe(false)

    const tabs = browserTabs($previewTabs.get())

    expect(tabs).toHaveLength(1)
    expect($dockedPreviewTabs.get().map(tab => tab.id)).toEqual([tabs[0].id])
  })

  it('adoption is a no-op when the draft never opened a browser', () => {
    adoptDraftBrowserSession('runtime-9')

    expect($embeddedBrowserSessions.get().size).toBe(0)
    expect($previewTabs.get()).toHaveLength(0)
  })

  it('first toggle mounts, expands, and mints this conversation a browser tab', () => {
    withHost('sess-1')
    toggleEmbeddedBrowser('sess-1')

    expect($embeddedBrowserSessions.get().has('sess-1')).toBe(true)
    expect($embeddedBrowserExpanded.get().has('sess-1')).toBe(true)

    const tabs = browserTabs($previewTabs.get())

    expect(tabs).toHaveLength(1)
    expect(tabs[0].owner).toBe('sess-1')
    expect($rightRailActiveTabId.get()).toBe(tabs[0].id)
  })

  it('collapses without unmounting, and re-expands — the tab never moves', () => {
    withHost('sess-1')
    toggleEmbeddedBrowser('sess-1')
    const tabId = browserTabs($previewTabs.get())[0].id

    toggleEmbeddedBrowser('sess-1') // park
    expect($embeddedBrowserExpanded.get().has('sess-1')).toBe(false)
    expect($embeddedBrowserSessions.get().has('sess-1')).toBe(true)
    expect($previewTabs.get().map(tab => tab.id)).toEqual([tabId])

    toggleEmbeddedBrowser('sess-1') // bring back
    expect($embeddedBrowserExpanded.get().has('sess-1')).toBe(true)
    expect($previewTabs.get().map(tab => tab.id)).toEqual([tabId])
  })

  it('drops the focused conversation’s embedded browser tabs from the strip, and only theirs', () => {
    openPreview(urlTarget('https://example.com/shared'), 'manual') // unowned
    openPreview(fileTarget('/work/demo.html')) // file peek
    newBrowserTab('sess-1')
    newBrowserTab('sess-2')

    // Not embedded yet: everything is docked.
    expect($dockedPreviewTabs.get()).toHaveLength(4)

    setEmbeddedBrowserSession('sess-1', true)
    // While sess-1 is NOT the conversation on screen, its tabs stay docked
    // (the strip keeps the panes alive for its agent).
    expect($dockedPreviewTabs.get()).toHaveLength(4)

    // sess-1 comes on screen: ITS browser tabs move into the embedded panel…
    $browserSessionId.set('sess-1')
    const docked = $dockedPreviewTabs.get()

    const sess1Tabs = browserTabs($previewTabs.get())
      .filter(tab => tab.owner === 'sess-1')
      .map(tab => tab.id)

    expect(sess1Tabs.length).toBeGreaterThan(0)
    expect(docked.map(tab => tab.id)).toEqual(expect.not.arrayContaining(sess1Tabs))
    // …while the shared page, the file peek, and the OTHER conversation's
    // browser stay in the strip.
    expect(docked.some(tab => tab.target.kind === 'file')).toBe(true)
    expect(docked.some(tab => tab.target.url === 'https://example.com/shared')).toBe(true)
    expect(docked.some(tab => tab.owner === 'sess-2')).toBe(true)

    // Glancing at sess-2 returns sess-1's tabs to the strip (its panel is
    // unmounted there — the strip is what keeps them alive).
    $browserSessionId.set('sess-2')
    expect($dockedPreviewTabs.get().some(tab => tab.owner === 'sess-1')).toBe(true)
  })

  it('keeps excluding a popped-out tab even while embedded', () => {
    toggleEmbeddedBrowser('sess-1')
    const tabId = browserTabs($previewTabs.get())[0].id

    markBrowserTabPopped(tabId, true)

    expect($dockedPreviewTabs.get()).toHaveLength(0)
  })

  it('closing the conversation closes its browser tabs and forgets the embed', () => {
    toggleEmbeddedBrowser('sess-1')
    // Seed the two survivors directly so the id-derivation in openPreview
    // (which would fold a new URL open into an existing vessel) can't blur
    // who owns what: a RESTORED tab (no runtime owner, only the stored key)
    // and a page nobody's conversation owns.
    $previewTabs.set([
      ...$previewTabs.get(),
      {
        agent: true,
        id: 'url:restored',
        ownerKey: 'stored-1',
        target: urlTarget('https://example.com/restored')
      },
      { id: 'url:shared', target: urlTarget('https://example.com/shared') }
    ])

    const ownedId = browserTabs($previewTabs.get()).find(tab => tab.owner === 'sess-1')?.id

    expect(ownedId).toBeTruthy()

    closeBrowserTabsForSession('sess-1', 'stored-1')

    const remaining = browserTabs($previewTabs.get())

    expect(remaining.map(tab => tab.target.url)).toEqual(['https://example.com/shared'])
    expect($embeddedBrowserSessions.get().has('sess-1')).toBe(false)
    expect($embeddedBrowserExpanded.get().has('sess-1')).toBe(false)
  })

  it('closing a tab inside the embedded panel fronts a sibling, not a dead id', () => {
    toggleEmbeddedBrowser('sess-1')
    const first = browserTabs($previewTabs.get())[0].id
    newBrowserTab('sess-1')

    expect(browserTabs($previewTabs.get())).toHaveLength(2)

    selectRightRailTab(first)
    closeRightRailTab(first)

    expect($previewTabs.get()).toHaveLength(1)
    expect($rightRailActiveTabId.get()).toBe(browserTabs($previewTabs.get())[0].id)
  })
})
