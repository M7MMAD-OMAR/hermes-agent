import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import type { SessionInfo } from '@/types/hermes'

import {
  $pinnedSessionRows,
  prunePinnedSessionRows,
  rememberedPinnedRow,
  rememberPinnedSessionRows,
  resetPinnedSessionRows,
  watchPinnedSessionRows
} from './session-pin-rows'

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, message_count: 1, source: 'cli', started_at: 0, title: id, ...extra }) as SessionInfo

beforeEach(() => {
  $pinnedSessionIds.set([])
  resetPinnedSessionRows()
})

afterEach(() => {
  $pinnedSessionIds.set([])
  resetPinnedSessionRows()
})

describe('rememberPinnedSessionRows', () => {
  it('keeps the row for a pinned conversation and ignores every other row', () => {
    pinSession('wanted')

    rememberPinnedSessionRows([row('wanted'), row('unrelated'), row('also-unrelated')])

    expect(rememberedPinnedRow('wanted')?.id).toBe('wanted')
    expect(Object.keys($pinnedSessionRows.get())).toEqual(['wanted'])
  })

  it('remembers a row pinned under its lineage root', () => {
    // Pins are stored on the durable root; the row on screen is the live tip.
    pinSession('root')

    rememberPinnedSessionRows([row('tip', { _lineage_root_id: 'root' })])

    expect(rememberedPinnedRow('root')?.id).toBe('tip')
  })

  it('captures the row on the pass that follows the pin gesture', () => {
    // The row is on screen BEFORE it is pinned, so the first pass ignores it; the caller
    // re-runs when the pin set changes, and that pass is the one that must catch it.
    const rows = [row('later')]
    rememberPinnedSessionRows(rows)
    expect(rememberedPinnedRow('later')).toBeUndefined()

    pinSession('later')
    rememberPinnedSessionRows(rows)

    expect(rememberedPinnedRow('later')?.id).toBe('later')
  })

  it('publishes a new object only when the row actually changed', () => {
    // A search result is rebuilt from the payload on every pass, so an unchanged
    // conversation arrives as a fresh object; republishing those would churn the sidebar's
    // Pinned memo and the pin sync's reconcile for nothing.
    pinSession('a')
    rememberPinnedSessionRows([row('a')])
    const first = $pinnedSessionRows.get()

    rememberPinnedSessionRows([row('a')])
    expect($pinnedSessionRows.get()).toBe(first)

    rememberPinnedSessionRows([row('a', { title: 'renamed' })])
    expect($pinnedSessionRows.get()).not.toBe(first)
    expect(rememberedPinnedRow('a')?.title).toBe('renamed')
  })

  it('does nothing when nothing is pinned', () => {
    rememberPinnedSessionRows([row('a'), row('b')])

    expect($pinnedSessionRows.get()).toEqual({})
  })
})

describe('prunePinnedSessionRows', () => {
  it('forgets the row once its conversation is unpinned', () => {
    pinSession('a')
    rememberPinnedSessionRows([row('a')])
    unpinSession('a')

    prunePinnedSessionRows()

    expect(rememberedPinnedRow('a')).toBeUndefined()
  })

  it('keeps the rows that are still pinned', () => {
    pinSession('a')
    pinSession('b')
    rememberPinnedSessionRows([row('a'), row('b')])
    unpinSession('a')

    prunePinnedSessionRows()

    expect(Object.keys($pinnedSessionRows.get())).toEqual(['b'])
  })
})

describe('watchPinnedSessionRows', () => {
  it('prunes on an unpin without any caller doing it', () => {
    const stop = watchPinnedSessionRows()
    pinSession('a')
    rememberPinnedSessionRows([row('a')])

    unpinSession('a')

    expect(rememberedPinnedRow('a')).toBeUndefined()
    stop()
  })

  it('stops pruning once detached', () => {
    const stop = watchPinnedSessionRows()
    pinSession('a')
    rememberPinnedSessionRows([row('a')])
    stop()

    unpinSession('a')

    expect(rememberedPinnedRow('a')?.id).toBe('a')
  })
})
