import { describe, expect, it } from 'vitest'

import { NATIVE_NOTIFICATION_KINDS } from '@/store/native-notifications'

import { cueForKind, notificationCueKey } from './notification-cue'

describe('cueForKind', () => {
  it('sounds the attention cue for the kinds that block on the user', () => {
    expect(cueForKind('approval')).toBe('attention')
    expect(cueForKind('input')).toBe('attention')
  })

  it('sounds the error cue for failures and the credit wall', () => {
    expect(cueForKind('turnError')).toBe('error')
    expect(cueForKind('credits')).toBe('error')
  })

  it('sounds the done cue for work that finished on its own', () => {
    expect(cueForKind('backgroundDone')).toBe('done')
    expect(cueForKind('plugin')).toBe('done')
  })

  it('stays silent for turnDone, which the turn-end chime already covers', () => {
    expect(cueForKind('turnDone')).toBeNull()
  })

  it('has a decision for every kind, so a new kind cannot be silently forgotten', () => {
    for (const kind of NATIVE_NOTIFICATION_KINDS) {
      expect([null, 'attention', 'done', 'error']).toContain(cueForKind(kind))
    }
  })
})

describe('notificationCueKey', () => {
  it('separates two kinds in the same chat, which a session-only key would merge', () => {
    expect(notificationCueKey('approval', 's-1')).not.toBe(notificationCueKey('turnError', 's-1'))
  })

  it('separates the same kind in two chats', () => {
    expect(notificationCueKey('approval', 's-1')).not.toBe(notificationCueKey('approval', 's-2'))
  })

  it('is stable for the same kind and chat, so peer windows collapse onto one cue', () => {
    expect(notificationCueKey('approval', 's-1')).toBe(notificationCueKey('approval', 's-1'))
  })

  it('never collides with the turn-end chime key, which is the bare session id', () => {
    expect(notificationCueKey('turnDone', 's-1')).not.toBe('sound:s-1')
  })
})
