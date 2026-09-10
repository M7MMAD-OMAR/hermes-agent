import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { $sessionStates, clearAllSessionStates, dropSessionState } from '@/store/session-states'
import { $turnOutcome, clearAllTurnOutcomes, setTurnOutcome } from '@/store/turn-outcome'

import { handleOutcomeEvent } from './outcome'
import type { GatewayEventContext } from './types'

/**
 * S6 of docs/design/herwork-workspace.md, handler half. The event's OWN routed
 * session id is the key (an unscoped frame never reaches here: it is dropped by
 * `gatewayEventRequiresSessionId`), a background session's outcome is stored
 * and not painted, and eviction follows the session.
 */

const OUTCOME = { delivered: ['q3-report.docx in output/'], failed: [], open: ['review slide 4'], source: 'model' }

function context(overrides: Partial<GatewayEventContext> = {}, payload: Record<string, unknown> = {}): GatewayEventContext {
  const body = { outcome: OUTCOME, session_id: 'routed-session', turn_id: 'user-171-abc', ...payload }

  return {
    deps: {
      sessionStateByRuntimeIdRef: { current: new Map<string, ClientSessionState>() }
    } as unknown as GatewayEventContext['deps'],
    event: { payload: body, session_id: 'routed-session', type: 'session.outcome' },
    explicitSid: 'routed-session',
    fromActiveSource: () => true,
    isActiveEvent: false,
    occurredAt: 1_700_000_100,
    payload: body as GatewayEventContext['payload'],
    scheduleConfigRefresh: vi.fn(),
    sessionId: 'routed-session',
    ...overrides
  }
}

afterEach(() => {
  clearAllTurnOutcomes()
  clearAllSessionStates()
})

describe('handleOutcomeEvent', () => {
  it('does not claim other events', () => {
    expect(handleOutcomeEvent(context({ event: { type: 'message.complete' } }))).toBe(false)
  })

  it('stores a background session outcome under the routed id and the echoed turn id', () => {
    expect(handleOutcomeEvent(context())).toBe(true)

    expect($turnOutcome('routed-session', 'user-171-abc').get()).toEqual(OUTCOME)
    // Not the active chat, not the event's raw sid when routing differs.
    expect($turnOutcome('active-session', 'user-171-abc').get()).toBeUndefined()
  })

  it('claims an unscoped frame without storing anything', () => {
    expect(handleOutcomeEvent(context({ sessionId: null }))).toBe(true)
    expect($turnOutcome('routed-session', 'user-171-abc').get()).toBeUndefined()
  })

  it('binds to the latest visible user message when the backend echoes no turn id', () => {
    const states = new Map<string, ClientSessionState>()
    states.set('routed-session', {
      messages: [
        { id: 'user-old', role: 'user', parts: [] },
        { id: 'asst-old', role: 'assistant', parts: [] },
        { id: 'user-new', role: 'user', parts: [] },
        { id: 'user-hidden', role: 'user', parts: [], hidden: true },
        { id: 'asst-new', role: 'assistant', parts: [] }
      ]
    } as unknown as ClientSessionState)

    handleOutcomeEvent(
      context({ deps: { sessionStateByRuntimeIdRef: { current: states } } as unknown as GatewayEventContext['deps'] }, { turn_id: '' })
    )

    expect($turnOutcome('routed-session', 'user-new').get()).toEqual(OUTCOME)
    expect($turnOutcome('routed-session', 'user-old').get()).toBeUndefined()
  })

  it('drops an outcome with no turn to bind to', () => {
    handleOutcomeEvent(context({}, { turn_id: undefined }))

    expect(Object.keys($turnOutcome('routed-session', '').get() ?? {})).toEqual([])
  })

  it('is idempotent under replay', () => {
    handleOutcomeEvent(context())
    handleOutcomeEvent(context())

    expect($turnOutcome('routed-session', 'user-171-abc').get()).toEqual(OUTCOME)
  })
})

describe('eviction follows the session', () => {
  it('dropping a runtime state forgets its outcomes', () => {
    $sessionStates.set({ 'runtime-1': { messages: [] } as unknown as ClientSessionState })
    setTurnOutcome('runtime-1', 'user-1', OUTCOME)
    setTurnOutcome('runtime-2', 'user-1', OUTCOME)

    dropSessionState('runtime-1')

    expect($turnOutcome('runtime-1', 'user-1').get()).toBeUndefined()
    expect($turnOutcome('runtime-2', 'user-1').get()).toEqual(OUTCOME)
  })

  it('a profile switch clears them all', () => {
    setTurnOutcome('runtime-1', 'user-1', OUTCOME)

    clearAllSessionStates()

    expect($turnOutcome('runtime-1', 'user-1').get()).toBeUndefined()
  })
})
