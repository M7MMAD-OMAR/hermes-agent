import { describe, expect, it } from 'vitest'

import { workspaceMoveTargetSessionId } from './workspace-move-target'

describe('which chat the workspace chip moves', () => {
  it('moves the focused tile, not the primary selection behind it', () => {
    // The failure this guards is silent: the chip would name the tile's folder
    // while re-homing the chat in the main pane, with nothing in the menu to
    // say which one actually moved.
    expect(workspaceMoveTargetSessionId('tile-chat', 'primary-chat')).toBe('tile-chat')
  })

  it('falls back to the primary selection when nothing is focused', () => {
    expect(workspaceMoveTargetSessionId(null, 'primary-chat')).toBe('primary-chat')
    expect(workspaceMoveTargetSessionId('', 'primary-chat')).toBe('primary-chat')
    expect(workspaceMoveTargetSessionId(undefined, 'primary-chat')).toBe('primary-chat')
  })

  it('reports no target for a draft, so the panel stays read-only', () => {
    // A draft has no stored row. Returning anything here would re-home whatever
    // chat the gateway happened to resolve instead.
    expect(workspaceMoveTargetSessionId(null, null)).toBeNull()
    expect(workspaceMoveTargetSessionId('', '')).toBeNull()
    expect(workspaceMoveTargetSessionId(undefined, undefined)).toBeNull()
  })
})
