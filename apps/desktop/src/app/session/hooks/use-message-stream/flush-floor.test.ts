import { describe, expect, it } from 'vitest'

import {
  HIDDEN_STREAM_FLUSH_MS,
  MAX_STREAM_FLUSH_GAP_MS,
  STREAM_DELTA_FLUSH_MS,
  streamFlushGapMs,
  UNFOCUSED_STREAM_FLUSH_MS
} from './utils'

/** The floor alone: a flush whose predecessor cost nothing to apply. */
const floor = (focused: boolean, presented: boolean) => streamFlushGapMs({ focused, lastFlushCostMs: 0, presented })

describe('streamFlushGapMs floor', () => {
  it('paints at full cadence for the window being read', () => {
    expect(floor(true, true)).toBe(STREAM_DELTA_FLUSH_MS)
  })

  it('slows a visible window nobody has focused, rather than freezing it', () => {
    expect(floor(false, true)).toBe(UNFOCUSED_STREAM_FLUSH_MS)
  })

  it('drops to the hidden floor when the pixels go nowhere', () => {
    expect(floor(false, false)).toBe(HIDDEN_STREAM_FLUSH_MS)
  })

  it('treats presentation, not focus, as the deciding signal', () => {
    // A window can report focus while parked on another workspace: Wayland
    // leaves the page "visible" and the compositor never says otherwise.
    expect(floor(true, false)).toBe(HIDDEN_STREAM_FLUSH_MS)
  })
})

describe('streamFlushGapMs cost stretch', () => {
  it('stretches toward the last flush cost, capped for text being watched', () => {
    expect(streamFlushGapMs({ focused: true, lastFlushCostMs: 40, presented: true })).toBe(120)
    expect(streamFlushGapMs({ focused: true, lastFlushCostMs: 400, presented: true })).toBe(MAX_STREAM_FLUSH_GAP_MS)
  })

  it('keeps the hidden floor: the 4-per-second promise is about visible text', () => {
    expect(streamFlushGapMs({ focused: false, lastFlushCostMs: 0, presented: false })).toBe(HIDDEN_STREAM_FLUSH_MS)
    expect(streamFlushGapMs({ focused: false, lastFlushCostMs: 400, presented: false })).toBe(HIDDEN_STREAM_FLUSH_MS)
  })

  it('never returns less than the attention floor', () => {
    expect(streamFlushGapMs({ focused: false, lastFlushCostMs: 0, presented: true })).toBe(UNFOCUSED_STREAM_FLUSH_MS)
  })
})
