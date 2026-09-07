import { describe, expect, it } from 'vitest'

import type { PreviewTab } from '@/store/preview'

import { browserGuestEvictions } from './browser-guest-budget'

const url = (id: string, owner?: string): PreviewTab => ({
  id: `url:${id}`,
  owner,
  target: { kind: 'url', label: id, source: id, url: `https://${id}` }
})

const file = (id: string): PreviewTab => ({ id: `file:${id}`, target: { kind: 'file', label: id, source: id, url: id } })

describe('browser guest budget', () => {
  it('does nothing at or under the ceiling', () => {
    const tabs = [url('a'), url('b'), file('f')]

    expect(browserGuestEvictions(tabs, 'url:a', new Map(), () => false, 2)).toEqual([])
  })

  it('closes the least recently shown guests first, never the one on screen', () => {
    const tabs = [url('a'), url('b'), url('c'), url('d')]

    const shown = new Map([
      ['url:a', 10],
      ['url:b', 30],
      ['url:c', 20]
    ])

    // d was never shown, so it goes first; then a (oldest); b is on screen.
    expect(browserGuestEvictions(tabs, 'url:b', shown, () => false, 2)).toEqual(['url:d', 'url:a'])
  })

  it('spares a tab whose owner is mid-turn even when it is the oldest', () => {
    const tabs = [url('a', 'busy'), url('b'), url('c')]

    const shown = new Map([
      ['url:a', 1],
      ['url:b', 2],
      ['url:c', 3]
    ])

    expect(browserGuestEvictions(tabs, 'url:c', shown, tab => tab.owner === 'busy', 2)).toEqual(['url:b'])
  })

  it('files and artifacts do not count as guests', () => {
    const tabs = [file('x'), file('y'), file('z'), url('a')]

    expect(browserGuestEvictions(tabs, null, new Map(), () => false, 1)).toEqual([])
  })
})
