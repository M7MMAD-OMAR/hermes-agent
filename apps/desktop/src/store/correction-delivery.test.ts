import { beforeEach, describe, expect, it } from 'vitest'

import {
  $pendingCorrections,
  clearAllPendingCorrections,
  clearPendingCorrection,
  isCorrectionWaiting,
  setPendingCorrection
} from './correction-delivery'

beforeEach(() => {
  clearAllPendingCorrections()
})

describe('pending correction store', () => {
  it('records what was sent and how it will arrive', () => {
    setPendingCorrection('s1', 'use tabs', 'tool_boundary')

    const pending = $pendingCorrections.get().s1

    expect(pending?.text).toBe('use tabs')
    expect(pending?.delivery).toBe('tool_boundary')
  })

  it('keeps sessions apart', () => {
    // A correction shown against the wrong conversation is worse than showing none.
    setPendingCorrection('s1', 'first', 'tool_boundary')
    setPendingCorrection('s2', 'second', 'tool_boundary_blocked')

    expect($pendingCorrections.get().s1?.text).toBe('first')
    expect($pendingCorrections.get().s2?.delivery).toBe('tool_boundary_blocked')
  })

  it('a newer correction replaces the older one', () => {
    // Two corrections in a row are one intent; the row must name the latest, not the stalest.
    setPendingCorrection('s1', 'first', 'tool_boundary')
    setPendingCorrection('s1', 'actually, second', 'tool_boundary')

    expect($pendingCorrections.get().s1?.text).toBe('actually, second')
  })

  it('ignores an empty session id instead of writing a bogus key', () => {
    setPendingCorrection('', 'orphan', 'tool_boundary')

    expect(Object.keys($pendingCorrections.get())).toHaveLength(0)
  })

  it('clears one session and leaves the rest', () => {
    setPendingCorrection('s1', 'a', 'tool_boundary')
    setPendingCorrection('s2', 'b', 'tool_boundary')
    clearPendingCorrection('s1')

    expect($pendingCorrections.get().s1).toBeUndefined()
    expect($pendingCorrections.get().s2?.text).toBe('b')
  })

  it('clearing a session with nothing pending is a no-op', () => {
    // Every caller is a lifecycle event that fires whether or not a correction was outstanding.
    expect(() => clearPendingCorrection('never-used')).not.toThrow()
    expect(() => clearPendingCorrection('')).not.toThrow()
  })

  it('clears everything for a profile switch', () => {
    setPendingCorrection('s1', 'a', 'tool_boundary')
    setPendingCorrection('s2', 'b', 'tool_boundary')
    clearAllPendingCorrections()

    expect(Object.keys($pendingCorrections.get())).toHaveLength(0)
  })
})

describe('isCorrectionWaiting', () => {
  it('is true only for the modes that actually wait', () => {
    setPendingCorrection('s1', 'x', 'tool_boundary')
    expect(isCorrectionWaiting($pendingCorrections.get().s1)).toBe(true)

    setPendingCorrection('s1', 'x', 'tool_boundary_blocked')
    expect(isCorrectionWaiting($pendingCorrections.get().s1)).toBe(true)
  })

  it('is false once the correction is already in the rebuilt turn', () => {
    // Narrating something that already happened is noise, not reassurance.
    setPendingCorrection('s1', 'x', 'model_cancelled')

    expect(isCorrectionWaiting($pendingCorrections.get().s1)).toBe(false)
  })

  it('is false for a session with nothing pending', () => {
    expect(isCorrectionWaiting(undefined)).toBe(false)
  })
})
