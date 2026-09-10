import { describe, expect, it } from 'vitest'

import { OUTCOME_ITEM_LIMIT, OUTCOME_MAX_ITEMS, readTurnOutcome, turnOutcomesEquivalent } from './turn-outcome'

/**
 * The turn-outcome contract, renderer side. Both ends of the wire are untrusted
 * here: a live `session.outcome` frame and a `display_metadata` blob off the DB
 * both reach the UI only through `readTurnOutcome`, so this is the suite that
 * pins what an older or hostile backend cannot make it render.
 */

const row = (over: Record<string, unknown> = {}) => ({
  delivered: ['a'],
  failed: [],
  open: [],
  source: 'model',
  ...over
})

describe('readTurnOutcome', () => {
  it('accepts the contract and defaults an unknown source to rules', () => {
    expect(readTurnOutcome(row())).toEqual({ delivered: ['a'], failed: [], open: [], source: 'model' })
    expect(readTurnOutcome(row({ source: 'guessed' }))?.source).toBe('rules')
    expect(readTurnOutcome(row({ source: undefined }))?.source).toBe('rules')
  })

  it('treats a missing list as empty but a non-list as a broken payload', () => {
    expect(readTurnOutcome({ delivered: ['a'] })).toEqual({ delivered: ['a'], failed: [], open: [], source: 'rules' })
    expect(readTurnOutcome({ delivered: 'a' })).toBeNull()
    expect(readTurnOutcome({ delivered: ['a'], failed: 3 })).toBeNull()
  })

  it('rejects anything that is not an outcome object', () => {
    for (const raw of [null, undefined, 'text', 7, [], [{ delivered: ['a'] }]]) {
      expect(readTurnOutcome(raw)).toBeNull()
    }
  })

  it('refuses an outcome with nothing to say', () => {
    // An empty row is not an outcome: it would render a heading over no items.
    expect(readTurnOutcome({ delivered: [], failed: [], open: [], source: 'model' })).toBeNull()
    expect(readTurnOutcome(row({ delivered: ['', '   '] }))).toBeNull()
  })

  it('drops non-strings, blanks and duplicates rather than failing the row', () => {
    expect(readTurnOutcome(row({ delivered: ['a', 2, null, '', 'a', 'b'] }))?.delivered).toEqual(['a', 'b'])
  })

  it('caps the list and clips each item, guarding against an older backend', () => {
    expect(readTurnOutcome(row({ delivered: ['a', 'b', 'c', 'd', 'e'] }))?.delivered).toHaveLength(OUTCOME_MAX_ITEMS)

    const long = readTurnOutcome(row({ delivered: ['x'.repeat(OUTCOME_ITEM_LIMIT + 50)] }))?.delivered[0]

    expect(long).toHaveLength(OUTCOME_ITEM_LIMIT)
    expect(long?.slice(-1)).toBe('…')
  })

  it('flattens whitespace so a multi-line item stays one row', () => {
    expect(readTurnOutcome(row({ delivered: ['  wrote\n  two   files  '] }))?.delivered).toEqual(['wrote two files'])
  })
})

describe('turnOutcomesEquivalent', () => {
  it('compares structurally, not by identity', () => {
    expect(turnOutcomesEquivalent(readTurnOutcome(row()), readTurnOutcome(row()))).toBe(true)
    expect(turnOutcomesEquivalent(readTurnOutcome(row()), readTurnOutcome(row({ delivered: ['b'] })))).toBe(false)
  })

  it('counts source, so a rules row never reads as its model upgrade', () => {
    expect(turnOutcomesEquivalent(readTurnOutcome(row()), readTurnOutcome(row({ source: 'rules' })))).toBe(false)
  })

  it('treats a missing outcome as equal only to another missing one', () => {
    expect(turnOutcomesEquivalent(undefined, undefined)).toBe(true)
    expect(turnOutcomesEquivalent(readTurnOutcome(row()), undefined)).toBe(false)
    expect(turnOutcomesEquivalent(null, undefined)).toBe(false)
  })

  it('does not confuse list boundaries the way a joined string would', () => {
    // `['a','b']` and `['a b']` join to the same string; they are not the same
    // row, and claiming they are would skip a needed repaint.
    expect(turnOutcomesEquivalent(readTurnOutcome(row({ delivered: ['a', 'b'] })), readTurnOutcome(row({ delivered: ['a b'] })))).toBe(false)
  })
})
