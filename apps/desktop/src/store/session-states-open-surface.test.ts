import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeSessionId } from '@/store/session'
import {
  $sessionTiles,
  clearAllSessionStates,
  publishSessionState,
  runtimeHasOpenSurface
} from '@/store/session-states'

// `runtimeHasOpenSurface` is the permission predicate for anything scoped to
// "the user can see this chat right now": whether the agent may drive the shared
// preview pane, whether a finished turn notifies, whether it is listed in the
// notification inbox. All three refuse a session it says has no surface, so a
// false negative here is silent in three places at once.
function bind(runtimeId: string, storedSessionId: string) {
  publishSessionState(runtimeId, { ...createClientSessionState(), storedSessionId })
}

beforeEach(() => {
  clearAllSessionStates()
  $sessionTiles.set([])
  $activeSessionId.set(null)
})

afterEach(() => {
  clearAllSessionStates()
  $sessionTiles.set([])
  $activeSessionId.set(null)
})

describe('a chat with a surface in this window', () => {
  it('counts the primary view', () => {
    $activeSessionId.set('rt-primary')
    expect(runtimeHasOpenSurface('rt-primary')).toBe(true)
  })

  it('counts a tile already bound to the runtime', () => {
    $sessionTiles.set([{ runtimeId: 'rt-1', storedSessionId: 'stored-1' }])
    expect(runtimeHasOpenSurface('rt-1')).toBe(true)
  })

  it('counts a tile still mid-resume, which references by stored id only', () => {
    // `resumeTile` patches `runtimeId` in only after it returns, so between the
    // stream binding and that patch a tile plainly on screen matched nothing.
    // The window is short, and a turn finishing inside it is exactly the case
    // where the user is waiting to be told.
    $sessionTiles.set([{ storedSessionId: 'stored-1' }])
    bind('rt-1', 'stored-1')

    expect(runtimeHasOpenSurface('rt-1')).toBe(true)
  })
})

describe('a chat with no surface', () => {
  it('is refused when no tile and no primary hold it', () => {
    // The whole point of the predicate: a busy gateway runs sessions the user
    // never opened, and they must stay out of every surface gated on this.
    bind('rt-cron', 'stored-cron')
    expect(runtimeHasOpenSurface('rt-cron')).toBe(false)
  })

  it('is refused when a tile holds a DIFFERENT chat', () => {
    // The mid-resume clause must match this runtime's own stored id, not any
    // tile at all, or the predicate would wave through every background session
    // the moment one tile existed.
    $sessionTiles.set([{ storedSessionId: 'stored-other' }])
    bind('rt-cron', 'stored-cron')

    expect(runtimeHasOpenSurface('rt-cron')).toBe(false)
  })

  it('is refused for no runtime id at all', () => {
    expect(runtimeHasOpenSurface(null)).toBe(false)
    expect(runtimeHasOpenSurface('')).toBe(false)
  })
})
