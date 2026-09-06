import { atom } from 'nanostores'

// "Is the thread parked at the bottom" is owned by use-stick-to-bottom inside
// ThreadMessageList (the scroll container). That state lives only in that
// subtree, so ThreadMessageList mirrors it out here for the composer, status
// stack, and floating jump button, all of which render OUTSIDE the thread.
//
// KEYED BY SESSION, and that is the whole point. Panes are shown side by side,
// so several transcripts are on screen at once. While this mirror was two
// global booleans, whichever pane published last spoke for all of them:
// scrolling up in one chat raised the jump pill in every other open chat and
// dimmed all their composers. Each transcript owns its own answer.
//
// `scrolledUp` dims the composer / status stack; `jumpVisible` shows the
// floating jump control. Both track `!isAtBottom` today, but stay separate so
// their thresholds can diverge again without touching consumers.
export interface ThreadScrollState {
  jumpVisible: boolean
  scrolledUp: boolean
}

/** Draft transcripts have no session id yet and share the empty key, so two
 *  un-persisted drafts on screen at once still mirror each other. Same
 *  compromise the prompt store makes, and for the same reason: there is no
 *  other identity to key on until the first turn persists. */
const keyFor = (sessionId: null | string | undefined): string => sessionId ?? ''

const AT_BOTTOM: ThreadScrollState = { jumpVisible: false, scrolledUp: false }

export const $threadScrollBySession = atom<Record<string, ThreadScrollState>>({})

/** One transcript's chrome state. Never null: an unknown session has not
 *  scrolled, which is what a fresh pane should paint. */
export const threadScrollFor = (
  all: Record<string, ThreadScrollState>,
  sessionId: null | string | undefined
): ThreadScrollState => all[keyFor(sessionId)] ?? AT_BOTTOM

export const setThreadAtBottom = (sessionId: null | string, isAtBottom: boolean): void => {
  const key = keyFor(sessionId)
  const all = $threadScrollBySession.get()
  const current = all[key] ?? AT_BOTTOM

  // Skip no-op writes so subscribers do not churn on every scroll tick.
  if (current.scrolledUp === !isAtBottom && current.jumpVisible === !isAtBottom) {
    return
  }

  $threadScrollBySession.set({ ...all, [key]: { jumpVisible: !isAtBottom, scrolledUp: !isAtBottom } })
}

/** Drop one transcript's entry when its list unmounts.
 *
 *  There is no `paneVisible` guard here or on the publisher any more. It existed
 *  because a hidden keep-alive tab writing the single global would clobber the
 *  visible pane's value; with one entry per session a hidden pane writing its
 *  own key harms nobody, and refusing its writes is worse than allowing them: a
 *  tab you scrolled up in and switched away from would keep a stale entry. */
export const clearThreadScroll = (sessionId: null | string): void => {
  const key = keyFor(sessionId)
  const all = $threadScrollBySession.get()

  if (!(key in all)) {
    return
  }

  const next = { ...all }

  delete next[key]
  $threadScrollBySession.set(next)
}

/** Forget every transcript's state (gateway switch, tests). */
export const resetAllThreadScroll = (): void => {
  if (Object.keys($threadScrollBySession.get()).length > 0) {
    $threadScrollBySession.set({})
  }
}

// Cross-component bridge: the jump button lives by the composer, the viewport's
// `scrollToBottom` lives inside the thread. The bridge registers a handler; the
// button fires it. Mirrors the composer focus/insert emitter pattern.
const handlers = new Map<string | null, Set<() => void>>()

export const onScrollToBottomRequest = (handler: () => void, sessionId: string | null = null) => {
  const scoped = handlers.get(sessionId) ?? new Set<() => void>()

  scoped.add(handler)
  handlers.set(sessionId, scoped)

  return () => {
    scoped.delete(handler)

    if (scoped.size === 0) {
      handlers.delete(sessionId)
    }
  }
}

export const requestScrollToBottom = (sessionId: string | null = null) => {
  handlers.get(sessionId)?.forEach(handler => handler())
}

// Inline edit grows a sticky human bubble. Fire on pointerdown so the viewport
// escapes stick-to-bottom before focus/layout; close clears the edit flag when
// the inline composer unmounts.
const editOpenHandlers = new Set<() => void>()
const editCloseHandlers = new Set<() => void>()

export const onThreadEditOpen = (handler: () => void) => {
  editOpenHandlers.add(handler)

  return () => void editOpenHandlers.delete(handler)
}

export const notifyThreadEditOpen = () => editOpenHandlers.forEach(handler => handler())

export const onThreadEditClose = (handler: () => void) => {
  editCloseHandlers.add(handler)

  return () => void editCloseHandlers.delete(handler)
}

export const notifyThreadEditClose = () => editCloseHandlers.forEach(handler => handler())
