import { useEffect } from 'react'

import { $sessionsChangeTick } from '@/store/live-sync'

/**
 * Coalescing gap for the tick-driven re-hydration of the entered project's
 * snapshot. sessions.changed is floored to 2s server-side and fires on every
 * state.db write during a streaming turn, while `projects.project_sessions`
 * re-runs the backend's per-project session scan — so the re-fetch trails the
 * same cadence the flat list uses for its heavy refresh instead of running per
 * tick.
 */
const ENTERED_PROJECT_REFRESH_GAP_MS = 10_000

/**
 * Re-fetch the entered project's full lane snapshot when the backend broadcasts
 * `sessions.changed`.
 *
 * The render-time overlay (`overlayLiveLanes`) keeps rows that are also on the
 * flat `$sessions` page fresh, but project rows beyond that page exist only in
 * this snapshot: their activity never reaches the view, so a stale lane keeps
 * ranking above one that just went active, and a session deleted from another
 * surface lingers until re-entry. A throttled, trailing-edge re-fetch folds the
 * backend's fresh ordering (and deletions) into the view while a project is
 * entered — at most one fetch per gap, with the burst's last write landing.
 *
 * `refresh` receives the project id that was current when the tick fired; the
 * caller owns stale-response guarding (it must not paint a snapshot for a
 * project the user already left).
 */
export function useEnteredProjectRefresh(
  projectId: null | string,
  enabled: boolean,
  refresh: (projectId: string) => void
): void {
  useEffect(() => {
    if (!projectId || !enabled) {
      return
    }

    const id = projectId
    let cancelled = false
    let lastRunAt = 0
    let timer: null | number = null

    const run = () => {
      if (cancelled) {
        return
      }

      lastRunAt = Date.now()
      refresh(id)
    }

    const unsubscribe = $sessionsChangeTick.listen(() => {
      const since = Date.now() - lastRunAt

      if (since >= ENTERED_PROJECT_REFRESH_GAP_MS) {
        run()
      } else if (timer === null) {
        // Within the gap a pass is already scheduled — trailing-edge, so the
        // burst's last write lands once the gap closes.
        timer = window.setTimeout(() => {
          timer = null
          run()
        }, ENTERED_PROJECT_REFRESH_GAP_MS - since)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [projectId, enabled, refresh])
}
