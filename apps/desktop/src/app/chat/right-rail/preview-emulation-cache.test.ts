import { describe, expect, it, vi } from 'vitest'

import { createEmulationCache } from './preview-emulation-cache'

const PAYLOAD = { metrics: { height: 900, mobile: false, scale: 1, width: 1440 }, webContentsId: 7 }
const KEY = '7:1440x900:false:1'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('while the guest is taking the override', () => {
  it('sends it', () => {
    const send = vi.fn().mockResolvedValue(true)

    createEmulationCache(send).send(PAYLOAD, KEY)

    expect(send).toHaveBeenCalledWith(PAYLOAD)
  })

  it('remembers it, so a sash drag does not re-send it every frame', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const cache = createEmulationCache(send)

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(true)
  })

  it('forgets on demand, for a guest that reset itself', async () => {
    // A navigation clears the override inside the guest, so re-sending the same
    // metrics afterwards is the point rather than waste.
    const cache = createEmulationCache(vi.fn().mockResolvedValue(true))

    cache.send(PAYLOAD, KEY)
    await settle()
    cache.forget()

    expect(cache.has(KEY)).toBe(false)
  })
})

describe('when the guest refuses it', () => {
  it('does not remember an override that was refused', async () => {
    // THE BUG. The bridge answers false for a guest that is gone, mid-teardown,
    // or not yet owned by this renderer. Remembering that attempt short-circuits
    // every later rung of the ladder, so the preset stays lit in the toolbar,
    // keeps reporting its size, and is never actually in force. A window resize
    // cannot recover it, because a resize IS the ladder the memo disabled.
    const cache = createEmulationCache(vi.fn().mockResolvedValue(false))

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(false)
  })

  it('sends again on the next rung after a refusal', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const cache = createEmulationCache(send)

    cache.send(PAYLOAD, KEY)
    await settle()

    if (!cache.has(KEY)) {
      cache.send(PAYLOAD, KEY)
    }

    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(cache.has(KEY)).toBe(true)
  })

  it('does not remember one that threw', async () => {
    const cache = createEmulationCache(() => {
      throw new Error('bridge gone')
    })

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(false)
  })

  it('does not remember one whose promise rejected', async () => {
    const cache = createEmulationCache(vi.fn().mockRejectedValue(new Error('destroyed')))

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(false)
  })

  it('does not remember anything with no bridge at all', async () => {
    // A browser build has no desktop bridge; claiming the override landed would
    // leave the pane certain about a call it never made.
    const cache = createEmulationCache(undefined)

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(false)
  })

  it('does not remember one the bridge answered synchronously with nothing', async () => {
    const cache = createEmulationCache(() => undefined)

    cache.send(PAYLOAD, KEY)
    await settle()

    expect(cache.has(KEY)).toBe(false)
  })
})

describe('a late refusal must not undo a newer override', () => {
  it('keeps the override that replaced the failed one', async () => {
    // The user switches preset while the first send is still in flight. Clearing
    // the memo on the stale answer would drop an override that IS in force.
    let refuse: (value: boolean) => void = () => {}

    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>(resolve => (refuse = resolve)))
      .mockResolvedValueOnce(true)

    const cache = createEmulationCache(send)

    cache.send(PAYLOAD, KEY)
    cache.send({ ...PAYLOAD, metrics: { height: 812, mobile: true, scale: 1, width: 375 } }, 'phone')
    await settle()

    refuse(false)
    await settle()

    expect(cache.has('phone')).toBe(true)
  })
})
