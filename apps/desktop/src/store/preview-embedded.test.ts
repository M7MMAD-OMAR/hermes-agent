import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $rightRailActiveTabId, selectRightRailTab } from './layout'
import {
  $browserSessionId,
  $dockedPreviewTabs,
  $embeddedBrowserExpanded,
  $embeddedBrowserSessions,
  $poppedBrowserTabIds,
  $previewTabs,
  closeBrowserTabsForSession,
  closeRightRail,
  closeRightRailTab,
  markBrowserTabPopped,
  newBrowserTab,
  openPreview,
  type PreviewTab,
  type PreviewTarget,
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
    closeRightRail()
    window.localStorage.clear()
  })

  afterEach(() => {
    $previewTabs.set([])
    $poppedBrowserTabIds.set(new Set())
    $embeddedBrowserSessions.set(new Set())
    $embeddedBrowserExpanded.set(new Set())
    $browserSessionId.set(null)
    closeRightRail()
    window.localStorage.clear()
  })

  it('does nothing without a conversation to embed into', () => {
    toggleEmbeddedBrowser(null)

    expect($embeddedBrowserSessions.get().size).toBe(0)
    expect($previewTabs.get()).toHaveLength(0)
  })

  it('first toggle mounts, expands, and mints this conversation a browser tab', () => {
    toggleEmbeddedBrowser('sess-1')

    expect($embeddedBrowserSessions.get().has('sess-1')).toBe(true)
    expect($embeddedBrowserExpanded.get().has('sess-1')).toBe(true)

    const tabs = browserTabs($previewTabs.get())

    expect(tabs).toHaveLength(1)
    expect(tabs[0].owner).toBe('sess-1')
    expect($rightRailActiveTabId.get()).toBe(tabs[0].id)
  })

  it('collapses without unmounting, and re-expands — the tab never moves', () => {
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
