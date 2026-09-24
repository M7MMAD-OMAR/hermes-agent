import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $unreadFinishedSessionIds } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { SessionStatusChip } from './session-status-dot'

const SID = 'session-under-test'

/** Drive the real input the dot state is computed from. */
const sessionState = (patch: Partial<ReturnType<typeof createClientSessionState>>) => {
  $sessionStates.set({ [SID]: { ...createClientSessionState(), storedSessionId: SID, ...patch } })
}

afterEach(() => {
  cleanup()
  $sessionStates.set({})
  $unreadFinishedSessionIds.set([])
})

/** The one mark a tab carries. */
const chip = () => document.querySelector('[data-slot="session-status-chip"]')

describe('the tab status mark', () => {
  it('spends one glyph, not a word', () => {
    // A tab is mostly title, and the title is what tells two running chats
    // apart; the status must not be the widest thing on it.
    sessionState({ busy: true })
    render(<SessionStatusChip storedSessionId={SID} />)

    expect(chip()?.textContent).toHaveLength(1)
    // Language-free: the word it stands for lives in the tooltip, translated.
    expect(chip()?.textContent).not.toMatch(/[A-Za-z؀-ۿ]/)
  })

  it('keeps the word for anyone who has not learned the glyph', () => {
    sessionState({ needsInput: true })
    render(<SessionStatusChip storedSessionId={SID} />)

    expect((chip()?.getAttribute('title') ?? '').length).toBeGreaterThan(1)
  })

  it('gives each state a mark of its own', () => {
    const marks: string[] = []

    const arrangements = [
      () => sessionState({ busy: true }),
      () => sessionState({ needsInput: true }),
      () => $unreadFinishedSessionIds.set([SID])
    ]

    for (const arrange of arrangements) {
      arrange()
      render(<SessionStatusChip storedSessionId={SID} />)
      const mark = chip()?.textContent

      expect(mark, 'every live state earns a mark').toBeTruthy()
      marks.push(mark ?? '')
      cleanup()
      $sessionStates.set({})
      $unreadFinishedSessionIds.set([])
    }

    // A mark that collides with another is worse than no mark at all.
    expect(new Set(marks).size).toBe(marks.length)
  })

  it('paints nothing when nothing is happening, but keeps its slot', () => {
    render(<SessionStatusChip storedSessionId={SID} />)

    // No glyph and nothing announced: a strip of settled chats is quiet.
    expect(chip()?.textContent).toBe('')
    expect(chip()?.getAttribute('role')).toBeNull()
    // The box itself stays. The tab's ⌘-number hint paints absolutely inside
    // it, so a zero-width lead would take the number off every settled tab.
    expect(chip()).not.toBeNull()
  })

  it('is the ONLY mark on a tab: no dot beside it', () => {
    // The dot is the sidebar's mark, where it also carries the project colour.
    // Two marks for one meaning, on the surface with the least room for either,
    // is what this replaced.
    sessionState({ busy: true })
    const { container } = render(<SessionStatusChip storedSessionId={SID} />)

    expect(container.querySelectorAll('span')).toHaveLength(1)
    // The dot is a `rounded-full` circle; the tab carries no such thing.
    expect(container.querySelector('.rounded-full')).toBeNull()
  })

  it('still names the state for a reader who cannot see the glyph', () => {
    sessionState({ needsInput: true })
    render(<SessionStatusChip storedSessionId={SID} />)

    expect(chip()?.getAttribute('role')).toBe('status')
    expect((chip()?.getAttribute('aria-label') ?? '').length).toBeGreaterThan(1)
  })
})
