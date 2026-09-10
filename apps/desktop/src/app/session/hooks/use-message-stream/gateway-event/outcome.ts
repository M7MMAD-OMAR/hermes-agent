import { isVisibleUserMessage } from '@/app/session/hooks/use-prompt-actions/utils'
import { setTurnOutcome } from '@/store/turn-outcome'

import type { GatewayEventContext } from './types'

/** `session.outcome`: the backend's post-turn account of what a turn
 *  delivered, what failed and what is still open.
 *
 *  The session id is the event's OWN routed id, never the active one: the row
 *  describes one conversation's turn, and `session.outcome` is registered in
 *  `gatewayEventRequiresSessionId` so an unscoped frame is dropped upstream
 *  rather than landed on whichever chat is focused. A session that is not on
 *  screen still stores its outcome; the digest reads it when the chat opens.
 *
 *  The turn id is the client id sent with `prompt.submit`. When the backend
 *  echoes none (a queued drain, an older gateway) the outcome binds to the
 *  session's latest user message, which is the turn that just completed. */
export function handleOutcomeEvent(ctx: GatewayEventContext): boolean {
  if (ctx.event.type !== 'session.outcome') {
    return false
  }

  const { sessionId } = ctx

  if (!sessionId) {
    return true
  }

  const payload = ctx.payload as undefined | { outcome?: unknown; turn_id?: unknown }
  const echoed = typeof payload?.turn_id === 'string' ? payload.turn_id.trim() : ''
  const turnId = echoed || latestUserMessageId(ctx, sessionId)

  if (turnId) {
    setTurnOutcome(sessionId, turnId, payload?.outcome)
  }

  return true
}

function latestUserMessageId(ctx: GatewayEventContext, sessionId: string): string {
  const messages = ctx.deps.sessionStateByRuntimeIdRef?.current?.get(sessionId)?.messages ?? []

  return messages.findLast(isVisibleUserMessage)?.id ?? ''
}
