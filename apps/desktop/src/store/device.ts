import { atom } from 'nanostores'

import { $browserSessionId } from '@/store/preview'

/**
 * DEVICE PANEL state: which conversations are showing a phone, and the last frame
 * each one received.
 *
 * Frames, not a video stream. `screenrecord` hands out an H.264 elementary stream that
 * `VideoDecoder` can take, and that is the right answer for a smooth mirror; it is also
 * a codec pipeline, a keyframe policy and a reconnect story. What this panel is for is
 * watching what the agent is doing to a phone, which needs to be current rather than
 * cinematic. A JPEG every few hundred milliseconds follows a tap perfectly well, costs
 * one screencap, and degrades by going stale instead of going black.
 *
 * The last frame is KEPT when a poll fails. A panel that blanks the moment a device
 * blinks is worse than one showing a frame two seconds old next to the reason, because
 * the reason is usually "the app is restarting" and the old frame is still the truth
 * about where it was.
 */

export interface DeviceFrame {
  /** JPEG data URL, or null before the first successful poll. */
  readonly dataUrl: null | string
  /** Capture size, for the aspect ratio; a phone is not the panel's shape. */
  readonly height: number
  /** Why there is no live frame, when there is not. Shown beside a stale one. */
  readonly reason: string
  /** Whether the LAST poll succeeded, which is not whether `dataUrl` is set. */
  readonly stale: boolean
  readonly width: number
}

export const EMPTY_FRAME: DeviceFrame = { dataUrl: null, height: 0, reason: '', stale: false, width: 0 }

/** Conversations whose panel is open. Per session: a phone belongs to the work, not the window. */
export const $devicePanelSessions = atom<ReadonlySet<string>>(new Set())

/** sessionId to its most recent frame. */
export const $deviceFrames = atom<ReadonlyMap<string, DeviceFrame>>(new Map())

/** How often a visible panel asks for a frame. A screencap costs about a quarter of a
 *  second on a real device, so a shorter interval queues rather than refreshes. */
export const FRAME_INTERVAL_MS = 500

export function toggleDevicePanel(sessionId: string): boolean {
  const open = new Set($devicePanelSessions.get())
  const nowOpen = !open.has(sessionId)

  if (nowOpen) {
    open.add(sessionId)
  } else {
    open.delete(sessionId)
  }

  $devicePanelSessions.set(open)

  return nowOpen
}

export function isDevicePanelOpen(sessionId: string): boolean {
  return $devicePanelSessions.get().has(sessionId)
}

/** Record a successful poll. */
export function setDeviceFrame(sessionId: string, frame: { height: number; url: string; width: number }): void {
  writeFrame(sessionId, { dataUrl: frame.url, height: frame.height, reason: '', stale: false, width: frame.width })
}

/** Record a failed poll, keeping whatever frame was already on screen. */
export function setDeviceUnavailable(sessionId: string, reason: string): void {
  const previous = $deviceFrames.get().get(sessionId) ?? EMPTY_FRAME

  writeFrame(sessionId, { ...previous, reason, stale: true })
}

/** Drop one conversation's frame, so a reopened panel never shows the previous phone. */
export function clearDeviceFrame(sessionId: string): void {
  const frames = new Map($deviceFrames.get())

  if (frames.delete(sessionId)) {
    $deviceFrames.set(frames)
  }
}

function writeFrame(sessionId: string, frame: DeviceFrame): void {
  const frames = new Map($deviceFrames.get())

  frames.set(sessionId, frame)
  $deviceFrames.set(frames)
}

/**
 * Toggle the panel for the conversation on screen.
 *
 * Uses the same key the embedded browser does, `$browserSessionId`, rather than the
 * runtime session id: a draft conversation has no runtime id until its first turn, and
 * keying on that is how the browser could not be opened on an empty chat at all.
 */
export function toggleDevicePanelForActiveSession(): boolean {
  const key = $browserSessionId.get()

  return key ? toggleDevicePanel(key) : false
}
