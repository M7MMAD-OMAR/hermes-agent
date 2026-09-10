/**
 * What a HerWork chat shows before the first message.
 *
 * Core's splash is Hermes' wordmark and belongs to a fresh draft; a HerWork chat
 * is a desk session. It claims only sessions whose tile carries the HerWork
 * workspace scope and declines everything else, which is also how it stands
 * down while the transcript hydrates (the tile lands before the first turn).
 */

import { host, useValue, Wordmark } from '@hermes/plugin-sdk'

import { HERWORK_OWNER_KEY } from './desk'
import { useHerwork } from './i18n'

export function HerworkChatEmpty({ sessionId }: { sessionId: string }) {
  const m = useHerwork()
  // Subscribed, not read once: the tile and the focused stored id both land
  // after the transcript mounts, and the slot mounts for every empty session.
  useValue(host.sessionTiles)
  const focusedStored = useValue(host.state.focusedStoredSessionId) ?? ''

  // The transcript hands its slot the RUNTIME id; tiles are keyed by the
  // STORED one. Same two id spaces Bot Mode translates through.
  const owned =
    host.sessionInWorkspace(sessionId, 'herwork', HERWORK_OWNER_KEY) ||
    host.sessionInWorkspace(focusedStored, 'herwork', HERWORK_OWNER_KEY)

  if (!owned) {
    return null
  }

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="herwork_chat_empty"
    >
      <div className="w-full min-w-0">
        <Wordmark className="mb-1" text={m.empty.title} width="calc(80% - 1rem)" />
        <p className="m-0 text-center leading-normal tracking-tight">{m.empty.desk}</p>
        <p className="m-0 mt-3 text-center text-xs leading-normal text-muted-foreground/70">{m.empty.rule}</p>
      </div>
    </div>
  )
}
