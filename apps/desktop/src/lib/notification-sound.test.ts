import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $hapticsMuted } from '@/store/haptics'

import { playNotificationSound } from './notification-sound'

const claimAmbientCue = vi.fn().mockResolvedValue(true)
const started = vi.fn()

/** Enough of WebAudio to record that a cue was actually scheduled. */
function stubAudioContext() {
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })

  return {
    currentTime: 0,
    destination: {},
    createBiquadFilter: () => ({ type: '', frequency: param(), Q: param(), connect: vi.fn() }),
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    createOscillator: () => ({
      type: '',
      frequency: param(),
      connect: vi.fn(),
      start: started,
      stop: vi.fn()
    }),
    state: 'running'
  }
}

beforeEach(() => {
  claimAmbientCue.mockClear().mockResolvedValue(true)
  started.mockClear()
  $hapticsMuted.set(false)

  const win = window as unknown as { AudioContext: unknown; hermesDesktop?: unknown }

  win.hermesDesktop = { claimAmbientCue }
  win.AudioContext = vi.fn(stubAudioContext)
})

describe('playNotificationSound', () => {
  it('schedules a cue for a kind that has one', async () => {
    playNotificationSound('approval', 's-1')
    await vi.waitFor(() => expect(started).toHaveBeenCalled())
  })

  it('never claims a cue for turnDone, which the turn-end chime already owns', () => {
    playNotificationSound('turnDone', 's-1')
    expect(claimAmbientCue).not.toHaveBeenCalled()
  })

  it('obeys the app mute, and does not claim the cue away from an unmuted peer window', () => {
    // Order matters: claiming first and then discovering we are muted would let
    // a muted window silence an audible one, which is how the turn-end cue is
    // careful about it too.
    $hapticsMuted.set(true)
    playNotificationSound('approval', 's-1')
    expect(claimAmbientCue).not.toHaveBeenCalled()
    expect(started).not.toHaveBeenCalled()
  })

  it('stays silent in the window that lost the claim', async () => {
    claimAmbientCue.mockResolvedValue(false)
    playNotificationSound('approval', 's-1')
    await claimAmbientCue.mock.results[0]?.value
    expect(started).not.toHaveBeenCalled()
  })

  it('claims per kind and session, so two events in one chat are two cues', () => {
    playNotificationSound('approval', 's-1')
    playNotificationSound('turnError', 's-1')
    expect(claimAmbientCue.mock.calls.map(call => call[0])).toEqual([
      'notify:approval:s-1',
      'notify:turnError:s-1'
    ])
  })
})
