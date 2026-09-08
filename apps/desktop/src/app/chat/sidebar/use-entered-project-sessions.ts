import { useCallback, useEffect, useState } from 'react'

import { fetchProjectSessions } from '@/store/projects'

import type { SidebarProjectTree } from './projects/workspace-groups'
import { useEnteredProjectRefresh } from './use-entered-project-refresh'

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

  useEffect(() => {
    setProject(null)
  }, [projectId, scope])

  useEffect(() => {
    let cancelled = false
    setFailed(false)

    if (!projectId || !ready) {
      setProject(null)
      setLoading(false)

      return
    }

    setLoading(true)
    void fetchProjectSessions(projectId)
      .then(next => {
        if (!cancelled) {
          if (next.status === 'ok') {setProject(next.project)}

          if (next.status === 'failed') {setFailed(true)}
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId, ready, treeRevision, scope, retryToken])

  return { project, failed, loading, retry }
}
