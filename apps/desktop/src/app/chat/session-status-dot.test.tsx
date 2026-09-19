import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $unreadFinishedSessionIds } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { SessionStatusDot } from './session-status-dot'

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

/** The status mark beside the dot. */
const chip = () => document.querySelector('[data-slot="session-status-chip"]')

describe('the tab status mark', () => {
  it('spends one glyph, not a word', () => {
    // A tab is mostly title, and the title is what tells two running chats
    // apart; the status must not be the widest thing on it.
    sessionState({ busy: true })
    render(<SessionStatusDot chip storedSessionId={SID} />)

    expect(chip()?.textContent).toHaveLength(1)
    // Language-free: the word it stands for lives in the tooltip, translated.
    expect(chip()?.textContent).not.toMatch(/[A-Za-z؀-ۿ]/)
  })

  it('keeps the word for anyone who has not learned the glyph', () => {
    sessionState({ needsInput: true })
    render(<SessionStatusDot chip storedSessionId={SID} />)

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
      render(<SessionStatusDot chip storedSessionId={SID} />)
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

  it('stays out of the way when nothing is happening', () => {
    render(<SessionStatusDot chip storedSessionId={SID} />)

    expect(chip()).toBeNull()
  })
})
