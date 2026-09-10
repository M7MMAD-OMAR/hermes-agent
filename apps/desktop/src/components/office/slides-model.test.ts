/**
 * The deck reduction, against a presentation built here.
 *
 * Two things have to hold: the slide's shapes come back as real SVG (a deck
 * that renders as an empty frame is worse than no preview), and the document's
 * own text can never become markup on the page.
 */

import { addTitleSlide, createPresentation, savePresentation } from '@office-kit/pptx'
import { describe, expect, it } from 'vitest'

import { readDeck } from './deck-model'

async function deckBytes(title: string) {
  const presentation = createPresentation()

  addTitleSlide(presentation, title)

  return savePresentation(presentation)
}

describe('reading a presentation into slides', () => {
  it('renders a slide as SVG carrying its own text', async () => {
    const source = await readDeck(await deckBytes('نتائج الربع الثالث'))

    expect(source.slides).toHaveLength(1)
    expect(source.aspect).toBeGreaterThan(1)

    const svg = await source.render(0)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('نتائج الربع الثالث')
    // Shapes are positioned, not stacked into a text dump.
    expect(svg).toContain('foreignObject')
  })

  it('never lets a slide text become markup', async () => {
    const source = await readDeck(await deckBytes('<img src=x onerror="alert(1)"><script>alert(2)</script>'))
    const svg = await source.render(0)

    expect(svg).not.toMatch(/<script/i)
    expect(svg).not.toMatch(/<img\s/i)
    // It is still shown, as the text it is.
    expect(svg).toContain('alert(1)')
  })

  it('reads the slide title and notes for the rail', async () => {
    const source = await readDeck(await deckBytes('Quarterly review'))

    expect(source.slides[0]!.title).toBe('Quarterly review')
    expect(typeof source.slides[0]!.notes).toBe('string')
  })
})
