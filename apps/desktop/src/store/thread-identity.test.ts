import { describe, expect, it } from 'vitest'

import { $sessionTiles } from './session-states'
import { storedSessionIdForRuntimeId } from './session-states'

/**
 * Which id is "this conversation" for threads.
 *
 * A delegated child is stamped with its parent's DURABLE session id
 * (`model_config.$._delegate_from` = `parent_agent.session_id`), so every
 * thread read keys on the stored id. `$activeSessionId` holds a RUNTIME id.
 *
 * The first cut handed the runtime id straight to `thread.list`, which queries
 * a key the backend never writes: every conversation looked thread-less and
 * the router never fired, silently. The repo already carries this exact scar
 * in `docs/plans/browser-session-isolation.md`, where two expressions for
 * "which conversation is this" disagreed in a reachable state.
 *
 * These tests pin the contract the dock and the composer both depend on.
 */

function seedTile(storedSessionId: string, runtimeId: string) {
  $sessionTiles.set([
    {
      profile: 'default',
      runtimeId,
      storedSessionId
    } as unknown as (typeof $sessionTiles.value)[number]
  ])
}

describe('thread coordinator identity', () => {
  it('maps a runtime id to the durable id threads are stamped with', () => {
    seedTile('20260920_140831_cbd266', 'runtime-abc')

    expect(storedSessionIdForRuntimeId('runtime-abc')).toBe('20260920_140831_cbd266')
  })

  it('passes a stored id through unchanged', () => {
    // The dock may already hold the durable id; the mapper must not reject it.
    seedTile('20260920_140831_cbd266', 'runtime-abc')

    expect(storedSessionIdForRuntimeId('20260920_140831_cbd266')).toBe('20260920_140831_cbd266')
  })

  it('returns null for an unknown id rather than guessing', () => {
    seedTile('20260920_140831_cbd266', 'runtime-abc')

    expect(storedSessionIdForRuntimeId('nobody')).toBeNull()
  })

  it('a runtime id is not itself a usable coordinator key', () => {
    // The assertion that would have caught the original bug: the two ids are
    // different values, so handing the runtime one to thread.list finds nothing.
    seedTile('20260920_140831_cbd266', 'runtime-abc')

    expect(storedSessionIdForRuntimeId('runtime-abc')).not.toBe('runtime-abc')
  })
})
