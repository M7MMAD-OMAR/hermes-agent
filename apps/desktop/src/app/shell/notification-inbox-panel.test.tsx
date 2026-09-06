import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { atom } = await import('nanostores')

  return {
    inbox: atom<unknown[]>([]),
    markAllInboxRead: vi.fn(),
    markInboxEntryRead: vi.fn(),
    clearInbox: vi.fn(),
    openSession: vi.fn(),
    sessions: atom<unknown[]>([])
  }
})

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/app/open-session', () => ({ openSession: mocks.openSession }))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      titlebar: {
        inbox: {
          clear: 'Clear',
          empty: 'Nothing new',
          emptyHint: 'Finished chats land here.',
          markAllRead: 'Mark all as read',
          open: 'Notifications',
          title: 'Notifications',
          unread: (count: number) => `${count} unread`
        }
      }
    }
  })
}))

vi.mock('@/lib/chat-runtime', () => ({ sessionTitle: (s: { title: string }) => s.title }))

vi.mock('@/store/notification-inbox', () => ({
  $inbox: mocks.inbox,
  clearInbox: mocks.clearInbox,
  markAllInboxRead: mocks.markAllInboxRead,
  markInboxEntryRead: mocks.markInboxEntryRead
}))

vi.mock('@/store/session', () => ({
  $sessions: mocks.sessions,
  sessionMatchesStoredId: (session: { id: string }, id: string) => session.id === id
}))

import { NotificationInboxPanel } from './notification-inbox-panel'

const entry = (over: Record<string, unknown> = {}) => ({
  at: Date.now(),
  id: 'e1',
  kind: 'turnDone',
  read: false,
  storedSessionId: 'stored-1',
  title: 'Response ready',
  ...over
})

describe('the list', () => {
  beforeEach(() => {
    mocks.inbox.set([])
    mocks.sessions.set([{ id: 'stored-1', title: 'Fix login' }])
    mocks.openSession.mockReset()
    mocks.markInboxEntryRead.mockReset()
  })

  afterEach(() => cleanup())

  it('says so when there is nothing, rather than showing an empty box', () => {
    render(<NotificationInboxPanel onClose={vi.fn()} />)
    expect(screen.getByText('Nothing new')).toBeTruthy()
  })

  it('names the chat an event came from', () => {
    // Without it every row reads "Response ready" and the panel answers nothing.
    mocks.inbox.set([entry()])
    render(<NotificationInboxPanel onClose={vi.fn()} />)
    expect(screen.getByText('Fix login')).toBeTruthy()
  })

  it('still lists an event whose chat is no longer in the session list', () => {
    mocks.sessions.set([])
    mocks.inbox.set([entry()])
    render(<NotificationInboxPanel onClose={vi.fn()} />)
    expect(screen.getByText('Response ready')).toBeTruthy()
  })
})

describe('clicking an entry', () => {
  beforeEach(() => {
    mocks.sessions.set([{ id: 'stored-1', title: 'Fix login' }])
    mocks.inbox.set([entry()])
    mocks.openSession.mockReset()
    mocks.markInboxEntryRead.mockReset()
  })

  afterEach(() => cleanup())

  it('opens the chat beside what is loaded, never over it', () => {
    // The user's requirement in their own words: jumping to a notification must
    // not close the chats already on screen. `stack` is the intent that docks
    // beside; `in-place` would replace the current one.
    render(<NotificationInboxPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Response ready'))
    expect(mocks.openSession).toHaveBeenCalledWith('stored-1', expect.anything(), 'stack')
  })

  it('marks it read and closes the panel', () => {
    const onClose = vi.fn()
    render(<NotificationInboxPanel onClose={onClose} />)
    fireEvent.click(screen.getByText('Response ready'))
    expect(mocks.markInboxEntryRead).toHaveBeenCalledWith('e1')
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates nowhere for an event that belongs to no chat', () => {
    // Plugin and credit entries have no session. Clicking one should still mark
    // it read rather than routing to an empty id.
    mocks.inbox.set([entry({ kind: 'plugin', storedSessionId: null, title: 'Plugin finished' })])
    render(<NotificationInboxPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Plugin finished'))
    expect(mocks.openSession).not.toHaveBeenCalled()
    expect(mocks.markInboxEntryRead).toHaveBeenCalled()
  })
})
