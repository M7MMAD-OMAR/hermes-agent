import type { ThreadSummary } from '@hermes/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $subagentsBySession, type SubagentProgress } from './subagents'

/**
 * `tryRouteToThread` is the seam the composer calls before starting a turn.
 *
 * The contract it has to keep is narrow and unforgiving: return false for
 * anything not explicitly addressed at a running thread (so ordinary messages
 * are untouched), and never leave a receipt claiming a message arrived
 * somewhere it did not.
 */

// The send is injected rather than module-mocked: `tryRouteToThread` calls it
// from inside its own module, where a module mock cannot reach.
const steerThread = vi.fn()

import {
  $threadRouteReceipt,
  $threadRouteUndo,
  $threadsByCoordinator,
  consumeThreadRouteUndo,
  resetThreadStore,
  tryRouteToThread,
  undoThreadRoute
} from './threads'

function durable(label: string, sessionId: string): ThreadSummary {
  return {
    coordinator_session_id: 'coord-1',
    cwd: null,
    end_reason: null,
    ended_at: null,
    label,
    message_count: 4,
    model: 'm',
    preview: '',
    profile_name: null,
    session_id: sessionId,
    started_at: 100,
    state: 'working',
    title: null,
    tool_call_count: 1
  }
}

function live(sessionId: string, id: string): SubagentProgress {
  return {
    filesRead: [],
    filesWritten: [],
    goal: 'do the work',
    id,
    parentId: null,
    sessionId,
    startedAt: 100,
    status: 'running',
    stream: [],
    taskCount: 1,
    taskIndex: 0,
    updatedAt: 100
  }
}

function seedRunningThread() {
  $threadsByCoordinator.setKey('coord-1', [durable('History of the cyanotype style', 't-history')])
  $subagentsBySession.set({ 'coord-1': [live('t-history', 'sub-history')] })
}

describe('tryRouteToThread', () => {
  beforeEach(() => {
    resetThreadStore()
    $subagentsBySession.set({})
    steerThread.mockReset()
    steerThread.mockResolvedValue('sent')
  })

  it('leaves an ordinary message alone', () => {
    seedRunningThread()

    expect(tryRouteToThread('what is the style called?', 'coord-1', steerThread)).toBe(false)
    expect(steerThread).not.toHaveBeenCalled()
    expect($threadRouteReceipt.get()).toBeNull()
  })

  it('leaves a request to CREATE a thread alone', () => {
    seedRunningThread()

    expect(tryRouteToThread('make a new thread for these charts', 'coord-1', steerThread)).toBe(false)
  })

  it('routes a message explicitly addressed at a running thread', () => {
    seedRunningThread()

    expect(tryRouteToThread('@thread check the Japanese lineage', 'coord-1', steerThread)).toBe(true)
    expect(steerThread).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 't-history' }),
      'check the Japanese lineage',
      'coord-1'
    )
  })

  it('shows the receipt immediately, before the steer resolves', () => {
    // The user must see where their words went now, not after a round trip.
    seedRunningThread()
    steerThread.mockReturnValue(new Promise(() => {}))

    tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)

    expect($threadRouteReceipt.get()?.threadLabel).toBe('History of the cyanotype style')
    expect($threadRouteReceipt.get()?.originalText).toBe('@thread check the lineage')
  })

  it('hands the words back when the steer does not land', async () => {
    // The failure this exists to stop: a receipt claiming delivery for a
    // message the thread never received.
    seedRunningThread()
    steerThread.mockResolvedValue('unreachable')

    tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)
    await vi.waitFor(() => expect($threadRouteUndo.get()).toBe('@thread check the lineage'))

    expect($threadRouteReceipt.get()).toBeNull()
  })

  it('routes nothing when no thread is running', () => {
    $threadsByCoordinator.setKey('coord-1', [durable('History of the cyanotype style', 't-history')])

    expect(tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)).toBe(false)
  })

  it('routes nothing without a coordinator', () => {
    seedRunningThread()

    expect(tryRouteToThread('@thread check the lineage', '', steerThread)).toBe(false)
  })

  it('routes nothing for an empty message', () => {
    seedRunningThread()

    expect(tryRouteToThread('   ', 'coord-1', steerThread)).toBe(false)
  })
})

describe('undo', () => {
  beforeEach(() => {
    resetThreadStore()
    $subagentsBySession.set({})
    steerThread.mockReset()
    steerThread.mockResolvedValue('sent')
  })

  it('returns the original words, not the stripped instruction', () => {
    seedRunningThread()
    tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)

    undoThreadRoute()

    expect(consumeThreadRouteUndo()).toBe('@thread check the lineage')
  })

  it('clears the receipt so the bar does not linger', () => {
    seedRunningThread()
    tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)

    undoThreadRoute()

    expect($threadRouteReceipt.get()).toBeNull()
  })

  it('is consumed once', () => {
    seedRunningThread()
    tryRouteToThread('@thread check the lineage', 'coord-1', steerThread)
    undoThreadRoute()

    expect(consumeThreadRouteUndo()).toBeTruthy()
    expect(consumeThreadRouteUndo()).toBeNull()
  })

  it('does nothing without a receipt', () => {
    undoThreadRoute()

    expect(consumeThreadRouteUndo()).toBeNull()
  })
})

describe('cross conversation isolation', () => {
  beforeEach(() => {
    resetThreadStore()
    $subagentsBySession.set({})
    steerThread.mockReset()
    steerThread.mockResolvedValue('sent')
  })

  it('never steers another conversation’s worker', () => {
    // The harm this module exists to prevent, and the shape that slipped
    // through once: one thread running in conversation A, the user types in
    // conversation B, and B's words are sent into A's worker because it was
    // the only one running anywhere.
    $threadsByCoordinator.setKey('coord-A', [durable('A thread doing work', 't-a')])
    $subagentsBySession.set({ 'coord-A': [live('t-a', 'sub-a')] })

    expect(tryRouteToThread('@thread check the lineage', 'coord-B', steerThread)).toBe(false)
    expect(steerThread).not.toHaveBeenCalled()
  })

  it('routes to this conversation’s thread and not the other one', () => {
    $threadsByCoordinator.setKey('coord-A', [durable('A thread doing work', 't-a')])
    $threadsByCoordinator.setKey('coord-B', [durable('B thread doing work', 't-b')])
    $subagentsBySession.set({
      'coord-A': [live('t-a', 'sub-a')],
      'coord-B': [live('t-b', 'sub-b')]
    })

    expect(tryRouteToThread('@thread check the lineage', 'coord-B', steerThread)).toBe(true)
    expect(steerThread).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 't-b' }),
      'check the lineage',
      'coord-B'
    )
  })
})
