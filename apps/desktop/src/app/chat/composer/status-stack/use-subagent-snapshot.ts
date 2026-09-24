import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { subscribeWindowReturn } from '@/lib/window-return'
import { $gatewayState } from '@/store/session'
import { knownOwnerForSession, requestForOwnedSession } from '@/store/session-states'
import { $subagentsBySession, reconcileSubagentSnapshot, type SubagentPayload } from '@/store/subagents'

export const rejectUnownedSubagentRequest = async <T>(): Promise<T> => {
  throw new Error('Subagent owner unavailable')
}

/** Safety-net cadence behind the live subagent events, for the VISIBLE stack only. */
export const SUBAGENT_SNAPSHOT_POLL_MS = 5_000

/** Hydrate even an empty composer; live events remain authoritative over reads.
 *
 *  Keep-alive keeps every ever-active tab mounted, so the poll is gated on the
 *  pane being the visible tab AND the document being visible: eight open
 *  sessions used to cost eight `subagent.list` round-trips every five seconds
 *  forever, hidden window included. A tab that comes back into view (or the
 *  window that returns) pulls once, immediately.
 *
 *  `poll` keeps the safety-net refresh. It is off when nothing on screen shows
 *  the answer; the one-shot hydrate still lands. */
export function useSubagentSnapshot(sessionId: string | null, poll = true) {
  const gatewayState = useStore($gatewayState)
  const paneVisible = usePaneVisible()

  useEffect(() => {
    if (!sessionId || !paneVisible) {
      return
    }

    let cancelled = false
    let pending = false
    let failures = 0

    const refresh = async () => {
      if (cancelled || pending || failures >= 3) {
        return
      }

      pending = true
      const before = $subagentsBySession.get()[sessionId]
      const owner = JSON.stringify(knownOwnerForSession(sessionId))

      try {
        const snapshot = await requestForOwnedSession<{ subagents: SubagentPayload[] }>(
          sessionId,
          rejectUnownedSubagentRequest,
          'subagent.list',
          { session_id: sessionId }
        )

        if (
          !cancelled &&
          owner === JSON.stringify(knownOwnerForSession(sessionId)) &&
          before === $subagentsBySession.get()[sessionId] &&
          Array.isArray(snapshot.subagents)
        ) {
          reconcileSubagentSnapshot(sessionId, snapshot.subagents)
        }

        failures = 0
      } catch {
        // Older backends retain their event-fed frame; don't hot-loop a missing RPC.
        failures++
      } finally {
        pending = false
      }
    }

    const refreshWhileViewed = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    void refresh()

    if (!poll) {
      return () => {
        cancelled = true
      }
    }

    const timer = window.setInterval(refreshWhileViewed, SUBAGENT_SNAPSHOT_POLL_MS)

    const unsubscribeReturn = subscribeWindowReturn(() => {
      failures = 0
      void refresh()
    })

    return () => {
      cancelled = true
      window.clearInterval(timer)
      unsubscribeReturn()
    }
  }, [sessionId, gatewayState, paneVisible, poll])
}
