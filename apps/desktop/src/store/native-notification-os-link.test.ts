import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dispatchNativeNotification, setNativeNotifyEnabled, setNativeNotifyKind } from './native-notifications'
import { setActiveSessionId } from './session'
import { $sessionStates, $sessionTiles } from './session-states'

const playNotificationSound = vi.fn()

vi.mock('@/lib/notification-sound', () => ({
  playNotificationSound: (...args: unknown[]) => playNotificationSound(...args)
}))

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const notify = vi.fn().mockResolvedValue(true)

function away() {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
}

let counter = 0

/** A chat on screen. Returns a fresh runtime id so the 1s dispatch throttle,
 *  which is keyed on kind+session, never swallows the next assertion. */
function openChat(storedSessionId: string): string {
  counter += 1
  const runtimeId = `rt-${counter}`
  $sessionTiles.set([{ runtimeId, storedSessionId }])

  return runtimeId
}

beforeEach(() => {
  notify.mockClear()
  playNotificationSound.mockClear()
  desktopWindow.hermesDesktop = { notify } as unknown as Window['hermesDesktop']
  $sessionTiles.set([])
  $sessionStates.set({})
  setActiveSessionId(null)
  setNativeNotifyEnabled(true)
  setNativeNotifyKind('turnDone', true)
  setNativeNotifyKind('approval', true)
  away()
})

describe('the durable id the OS notification carries', () => {
  it('sends the stored id, not the runtime id it was raised with', () => {
    // Main builds `hermes://chat/<id>` from this. A runtime id would stop
    // resolving the moment the session is evicted and resumed, and a cold start
    // has no renderer state to translate one with at all.
    const runtimeId = openChat('stored-1')

    dispatchNativeNotification({ kind: 'turnDone', sessionId: runtimeId, title: 'done' })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ chatId: 'stored-1', sessionId: runtimeId })
  })

  it('sends a translated label for the link, since main is not localized', () => {
    dispatchNativeNotification({ kind: 'turnDone', global: true, title: 'done' })

    expect(notify.mock.calls[0]?.[0]?.linkLabel).toBeTruthy()
  })

  it('omits the chat id for an event that belongs to no chat', () => {
    dispatchNativeNotification({ kind: 'plugin', global: true, tag: 'p1', title: 'done' })

    expect(notify.mock.calls[0]?.[0]?.chatId).toBeUndefined()
  })
})

describe('the sound', () => {
  it('rides the same decision as the banner', () => {
    const runtimeId = openChat('stored-2')

    dispatchNativeNotification({ kind: 'approval', sessionId: runtimeId, title: 'approve?' })

    expect(playNotificationSound).toHaveBeenCalledWith('approval', 'stored-2')
  })

  it('stays silent when the banner was suppressed', () => {
    // Nothing else about this call changed: the kind is muted, so neither the
    // banner nor the sound may happen. Sounding off the raw event instead would
    // put a noise on work the user deliberately silenced.
    const runtimeId = openChat('stored-3')
    setNativeNotifyKind('approval', false)

    dispatchNativeNotification({ kind: 'approval', sessionId: runtimeId, title: 'approve?' })

    expect(notify).not.toHaveBeenCalled()
    expect(playNotificationSound).not.toHaveBeenCalled()
  })

  it('stays silent for a session the user has no surface for', () => {
    dispatchNativeNotification({ kind: 'turnDone', sessionId: 'cron-runtime', title: 'done' })

    expect(playNotificationSound).not.toHaveBeenCalled()
  })

  it('honours an explicit silent request', () => {
    const runtimeId = openChat('stored-4')

    dispatchNativeNotification({ kind: 'approval', sessionId: runtimeId, silent: true, title: 'approve?' })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(playNotificationSound).not.toHaveBeenCalled()
  })
})
