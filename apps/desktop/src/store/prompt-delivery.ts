/**
 * PROMPT DELIVERY — the one seam between "a comment is leaving the pin panel"
 * and "it lands in the conversation".
 *
 * Three roads a comment can take, and they used to disagree: the panel's Send
 * submitted bare text through the composer bus (its attachments were dropped
 * on the floor — the chip was left sitting in the input field, and the model
 * got the comment without the URL, the selector or the images); Queue parked a
 * copy but ALSO dropped a chip into the input field; and from a popped-out
 * Browser the queue write went to that window's own localStorage, which the
 * composer's window never reads — the entry sat there unsent forever.
 *
 * One function now answers for all of it: resolve the conversation, queue when
 * a turn is in flight, otherwise submit the text WITH its attachments, and
 * fall back to the queue when nothing visible can take the submit. The
 * composer is never touched on the queue road, and a popped-out Browser
 * relays here (see `composer-relay`) so the window that owns the composer and
 * the queue does the work.
 */

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import type { ComposerAttachment } from '@/store/composer'
import { enqueueQueuedPrompt } from '@/store/composer-queue'
import { relayPromptDelivery } from '@/store/composer-relay'
import { $activeSessionId, $sessions, resolveComposerSessionKey, sessionMatchesStoredId } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { isBrowserWindow } from '@/store/windows'

export interface PromptDelivery {
  attachments: ComposerAttachment[]
  /** `'now'` sends (or queues when a turn is busy); `'queue'` always queues. */
  mode: 'now' | 'queue'
  text: string
}

/** The conversation the send paths address. The route-driven key the composer
 *  itself uses is not reachable from the rail, so this resolves the same
 *  durable key from the active session — the queue panel and this resolver
 *  then agree about which conversation owns an entry. */
export function conversationKey(): null | string {
  return resolveComposerSessionKey($activeSessionId.get(), $sessions.get())
}

/** Is that conversation mid-turn? Session states are keyed by RUNTIME id and
 *  carry the stored id they belong to, so match on that: the send path only
 *  queues when a real turn is in flight, never when the caller merely guessed. */
export function isSessionBusy(key: string): boolean {
  return Object.values($sessionStates.get()).some(state => {
    if (!state.busy || !state.storedSessionId) {
      return false
    }

    // The key is a lineage root; the state carries the stored id it belongs
    // to. Match through the same table the composer scope resolves with, so
    // the two never disagree about whether a conversation is mid-turn.
    return (
      state.storedSessionId === key ||
      $sessions
        .get()
        .some(
          session =>
            sessionMatchesStoredId(session, state.storedSessionId ?? '') && sessionMatchesStoredId(session, key)
        )
    )
  })
}

/** Queue one prompt for the conversation, attachments and all. */
const queueIt = (payload: PromptDelivery): boolean => {
  const key = conversationKey()

  return Boolean(key && enqueueQueuedPrompt(key, { attachments: payload.attachments, text: payload.text }))
}

/**
 * Deliver into THIS window's conversation. The primary window runs this for
 * itself; the relay subscription runs it for a popped-out Browser's request.
 */
export async function deliverPromptLocally(payload: PromptDelivery): Promise<boolean> {
  if (payload.mode === 'queue') {
    return queueIt(payload)
  }

  // Mid-turn: the queue drains it when the turn settles.
  if (isSessionBusy(conversationKey() ?? '')) {
    return queueIt(payload)
  }

  // Submit through the composer as if typed — with the chip and the images,
  // which is what makes the model receive the rich preview-comments block
  // instead of the bare sentence. A composer that is not on screen (settings,
  // no visible chat surface) fails closed and the queue catches the prompt.
  if (requestComposerSubmit(payload.text, { attachments: payload.attachments })) {
    return true
  }

  return queueIt(payload)
}

/**
 * The single entry the panel calls. In any window with a composer this is a
 * local delivery; in a popped-out Browser it relays to the window that owns
 * the composer and the queue, and answers with that window's acknowledgement.
 */
export async function deliverPrompt(payload: PromptDelivery): Promise<boolean> {
  if (isBrowserWindow()) {
    return relayPromptDelivery(payload)
  }

  return deliverPromptLocally(payload)
}
