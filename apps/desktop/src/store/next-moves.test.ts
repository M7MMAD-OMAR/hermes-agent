import { afterEach, describe, expect, it } from 'vitest'

import { $parkedQueueSessions, clearQueuedPrompts, enqueueQueuedPrompt } from '@/store/composer-queue'
import { clearApprovalRequest, setApprovalRequest } from '@/store/prompts'

import {
  $nextMovesBySession,
  noteTurnCompleted,
  noteTurnStarted,
  offerNextMoves,
  readMoves,
  resetNextMoveTracking,
  withdrawNextMoves
} from './next-moves'

/**
 * The provider's whole job is deciding whether an offer may land. The turn
 * accounting is what makes a REPLAYED frame — the gateway re-delivers every
 * session event past the client's watermark on reconnect, through the same
 * path as live ones — harmless without comparing two machines' clocks.
 */

const move = (over: Record<string, unknown> = {}) => ({
  kind: 'action',
  label: 'Run the tests',
  payload: 'Run the tests that cover what we just changed.',
  tip: 'because',
  ...over
})

const ghost = (sessionId: string) => ($nextMovesBySession.get()[sessionId] ?? []).map(m => m.payload)

/** A session sitting on a clean completion — the only state that takes an offer. */
function settled(sessionId: string) {
  noteTurnStarted(sessionId)
  noteTurnCompleted(sessionId)
}

afterEach(() => {
  resetNextMoveTracking()
  clearApprovalRequest('s1')
  $parkedQueueSessions.set({})
  clearQueuedPrompts('s1')
  $nextMovesBySession.set({})
})

describe('readMoves', () => {
  it('accepts a well-formed pack', () => {
    expect(readMoves([move()])).toHaveLength(1)
  })

  it.each([
    ['not an array', 'nope'],
    ['empty', []],
    ['unknown kind', [move({ kind: 'launch_missiles' })]],
    ['empty label', [move({ label: '   ' })]],
    ['empty payload', [move({ payload: '' })]],
    ['a non-object among valid ones', [move(), 7]]
  ])('rejects %s outright rather than partially', (_name, raw) => {
    expect(readMoves(raw)).toEqual([])
  })

  it('caps a long pack instead of rejecting it', () => {
    expect(readMoves(Array.from({ length: 20 }, (_, i) => move({ label: `Move ${i}` })))).toHaveLength(3)
  })

  it('clips a label to what the pill can show', () => {
    expect(readMoves([move({ label: 'y'.repeat(200) })])[0]!.label.length).toBeLessThanOrEqual(48)
  })
})

describe('offerNextMoves', () => {
  it('publishes for a session sitting on a clean completion', () => {
    settled('s1')

    expect(offerNextMoves('s1', [move()])).toBe(true)
    expect(ghost('s1')).toEqual(['Run the tests that cover what we just changed.'])
  })

  it('replaces the standing offer rather than accumulating', () => {
    settled('s1')
    offerNextMoves('s1', [move()])

    noteTurnStarted('s1')
    noteTurnCompleted('s1')
    offerNextMoves('s1', [move({ payload: 'Something else entirely.' })])

    expect(ghost('s1')).toEqual(['Something else entirely.'])
  })

  it('drops a payload too long to read on one clipped line', () => {
    settled('s1')

    // The ghost sits where the placeholder does: one line, ellipsis after.
    // All-ellipsis says nothing, so no offer beats a shrug.
    expect(offerNextMoves('s1', [move({ payload: 'x'.repeat(400) })])).toBe(false)
  })

  it('never writes the shared null bucket', () => {
    expect(offerNextMoves(null, [move()])).toBe(false)
    expect(offerNextMoves('', [move()])).toBe(false)
    expect($nextMovesBySession.get()['']).toBeUndefined()
  })

  it('drops an offer for a session that never completed a turn here', () => {
    // The renderer that restarted, or the error path — which arms nothing.
    expect(offerNextMoves('s2', [move()])).toBe(false)
  })

  it('drops an offer that lost the race to the next turn', () => {
    settled('s1')
    noteTurnStarted('s1')

    expect(offerNextMoves('s1', [move()])).toBe(false)
  })

  it('drops a replayed offer delivered several turns later', () => {
    settled('s1')

    for (let i = 0; i < 3; i += 1) {
      noteTurnStarted('s1')
      noteTurnCompleted('s1')
    }

    // The reconnect replays the pack emitted for the first completion. The
    // session has moved on three turns; nothing about the frame itself says so.
    withdrawNextMoves('s1')

    expect(offerNextMoves('s1', [move()])).toBe(false)
  })

  it('drops while a queued prompt is about to drain', () => {
    settled('s1')
    enqueueQueuedPrompt('s1', { attachments: [], text: 'next thing' })

    expect(offerNextMoves('s1', [move()])).toBe(false)
  })

  it('offers when that queue is parked — parked is idle, not imminent', () => {
    settled('s1')
    enqueueQueuedPrompt('s1', { attachments: [], text: 'next thing' })
    $parkedQueueSessions.set({ s1: true })

    expect(offerNextMoves('s1', [move()])).toBe(true)
  })

  it('drops while a blocking prompt owns the composer', () => {
    settled('s1')
    setApprovalRequest({ command: 'rm -rf /', description: 'dangerous', sessionId: 's1' } as never)

    expect(offerNextMoves('s1', [move()])).toBe(false)
  })

  it('emits nothing for a malformed pack', () => {
    settled('s1')

    expect(offerNextMoves('s1', [move({ kind: 'nope' })])).toBe(false)
    expect(ghost('s1')).toEqual([])
  })

  it('takes a fresh offer on the next turn after the last one was accepted', () => {
    // Accepting withdraws, which disarms the session. The next completion has
    // to re-arm it or the feature works exactly once per conversation.
    settled('s1')
    offerNextMoves('s1', [move()])
    withdrawNextMoves('s1')

    noteTurnStarted('s1')
    noteTurnCompleted('s1')

    expect(offerNextMoves('s1', [move({ payload: 'The next thing.' })])).toBe(true)
    expect(ghost('s1')).toEqual(['The next thing.'])
  })
})

describe('withdrawNextMoves', () => {
  it('clears the offer and disarms the session', () => {
    settled('s1')
    offerNextMoves('s1', [move()])

    withdrawNextMoves('s1')

    expect(ghost('s1')).toEqual([])
    // Disarmed: a late pack for the withdrawn turn cannot re-land.
    expect(offerNextMoves('s1', [move()])).toBe(false)
  })

  it('is safe with nothing standing', () => {
    expect(() => withdrawNextMoves('unknown')).not.toThrow()
    expect(() => withdrawNextMoves(null)).not.toThrow()
  })
})
