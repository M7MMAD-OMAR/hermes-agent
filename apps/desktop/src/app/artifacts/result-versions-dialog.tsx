import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { mediaExternalUrl } from '@/lib/media'
import { fmtDayTime } from '@/lib/time'

import type { ArtifactRecord } from './artifact-utils'
import type { ResultsRequest, ResultVersion } from './result-index'

export function ResultVersionsDialog({
  artifact,
  request,
  onClose,
  onOpen
}: {
  artifact: ArtifactRecord
  request: ResultsRequest
  onClose: () => void
  onOpen: (artifact: ArtifactRecord) => void | Promise<void>
}) {
  const { t } = useI18n()
  const a = t.artifacts
  const [versions, setVersions] = useState<ResultVersion[]>([])
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  // eslint-disable-next-line no-restricted-syntax -- Async lifecycle flag, not a mirror of reactive state.
  useEffect(() => {
    let active = true
    alive.current = true
    void request<{ versions: ResultVersion[] }>('projects.results.versions', { result_id: artifact.resultId })
      .then(result => {
        if (active) {
          setVersions(result.versions)
        }
      })
      .catch(err => {
        if (active) {
          setError(String(err))
        }
      })
      .finally(() => {
        if (active) {
          setPending(false)
        }
      })

    return () => {
      active = false
      alive.current = false
    }
  }, [artifact.resultId, request])

  async function capture() {
    setPending(true)
    setError(null)

    try {
      const { version } = await request<{ version: ResultVersion }>('projects.results.capture', {
        result_id: artifact.resultId
      })

      if (alive.current) {
        setVersions(current =>
          [version, ...current.filter(row => row.id !== version.id)].sort((left, right) => right.number - left.number)
        )
      }
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setPending(false)
      }
    }
  }

  async function review(version: ResultVersion, state: string) {
    const previous = versions
    setPending(true)
    setError(null)
    setVersions(current =>
      current.map(row =>
        row.id === version.id ? { ...row, review_state: state as ResultVersion['review_state'] } : row
      )
    )

    try {
      const result = await request<{ version: ResultVersion }>('projects.results.review', {
        version_id: version.id,
        state
      })

      if (alive.current) {
        setVersions(current => current.map(row => (row.id === version.id ? result.version : row)))
      }
    } catch (err) {
      if (alive.current) {
        setVersions(previous)
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setPending(false)
      }
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {a.versions}: {artifact.label}
          </DialogTitle>
          <DialogDescription>{a.captureHint}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <p className="break-all text-xs text-muted-foreground" dir="auto">
            {artifact.value}
          </p>
          <Button disabled={pending} onClick={() => void capture()}>
            {a.captureVersion}
          </Button>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {pending && (
            <p className="text-xs text-muted-foreground" role="status">
              {a.refreshing}
            </p>
          )}
          {!pending && versions.length === 0 && <p className="text-sm text-muted-foreground">{a.noVersions}</p>}
          <ol className="max-h-96 space-y-4 overflow-y-auto">
            {versions.map(version => (
              <li className="flex flex-wrap items-center gap-2" key={version.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.versionNumber(version.number)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDayTime.format(new Date(version.captured_at * 1000))} · {Math.ceil(version.size_bytes / 1024)}{' '}
                    KB
                  </p>
                </div>
                <Select
                  disabled={pending}
                  onValueChange={state => void review(version, state)}
                  value={version.review_state}
                >
                  <SelectTrigger aria-label={`${a.reviewState}: ${a.versionNumber(version.number)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unreviewed">{a.unreviewed}</SelectItem>
                    <SelectItem value="approved">{a.approved}</SelectItem>
                    <SelectItem value="changes_requested">{a.changesRequested}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() =>
                    void onOpen({
                      ...artifact,
                      value: version.snapshot_path,
                      href: mediaExternalUrl(version.snapshot_path)
                    })
                  }
                  size="sm"
                  variant="textStrong"
                >
                  {a.openVersion}
                </Button>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}
