import { describe, expect, it } from 'vitest'

import {
  addressesAThread,
  messageForThread,
  namedThreads,
  type RouteDecision,
  routeMessage
} from './thread-routing'
import type { ThreadRow } from './threads'

/**
 * Routing a message away from the conversation someone typed it into.
 *
 * Almost every test here asserts that a message stays INLINE. That is the
 * point: a wrong route does not produce a bad answer, it produces no answer,
 * because the words went to a background worker the user was not addressing.
 * Answering inline costs a repeat; guessing costs the message.
 */

function row(overrides: Partial<ThreadRow> & Pick<ThreadRow, 'label'>): ThreadRow {
  return {
    childCount: 0,
    coordinatorSessionId: 'coord-1',
    endedAt: null,
    live: true,
    messageCount: 4,
    model: 'test-model',
    sessionId: `t-${overrides.label.slice(0, 6)}`,
    startedAt: 100,
    state: 'working',
    subagentId: `sub-${overrides.label.slice(0, 6)}`,
    toolCallCount: 2,
    ...overrides
  }
}

const HISTORY = row({ label: 'History of the cyanotype style', sessionId: 't-history', subagentId: 'sub-history' })
const DECK = row({ label: 'Claude Projects presentation deck', sessionId: 't-deck', subagentId: 'sub-deck' })

const routed = (decision: RouteDecision) => (decision.kind === 'route' ? decision.row.sessionId : null)

describe('addressesAThread', () => {
  it.each([
    '@thread check the Japanese lineage',
    'tell the History of the cyanotype style thread to stop',
    'in the History of the cyanotype style thread, check the dates',
    'thread: check the dates'
  ])('recognises %s as addressed at a thread', message => {
    expect(addressesAThread(message)).toBe(true)
  })

  it.each([
    'what is the style called?',
    'I want you to make a new thread for that',
    'the threading model here is interesting',
    'summarise the History of the cyanotype style for me'
  ])('does not treat %s as an address', message => {
    expect(addressesAThread(message)).toBe(false)
  })
})

describe('namedThreads', () => {
  it('matches a thread whose whole label appears', () => {
    const named = namedThreads('in the History of the cyanotype style thread, check dates', [HISTORY, DECK])

    expect(named.map(t => t.sessionId)).toEqual(['t-history'])
  })

  it('ignores punctuation and case', () => {
    const named = namedThreads('tell the "history of the CYANOTYPE style" thread to stop', [HISTORY])

    expect(named).toHaveLength(1)
  })

  it('does not match on partial overlap', () => {
    // "the review" matched four sibling review threads on a real machine.
    expect(namedThreads('what about the style?', [HISTORY])).toEqual([])
  })

  it('refuses to identify a thread by a one or two word label', () => {
    // "deck" appears in sentences that have nothing to do with the deck thread.
    const short = row({ label: 'the deck' })

    expect(namedThreads('put that on the deck please', [short])).toEqual([])
  })
})

describe('routeMessage', () => {
  it('answers inline when nothing addresses a thread', () => {
    expect(routeMessage('what is the style called?', [HISTORY]).kind).toBe('inline')
  })

  it('answers inline for an empty message', () => {
    expect(routeMessage('   ', [HISTORY]).kind).toBe('inline')
  })

  it('routes an explicit, unambiguous mention', () => {
    const decision = routeMessage('tell the History of the cyanotype style thread to check the dates', [
      HISTORY,
      DECK
    ])

    expect(decision.kind).toBe('route')
    expect(routed(decision)).toBe('t-history')
    expect(decision.kind === 'route' && decision.reason).toBe('explicit-mention')
  })

  it('answers inline when two running threads both match', () => {
    // The failure this guard exists to stop: the words fit both, so we cannot
    // know which, so the message stays where its author put it.
    const twin = row({ label: 'History of the cyanotype style', sessionId: 't-twin', subagentId: 'sub-twin' })
    const decision = routeMessage('in the History of the cyanotype style thread, check dates', [HISTORY, twin])

    expect(decision.kind).toBe('inline')
  })

  it('routes a bare @thread only when exactly one thread is running', () => {
    expect(routed(routeMessage('@thread check the lineage', [HISTORY]))).toBe('t-history')
    expect(routeMessage('@thread check the lineage', [HISTORY, DECK]).kind).toBe('inline')
  })

  it('answers inline when no thread is running', () => {
    const finished = row({ label: 'History of the cyanotype style', live: false, state: 'resolved' })

    expect(routeMessage('@thread check the lineage', [finished]).kind).toBe('inline')
  })

  it('answers inline when the named thread has finished', () => {
    // A finished thread has no worker, so "sending" to it is the same lost
    // message by another route.
    const finished = row({
      label: 'History of the cyanotype style',
      live: false,
      sessionId: 't-history',
      state: 'resolved'
    })

    expect(routeMessage('tell the History of the cyanotype style thread to stop', [finished]).kind).toBe('inline')
  })

  it('answers inline for a thread with no steerable worker', () => {
    const noWorker = row({ label: 'History of the cyanotype style', subagentId: undefined })

    expect(routeMessage('tell the History of the cyanotype style thread to stop', [noWorker]).kind).toBe('inline')
  })

  it('answers inline when the user asks for a NEW thread', () => {
    // The exact phrasing from the recording. Asking for a thread to be made is
    // a request to the assistant, never a message to an existing worker.
    expect(routeMessage('I want you to also make a new thread for these charts', [HISTORY]).kind).toBe('inline')
  })

  it('answers inline when a thread name is merely quoted', () => {
    expect(routeMessage('summarise History of the cyanotype style for me', [HISTORY]).kind).toBe('inline')
  })

  it('routes nothing when there are no threads at all', () => {
    expect(routeMessage('@thread do the thing', []).kind).toBe('inline')
  })
})

describe('messageForThread', () => {
  it('strips the address so the worker receives the instruction', () => {
    expect(messageForThread('@thread check the Japanese lineage')).toBe('check the Japanese lineage')
  })

  it('strips a named address', () => {
    expect(messageForThread('tell the History of the style thread to check the dates')).toBe(
      'check the dates'
    )
  })

  it('strips a thread: prefix', () => {
    expect(messageForThread('thread: check the dates')).toBe('check the dates')
  })

  it('never returns an empty instruction', () => {
    // Stripping everything would send a blank steer, which is worse than
    // sending the original words.
    expect(messageForThread('@thread')).toBe('@thread')
  })
})
