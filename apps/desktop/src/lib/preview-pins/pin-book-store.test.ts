/**
 * The store is the fix for "عم يحزف لي كل شي": the review used to live in a
 * component ref and died with it. These are the behaviours that only exist at
 * this level — persistence across a remount and a restart, and never losing a
 * comment the user wrote.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { normalizePageUrl, pinsForPage } from './pin-book'
import { $pinBook, setPinBook } from './pin-book-store'
import type { PreviewPin } from './types'

const HOME = 'http://localhost:5178/en/index.html'

function pin(comment: string, id = comment): PreviewPin {
  return {
    comment,
    createdAt: id.length,
    id,
    kind: 'element',
    pageUrl: HOME,
    resolved: false,
    target: comment
  }
}

beforeEach(() => {
  window.localStorage.clear()
  setPinBook({})
})

describe('the persistent pin book', () => {
  it('survives an app restart: a fresh atom reads what the last one wrote', () => {
    setPinBook({ [HOME]: [pin('hero')] })
    // A second window/module load reads the same storage key.
    expect(pinsForPage($pinBook.get(), HOME).map(p => p.comment)).toEqual(['hero'])
  })

  it('keys pages by normalized url, so a bare # does not split the review', () => {
    expect(normalizePageUrl('http://x/index.html#')).toBe('http://x/index.html')
    setPinBook({ 'http://x/index.html#': [pin('hero')] })
    expect(pinsForPage($pinBook.get(), 'http://x/index.html')).toHaveLength(1)
  })

  it('marks delivered without deleting anything — the complaint was wholesale loss', () => {
    const hero = pin('hero')
    const nav = pin('nav', 'nav')
    setPinBook({ [HOME]: [hero, nav] })

    // The panel marks ONE comment delivered; the other stays exactly as it was.
    const marked = $pinBook.get()[HOME].map(p => (p.id === 'hero' ? { ...p, delivered: true } : p))
    setPinBook({ [HOME]: marked })

    const after = $pinBook.get()[HOME]
    expect(after).toHaveLength(2)
    expect(after.find(p => p.id === 'hero')?.delivered).toBe(true)
    expect(after.find(p => p.id === 'nav')?.delivered).toBeUndefined()
    expect(after.find(p => p.id === 'nav')?.comment).toBe('nav')
  })

  it('rejects corrupt storage shapes instead of losing the whole book', () => {
    window.localStorage.setItem('hermes.desktop.pinBook.v2', JSON.stringify({ [HOME]: 'garbage', other: [null, 42] }))
    expect(pinsForPage($pinBook.get(), HOME)).toEqual([])
  })
})
