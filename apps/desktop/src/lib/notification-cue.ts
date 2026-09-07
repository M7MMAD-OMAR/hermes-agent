import type { NativeNotificationKind } from '@/store/native-notifications'

/**
 * Which sound a notification kind gets, as a pure rule.
 *
 * Three cues, not seven: the point is to tell APART the thing that needs you
 * from the thing that merely finished, without learning a vocabulary. More
 * distinct tones would only be noise, since the notification itself names the
 * event.
 */
export type NotificationCue = 'attention' | 'done' | 'error'

/**
 * `turnDone` deliberately maps to null. The turn-end chime already plays from
 * `message.complete` (completion-sound.ts) with its own fourteen-variant bank
 * and its own settings, focused or not. Firing a second cue here would double
 * every finished turn, and silencing the older one would take away a cue people
 * already rely on while focused, which no notification covers.
 */
const CUE_BY_KIND: Record<NativeNotificationKind, NotificationCue | null> = {
  approval: 'attention',
  backgroundDone: 'done',
  credits: 'error',
  input: 'attention',
  plugin: 'done',
  turnDone: null,
  turnError: 'error'
}

export function cueForKind(kind: NativeNotificationKind): NotificationCue | null {
  return CUE_BY_KIND[kind] ?? null
}

/**
 * The cross-window ownership key for one cue.
 *
 * Keyed on kind AND session, not session alone. The turn-end cue's key is the
 * session by itself, which is right for it (one turn, one chime), but two
 * different notifications for the same chat, an approval and then the finished
 * turn, are two separate events, and a session-only key would let the first
 * one silence the second.
 */
export function notificationCueKey(kind: NativeNotificationKind, sessionId?: null | string): string {
  return `notify:${kind}:${sessionId ?? ''}`
}
