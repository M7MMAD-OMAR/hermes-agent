import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeFrames, installFakeFrames } from '@/test/frames'
import { setDocumentHidden } from '@/test/window-state'

import {
  isPresentationProbeFrame,
  isWindowPresented,
  PRESENT_CHECK_MS,
  PRESENT_STALE_MS,
  resetWindowPresentedForTests,
  subscribeWindowPresented
} from './window-presented'

let frames: FakeFrames

describe('window presentation detector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    frames = installFakeFrames()
  })

  afterEach(() => {
    resetWindowPresentedForTests()
    setDocumentHidden(false)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('answers presented before any frame has had the chance to arrive', () => {
    expect(isWindowPresented()).toBe(true)
  })

  it('stays presented while frames keep arriving', async () => {
    subscribeWindowPresented(() => undefined)

    for (let i = 0; i < 10; i++) {
      await frames.advance(PRESENT_CHECK_MS)
      frames.paint()
    }

    expect(isWindowPresented()).toBe(true)
  })

  it('reports not presented once frames stop while timers keep running', async () => {
    const seen: boolean[] = []
    subscribeWindowPresented(presented => seen.push(presented))

    frames.paint()
    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
    expect(seen).toEqual([false])
  })

  it('recovers on the first frame after the window comes back', async () => {
    const seen: boolean[] = []
    subscribeWindowPresented(presented => seen.push(presented))

    frames.paint()
    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    expect(isWindowPresented()).toBe(false)

    frames.paint()

    expect(isWindowPresented()).toBe(true)
    expect(seen).toEqual([false, true])
  })

  it('trusts a hidden document even while frames are still arriving', async () => {
    subscribeWindowPresented(() => undefined)
    setDocumentHidden(true)

    frames.paint()
    await frames.advance(PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
  })

  it('does not notify a listener that has unsubscribed', async () => {
    const seen: boolean[] = []
    const unsubscribe = subscribeWindowPresented(presented => seen.push(presented))

    frames.paint()
    unsubscribe()
    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)

    expect(isWindowPresented()).toBe(false)
    expect(seen).toEqual([])
  })

  it('probes for a frame rather than riding every one', async () => {
    subscribeWindowPresented(() => undefined)

    // A second of an ordinary 60fps window: the detector must not want a
    // callback per vsync, which is the cost it exists to remove elsewhere.
    await frames.advancePainting(1_000)

    const requested = vi.mocked(window.requestAnimationFrame).mock.calls.length

    expect(requested).toBeLessThanOrEqual(1_000 / PRESENT_CHECK_MS + 2)
    expect(isWindowPresented()).toBe(true)
  })

  it('stops its clock while the window is away, leaving one frame to catch the return', async () => {
    subscribeWindowPresented(() => undefined)
    frames.paint()

    await frames.advance(PRESENT_STALE_MS + PRESENT_CHECK_MS)
    expect(isWindowPresented()).toBe(false)

    // Nothing left ticking, and exactly one frame parked to fire on return.
    expect(vi.getTimerCount()).toBe(0)
    expect(frames.pending()).toBe(1)
  })

  it('comes back from a platform-reported hide, where frames never stopped', async () => {
    // A minimise, not a workspace switch: the document says hidden while the
    // compositor keeps painting. Nothing here can rely on a parked frame,
    // because the frames keep arriving and being discarded.
    const seen: boolean[] = []
    subscribeWindowPresented(presented => seen.push(presented))

    setDocumentHidden(true)
    await frames.advancePainting(PRESENT_CHECK_MS * 2)
    expect(isWindowPresented()).toBe(false)

    setDocumentHidden(false)
    await frames.advancePainting(PRESENT_CHECK_MS * 2)

    expect(isWindowPresented()).toBe(true)
    expect(seen).toEqual([false, true])
  })

  it('identifies its own probe frame for tests that stub rAF', () => {
    subscribeWindowPresented(() => undefined)

    const [callback] = vi.mocked(window.requestAnimationFrame).mock.calls.at(-1) ?? []

    expect(isPresentationProbeFrame(callback)).toBe(true)
    expect(isPresentationProbeFrame(() => undefined)).toBe(false)
  })
})
