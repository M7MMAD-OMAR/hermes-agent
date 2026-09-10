/**
 * The deck viewer: a rail of slides, one large slide, and navigation between
 * them. The SVG each slide carries is generated markup, so the checks are that
 * it reaches the page and that the reader can move through the deck.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Deck } from './slides-view'
import { SlidesPreview } from './slides-view'

const svg = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><title>${label}</title></svg>`

const deck: Deck = {
  aspect: 16 / 9,
  slides: [
    { notes: 'Say hello', svg: svg('one'), title: 'Quarterly review' },
    { notes: '', svg: svg('two'), title: 'Agenda' },
    { notes: '', svg: null, title: 'Still rendering' }
  ]
}

afterEach(cleanup)

describe('the deck viewer', () => {
  it('opens on the first slide and says where in the deck it is', () => {
    render(<SlidesPreview deck={deck} />)

    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getAllByText('Quarterly review').length).toBeGreaterThan(0)
  })

  it('draws the slide markup rather than escaping it', () => {
    const { container } = render(<SlidesPreview deck={deck} />)

    // One in the rail, one in the main view.
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
  })

  it('walks the deck with the next control', () => {
    render(<SlidesPreview deck={deck} />)

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
  })

  it('stops at both ends of the deck', () => {
    render(<SlidesPreview deck={deck} />)

    const previous = screen.getByRole('button', { name: 'Previous slide' }) as HTMLButtonElement

    expect(previous.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect((screen.getByRole('button', { name: 'Next slide' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('jumps to the slide picked in the rail', () => {
    render(<SlidesPreview deck={deck} />)

    fireEvent.click(screen.getByText('3').closest('button') as HTMLElement)
    expect(screen.getByText('3 / 3')).toBeTruthy()
  })

  it('shows the speaker notes of the slide in view, and only then', () => {
    render(<SlidesPreview deck={deck} />)

    expect(screen.getByText('Say hello')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(screen.queryByText('Say hello')).toBeNull()
  })

  it('says so when the presentation has no slides', () => {
    render(<SlidesPreview deck={{ aspect: 16 / 9, slides: [] }} />)

    expect(screen.getByText('This presentation has no slides.')).toBeTruthy()
  })
})
