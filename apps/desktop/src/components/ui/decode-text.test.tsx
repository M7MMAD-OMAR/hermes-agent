import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeFrames, installFakeFrames } from '@/test/frames'

import { DecodeText } from './decode-text'

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

    // Time passes with no frames — a window parked on another workspace.
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
})
