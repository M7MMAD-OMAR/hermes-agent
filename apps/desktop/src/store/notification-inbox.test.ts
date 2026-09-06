import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'

import {
  dispatchNativeNotification,
  setNativeNotifyEnabled,
  setNativeNotifyKind
} from './native-notifications'
import {
  $inbox,
  $unreadInboxCount,
  clearInbox,
  markAllInboxRead,
  markInboxEntryRead,
  recordInboxEntry
} from './notification-inbox'
import { setActiveSessionId } from './session'
import { $sessionStates, $sessionTiles, publishSessionState } from './session-states'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const notify = vi.fn().mockResolvedValue(true)

function setWindowState({ focused = true, hidden = false }: { focused?: boolean; hidden?: boolean }) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused })
}

beforeEach(() => {
  clearInbox()
  notify.mockClear()
  desktopWindow.hermesDesktop = { notify } as unknown as Window['hermesDesktop']
  $sessionStates.set({})
  $sessionTiles.set([])
  setActiveSessionId(null)
  setNativeNotifyEnabled(true)
  setWindowState({ focused: true, hidden: false })
})

/** A chat the user has on screen, bound to a runtime id. */
function openChat(runtimeId: string, storedSessionId: string) {
  $sessionTiles.set([{ runtimeId, storedSessionId }])
}

describe('which events reach the list', () => {
  it('keeps an event from a chat the user has open', () => {
    openChat('rt-1', 'stored-1')
    expect(recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })).not.toBeNull()
    expect($inbox.get()).toHaveLength(1)
  })

  it('drops an event from a session the user never opened', () => {
    // A busy gateway runs cron, kanban and delegated sessions all day. Listing
    // those would bury the two or three chats the user is actually waiting on,
    // which is the entire problem this list exists to solve.
    expect(recordInboxEntry({ kind: 'turnDone', sessionId: 'cron-runtime', title: 'done' })).toBeNull()
    expect($inbox.get()).toHaveLength(0)
  })

  it('keeps an event that belongs to no chat at all', () => {
    // Plugin runs and credit alerts have no session. Nothing else reports them,
    // so the surface filter must not swallow them.
    expect(recordInboxEntry({ global: true, kind: 'plugin', title: 'Plugin finished' })).not.toBeNull()
    expect(recordInboxEntry({ kind: 'credits', title: 'Credits paused' })).not.toBeNull()
    expect($inbox.get()).toHaveLength(2)
  })
})

describe('the chat an entry points at', () => {
  it('stores the durable id, so a new runtime id cannot orphan the entry', () => {
    // Runtime ids are ephemeral: evict and resume a session and it gets another
    // one. An entry holding a runtime id would silently stop resolving to its
    // chat, which is worse than not listing it.
    openChat('rt-old', 'stored-1')
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-old', title: 'done' })

    openChat('rt-new', 'stored-1')
    expect($inbox.get()[0]?.storedSessionId).toBe('stored-1')
  })

  it('resolves the primary chat, which is not a tile', () => {
    // Only tiles carry a stored id of their own. The selected chat is not a
    // tile, so its runtime slice has to answer for it or every notification
    // from the chat in front of the user would be unclickable.
    setActiveSessionId('rt-primary')
    publishSessionState('rt-primary', { storedSessionId: 'stored-primary' } as ClientSessionState)
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-primary', title: 'done' })
    expect($inbox.get()[0]?.storedSessionId).toBe('stored-primary')
  })

  it('leaves the id null for an event with no chat', () => {
    recordInboxEntry({ global: true, kind: 'plugin', title: 'Plugin finished' })
    expect($inbox.get()[0]?.storedSessionId).toBeNull()
  })
})

describe('recording sits above the notification gates', () => {
  beforeEach(() => openChat('rt-1', 'stored-1'))

  it('lists a turn that finished while the user was looking at another chat', () => {
    // The exact case people described: on screen, working in chat A, chat B
    // finishes. No OS notification fires by design, and before this list there
    // was no other way to find out.
    setActiveSessionId('rt-other')
    setWindowState({ focused: true, hidden: false })
    dispatchNativeNotification({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    expect(notify).not.toHaveBeenCalled()
    expect($inbox.get()).toHaveLength(1)
  })

  it('lists an event whose kind the user muted', () => {
    // Muting an OS interruption is not the same as asking never to be told.
    setNativeNotifyKind('turnDone', false)
    dispatchNativeNotification({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    setNativeNotifyKind('turnDone', true)
    expect(notify).not.toHaveBeenCalled()
    expect($inbox.get()).toHaveLength(1)
  })

  it('lists events even with notifications switched off entirely', () => {
    setNativeNotifyEnabled(false)
    dispatchNativeNotification({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    setNativeNotifyEnabled(true)
    expect($inbox.get()).toHaveLength(1)
  })
})

describe('the list itself', () => {
  beforeEach(() => openChat('rt-1', 'stored-1'))

  it('collapses the same event arriving twice', () => {
    // Recording sits above the dispatcher's own throttle, so a gateway
    // reconnect replaying recent events would otherwise add a second identical
    // row for something that happened once.
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    expect($inbox.get()).toHaveLength(1)
  })

  it('stops collapsing once the dedupe window has passed', () => {
    // The window is what separates "the same event replayed" from "it happened
    // again". Without an expiry the second turn of a chat the user left running
    // would never be listed, and a dedupe window that never ends looks exactly
    // like a working one in a test that only records twice in a row.
    const start = Date.now()
    const now = vi.spyOn(Date, 'now')

    try {
      now.mockReturnValue(start)
      recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
      now.mockReturnValue(start + 1_500)
      recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    } finally {
      now.mockRestore()
    }

    expect($inbox.get()).toHaveLength(2)
  })

  it('keeps two genuinely different events from the same chat', () => {
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'done' })
    recordInboxEntry({ kind: 'turnError', sessionId: 'rt-1', title: 'failed' })
    expect($inbox.get()).toHaveLength(2)
  })

  it('puts the newest event first', () => {
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'first' })
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'second' })
    expect($inbox.get().map(entry => entry.title)).toEqual(['second', 'first'])
  })

  it('caps at fifty so a long day cannot grow it without bound', () => {
    for (let i = 0; i < 60; i += 1) {
      recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: `t${i}` })
    }

    expect($inbox.get()).toHaveLength(50)
    expect($inbox.get()[0]?.title).toBe('t59')
  })

  it('counts what has not been read', () => {
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'a' })
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'b' })
    expect($unreadInboxCount.get()).toBe(2)

    markInboxEntryRead($inbox.get()[0]!.id)
    expect($unreadInboxCount.get()).toBe(1)

    markAllInboxRead()
    expect($unreadInboxCount.get()).toBe(0)
  })

  it('keeps entries when they are marked read, it only clears the count', () => {
    // Reading is not dismissing: the list is also the short history of what
    // happened, so marking all read must not empty it.
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'a' })
    markAllInboxRead()
    expect($inbox.get()).toHaveLength(1)
  })

  it('does not rewrite the list when everything is already read', () => {
    recordInboxEntry({ kind: 'turnDone', sessionId: 'rt-1', title: 'a' })
    markAllInboxRead()
    const settled = $inbox.get()
    markAllInboxRead()
    expect($inbox.get()).toBe(settled)
  })
})
