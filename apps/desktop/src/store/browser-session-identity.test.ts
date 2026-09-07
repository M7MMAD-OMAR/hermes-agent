import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $browserSessionId,
  $embeddedBrowserExpanded,
  $embeddedBrowserSessions,
  $poppedBrowserTabIds,
  $previewTabs,
  adoptBrowserSessionKey,
  browserSessionKey,
  closeRightRail,
  decodePreviewTabs,
  DRAFT_BROWSER_SESSION_ID,
  isProvisionalBrowserKey,
  newBrowserTab,
  openPreview,
  previewTabBelongsToSession,
  registerEmbeddedBrowserHost,
  resetEmbeddedBrowserHosts,
  setStoredSessionResolver,
  storedBrowserSessionKey,
  toggleEmbeddedBrowser
} from './preview'

const reset = () => {
  $previewTabs.set([])
  $poppedBrowserTabIds.set(new Set())
  $embeddedBrowserSessions.set(new Set())
  $embeddedBrowserExpanded.set(new Set())
  $browserSessionId.set(null)
  resetEmbeddedBrowserHosts()
  setStoredSessionResolver(() => null)
  closeRightRail()
  window.localStorage.clear()
}

/** What `syncBrowserSession` publishes, and what the chat view mounts its panel
 *  under. Two expressions in two files once, which is how they drifted; both
 *  are this call now, and this helper is here so the test would fail if either
 *  stopped being it. */
const toggleKeyFor = (runtimeId: null | string, storedId: null | string) => browserSessionKey(runtimeId, storedId)
const mountKeyFor = (runtimeId: null | string, storedId: null | string) => browserSessionKey(runtimeId, storedId)

describe('browser session identity', () => {
  beforeEach(reset)
  afterEach(reset)

  // The drift itself, not its symptom. Pinning "the panel closes" would have
  // passed on any one of these states alone; only the table catches a rung
  // that answers differently on the two sides.
  it.each([
    ['a bound runtime', 'runtime-1', 'stored-1', 'runtime-1'],
    ['a conversation whose runtime has not bound', null, 'stored-1', 'stored:stored-1'],
    ['a brand-new chat', null, null, DRAFT_BROWSER_SESSION_ID],
    ['a runtime with no stored id yet', 'runtime-1', null, 'runtime-1']
  ])('agrees on the key for %s', (_name, runtimeId, storedId, expected) => {
    expect(toggleKeyFor(runtimeId, storedId)).toBe(expected)
    expect(mountKeyFor(runtimeId, storedId)).toBe(expected)
  })

  it('gives an unbound conversation a key of its own, never the new chat’s', () => {
    expect(browserSessionKey(null, 'stored-1')).not.toBe(DRAFT_BROWSER_SESSION_ID)
    expect(browserSessionKey(null, 'stored-1')).not.toBe(browserSessionKey(null, 'stored-2'))
    expect(isProvisionalBrowserKey(browserSessionKey(null, 'stored-1'))).toBe(true)
    expect(isProvisionalBrowserKey('runtime-1')).toBe(false)
  })

  // The reported symptom: a panel on screen that the button which opens it
  // cannot close, because the two sides named it differently.
  it('lets the globe collapse a panel mounted before the runtime bound', () => {
    const key = browserSessionKey(null, 'stored-1')

    registerEmbeddedBrowserHost(key)
    toggleEmbeddedBrowser(key)
    expect($embeddedBrowserSessions.get().has(key)).toBe(true)
    expect($embeddedBrowserExpanded.get().has(key)).toBe(true)

    toggleEmbeddedBrowser(key)
    expect($embeddedBrowserExpanded.get().has(key)).toBe(false)
  })

  it('does not show one unbound conversation’s browser in another', () => {
    const a = browserSessionKey(null, 'stored-a')
    const b = browserSessionKey(null, 'stored-b')

    registerEmbeddedBrowserHost(a)
    toggleEmbeddedBrowser(a)

    expect($embeddedBrowserSessions.get().has(a)).toBe(true)
    expect($embeddedBrowserSessions.get().has(b)).toBe(false)
    expect($embeddedBrowserSessions.get().has(DRAFT_BROWSER_SESSION_ID)).toBe(false)
  })
})

describe('ownership survives a restart', () => {
  beforeEach(reset)
  afterEach(reset)

  // `owner` is stripped by the encoder, so `ownerKey` is the only claim that
  // can come back. It was written by one caller out of three.
  it('stamps the durable half on a tab the USER opens', () => {
    setStoredSessionResolver(id => (id === 'runtime-1' ? 'stored-1' : null))
    newBrowserTab('runtime-1')

    expect($previewTabs.get()[0]?.ownerKey).toBe('stored-1')
  })

  it('stamps it from a provisional key without any resolver', () => {
    newBrowserTab(storedBrowserSessionKey('stored-1'))

    expect($previewTabs.get()[0]?.ownerKey).toBe('stored-1')
  })

  it('stamps it on an agent open that passed none', () => {
    setStoredSessionResolver(id => (id === 'runtime-1' ? 'stored-1' : null))
    openPreview({ kind: 'url', label: 'x', source: 'https://x.test', url: 'https://x.test' }, 'tool-result', {
      sessionId: 'runtime-1'
    })

    expect($previewTabs.get()[0]?.ownerKey).toBe('stored-1')
  })

  it('leaves a draft tab unclaimed, because a draft has nothing durable to claim with', () => {
    newBrowserTab(DRAFT_BROWSER_SESSION_ID)

    expect($previewTabs.get()[0]?.ownerKey).toBeUndefined()
  })

  // The end-to-end shape of the reported bug: reopen the app and the tab is
  // still this conversation's rather than everyone's.
  it('restores a user-opened tab into its own conversation only', () => {
    setStoredSessionResolver(id => (id === 'runtime-1' ? 'stored-1' : null))
    newBrowserTab('runtime-1')

    const restored = decodePreviewTabs(window.localStorage.getItem('hermes.desktop.previewTabs.v2') ?? '[]')

    expect(restored[0]?.owner).toBeUndefined()
    expect(restored[0]?.ownerKey).toBe('stored-1')
    expect(previewTabBelongsToSession(restored[0]!, 'runtime-2', 'stored-1')).toBe(true)
    expect(previewTabBelongsToSession(restored[0]!, 'runtime-2', 'stored-2')).toBe(false)
  })
})

describe('provisional handover', () => {
  beforeEach(reset)
  afterEach(reset)

  it('moves the browser onto the runtime id without dropping the tab', () => {
    setStoredSessionResolver(id => (id === 'runtime-1' ? 'stored-1' : null))

    const key = storedBrowserSessionKey('stored-1')

    registerEmbeddedBrowserHost(key)
    toggleEmbeddedBrowser(key)

    const before = $previewTabs.get()[0]?.id

    adoptBrowserSessionKey(key, 'runtime-1')

    const after = $previewTabs.get()[0]

    expect(after?.id).toBe(before)
    expect(after?.owner).toBe('runtime-1')
    expect(after?.ownerKey).toBe('stored-1')
    expect($embeddedBrowserSessions.get().has('runtime-1')).toBe(true)
    expect($embeddedBrowserSessions.get().has(key)).toBe(false)
  })

  it('never adopts from a runtime id, so switching chats cannot steal tabs', () => {
    newBrowserTab('runtime-a')
    adoptBrowserSessionKey('runtime-a', 'runtime-b')

    expect($previewTabs.get()[0]?.owner).toBe('runtime-a')
  })

  it('is a no-op when the stand-in owns nothing', () => {
    newBrowserTab('runtime-a')

    const before = $previewTabs.get()

    adoptBrowserSessionKey(storedBrowserSessionKey('stored-z'), 'runtime-b')

    expect($previewTabs.get()).toBe(before)
  })
})
