import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  $threadScrollBySession,
  clearThreadScroll,
  onScrollToBottomRequest,
  requestScrollToBottom,
  resetAllThreadScroll,
  setThreadAtBottom,
  threadScrollFor
} from './thread-scroll'

afterEach(() => {
  resetAllThreadScroll()
})

const stateOf = (sessionId: null | string) => threadScrollFor($threadScrollBySession.get(), sessionId)

describe('each transcript owns its own scroll chrome', () => {
  it('raises the jump pill for the thread that actually left the bottom', () => {
    setThreadAtBottom('a', false)

    expect(stateOf('a').jumpVisible).toBe(true)
    expect(stateOf('a').scrolledUp).toBe(true)
  })

  it('leaves every other open chat alone', () => {
    // The reported bug: panes sit side by side, so scrolling up in one chat
    // raised the pill and dimmed the composer in all of them.
    setThreadAtBottom('a', false)

    expect(stateOf('b').jumpVisible).toBe(false)
    expect(stateOf('b').scrolledUp).toBe(false)
  })

  it('does not let one thread returning to the bottom clear another', () => {
    setThreadAtBottom('a', false)
    setThreadAtBottom('b', true)

    expect(stateOf('a').jumpVisible).toBe(true)
  })

  it('reports a thread nobody has scrolled as parked at the bottom', () => {
    expect(stateOf('never-seen').scrolledUp).toBe(false)
  })

  it('keeps the map reference stable when nothing changed', () => {
    // Published on every scroll tick, so a no-op write would re-render every
    // composer and status stack on screen.
    setThreadAtBottom('a', false)
    const settled = $threadScrollBySession.get()

    setThreadAtBottom('a', false)
    expect($threadScrollBySession.get()).toBe(settled)
  })
})

describe('clearThreadScroll', () => {
  it('forgets only the transcript that unmounted', () => {
    setThreadAtBottom('a', false)
    setThreadAtBottom('b', false)

    clearThreadScroll('a')

    expect(stateOf('a').jumpVisible).toBe(false)
    expect(stateOf('b').jumpVisible).toBe(true)
  })

  it('is a no-op for a transcript with no entry', () => {
    setThreadAtBottom('a', false)
    const settled = $threadScrollBySession.get()

    clearThreadScroll('never-seen')
    expect($threadScrollBySession.get()).toBe(settled)
  })
})

describe('requestScrollToBottom', () => {
  it('routes a scroll request only to its session', () => {
    const sessionA = vi.fn()
    const sessionB = vi.fn()
    const stopA = onScrollToBottomRequest(sessionA, 'session-a')
    const stopB = onScrollToBottomRequest(sessionB, 'session-b')

    requestScrollToBottom('session-b')

    expect(sessionA).not.toHaveBeenCalled()
    expect(sessionB).toHaveBeenCalledOnce()
    stopA()
    stopB()
  })

  it("does not let a late unmount clear a newer session's handler", () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onScrollToBottomRequest(first, 'session-a')
    const stopSecond = onScrollToBottomRequest(second, 'session-a')

    stopFirst()
    requestScrollToBottom('session-a')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    stopSecond()
  })
})
