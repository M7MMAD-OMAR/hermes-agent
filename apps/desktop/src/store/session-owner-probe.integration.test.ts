import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { $profiles } = await import('./profile')
const { $activeSessionId, _resetSessionOwnerHintsForTests, setSessions } = await import('./session')
const { $gateway, setPrimaryGateway } = await import('./gateway')

const { $sessionTiles, clearAllSessionStates, knownOwnerForSession, requestForOwnedSession } =
  await import('./session-states')

const { isSessionOwnerResolutionError, setSessionOwnerProbe } = await import('./session-owner-resolution')

const primaryRequest = vi.fn(async (method: string, params: Record<string, unknown>) => ({ method, params }))

beforeEach(() => {
  primaryRequest.mockClear()
  // Two profiles and no registry: the ambient gateway is not provably the only
  // backend, so an unknown owner is exactly the case that used to fail closed.
  $profiles.set([{ name: 'default' }, { name: 'research' }] as never)
  $sessionTiles.set([])
  setSessions([])
  clearAllSessionStates()
  $activeSessionId.set(null)
  _resetSessionOwnerHintsForTests({ storage: true })
  const primary = { connectionState: 'open', request: primaryRequest }
  $gateway.set(primary as never)
  setPrimaryGateway(primary as never, 'default')
})

afterEach(() => {
  setSessionOwnerProbe(null)
  clearAllSessionStates()
  $sessionTiles.set([])
  $profiles.set([])
  setSessions([])
  _resetSessionOwnerHintsForTests({ storage: true })
  $activeSessionId.set(null)
  $gateway.set(null)
})

describe('async owner probe rung for session-scoped RPCs', () => {
  it('routes a session the sync ladder cannot name once the probe names its profile', async () => {
    // The sidebar page holds no row for this conversation, which is the normal
    // state for anything older than the recents window or newer than the next
    // list refresh.
    expect(knownOwnerForSession('outside-the-window')).toBeUndefined()

    const probe = vi.fn(async () => 'default')
    setSessionOwnerProbe(probe)

    await expect(
      requestForOwnedSession('outside-the-window', vi.fn() as never, 'session.control.read', {
        session_id: 'outside-the-window'
      })
    ).resolves.toEqual({
      method: 'session.control.read',
      params: { session_id: 'outside-the-window' }
    })

    expect(probe).toHaveBeenCalledWith('outside-the-window')
    expect(primaryRequest).toHaveBeenCalledWith('session.control.read', { session_id: 'outside-the-window' })
  })

  it('still fails closed when the probe names nobody, and when no probe is registered', async () => {
    setSessionOwnerProbe(async () => undefined)

    await expect(
      requestForOwnedSession('ghost', vi.fn() as never, 'session.control.read', { session_id: 'ghost' })
    ).rejects.toSatisfy(isSessionOwnerResolutionError)

    setSessionOwnerProbe(null)

    await expect(
      requestForOwnedSession('ghost', vi.fn() as never, 'session.control.read', { session_id: 'ghost' })
    ).rejects.toSatisfy(isSessionOwnerResolutionError)

    expect(primaryRequest).not.toHaveBeenCalled()
  })

  it('probes once for the burst of RPCs one session open fires', async () => {
    let release: (value: string) => void = () => undefined
    const probe = vi.fn(() => new Promise<string>(resolve => (release = resolve)))
    setSessionOwnerProbe(probe as never)

    const calls = [
      requestForOwnedSession('burst', vi.fn() as never, 'session.control.read', { session_id: 'burst' }),
      requestForOwnedSession('burst', vi.fn() as never, 'process.list', { session_id: 'burst' }),
      requestForOwnedSession('burst', vi.fn() as never, 'session.goal.read', { session_id: 'burst' })
    ]

    release('default')
    await expect(Promise.all(calls)).resolves.toHaveLength(3)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('does not re-sweep every poll for a session no backend claims', async () => {
    const probe = vi.fn(async () => undefined)
    setSessionOwnerProbe(probe)

    for (let tick = 0; tick < 3; tick += 1) {
      await expect(
        requestForOwnedSession('nobody', vi.fn() as never, 'process.list', { session_id: 'nobody' })
      ).rejects.toSatisfy(isSessionOwnerResolutionError)
    }

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('leaves the sync ladder in charge when it already names an owner', async () => {
    setSessions([{ id: 'stored-known', profile: 'default' } as never])
    const probe = vi.fn(async () => 'research')
    setSessionOwnerProbe(probe)

    await requestForOwnedSession('stored-known', vi.fn() as never, 'session.control.read', {
      session_id: 'stored-known'
    })

    expect(probe).not.toHaveBeenCalled()
    expect(primaryRequest).toHaveBeenCalledTimes(1)
  })
})
