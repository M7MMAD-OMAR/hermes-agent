import type { ThreadSummary } from '@hermes/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $subagentsBySession } from '@/store/subagents'
import { $threadCountsByCoordinator, $threadsByCoordinator, resetThreadStore } from '@/store/threads'

import { threadAge, ThreadsView } from './index'

/**
 * The dock's job is to show one row per thread, from two sources, without
 * losing a live child or duplicating a durable one. The merge itself is tested
 * directly in `store/threads.test.ts`; these tests are about what a person
 * actually sees.
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
    started_at: Date.now() / 1000,
    state: 'resolved',
    title: null,
    tool_call_count: 2,
    ...overrides
  }
}

function renderDock(props: Partial<Parameters<typeof ThreadsView>[0]> = {}) {
  return render(
    <ThreadsView coordinatorSessionId="coord-1" onClose={vi.fn()} {...props} />
  )
}

describe('threadAge', () => {
  const now = 1_000_000_000_000

  it('reads seconds as now, because a per-second counter is noise', () => {
    expect(threadAge(now / 1000, now)).toBe('now')
    expect(threadAge(now / 1000 - 30, now)).toBe('now')
  })

  it.each([
    [120, '2m'],
    [3 * 3600, '3h'],
    [2 * 86_400, '2d']
  ])('renders %s seconds ago compactly', (seconds, expected) => {
    expect(threadAge(now / 1000 - seconds, now)).toBe(expected)
  })

  it('never renders a negative age from a clock skew', () => {
    expect(threadAge(now / 1000 + 600, now)).toBe('now')
  })
})

describe('ThreadsView', () => {
  beforeEach(() => {
    resetThreadStore()
    $subagentsBySession.set({})
  })

  it('shows the empty state when the conversation has no threads', () => {
    renderDock()

    expect(screen.getByText(/No threads yet/i)).toBeTruthy()
  })

  it('lists a durable thread under its section', () => {
    $threadsByCoordinator.setKey('coord-1', [
      durable({ label: 'History of the style', session_id: 't-1', state: 'resolved' })
    ])

    renderDock()

    expect(screen.getByText('History of the style')).toBeTruthy()
  })

  it('renders every section even when empty, so a clear inbox is visible', () => {
    // A header that vanishes at zero reads as a missing feature.
    $threadsByCoordinator.setKey('coord-1', [durable({ session_id: 't-1', state: 'resolved' })])

    renderDock()

    expect(screen.getByText('Working')).toBeTruthy()
    expect(screen.getByText('Resolved')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('does not promise a Waiting on you section it cannot fill', () => {
    // A delegated child installs a non-interactive approval callback, so
    // nothing can ask the user anything yet. A permanent zero would lie.
    $threadsByCoordinator.setKey('coord-1', [durable({ session_id: 't-1' })])

    renderDock()

    expect(screen.queryByText('Waiting on you')).toBeNull()
  })

  it('shows the whole-scope count rather than the visible page', () => {
    $threadsByCoordinator.setKey('coord-1', [durable({ session_id: 't-1', state: 'resolved' })])
    $threadCountsByCoordinator.setKey('coord-1', { failed: 0, resolved: 12, working: 0 })

    renderDock()

    expect(screen.getByText('12')).toBeTruthy()
  })

  it('shows a live child that has no durable row yet', () => {
    $subagentsBySession.set({
      'coord-1': [
        {
          currentTool: 'read_file',
          filesRead: [],
          filesWritten: [],
          goal: 'trace the cyanotype lineage',
          id: 'sub-1',
          parentId: null,
          sessionId: 't-live',
          startedAt: Date.now() / 1000,
          status: 'running',
          stream: [],
          taskCount: 1,
          taskIndex: 0,
          updatedAt: Date.now() / 1000
        }
      ]
    })

    renderDock()

    expect(screen.getByText('trace the cyanotype lineage')).toBeTruthy()
    expect(screen.getByText('read_file')).toBeTruthy()
  })

  it('shows one row when both sources describe the same child', () => {
    $threadsByCoordinator.setKey('coord-1', [durable({ label: 'the deck', session_id: 't-1' })])
    $subagentsBySession.set({
      'coord-1': [
        {
          filesRead: [],
          filesWritten: [],
          goal: 'build the deck',
          id: 'sub-1',
          parentId: null,
          sessionId: 't-1',
          startedAt: Date.now() / 1000,
          status: 'running',
          stream: [],
          taskCount: 1,
          taskIndex: 0,
          updatedAt: Date.now() / 1000
        }
      ]
    })

    renderDock()

    expect(screen.getAllByText('the deck')).toHaveLength(1)
    expect(screen.queryByText('build the deck')).toBeNull()
  })

  it('asks for the coordinator’s threads on mount', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)

    renderDock({ onRefresh })

    expect(onRefresh).toHaveBeenCalledWith('coord-1')
  })

  it('does not request threads without a coordinator', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)

    renderDock({ coordinatorSessionId: null, onRefresh })

    expect(onRefresh).not.toHaveBeenCalled()
  })
})
