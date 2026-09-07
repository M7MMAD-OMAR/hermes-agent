import { describe, expect, it } from 'vitest'

import { chatSessionIdFromDeepLink } from './chat-deep-link'

describe('chatSessionIdFromDeepLink', () => {
  it('reads the id from a chat link', () => {
    expect(chatSessionIdFromDeepLink({ kind: 'chat', name: 's-1' })).toBe('s-1')
  })

  it('is null for every other kind, so the generic resolver still gets its turn', () => {
    expect(chatSessionIdFromDeepLink({ kind: 'open', name: 's-1' })).toBeNull()
    expect(chatSessionIdFromDeepLink({ kind: 'index-network', name: 'intent/1' })).toBeNull()
    expect(chatSessionIdFromDeepLink(null)).toBeNull()
  })

  it('is null for a chat link with no or an unsafe id', () => {
    expect(chatSessionIdFromDeepLink({ kind: 'chat' })).toBeNull()
    expect(chatSessionIdFromDeepLink({ kind: 'chat', name: '' })).toBeNull()
    expect(chatSessionIdFromDeepLink({ kind: 'chat', name: '../other' })).toBeNull()
  })
})
