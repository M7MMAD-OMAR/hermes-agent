import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchProjectSessions } from '@/store/projects'

import type { SidebarProjectTree } from './projects/workspace-groups'
import { useEnteredProjectRefresh } from './use-entered-project-refresh'

// A failed drill-in used to sit there until the user clicked Retry or a
// `sessions.changed` tick happened to fire, which on an idle machine can be
// never. The common failure is transient (a socket reconnecting under the
// request, a response dropped on a freshly opened one), so the view retries
// itself before it gives up and asks a human. The first delay is short enough
// that a dropped response reads as a slow load rather than as an error.
//
// This is the ONLY retry for this read: the store reports what happened and
// retries nothing, because the view is the layer that knows whether the user
// is still standing in this project.
const RETRY_DELAYS_MS = [400, 2_000, 5_000]

// The mounted drill-in owns its outcome. A global error flag lets a departed
// project's slow failure overwrite the next project's successful load.
export function useEnteredProjectSessions(
  projectId: string | undefined,
  ready: boolean,
  treeRevision: readonly SidebarProjectTree[],
  scope: string
) {
  const [project, setProject] = useState<SidebarProjectTree | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => setRetryToken(token => token + 1), [])
  useEnteredProjectRefresh(projectId ?? null, ready, retry)

  // Automatic attempts spent on the current (project, scope, manual retry).
  // NOT effect-local: the effect also re-runs on every project-tree refresh,
  // which arrives on the same order of seconds as the retry delays, so a
  // fresh allowance per run means a persistent failure retries forever and
  // never reaches the state that tells the user. The read is a hydrated
  // per-profile scan; it must be allowed to stop.
  const attempts = useRef({ key: '', n: 0 })

  useEffect(() => {
    setProject(null)
  }, [projectId, scope])

  // The ref write below is not a reactive value mirrored into a ref: the retry
  // allowance has no render of its own to lag behind. It lives outside the
  // effect on purpose, so a project-tree refresh re-running the effect cannot
  // refill it and leave a failing read retrying forever.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let cancelled = false
    let timer: null | number = null
    const allowanceKey = `${projectId ?? ''}::${scope}::${retryToken}`

    // Reads and rewrites the allowance, rekeying it when this is a different
    // (project, scope, manual retry) than the one it was counting.
    const spendAttempt = (n: number | null): number => {
      if (attempts.current.key !== allowanceKey) {
        attempts.current = { key: allowanceKey, n: 0 }
      }

      if (n !== null) {
        attempts.current = { key: allowanceKey, n }
      }

      return attempts.current.n
    }

    setFailed(false)

    if (!projectId || !ready) {
      setProject(null)
      setLoading(false)

      return
    }

    // One attempt, then either paint the answer or schedule the next attempt.
    // `superseded` and `unavailable` are neither: another read owns the view,
    // or the scope has no drill-in to give, and both leave what is on screen.
    const run = () => {
      setLoading(true)
      void fetchProjectSessions(projectId)
        .then(next => {
          if (cancelled) {
            return
          }

          if (next.status === 'ok') {
            setProject(next.project)
            spendAttempt(0)

            return
          }

          if (next.status !== 'failed') {
            return
          }

          const delay = RETRY_DELAYS_MS[spendAttempt(null)]

          if (delay === undefined) {
            setFailed(true)

            return
          }

          spendAttempt(spendAttempt(null) + 1)
          timer = window.setTimeout(() => {
            timer = null
            run()
          }, delay)
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true)
          }
        })
        .finally(() => {
          if (!cancelled && timer === null) {
            setLoading(false)
          }
        })
    }

    run()

    return () => {
      cancelled = true

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [projectId, ready, treeRevision, scope, retryToken])

  return { project, failed, loading, retry }
}
