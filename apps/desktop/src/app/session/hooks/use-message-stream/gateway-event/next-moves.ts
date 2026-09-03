import { offerNextMoves } from '@/store/suggestion-providers/next-move'

import type { GatewayEventContext } from './types'

/** `next_moves.offer` — the backend's post-turn suggestion pack.
 *
 *  Thin on purpose: every drop rule lives in the provider, beside the turn
 *  accounting it has to consult. What matters here is that the session id is
 *  the event's OWN routed id and never the active one — the pack describes one
 *  conversation's turn, and `next_moves.offer` is registered in
 *  `gatewayEventRequiresSessionId` so an unscoped frame is dropped upstream
 *  rather than attributed to whatever chat happens to be focused. */
export function handleNextMovesEvent(ctx: GatewayEventContext): boolean {
  if (ctx.event.type !== 'next_moves.offer') {
    return false
  }

  offerNextMoves(ctx.sessionId, ctx.payload?.moves)

  return true
}
