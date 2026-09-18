import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeFrames, installFakeFrames } from '@/test/frames'

import {
  medianTurnHeight,
  TURN_ESTIMATE_MAX_PX,
  TURN_ESTIMATE_MIN_PX,
  TURN_ESTIMATE_PROPERTY,
  useTurnSizeEstimate,
  worthRepublishing
} from './use-turn-size-estimate'

describe('medianTurnHeight', () => {
  it('has no answer until something has been measured', () => {
    expect(medianTurnHeight([])).toBeNull()
    expect(medianTurnHeight([0, 0])).toBeNull()
  })

  it('takes the middle turn, not the average', () => {
    // One page-sized tool turn among ordinary ones must not drag the estimate.
    expect(medianTurnHeight([400, 420, 430, 8_000])).toBe(420)
  })

  it('clamps a collapsed pane and a single enormous turn', () => {
    expect(medianTurnHeight([4, 6])).toBe(TURN_ESTIMATE_MIN_PX)
    expect(medianTurnHeight([9_000, 9_000])).toBe(TURN_ESTIMATE_MAX_PX)
  })
})

describe('worthRepublishing', () => {
  it('always publishes the first measurement', () => {
    expect(worthRepublishing(null, 400)).toBe(true)
  })

  it('ignores drift that would only jog the scrollbar', () => {
    expect(worthRepublishing(400, 420)).toBe(false)
  })

  it('accepts a change big enough to matter', () => {
    expect(worthRepublishing(400, 700)).toBe(true)
  })
})

function Harness({ heights, rows }: { heights: number[]; rows: number }) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useTurnSizeEstimate({ contentRef, paneVisible: true, rows })

  return (
    <div data-testid="content" ref={contentRef}>
      {heights.map((height, index) => (
        <div
          data-slot="aui_message-group"
          data-virtualized={index === 0 ? 'true' : 'false'}
          key={index}
          style={{ height }}
        />
      ))}
    </div>
  )
}

describe('useTurnSizeEstimate', () => {
  let frames: FakeFrames

  beforeEach(() => {
    vi.useFakeTimers()
    frames = installFakeFrames()
    // jsdom lays nothing out; the heights come from the style attribute.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: Number.parseFloat(this.style.height) || 0 } as DOMRect
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('publishes the measured median of the rendered turns', () => {
    const { getByTestId } = render(<Harness heights={[600, 400, 410, 430]} rows={1} />)

    act(() => frames.paint())

    // The first row is virtualized: measuring it would feed the placeholder back.
    expect(getByTestId('content').style.getPropertyValue(TURN_ESTIMATE_PROPERTY)).toBe('410px')
  })

  it('publishes nothing when no turn has rendered yet', () => {
    const { getByTestId } = render(<Harness heights={[]} rows={1} />)

    act(() => frames.paint())

    expect(getByTestId('content').style.getPropertyValue(TURN_ESTIMATE_PROPERTY)).toBe('')
  })

  it('leaves the estimate alone while turns stay about the same size', () => {
    const { getByTestId, rerender } = render(<Harness heights={[400, 400, 400]} rows={1} />)
    act(() => frames.paint())
    expect(getByTestId('content').style.getPropertyValue(TURN_ESTIMATE_PROPERTY)).toBe('400px')

    rerender(<Harness heights={[430, 430, 430]} rows={2} />)
    act(() => frames.paint())

    expect(getByTestId('content').style.getPropertyValue(TURN_ESTIMATE_PROPERTY)).toBe('400px')
  })

  it('follows a transcript whose turns really did change size', () => {
    const { getByTestId, rerender } = render(<Harness heights={[400, 400, 400]} rows={1} />)
    act(() => frames.paint())

    rerender(<Harness heights={[900, 900, 900]} rows={2} />)
    act(() => frames.paint())

    expect(getByTestId('content').style.getPropertyValue(TURN_ESTIMATE_PROPERTY)).toBe('900px')
  })
})
