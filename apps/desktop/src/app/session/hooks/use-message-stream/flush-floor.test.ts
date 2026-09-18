import { describe, expect, it } from 'vitest'

import {
  HIDDEN_STREAM_FLUSH_MS,
  STREAM_DELTA_FLUSH_MS,
  streamFlushFloorMs,
  UNFOCUSED_STREAM_FLUSH_MS
} from './utils'

describe('streamFlushFloorMs', () => {
  it('paints at full cadence for the window being read', () => {
    expect(streamFlushFloorMs({ focused: true, presented: true })).toBe(STREAM_DELTA_FLUSH_MS)
  })

  it('slows a visible window nobody has focused, rather than freezing it', () => {
    expect(streamFlushFloorMs({ focused: false, presented: true })).toBe(UNFOCUSED_STREAM_FLUSH_MS)
  })

  it('drops to the hidden floor when the pixels go nowhere', () => {
    expect(streamFlushFloorMs({ focused: false, presented: false })).toBe(HIDDEN_STREAM_FLUSH_MS)
  })

  it('treats presentation, not focus, as the deciding signal', () => {
    // A window can report focus while parked on another workspace: Wayland
    // leaves the page "visible" and the compositor never says otherwise.
    expect(streamFlushFloorMs({ focused: true, presented: false })).toBe(HIDDEN_STREAM_FLUSH_MS)
  })
})
