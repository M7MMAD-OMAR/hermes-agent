import type { ThreadStateCounts, ThreadSummary } from '@hermes/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubagentProgress, SubagentStatus } from './subagents'
import {
  $threadsByCoordinator,
  $threadsLoading,
  clearThreads,
  groupThreadRows,
  mergeThreadRows,
  refreshThreads,
  resetThreadStore,
  threadCounts,
  threadCountsFor,
  threadDuration,
  threadsFor,
  threadStateForSubagent
} from './threads'

/**
 * The dock shows one list built from two sources that overlap: `thread.list`
 * is durable and knows a thread exists, `subagent.*` is live and knows what it
 * is doing. `mergeThreadRows` is that join, and the tests below are mostly
 * about the ways it can show the same child twice or lose it entirely.
 */

function durable(overrides: Partial<ThreadSummary> & Pick<ThreadSummary, 'session_id'>): ThreadSummary {
  return {
    coordinator_session_id: 'coord-1',
    cwd: null,
    end_reason: null,
    ended_at: null,
    label: overrides.session_id,
    message_count: 4,
    model: 'test-model',
    preview: '',
    profile_name: null,
    started_at: 100,
    state: 'resolved',
    title: null,
    tool_call_count: 2,
    ...overrides
  }
}

function live(overrides: Partial<SubagentProgress> & Pick<SubagentProgress, 'id'>): SubagentProgress {
  return {
    filesRead: [],
    filesWritten: [],
    goal: 'do the work',
    parentId: null,
    startedAt: 100,
    status: 'running' as SubagentStatus,
    stream: [],
    taskCount: 1,
    taskIndex: 0,
    updatedAt: 100,
    ...overrides
  }
}

describe('threadStateForSubagent', () => {
  it.each([
    ['running', 'working'],
    ['queued', 'working'],
    ['completed', 'resolved']
  ] as const)('maps %s to %s', (status, expected) => {
    expect(threadStateForSubagent(status)).toBe(expected)
  })

  it.each(['failed', 'interrupted'] as const)('treats %s as failed, never resolved', status => {
    // An interrupted thread did not finish on its own terms. Rendering it as
    // resolved would tell the user work landed that never did.
    expect(threadStateForSubagent(status)).toBe('failed')
  })
})

describe('mergeThreadRows', () => {
  it('returns durable rows when nothing is live', () => {
    const rows = mergeThreadRows([durable({ session_id: 't-1' })], [])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.sessionId).toBe('t-1')
    expect(rows[0]?.live).toBe(false)
  })

  it('does not duplicate a child that both sources describe', () => {
    // The whole point of the join. Two sources, one row.
    const rows = mergeThreadRows(
      [durable({ session_id: 't-1' })],
      [live({ id: 'sub-1', sessionId: 't-1' })]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.live).toBe(true)
    expect(rows[0]?.subagentId).toBe('sub-1')
  })

  it('lets the live status win over the durable one', () => {
    const rows = mergeThreadRows(
      [durable({ session_id: 't-1', state: 'resolved' })],
      [live({ id: 'sub-1', sessionId: 't-1', status: 'running' })]
    )

    expect(rows[0]?.state).toBe('working')
  })

  it('shows a live child that has no durable row yet', () => {
    // A child's session row lands a moment after it starts. A thread that is
    // invisible for its first seconds reads as a dropped request.
    const rows = mergeThreadRows([], [live({ goal: 'trace the lineage', id: 'sub-1', sessionId: 't-new' })])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.sessionId).toBe('t-new')
    expect(rows[0]?.label).toBe('trace the lineage')
    expect(rows[0]?.live).toBe(true)
  })

  it('falls back to the subagent id when a live child has no session id yet', () => {
    const rows = mergeThreadRows([], [live({ goal: '', id: 'sub-1' })])

    expect(rows[0]?.sessionId).toBe('sub-1')
    expect(rows[0]?.label).toBe('sub-1')
  })

  it('keeps a durable title instead of the raw live goal', () => {
    // A titled thread must not be renamed back to its goal by a live event.
    const rows = mergeThreadRows(
      [durable({ label: 'History of the style', session_id: 't-1', title: 'History of the style' })],
      [live({ goal: 'research the history of the style and report back', id: 'sub-1', sessionId: 't-1' })]
    )

    expect(rows[0]?.label).toBe('History of the style')
  })

  it('carries the live activity line', () => {
    const rows = mergeThreadRows(
      [durable({ session_id: 't-1' })],
      [live({ currentTool: 'read_file', id: 'sub-1', sessionId: 't-1' })]
    )

    expect(rows[0]?.activity).toBe('read_file')
  })

  it('falls back to the last stream entry when no tool is active', () => {
    const rows = mergeThreadRows(
      [durable({ session_id: 't-1' })],
      [
        live({
          id: 'sub-1',
          sessionId: 't-1',
          stream: [{ at: 1, kind: 'progress', text: 'Reading the reference plate' }]
        })
      ]
    )

    expect(rows[0]?.activity).toBe('Reading the reference plate')
  })

  it('counts a thread’s own children on its badge rather than listing them', () => {
    // A child of a child is structure inside one thread, not a second thread.
    const rows = mergeThreadRows(
      [durable({ session_id: 't-1' })],
      [
        live({ id: 'sub-1', sessionId: 't-1' }),
        live({ id: 'sub-2', parentId: 'sub-1', sessionId: 't-1-a' }),
        live({ id: 'sub-3', parentId: 'sub-1', sessionId: 't-1-b' })
      ]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.childCount).toBe(2)
  })

  it('orders newest first and breaks ties deterministically', () => {
    const rows = mergeThreadRows(
      [
        durable({ session_id: 't-old', started_at: 100 }),
        durable({ session_id: 't-new', started_at: 300 }),
        durable({ session_id: 't-b', started_at: 200 }),
        durable({ session_id: 't-a', started_at: 200 })
      ],
      []
    )

    expect(rows.map(row => row.sessionId)).toEqual(['t-new', 't-a', 't-b', 't-old'])
  })

  it('stamps the coordinator on a live-only row', () => {
    const rows = mergeThreadRows([], [live({ id: 'sub-1', sessionId: 't-1' })], 'coord-9')

    expect(rows[0]?.coordinatorSessionId).toBe('coord-9')
  })
})

describe('groupThreadRows', () => {
  it('splits rows into every section, empty ones included', () => {
    const rows = mergeThreadRows(
      [
        durable({ session_id: 't-done', state: 'resolved' }),
        durable({ session_id: 't-lost', state: 'failed' })
      ],
      []
    )

    const grouped = groupThreadRows(rows)

    expect(Object.keys(grouped).sort()).toEqual(['failed', 'resolved', 'working'])
    expect(grouped.working).toEqual([])
    expect(grouped.resolved.map(row => row.sessionId)).toEqual(['t-done'])
  })
})

describe('threadCounts', () => {
  const counts: ThreadStateCounts = { failed: 1, resolved: 7, working: 2 }

  it('uses the whole-scope counts rather than the visible page', () => {
    // Counts describe the scope so a section header does not move as the
    // client pages through it.
    const rows = mergeThreadRows([durable({ session_id: 't-1' })], [])

    expect(threadCounts(rows, counts)).toEqual(counts)
  })

  it('adds a live child the durable counts cannot know about yet', () => {
    const rows = mergeThreadRows([], [live({ id: 'sub-1', sessionId: 't-new' })])

    expect(threadCounts(rows, counts).working).toBe(3)
  })

  it('does not double count a live child that is already durable', () => {
    const rows = mergeThreadRows(
      [durable({ message_count: 12, session_id: 't-1', state: 'working' })],
      [live({ id: 'sub-1', sessionId: 't-1' })]
    )

    expect(threadCounts(rows, counts).working).toBe(2)
  })

  it('reports zeros rather than omitting a section', () => {
    expect(threadCounts([])).toEqual({ failed: 0, resolved: 0, working: 0 })
  })
})

describe('refreshThreads', () => {
  beforeEach(() => {
    resetThreadStore()
  })

  it('stores threads and counts for the coordinator', async () => {
    const request = vi.fn().mockResolvedValue({
      counts: { failed: 0, resolved: 1, working: 0 },
      threads: [durable({ session_id: 't-1' })],
      total: 1
    })

    await expect(refreshThreads('coord-1', request)).resolves.toBe(true)

    expect(request).toHaveBeenCalledWith('thread.list', { coordinator_session_id: 'coord-1' })
    expect(threadsFor('coord-1')).toHaveLength(1)
    expect(threadCountsFor('coord-1').resolved).toBe(1)
  })

  it('passes extra params through', async () => {
    const request = vi.fn().mockResolvedValue({ counts: { failed: 0, resolved: 0, working: 0 }, threads: [] })

    await refreshThreads('coord-1', request, { limit: 10, states: ['working'] })

    expect(request).toHaveBeenCalledWith('thread.list', {
      coordinator_session_id: 'coord-1',
      limit: 10,
      states: ['working']
    })
  })

  it('keeps the previous rows when the read fails', async () => {
    // Stale threads beat an empty dock, and the live rows on top are
    // unaffected by a durable read failing.
    $threadsByCoordinator.setKey('coord-1', [durable({ session_id: 't-1' })])

    const request = vi.fn().mockRejectedValue(new Error('socket closed'))

    await expect(refreshThreads('coord-1', request)).resolves.toBe(false)
    expect(threadsFor('coord-1')).toHaveLength(1)
  })

  it('clears the loading flag on success and on failure', async () => {
    await refreshThreads('coord-1', vi.fn().mockResolvedValue({ counts: {}, threads: [] }))
    expect($threadsLoading.get().has('coord-1')).toBe(false)

    await refreshThreads('coord-1', vi.fn().mockRejectedValue(new Error('nope')))
    expect($threadsLoading.get().has('coord-1')).toBe(false)
  })

  it('refuses an empty coordinator without calling the gateway', async () => {
    const request = vi.fn()

    await expect(refreshThreads('', request)).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('clears one coordinator without touching another', async () => {
    $threadsByCoordinator.setKey('coord-1', [durable({ session_id: 't-1' })])
    $threadsByCoordinator.setKey('coord-2', [durable({ session_id: 't-2' })])

    clearThreads('coord-1')

    expect(threadsFor('coord-1')).toEqual([])
    expect(threadsFor('coord-2')).toHaveLength(1)
  })

  it('returns empty rows for an unknown coordinator', () => {
    expect(threadsFor(null)).toEqual([])
    expect(threadCountsFor(undefined)).toEqual({ failed: 0, resolved: 0, working: 0 })
  })
})

describe('threadDuration', () => {
  it('reports how long a finished thread ran', () => {
    const rows = mergeThreadRows([durable({ ended_at: 400, session_id: 't-1', started_at: 100 })], [])

    expect(threadDuration(rows[0]!)).toBe(300)
  })

  it('is unknown while the thread is still running', () => {
    const rows = mergeThreadRows([durable({ ended_at: null, session_id: 't-1', state: 'working' })], [])

    expect(threadDuration(rows[0]!)).toBeNull()
  })

  it('is unknown for a live row even when the snapshot says it ended', () => {
    // The durable snapshot can predate this run's restart. A row the live
    // roster still owns is running, whatever the snapshot said.
    const rows = mergeThreadRows(
      [durable({ ended_at: 400, session_id: 't-1', started_at: 100 })],
      [live({ id: 'sub-1', sessionId: 't-1' })]
    )

    expect(threadDuration(rows[0]!)).toBeNull()
  })

  it('never reports a negative duration from a clock regression', () => {
    const rows = mergeThreadRows([durable({ ended_at: 50, session_id: 't-1', started_at: 100 })], [])

    expect(threadDuration(rows[0]!)).toBe(0)
  })
})
