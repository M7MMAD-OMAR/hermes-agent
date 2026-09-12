import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $deviceFrames,
  $devicePanelSessions,
  clearDeviceFrame,
  isDevicePanelOpen,
  setDeviceFrame,
  setDeviceUnavailable,
  toggleDevicePanel
} from '@/store/device'

import { DevicePanel } from './device-panel'

const request = vi.fn()

// Only the one call is replaced: the rest of the module is imported at load time by
// unrelated stores, and a whole-module mock takes `$gateway` out from under them.
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: (...args: unknown[]) => request(...args)
}))

const FRAME = 'data:image/jpeg;base64,AAAA'

beforeEach(() => {
  request.mockReset()
  $devicePanelSessions.set(new Set())
  $deviceFrames.set(new Map())
})

afterEach(cleanup)

describe('device panel state', () => {
  it('opens and closes per conversation, because a phone belongs to the work', () => {
    expect(toggleDevicePanel('a')).toBe(true)
    expect(isDevicePanelOpen('a')).toBe(true)
    expect(isDevicePanelOpen('b')).toBe(false)
    expect(toggleDevicePanel('a')).toBe(false)
    expect(isDevicePanelOpen('a')).toBe(false)
  })

  it('keeps the last frame when a poll fails, and marks it stale', () => {
    // A panel that blanks when a device blinks is worse than a two-second-old frame:
    // the reason is usually "the app is restarting" and the old frame is still true.
    setDeviceFrame('a', { height: 40, url: FRAME, width: 20 })
    setDeviceUnavailable('a', 'the device did not answer')

    const frame = $deviceFrames.get().get('a')

    expect(frame?.dataUrl).toBe(FRAME)
    expect(frame?.stale).toBe(true)
    expect(frame?.reason).toBe('the device did not answer')
  })

  it('clears a frame so a reopened panel never shows the previous phone', () => {
    setDeviceFrame('a', { height: 40, url: FRAME, width: 20 })
    clearDeviceFrame('a')

    expect($deviceFrames.get().has('a')).toBe(false)
  })
})

describe('DevicePanel', () => {
  it('renders nothing for a conversation with no panel open', () => {
    render(<DevicePanel sessionId="a" />)

    expect(screen.queryByTestId('device-panel')).toBeNull()
  })

  it('shows the frame the backend returned', async () => {
    request.mockResolvedValue({ available: true, frame: FRAME, height: 40, width: 20 })
    toggleDevicePanel('a')
    render(<DevicePanel sessionId="a" />)

    const image = await screen.findByRole('img')

    expect(image.getAttribute('src')).toBe(FRAME)
  })

  it('asks for THIS conversation, not whichever device answers first', async () => {
    request.mockResolvedValue({ available: true, frame: FRAME, height: 40, width: 20 })
    toggleDevicePanel('a')
    render(<DevicePanel sessionId="a" />)

    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(request.mock.calls[0][2]).toBe('device.frame')
    expect(request.mock.calls[0][3]).toEqual({ session_id: 'a' })
  })

  it('shows the reason instead of an empty box when there is no device yet', async () => {
    request.mockResolvedValue({ available: false, reason: 'no device is attached' })
    toggleDevicePanel('a')
    render(<DevicePanel sessionId="a" />)

    expect(await screen.findByText('no device is attached')).toBeTruthy()
  })

  it('reports a thrown request as the reason rather than disappearing', async () => {
    request.mockRejectedValue(new Error('gateway is not connected'))
    toggleDevicePanel('a')
    render(<DevicePanel sessionId="a" />)

    expect(await screen.findByText('gateway is not connected')).toBeTruthy()
  })

  it('polls one frame at a time, so a slow device lags instead of queueing', async () => {
    let release: (value: unknown) => void = () => {}

    request.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    )
    toggleDevicePanel('a')
    render(<DevicePanel sessionId="a" />)

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(request).toHaveBeenCalledTimes(1)

    release({ available: true, frame: FRAME, height: 40, width: 20 })
  })
})

describe('opening from the command palette', () => {
  it('uses the browser key, so an empty conversation can open one too', async () => {
    const { $browserSessionId } = await import('@/store/preview')
    const { toggleDevicePanelForActiveSession } = await import('@/store/device')

    $browserSessionId.set('draft-key')
    expect(toggleDevicePanelForActiveSession()).toBe(true)
    expect(isDevicePanelOpen('draft-key')).toBe(true)
  })

  it('does nothing when no conversation is on screen', async () => {
    const { $browserSessionId } = await import('@/store/preview')
    const { toggleDevicePanelForActiveSession } = await import('@/store/device')

    $browserSessionId.set(null)
    expect(toggleDevicePanelForActiveSession()).toBe(false)
  })
})
