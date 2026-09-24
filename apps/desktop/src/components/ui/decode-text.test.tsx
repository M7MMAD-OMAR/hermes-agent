import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeFrames, installFakeFrames } from '@/test/frames'

import { DecodeText } from './decode-text'

const TICK_MS = 45
// Half a char per tick plus the 16-tick hold, with slack for the final tick.
const settleTicks = (text: string) => text.length * 2 + 16 + 4

/** Frames under our control: the regression this file pins is DecodeText
 *  running its scramble on a timer, which a compositor that has stopped asking
 *  for frames cannot stop. */
let frames: FakeFrames

describe('DecodeText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    frames = installFakeFrames()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('animates on frames, so a window nobody is showing costs nothing', () => {
    render(<DecodeText prefix={1} text="HERMES" />)

    const before = screen.getByText(/^H/).textContent

    // Time passes with no frames: a window parked on another workspace.
    vi.advanceTimersByTime(5_000)

    expect(screen.getByText(/^H/).textContent).toBe(before)
    expect(frames.pending()).toBeGreaterThan(0)
  })

  it('keeps the prefix legible while the tail scrambles', () => {
    render(<DecodeText prefix={1} text="HERMES" />)

    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(60)
      frames.paint()
    }

    const text = screen.getByText(/^H/).textContent ?? ''
    expect(text.startsWith('H')).toBe(true)
    expect(text).toHaveLength('HERMES'.length)
  })

  it('renders the plain text when the decode is not active', () => {
    render(<DecodeText active={false} prefix={1} text="HERMES" />)

    expect(screen.getByText('HERMES')).toBeTruthy()
  })

  // The decode scramble is decorative. Once a quiet-surface placeholder (empty
  // pane zone, contrib panes) has resolved and held, its loop must be parked:
  // a replaying default kept a 22 Hz setState ticker alive for as long as the
  // mark was on screen, holding an otherwise idle renderer at ~16 commits/s
  // (#98394). Only a caller that asks for `loop` (the boot overlay) replays.
  it('resolves once and stops asking for frames by default', async () => {
    const { container } = render(<DecodeText prefix={1} text="HERMES" />)

    await act(() => frames.advancePainting(settleTicks('HERMES') * TICK_MS * 2))
    expect(container.textContent).toBe('HERMES')

    // Fully resolved and held: no frame pending, not replaying.
    expect(frames.pending()).toBe(0)
    await act(() => frames.advancePainting(TICK_MS * 40))
    expect(container.textContent).toBe('HERMES')
  })

  it('keeps replaying only when the caller asks for loop', async () => {
    const { container } = render(<DecodeText loop prefix={1} text="HERMES" />)

    await act(() => frames.advancePainting(settleTicks('HERMES') * TICK_MS * 2))
    expect(frames.pending()).toBeGreaterThan(0)

    // The replay scrambles the tail again at some point after the hold.
    const seen = new Set<string>()

    for (let i = 0; i < 40; i++) {
      await act(() => frames.advancePainting(TICK_MS))
      seen.add(container.textContent ?? '')
    }

    expect(seen.size).toBeGreaterThan(1)
  })
})
