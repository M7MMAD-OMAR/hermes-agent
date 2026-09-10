import { readTurnOutcome } from '@/lib/turn-outcome'

import type { GatewayEventContext } from './types'

/** `session.outcome`: the backend's post-turn account of what a turn
 *  delivered, what failed and what is still open.
 *
 *  The row is a `display_metadata` fact on the turn's final assistant reply,
 *  the same shape as a reaction. The backend has already persisted it (the DB
 *  write happens before this event), so a later resume rehydrates it through
 *  `messageTurnOutcome` -> `ChatMessage.turnOutcome` -> `metadata.custom`. This
 *  handler only paints it now instead of at the next resume, by stamping the
 *  same field onto the live message, so `TurnDigest` reads one source whether
 *  the turn is live or rehydrated.
 *
 *  Stamping onto the message (not a per-turn store keyed by a client turn id)
 *  is deliberate: the end-of-turn resume rebuilds the message list with fresh
 *  ids, so a key bound to the optimistic user-message id would drift off its
 *  row. The field travels ON the row instead, so id churn cannot lose it.
 *
 *  The session id is the event's OWN routed id, never the active one: the row
 *  describes one conversation's turn, and `session.outcome` is registered in
 *  `gatewayEventRequiresSessionId` so an unscoped frame is dropped upstream
 *  rather than landed on whichever chat is focused. A background session still
 *  records its outcome onto its own message list. */
export function handleOutcomeEvent(ctx: GatewayEventContext): boolean {
  if (ctx.event.type !== 'session.outcome') {
    return false
  }

  const { sessionId } = ctx

  if (!sessionId) {
    return true
  }

  const payload = ctx.payload as undefined | { outcome?: unknown }
  const outcome = readTurnOutcome(payload?.outcome)

  if (!outcome) {
    return true
  }

  ctx.deps.updateSessionState(sessionId, state => {
    const lastAssistant = state.messages.findLastIndex(message => message.role === 'assistant')

    if (lastAssistant === -1) {
      return state
    }

    // A replayed rules frame must not overwrite a model outcome already on the
    // row (the gateway replays up to 512 frames on reconnect); a model outcome
    // does replace rules text. A fresh object per change: the runtime message
    // repository caches normalised ThreadMessages in a WeakMap keyed by
    // ChatMessage identity.
    const standing = state.messages[lastAssistant]?.turnOutcome

    if (standing?.source === 'model' && outcome.source === 'rules') {
      return state
    }

    return {
      ...state,
      messages: state.messages.map((message, index) =>
        index === lastAssistant ? { ...message, turnOutcome: outcome } : message
      )
    }
  })

  return true
}
