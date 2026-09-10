import { describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'

import { handleOutcomeEvent } from './outcome'
import type { GatewayEventContext } from './types'

/**
 * S6 of docs/design/herwork-workspace.md, handler half. `session.outcome`
 * stamps the outcome onto the turn's final assistant message (the same row the
 * backend persisted it on), keyed by the event's OWN routed session id. An
 * unscoped frame is dropped upstream and never reaches here; a background
 * session's message list is still patched.
 */

const OUTCOME = { delivered: ['q3-report.docx in output/'], failed: [], open: ['review slide 4'], source: 'model' }

function assistant(id: string, turnOutcome?: unknown): ChatMessage {
  return { id, role: 'assistant', parts: [], ...(turnOutcome ? { turnOutcome } : {}) } as unknown as ChatMessage
}

function context(
  messages: ChatMessage[],
  payload: Record<string, unknown> = {},
  overrides: Partial<GatewayEventContext> = {}
): { ctx: GatewayEventContext; states: Map<string, ClientSessionState>; updateSessionState: ReturnType<typeof vi.fn> } {
  const states = new Map<string, ClientSessionState>()
  states.set('routed-session', { ...createClientSessionState(null, messages) })

  const updateSessionState = vi.fn((sessionId: string, updater: (s: ClientSessionState) => ClientSessionState) => {
    const next = updater(states.get(sessionId)!)
    states.set(sessionId, next)

    return next
  })

  const body = { outcome: OUTCOME, session_id: 'routed-session', ...payload }

  const ctx = {
    deps: { updateSessionState } as unknown as GatewayEventContext['deps'],
    event: { payload: body, session_id: 'routed-session', type: 'session.outcome' },
    explicitSid: 'routed-session',
    fromActiveSource: () => true,
    isActiveEvent: false,
    occurredAt: 1_700_000_100,
    payload: body as GatewayEventContext['payload'],
    scheduleConfigRefresh: vi.fn(),
    sessionId: 'routed-session',
    ...overrides
  } as GatewayEventContext

  return { ctx, states, updateSessionState }
}

const outcomeOf = (states: Map<string, ClientSessionState>): unknown =>
  (states.get('routed-session')!.messages as ChatMessage[]).find(m => m.id === 'reply')?.turnOutcome

describe('handleOutcomeEvent', () => {
  it('does not claim other events', () => {
    const { ctx } = context([assistant('reply')], {}, { event: { type: 'message.complete' } as never })
    expect(handleOutcomeEvent(ctx)).toBe(false)
  })

  it('stamps the outcome onto the last assistant message', () => {
    const { ctx, states } = context([assistant('reply-old'), assistant('reply')])

    expect(handleOutcomeEvent(ctx)).toBe(true)
    expect(outcomeOf(states)).toEqual(OUTCOME)
  })

  it('claims an unscoped frame without touching any session', () => {
    const { ctx, updateSessionState } = context([assistant('reply')], {}, { sessionId: null })

    expect(handleOutcomeEvent(ctx)).toBe(true)
    expect(updateSessionState).not.toHaveBeenCalled()
  })

  it('drops a payload that is not the outcome contract', () => {
    const { ctx, updateSessionState } = context([assistant('reply')], { outcome: { delivered: 'no' } })

    expect(handleOutcomeEvent(ctx)).toBe(true)
    expect(updateSessionState).not.toHaveBeenCalled()
  })

  it('leaves the list alone when the turn has no assistant row yet', () => {
    const { ctx, states } = context([{ id: 'user-1', role: 'user', parts: [] } as unknown as ChatMessage])

    handleOutcomeEvent(ctx)
    expect((states.get('routed-session')!.messages as ChatMessage[])[0]?.turnOutcome).toBeUndefined()
  })

  it('leaves the state object untouched when a replayed frame says the same thing', () => {
    // The gateway replays up to 512 frames on reconnect. A new state object per
    // replayed frame is a full message-list rebuild plus every side effect
    // `publishSessionState` carries, for a row that did not change.
    const { ctx, states } = context([assistant('reply', OUTCOME)])
    const before = states.get('routed-session')!

    expect(handleOutcomeEvent(ctx)).toBe(true)
    expect(states.get('routed-session')).toBe(before)
  })

  it('repaints a model upgrade that carries the same three lists', () => {
    // `source` is part of the compare on purpose: identical text arriving as
    // 'model' must still replace the 'rules' row it upgrades.
    const rules = { ...OUTCOME, source: 'rules' }
    const { ctx, states } = context([assistant('reply', rules)])

    handleOutcomeEvent(ctx)
    expect(outcomeOf(states)).toEqual(OUTCOME)
  })

  it('replaces rules text with a model outcome but never the reverse', () => {
    const rules = { delivered: ['Edited 2 files: a, b'], failed: [], open: [], source: 'rules' }

    const upgrade = context([assistant('reply', rules)])
    expect(handleOutcomeEvent(upgrade.ctx)).toBe(true)
    expect(outcomeOf(upgrade.states)).toEqual(OUTCOME)

    const replayed = context([assistant('reply', OUTCOME)], { outcome: rules })
    handleOutcomeEvent(replayed.ctx)
    expect(outcomeOf(replayed.states)).toEqual(OUTCOME)
  })
})
