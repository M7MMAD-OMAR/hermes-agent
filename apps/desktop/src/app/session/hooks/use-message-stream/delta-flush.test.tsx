import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { type MutableRefObject, useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { isPresentationProbeFrame, PRESENT_STALE_MS, resetWindowPresentedForTests } from '@/lib/window-presented'

import { useSessionStateCache } from '../use-session-state-cache'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'
import { UNFOCUSED_STREAM_FLUSH_MS } from './utils'

import { useMessageStream } from './index'

const SID = 'session-1'
let stream: MessageStreamHarness
let states: Map<string, ClientSessionState>
type UpdateSessionState = (
  sessionId: string,
  updater: (state: ClientSessionState) => ClientSessionState,
  storedSessionId?: string | null
) => ClientSessionState
let updateSessionState: ReturnType<typeof vi.fn<UpdateSessionState>>

/** The shared harness, but writing through a spy so the unmount test can count
 *  the writes that happen after teardown. */
function mountStream() {
  stream = renderMessageStream(SID, { states, updateSessionState })
}

const assistantText = () => stream.text()

/** Collect the frames the STREAM asked for. The window-presentation probe in
 *  lib/window-presented rides rAF as well (that is how it knows the window is
 *  on screen at all), and these assertions are about the flush's own
 *  measurement frame, not about it. */
const collectStreamFrames = (sink: FrameRequestCallback[]) => (callback: FrameRequestCallback) => {
  if (!isPresentationProbeFrame(callback)) {
    sink.push(callback)
  }

  return sink.length + 1
}

describe('useMessageStream delta flush scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    states = new Map()
    updateSessionState = vi.fn((sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => {
      const next = updater(states.get(sessionId) ?? createClientSessionState())
      states.set(sessionId, next)

      return next
    })
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('flushes streaming text on a bounded timer while the window is unfocused', async () => {
    mountStream()

    act(() => stream.appendDelta(SID, 'still streaming'))

    // A queued delta waits on a TIMER, never on a frame: an unfocused window
    // may get no frames at all, and the text still has to arrive. (The only
    // frame requested here belongs to the presentation probe in
    // lib/window-presented, which is what tells the floor how hidden we are.)
    expect(vi.getTimerCount()).toBe(1)
    expect(assistantText()).toBe('')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('still streaming')
  })

  it('flushes queued text on the first frame after an off-screen window is painted again', () => {
    // No frames while the clock keeps moving is what a window on another
    // workspace looks like: its timers run on, so nothing else tells the
    // renderer it left the screen.
    resetWindowPresentedForTests()

    const frames: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation(callback => {
      frames.push(callback)

      return frames.length
    })

    let clock = 0
    vi.mocked(performance.now).mockImplementation(() => clock)
    mountStream()

    // Two deltas far enough apart to land immediately. The second is what puts
    // the hidden floor in play for the third, and by then no frame has arrived
    // for longer than PRESENT_STALE_MS.
    act(() => stream.appendDelta(SID, 'first '))
    act(() => vi.advanceTimersByTime(UNFOCUSED_STREAM_FLUSH_MS + 50))

    clock = PRESENT_STALE_MS + 300
    act(() => stream.appendDelta(SID, 'second '))
    act(() => vi.advanceTimersByTime(1))
    expect(assistantText()).toBe('first second ')

    clock += 200
    act(() => stream.appendDelta(SID, 'queued while off screen'))

    // Well past the floor an unfocused window would use, still inside the
    // hidden one.
    act(() => vi.advanceTimersByTime(UNFOCUSED_STREAM_FLUSH_MS * 3))
    expect(assistantText()).toBe('first second ')

    // The window is painted again: the parked frame runs.
    act(() => {
      for (const frame of frames.splice(0)) {
        frame(clock)
      }
    })

    expect(assistantText()).toBe('first second queued while off screen')
    resetWindowPresentedForTests()
  })

  it('flushes queued text immediately when a hidden window becomes visible', () => {
    vi.mocked(performance.now).mockReturnValue(0)
    mountStream()

    act(() => stream.appendDelta(SID, 'caught up on focus'))
    expect(assistantText()).toBe('')
    expect(vi.getTimerCount()).toBe(1)

    Object.defineProperty(globalThis.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    act(() => globalThis.document.dispatchEvent(new Event('visibilitychange')))

    expect(assistantText()).toBe('caught up on focus')

    // The stream's own flush timer is gone: letting every other timer run
    // (the shared window-return coalescer also listens to this event) must
    // not produce a second write.
    const writes = updateSessionState.mock.calls.length

    act(() => {
      vi.runAllTimers()
    })

    expect(updateSessionState.mock.calls.length).toBe(writes)
    expect(assistantText()).toBe('caught up on focus')
  })

  it('flushes queued text on focus when visibility remains visible', () => {
    vi.mocked(performance.now).mockReturnValue(0)
    Object.defineProperty(globalThis.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    mountStream()

    act(() => stream.appendDelta(SID, 'focused without visibility change'))
    expect(assistantText()).toBe('')
    expect(vi.getTimerCount()).toBe(1)

    act(() => globalThis.window.dispatchEvent(new Event('focus')))

    expect(assistantText()).toBe('focused without visibility change')
  })

  it('cancels the pending timer on unmount and flushes exactly once', async () => {
    vi.mocked(performance.now).mockReturnValue(0)
    mountStream()

    act(() => stream.appendDelta(SID, 'final delta'))
    expect(vi.getTimerCount()).toBe(1)

    cleanup()

    expect(vi.getTimerCount()).toBe(0)
    expect(assistantText()).toBe('final delta')
    const updatesAfterUnmount = updateSessionState.mock.calls.length

    await vi.advanceTimersByTimeAsync(100)

    expect(updateSessionState).toHaveBeenCalledTimes(updatesAfterUnmount)
    expect(
      vi.mocked(window.requestAnimationFrame).mock.calls.filter(([callback]) => !isPresentationProbeFrame(callback))
    ).toHaveLength(0)
  })

  it('stretches the flush gap when the deferred commit frame is expensive', async () => {
    // The streaming-path $messages publish (React commit + Streamdown
    // re-parse) is deferred to a view-sync rAF inside updateSessionState, so
    // the flush cost must be measured through that frame. Simulate one
    // expensive frame and expect the next gap to adapt to 3x the frame cost.
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    const rafCallbacks: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation(collectStreamFrames(rafCallbacks))

    mountStream()

    act(() => stream.appendDelta(SID, 'first'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('first')
    expect(rafCallbacks).toHaveLength(1)

    // Frame started at 1040, the measurement callback runs at 1100: 60ms of
    // in-frame work (view sync + commit), so the next floor is 180ms.
    now = 1100
    act(() => rafCallbacks[0](1040))

    act(() => stream.appendDelta(SID, 'second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79)
    })

    expect(assistantText()).toBe('first')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(assistantText()).toBe('firstsecond')
  })

  it('paces an unfocused window at the slower floor and a focused one at the fast floor', async () => {
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    vi.mocked(window.requestAnimationFrame).mockImplementation(() => 1)

    mountStream()

    act(() => stream.appendDelta(SID, 'first'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('first')

    // Unfocused (the beforeEach default): 50ms after the last flush the next
    // one waits out the 100ms floor instead of the 33ms one.
    now = 1050
    act(() => stream.appendDelta(SID, 'second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(49)
    })

    expect(assistantText()).toBe('first')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(assistantText()).toBe('firstsecond')

    // Focused: the same 50ms gap is already past the 33ms floor.
    vi.mocked(document.hasFocus).mockReturnValue(true)
    now = 1150
    act(() => stream.appendDelta(SID, 'third'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('firstsecondthird')
  })

  it('keeps the write-cost floor when no frame fires (hidden renderer)', async () => {
    // A parked renderer never runs rAF callbacks. The cost must stay at the
    // synchronous store-write measurement so the gap falls back to the fixed
    // 33ms floor instead of waiting on a frame that will never come.
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    vi.mocked(window.requestAnimationFrame).mockImplementation(() => 1)

    mountStream()

    act(() => stream.appendDelta(SID, 'first'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('first')

    // 100ms later (well past the 33ms floor): the next flush is immediate.
    now = 1100
    act(() => stream.appendDelta(SID, 'second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(assistantText()).toBe('firstsecond')
  })

  it('ignores a late frame measurement once a newer flush has started', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(true)
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    const rafCallbacks: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation(collectStreamFrames(rafCallbacks))

    mountStream()

    act(() => stream.appendDelta(SID, 'a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // A second flush starts before the first flush's frame lands.
    now = 1010
    act(() => stream.appendDelta(SID, 'b'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(23)
    })

    expect(assistantText()).toBe('ab')
    expect(rafCallbacks).toHaveLength(2)

    // The stale callback must not overwrite the newer flush's cost. If it
    // did, cost would read 30ms and the next gap would stretch to 70ms.
    now = 1030
    act(() => rafCallbacks[0](1000))

    act(() => stream.appendDelta(SID, 'c'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13)
    })

    expect(assistantText()).toBe('abc')
  })
})

describe('useMessageStream composed with the real useSessionStateCache', () => {
  // The tests above mock updateSessionState, so they validate the adaptive
  // arithmetic but not the production ordering contract: runFlush's
  // measurement rAF must be registered AFTER the view-sync rAF that the real
  // updateSessionState schedules inside syncSessionStateToView, so the
  // measured frame cost includes the deferred $messages commit it adapts to.
  let cache: ReturnType<typeof useSessionStateCache> | null = null
  let published: ChatMessage[]
  let appendAssistantDelta: ((sessionId: string, delta: string) => void) | null = null

  function ComposedHarness() {
    const busyRef: MutableRefObject<boolean> = { current: false }
    const queryClientRef = useRef(new QueryClient())

    const sessionCache = useSessionStateCache({
      activeSessionId: SID,
      busyRef,
      selectedStoredSessionId: null,
      setAwaitingResponse: () => undefined,
      setBusy: () => undefined,
      setMessages: messages => {
        published = messages
      }
    })

    const stream = useMessageStream({
      activeSessionIdRef: sessionCache.activeSessionIdRef,
      hydrateFromStoredSession: vi.fn(async () => undefined),
      queryClient: queryClientRef.current,
      refreshHermesConfig: vi.fn(async () => undefined),
      refreshSessions: vi.fn(async () => undefined),
      sessionStateByRuntimeIdRef: sessionCache.sessionStateByRuntimeIdRef,
      updateSessionState: sessionCache.updateSessionState
    })

    useEffect(() => {
      appendAssistantDelta = stream.appendAssistantDelta
      cache = sessionCache
    }, [stream.appendAssistantDelta, sessionCache])

    return null
  }

  function cachedText() {
    const message = cache?.sessionStateByRuntimeIdRef.current.get(SID)?.messages.at(-1)
    const part = message?.parts.at(-1)

    return part?.type === 'text' ? part.text : ''
  }

  function publishedText() {
    const part = published.at(-1)?.parts.at(-1)

    return part?.type === 'text' ? part.text : ''
  }

  beforeEach(() => {
    vi.useFakeTimers()
    appendAssistantDelta = null
    cache = null
    published = []
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('measures the frame cost through the real view-sync rAF and adapts the next gap', async () => {
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    const rafCallbacks: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation(collectStreamFrames(rafCallbacks))

    render(<ComposedHarness />)
    expect(appendAssistantDelta).not.toBeNull()

    // Mid-turn state: busy keeps the view sync on the deferred rAF path
    // (terminal/needing-input states flush synchronously instead).
    act(() => {
      cache!.updateSessionState(SID, state => ({ ...state, busy: true }))
    })
    expect(rafCallbacks).toHaveLength(1)
    // Drain the seed's own view-sync rAF so the flush below starts clean.
    act(() => rafCallbacks.shift()!(now))

    act(() => appendAssistantDelta!(SID, 'first'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // The store write landed synchronously, but the $messages publish is
    // deferred: exactly two rAF callbacks are pending — first the cache's
    // view-sync, then runFlush's measurement.
    expect(cachedText()).toBe('first')
    expect(publishedText()).toBe('')
    expect(rafCallbacks).toHaveLength(2)

    // Draining the FIRST registered callback must be what publishes the
    // deferred commit; that identity is the ordering contract. It runs until
    // 60ms into the frame (React commit + Streamdown re-parse).
    now = 1100
    act(() => rafCallbacks[0](1040))
    expect(publishedText()).toBe('first')

    // The measurement callback closes the same frame: 60ms of in-frame work,
    // so the next adaptive floor is 3x = 180ms.
    act(() => rafCallbacks[1](1040))

    act(() => appendAssistantDelta!(SID, 'second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79)
    })

    expect(cachedText()).toBe('first')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(cachedText()).toBe('firstsecond')
  })

  it('keeps the write-cost fallback when the parked renderer never fires rAF', async () => {
    let now = 1000
    vi.mocked(performance.now).mockImplementation(() => now)
    // Parked renderer: rAF callbacks are accepted but never run.
    vi.mocked(window.requestAnimationFrame).mockImplementation(() => 1)

    render(<ComposedHarness />)

    act(() => {
      cache!.updateSessionState(SID, state => ({ ...state, busy: true }))
    })

    act(() => appendAssistantDelta!(SID, 'first'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(cachedText()).toBe('first')

    // 100ms later (well past the 33ms floor): the next flush is immediate.
    now = 1100
    act(() => appendAssistantDelta!(SID, 'second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(cachedText()).toBe('firstsecond')
  })
})
