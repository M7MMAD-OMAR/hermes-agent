import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { onScrollToBottomRequest, resetAllThreadScroll, setThreadAtBottom } from '@/store/thread-scroll'

import { ScrollToBottomButton } from './scroll-to-bottom-button'

function approvalFor(sessionId: string) {
  setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'dangerous command', sessionId })
}

afterEach(() => {
  cleanup()
  clearAllPrompts()
  resetAllThreadScroll()
  $activeSessionId.set(null)
})

// `getByRole('button')` excludes aria-hidden nodes, so "queryByRole null" is the
// control's hidden (parked-at-bottom) state.
describe('ScrollToBottomButton', () => {
  it('stays hidden while parked at the bottom', () => {
    render(<ScrollToBottomButton sessionId="sess-1" />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a plain jump-to-bottom control when scrolled up with no approval', () => {
    setThreadAtBottom('sess-1', false)
    render(<ScrollToBottomButton sessionId="sess-1" />)

    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy()
    expect(screen.queryByText('Approval needed')).toBeNull()
  })

  it('morphs into the approval pill when scrolled up with a pending approval', () => {
    approvalFor('sess-1')
    setThreadAtBottom('sess-1', false)
    render(<ScrollToBottomButton sessionId="sess-1" />)

    expect(screen.getByRole('button', { name: 'Approval needed' })).toBeTruthy()
    expect(screen.getByText('Approval needed')).toBeTruthy()
  })

  it('does not morph while a pending approval is still in view (at bottom)', () => {
    approvalFor('sess-1')
    render(<ScrollToBottomButton sessionId="sess-1" />)

    // Parked at bottom → control hidden, so it can't claim "approval needed".
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('re-arms sticky-bottom on click', () => {
    const handler = vi.fn()
    const stop = onScrollToBottomRequest(handler, 'sess-1')
    setThreadAtBottom('sess-1', false)
    render(<ScrollToBottomButton sessionId="sess-1" />)

    fireEvent.click(screen.getByRole('button'))

    expect(handler).toHaveBeenCalledTimes(1)
    stop()
  })
})

// Panes render side by side, so more than one of these is on screen at once.
// Both reads used to be global (the jump flag) or scoped to the ACTIVE session
// (the approval), which made every visible chat mirror whichever one the user
// last touched. These are the cases that caught it.
describe('with several chats open at once', () => {
  it('stays hidden in a chat the user did not scroll', () => {
    setThreadAtBottom('sess-1', false)
    render(<ScrollToBottomButton sessionId="sess-2" />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not claim an approval that belongs to another chat', () => {
    // The screenshot the user sent: one chat asked to approve a command and
    // every open chat grew an "Approval needed" pill.
    $activeSessionId.set('sess-1')
    approvalFor('sess-1')
    setThreadAtBottom('sess-2', false)
    render(<ScrollToBottomButton sessionId="sess-2" />)

    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy()
    expect(screen.queryByText('Approval needed')).toBeNull()
  })

  it('shows the pill in a background chat that has its own approval', () => {
    // The other half: scoping to the active session would have hidden a real
    // approval in a tile the user was not selected on.
    $activeSessionId.set('sess-1')
    approvalFor('sess-2')
    setThreadAtBottom('sess-2', false)
    render(<ScrollToBottomButton sessionId="sess-2" />)

    expect(screen.getByRole('button', { name: 'Approval needed' })).toBeTruthy()
  })
})
