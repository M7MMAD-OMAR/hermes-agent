import { afterEach, describe, expect, it } from 'vitest'

import { readTurnOutcome } from '@/lib/turn-outcome'

import {
  $turnOutcome,
  $turnOutcomes,
  clearAllTurnOutcomes,
  clearTurnOutcomes,
  setTurnOutcome,
  turnOutcomeKey
} from './turn-outcome'

/**
 * S6 of docs/design/herwork-workspace.md, store half: an outcome is bound to
 * (session, turn), accepted whole or not at all, idempotent under replay, and
 * evicted with its session rather than on a clock.
 */

const rules = { delivered: ['Edited 2 files: a, b'], failed: ['terminal reported an error'], open: [], source: 'rules' }
const model = { delivered: ['q3-report.docx in output/'], failed: [], open: ['review slide 4'], source: 'model' }

afterEach(() => {
  clearAllTurnOutcomes()
})

describe('readTurnOutcome', () => {
  it('accepts the contract and normalises the source', () => {
    expect(readTurnOutcome(model)).toEqual(model)
    expect(readTurnOutcome({ ...rules, source: 'anything else' })?.source).toBe('rules')
  })

  it('treats a missing list as empty but a wrong-typed one as not the contract', () => {
    expect(readTurnOutcome({ delivered: ['x'] })).toEqual({ delivered: ['x'], failed: [], open: [], source: 'rules' })
    expect(readTurnOutcome({ delivered: 'x' })).toBeNull()
    expect(readTurnOutcome(null)).toBeNull()
    expect(readTurnOutcome([])).toBeNull()
  })

  it('has nothing to show for an outcome with nothing in it', () => {
    expect(readTurnOutcome({ delivered: [], failed: [], open: [], source: 'model' })).toBeNull()
  })

  it('caps every list at three and every item at 140 characters, dropping non-strings', () => {
    const outcome = readTurnOutcome({ delivered: ['a', 'b', 'c', 'd'], failed: ['z'.repeat(300)], open: [1, '  spaced   out '] })

    expect(outcome?.delivered).toEqual(['a', 'b', 'c'])
    expect(outcome?.failed[0]).toHaveLength(140)
    expect(outcome?.failed[0]?.endsWith('…')).toBe(true)
    expect(outcome?.open).toEqual(['spaced out'])
  })
})

describe('setTurnOutcome', () => {
  it('stores under (session, turn) and the per-key atom sees exactly that one', () => {
    expect(setTurnOutcome('s1', 'user-1', rules)).toBe(true)

    expect($turnOutcome('s1', 'user-1').get()).toEqual(rules)
    expect($turnOutcome('s1', 'user-2').get()).toBeUndefined()
    expect($turnOutcome('s2', 'user-1').get()).toBeUndefined()
    expect($turnOutcome('s1', 'user-1')).toBe($turnOutcome('s1', 'user-1'))
  })

  it('refuses a missing id or a payload off the contract', () => {
    expect(setTurnOutcome('', 'user-1', rules)).toBe(false)
    expect(setTurnOutcome('s1', '', rules)).toBe(false)
    expect(setTurnOutcome('s1', 'user-1', { delivered: 'no' })).toBe(false)
    expect($turnOutcomes.get()).toEqual({})
  })

  it('upgrades rules text to model text in place, never the other way round', () => {
    setTurnOutcome('s1', 'user-1', rules)
    expect(setTurnOutcome('s1', 'user-1', model)).toBe(true)
    expect($turnOutcome('s1', 'user-1').get()).toEqual(model)

    // A replayed rules frame arriving after the upgrade changes nothing.
    expect(setTurnOutcome('s1', 'user-1', rules)).toBe(false)
    expect($turnOutcome('s1', 'user-1').get()).toEqual(model)
  })

  it('is idempotent under replay', () => {
    setTurnOutcome('s1', 'user-1', model)
    setTurnOutcome('s1', 'user-1', model)

    expect(Object.keys($turnOutcomes.get())).toEqual([turnOutcomeKey('s1', 'user-1')])
  })
})

describe('eviction', () => {
  it('follows the session and leaves other sessions alone', () => {
    setTurnOutcome('s1', 'user-1', rules)
    setTurnOutcome('s1', 'user-2', model)
    setTurnOutcome('s2', 'user-1', model)

    clearTurnOutcomes('s1')

    expect($turnOutcome('s1', 'user-1').get()).toBeUndefined()
    expect($turnOutcome('s1', 'user-2').get()).toBeUndefined()
    expect($turnOutcome('s2', 'user-1').get()).toEqual(model)
  })

  it('does not confuse a session whose id is a prefix of another', () => {
    setTurnOutcome('s1', 'user-1', rules)
    setTurnOutcome('s10', 'user-1', model)

    clearTurnOutcomes('s1')

    expect($turnOutcome('s10', 'user-1').get()).toEqual(model)
  })

  it('clears everything on a profile switch', () => {
    setTurnOutcome('s1', 'user-1', rules)
    setTurnOutcome('s2', 'user-1', model)

    clearAllTurnOutcomes()

    expect($turnOutcomes.get()).toEqual({})
  })
})
