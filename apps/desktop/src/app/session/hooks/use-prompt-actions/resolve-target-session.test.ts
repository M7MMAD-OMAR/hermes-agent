import { describe, expect, it, vi } from 'vitest'

import { resolveTargetSessionId } from './resolve-target-session'

vi.mock('../use-session-actions/utils', () => ({
  resolveSessionProfile: vi.fn(async () => 'work')
}))

const RECOVERED = 'rt-recovered'
const STORED = 'stored-goal-session'

function deps(overrides: Partial<Parameters<typeof resolveTargetSessionId>[0]> = {}) {
  return {
    activeRuntimeId: null,
    createSession: vi.fn(async () => 'rt-brand-new'),
    getRuntimeIdForStoredSession: () => null,
    requestGateway: vi.fn(async () => ({ session_id: RECOVERED })) as never,
    routedStoredSessionId: null,
    selectedStoredSessionId: null,
    ...overrides
  }
}

describe('resolveTargetSessionId', () => {
  it('resumes the routed stored session instead of minting a new one when the runtime binding is gone', async () => {
    // The exact condition behind "/goal status says No active goal": the
    // runtime binding was cleared (profile swap / reconnect / orphan-reap) but
    // the durable route still names the chat carrying the goal.
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')
    const requestGateway = vi.fn(async () => ({ session_id: RECOVERED }))

    const resolved = await resolveTargetSessionId(
      deps({ createSession, requestGateway: requestGateway as never, routedStoredSessionId: STORED })
    )

    expect(resolved).toBe(RECOVERED)
    expect(createSession).not.toHaveBeenCalled()
    expect(requestGateway).toHaveBeenCalledWith('session.resume', {
      session_id: STORED,
      source: 'desktop',
      profile: 'work'
    })
  })

  it('reuses the live runtime id when the cache confirms it owns the targeted stored session', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')
    const requestGateway = vi.fn(async () => ({ session_id: 'rt-resume-WRONG' }))

    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: RECOVERED,
        createSession,
        getRuntimeIdForStoredSession: () => RECOVERED,
        requestGateway: requestGateway as never,
        selectedStoredSessionId: STORED
      })
    )

    expect(resolved).toBe(RECOVERED)
    expect(createSession).not.toHaveBeenCalled()
    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('rejects a stale runtime id the route does not bind to the targeted session', async () => {
    // A stale ref left over from the previous profile must not capture the
    // command — that runs it against another profile's session. The durable
    // route outranks the ref here.
    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: 'rt-wrong-profile',
        getRuntimeIdForStoredSession: () => null,
        routedStoredSessionId: STORED,
        selectedStoredSessionId: STORED
      })
    )

    expect(resolved).toBe(RECOVERED)
  })

  it('honors an explicit runtime id above everything else', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')
    const requestGateway = vi.fn(async () => ({ session_id: 'rt-resume-WRONG' }))

    const resolved = await resolveTargetSessionId(
      deps({
        createSession,
        explicitRuntimeId: 'rt-explicit',
        requestGateway: requestGateway as never,
        routedStoredSessionId: STORED
      })
    )

    expect(resolved).toBe('rt-explicit')
    expect(createSession).not.toHaveBeenCalled()
    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('creates a session only for a genuine new-chat draft', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new')

    const resolved = await resolveTargetSessionId(deps({ createSession }))

    expect(resolved).toBe('rt-brand-new')
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('reuses the live runtime for a new-chat draft without creating a second session', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')

    const resolved = await resolveTargetSessionId(deps({ activeRuntimeId: 'rt-live', createSession }))

    expect(resolved).toBe('rt-live')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('returns null rather than forking when a targeted durable session cannot be rebound', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')

    const requestGateway = vi.fn(async () => {
      throw new Error('4007 session not found')
    })

    const resolved = await resolveTargetSessionId(
      deps({ createSession, requestGateway: requestGateway as never, routedStoredSessionId: STORED })
    )

    expect(resolved).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('prefers the routed stored session over a differing selected one', async () => {
    const requestGateway = vi.fn(async () => ({ session_id: RECOVERED }))

    await resolveTargetSessionId(
      deps({
        requestGateway: requestGateway as never,
        routedStoredSessionId: STORED,
        selectedStoredSessionId: 'stored-stale-selection'
      })
    )

    expect(requestGateway).toHaveBeenCalledWith('session.resume', expect.objectContaining({ session_id: STORED }))
  })
})

describe('a caller-named background conversation', () => {
  // The cross-session leak: a queued /slash command drained for a chat the user
  // is NOT looking at. Its runtime binding is routinely absent (reap,
  // reconnect, profile swap), and the foreground runtime is a DIFFERENT
  // conversation, so inheriting it runs the queued command in the wrong chat.
  const BACKGROUND = 'stored-background-chat'
  const FOREGROUND_RUNTIME = 'rt-foreground-WRONG'

  it('never inherits the foreground runtime when the binding is missing', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')
    const requestGateway = vi.fn(async () => ({ session_id: RECOVERED }))

    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: FOREGROUND_RUNTIME,
        createSession,
        requestGateway: requestGateway as never,
        routedStoredSessionId: 'stored-foreground-chat',
        selectedStoredSessionId: 'stored-foreground-chat',
        targetStoredSessionId: BACKGROUND
      })
    )

    expect(resolved).toBe(RECOVERED)
    expect(resolved).not.toBe(FOREGROUND_RUNTIME)
    expect(createSession).not.toHaveBeenCalled()
    expect(requestGateway).toHaveBeenCalledWith('session.resume', {
      session_id: BACKGROUND,
      source: 'desktop',
      profile: 'work'
    })
  })

  it('prefers that conversation\'s own runtime binding over the foreground one', async () => {
    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: FOREGROUND_RUNTIME,
        getRuntimeIdForStoredSession: id => (id === BACKGROUND ? 'rt-background' : FOREGROUND_RUNTIME),
        selectedStoredSessionId: 'stored-foreground-chat',
        targetStoredSessionId: BACKGROUND
      })
    )

    expect(resolved).toBe('rt-background')
  })

  it('reports failure rather than retargeting when the chat cannot be rebound', async () => {
    const createSession = vi.fn(async () => 'rt-brand-new-WRONG')
    const requestGateway = vi.fn(async () => {
      throw new Error('gateway down')
    })

    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: FOREGROUND_RUNTIME,
        createSession,
        requestGateway: requestGateway as never,
        selectedStoredSessionId: 'stored-foreground-chat',
        targetStoredSessionId: BACKGROUND
      })
    )

    expect(resolved).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('leaves the ordinary foreground ladder untouched', async () => {
    // Same conversation named by both: the existing rungs must still decide,
    // so a fresh chat keeps using its live runtime rather than resuming.
    const requestGateway = vi.fn(async () => ({ session_id: 'rt-resumed-UNWANTED' }))

    const resolved = await resolveTargetSessionId(
      deps({
        activeRuntimeId: 'rt-foreground',
        requestGateway: requestGateway as never,
        selectedStoredSessionId: 'stored-foreground-chat',
        targetStoredSessionId: 'stored-foreground-chat'
      })
    )

    expect(resolved).toBe('rt-foreground')
    expect(requestGateway).not.toHaveBeenCalled()
  })
})
