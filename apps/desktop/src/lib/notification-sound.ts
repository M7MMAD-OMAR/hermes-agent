// The audible half of a notification. Synthesized like every other cue in the
// app (wake-sound, completion-sound, thinking-sound) rather than shipped as an
// asset: nothing to bundle, nothing to decode, and it inherits the same mute.

import { getAudioContext } from '@/lib/audio-context'
import { cueForKind, type NotificationCue, notificationCueKey } from '@/lib/notification-cue'
import { ownsAmbientCue } from '@/store/ambient'
import { $hapticsMuted } from '@/store/haptics'
import type { NativeNotificationKind } from '@/store/native-notifications'

interface Tone {
  /** Seconds after the cue's start. */
  at: number
  dur: number
  freq: number
  gain: number
}

// Low-mid register, short, and quiet enough to sit under whatever the user is
// listening to. Attention RISES (a question), done SETTLES (a statement),
// error FALLS (something went wrong). The shapes carry the meaning even at
// low volume, which is the whole point of having three.
const TONES: Record<NotificationCue, readonly Tone[]> = {
  attention: [
    { at: 0, dur: 0.16, freq: 587.33, gain: 0.05 },
    { at: 0.13, dur: 0.3, freq: 880, gain: 0.055 }
  ],
  done: [
    { at: 0, dur: 0.18, freq: 659.25, gain: 0.04 },
    { at: 0.1, dur: 0.42, freq: 523.25, gain: 0.045 }
  ],
  error: [
    { at: 0, dur: 0.2, freq: 415.3, gain: 0.05 },
    { at: 0.15, dur: 0.42, freq: 277.18, gain: 0.05 }
  ]
}

function playCue(cue: NotificationCue) {
  const ac = getAudioContext()

  if (!ac) {
    return
  }

  // One shared low-pass so the cue reads warm rather than as a bare oscillator,
  // matching the turn-end bank's tone stage.
  const tone = ac.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(3800, ac.currentTime)
  tone.connect(ac.destination)

  const t0 = ac.currentTime + 0.01

  for (const spec of TONES[cue]) {
    const osc = ac.createOscillator()
    const env = ac.createGain()
    const start = t0 + spec.at
    const end = start + spec.dur

    osc.type = 'sine'
    osc.frequency.setValueAtTime(spec.freq, start)

    // Exponential ramps only: a ramp to literal zero clicks.
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(spec.gain, start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(env)
    env.connect(tone)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

/**
 * Sound one notification.
 *
 * Called from `dispatchNativeNotification` AFTER every gate, so the sound and
 * the OS banner are the same decision: a kind the user muted, an event they are
 * already looking at, or a duplicate is silent as well as invisible. Sounding
 * on the raw event instead would put a noise on work the machine does on its
 * own, which is exactly the thing the notification gate exists to keep quiet.
 */
export function playNotificationSound(kind: NativeNotificationKind, sessionId?: null | string): void {
  if ($hapticsMuted.get()) {
    return
  }

  const cue = cueForKind(kind)

  if (!cue) {
    return
  }

  // One window per event: several full windows each dispatch the same
  // notification, and main is the race-free owner of the claim.
  void ownsAmbientCue(notificationCueKey(kind, sessionId)).then(owns => {
    if (owns) {
      playCue(cue)
    }
  })
}
