import { afterEach, describe, expect, it } from 'vitest'

import { $graftSavingsBySession, clearAllGraftSavings, clearGraftSavings, recordGraftToolResult } from './graft-savings'

const SAVED_17K = '[graft] tokens saved ≈ 17,234 (93%) \u2014 this pack ≈ 1,263 tok\n\ngraft ask \u2014 "x"'
const SAVED_720 = '[graft] tokens saved ≈ 720 (86%) \u2014 this output ≈ 122 tok\n\ngraft skeleton \u2014 a.ts'

afterEach(() => {
  clearAllGraftSavings()
})

describe('graft-savings store', () => {
  it('accumulates tokens and calls per session', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)
    recordGraftToolResult('s1', 't2', 'mcp__graft__graft_file_api', SAVED_720)
    recordGraftToolResult('s2', 't3', 'mcp__graft__graft_find_code', SAVED_17K)

    expect($graftSavingsBySession.get()['s1']).toEqual({ calls: 2, tokensSaved: 17954 })
    expect($graftSavingsBySession.get()['s2']).toEqual({ calls: 1, tokensSaved: 17234 })
    expect($graftSavingsBySession.get()['s3']).toBeUndefined()
  })

  it('counts a call that reported no savings line as a call with zero saved', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_check_freshness', 'graph check: OK')

    expect($graftSavingsBySession.get()['s1']).toEqual({ calls: 1, tokensSaved: 0 })
  })

  it('counts each tool id once even when tool.complete is replayed', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)

    expect($graftSavingsBySession.get()['s1']).toEqual({ calls: 1, tokensSaved: 17234 })
  })

  it('ignores non-graft tools and missing sessions', () => {
    recordGraftToolResult('s1', 't1', 'read_file', SAVED_17K)
    recordGraftToolResult('s1', 't2', 'mcp__figma__get_design_context', SAVED_17K)
    recordGraftToolResult('', 't3', 'mcp__graft__graft_find_code', SAVED_17K)

    expect($graftSavingsBySession.get()).toEqual({})
  })

  it('drops one session on clear and leaves every other tally standing', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)
    recordGraftToolResult('s2', 't2', 'mcp__graft__graft_find_code', SAVED_720)

    clearGraftSavings('s1')

    expect($graftSavingsBySession.get()['s1']).toBeUndefined()
    expect($graftSavingsBySession.get()['s2']).toEqual({ calls: 1, tokensSaved: 720 })
  })

  it('forgets the seen tool ids too, so a recycled id counts again', () => {
    // The dedup set is keyed by session; leaving it behind would make a reused
    // runtime id silently skip its first graft call.
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)
    clearGraftSavings('s1')
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)

    expect($graftSavingsBySession.get()['s1']).toEqual({ calls: 1, tokensSaved: 17234 })
  })

  it('clearing an unknown session is a no-op', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', SAVED_17K)

    const before = $graftSavingsBySession.get()

    clearGraftSavings('nope')
    expect($graftSavingsBySession.get()).toBe(before)
  })

  it('reads MCP content-block results too', () => {
    recordGraftToolResult('s1', 't1', 'mcp__graft__graft_find_code', { content: [{ text: SAVED_17K, type: 'text' }] })

    expect($graftSavingsBySession.get()['s1']?.tokensSaved).toBe(17234)
  })
})
