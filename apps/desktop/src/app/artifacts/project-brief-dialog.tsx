import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { fmtDayTime } from '@/lib/time'
import type { ProjectInfo } from '@/types/hermes'

import type { ResultsRequest } from './result-index'

interface ReferenceHit {
  citation_id: number
  text: string
  path: string
  locator: 'page' | 'paragraph' | 'comment' | 'line'
  start: number
  end: number
  sha256: string
  indexed_at: number
  is_current: number
}
interface Brief {
  project: ProjectInfo
  files: { id: string; path: string; status: string; error: string | null }[]
  approved_results: { id: string; label: string; session_id: string; number: number }[]
}

interface ProjectBriefDialogProps {
  projectId: string
  request: ResultsRequest
  onClose: () => void
  onOpenChat: (sessionId: string) => void
  onOpenSource: (path: string) => void
}

export function ProjectBriefDialog({
  projectId,
  request,
  onClose,
  onOpenChat,
  onOpenSource
}: ProjectBriefDialogProps) {
  const { t } = useI18n()
  const a = t.projectBrief
  const [brief, setBrief] = useState<Brief | null>(null)
  const [description, setDescription] = useState('')
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState(false)
  const [matches, setMatches] = useState<ReferenceHit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loadRevision, setLoadRevision] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const alive = useRef(true)

  // eslint-disable-next-line no-restricted-syntax -- Async lifecycle guard, not a reactive state mirror.
  useEffect(() => {
    let active = true
    alive.current = true
    setError(null)
    void request<Brief>('projects.brief', { id: projectId })
      .then(value => {
        if (active) {
          setBrief(value)
          setDescription(value.project.description || '')
        }
      })
      .catch(err => {
        if (active) {
          setError(String(err))
        }
      })

    return () => {
      active = false
      alive.current = false
    }
  }, [projectId, request, loadRevision])

  useEffect(() => {
    let active = true
    setSearching(Boolean(query.trim()))
    setSearchError(null)

    if (!query.trim()) {
      setMatches([])

      return
    }

    const timer = setTimeout(() => {
      void request<{ matches: ReferenceHit[] }>('projects.references.search', {
        id: projectId,
        query,
        include_history: history
      })
        .then(value => {
          if (active) {
            setMatches(value.matches)
          }
        })
        .catch(err => {
          if (active) {
            setSearchError(String(err))
          }
        })
        .finally(() => {
          if (active) {
            setSearching(false)
          }
        })
    }, 250)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [projectId, request, query, history, revision])

  async function refresh() {
    setBusy(true)
    setError(null)

    try {
      const scan = await request<{ truncated: boolean; failures: { path: string; error: string }[] }>(
        'projects.references.scan',
        { id: projectId }
      )

      if (!alive.current) {
        return
      }

      const warnings = scan.failures.map(failure => `${failure.path}: ${failure.error}`)

      if (scan.truncated) {
        warnings.push(a.scanLimit)
      }

      for (let batch = 0; batch < 32 && alive.current; batch++) {
        const result = await request<{
          pending: number
          has_more: boolean
          failures: { path: string; error: string }[]
        }>('projects.references.index', { id: projectId })

        if (!alive.current) {
          return
        }

        setRemaining(result.pending)

        if (!result.has_more) {
          break
        }
      }

      const value = await request<Brief>('projects.brief', { id: projectId })

      if (alive.current) {
        setBrief(value)
        setRevision(current => current + 1)
        setError(warnings.length ? warnings.join('\n') : null)
      }
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  async function save() {
    setBusy(true)
    setError(null)

    try {
      const value = await request<{ project: ProjectInfo }>('projects.update', { id: projectId, description })

      if (alive.current) {
        setBrief(
          current => current && { ...current, project: { ...current.project, description: value.project.description } }
        )
      }
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  const issues = brief?.files.filter(file => file.status !== 'ready') || []

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {a.title}
            {brief ? `: ${brief.project.name}` : ''}
          </DialogTitle>
          <DialogDescription>{a.hint}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="whitespace-pre-wrap break-words text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {!brief && error && <Button onClick={() => setLoadRevision(value => value + 1)}>{a.retry}</Button>}
        {!brief && !error && <p role="status">{t.artifacts.refreshing}</p>}
        {brief && (
          <div className="min-w-0 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-brief-description">
                {a.summary}
              </label>
              <Textarea
                dir="auto"
                id="project-brief-description"
                onChange={event => setDescription(event.target.value)}
                value={description}
              />
              <Button
                disabled={busy || description === (brief.project.description || '')}
                onClick={() => void save()}
                size="sm"
              >
                {a.save}
              </Button>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{a.sources}</h3>
              {brief.project.folders.map(folder => (
                <p className="break-all text-xs text-muted-foreground" dir="auto" key={folder.path}>
                  {folder.path}
                  {folder.health !== 'available' ? ` (${a.unavailable})` : ''}
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy} onClick={() => void refresh()} size="sm">
                  {busy ? t.artifacts.indexing : a.refresh}
                </Button>
                <span className="text-xs text-muted-foreground" role="status">
                  {a.indexed(
                    brief.files.filter(file => file.status === 'ready' || file.status === 'partial').length,
                    brief.files.length
                  )}
                  {remaining > 0 ? ` · ${a.pending(remaining)}` : ''}
                </span>
              </div>
              {issues.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">{a.issues(issues.length)}</summary>
                  <ul className="mt-2 max-h-40 space-y-2 overflow-auto">
                    {issues.map(file => (
                      <li className="break-all text-xs" dir="auto" key={file.id}>
                        {file.path}
                        <br />
                        {file.error || a.pending(1)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            {brief.approved_results.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{a.approved}</h3>
                {brief.approved_results.map(result => (
                  <Button
                    key={`${result.id}:${result.number}`}
                    onClick={() => onOpenChat(result.session_id)}
                    size="sm"
                    variant="ghost"
                  >
                    {result.label} · {t.artifacts.versionNumber(result.number)}
                  </Button>
                ))}
              </div>
            )}
            <div className="space-y-3">
              <SearchField
                containerClassName="w-full"
                loading={searching}
                onChange={setQuery}
                placeholder={a.search}
                value={query}
              />
              <Button aria-pressed={history} onClick={() => setHistory(value => !value)} size="sm" variant="ghost">
                {a.history}
                {history ? ' ✓' : ''}
              </Button>
              {searchError && (
                <p className="text-xs text-destructive" role="alert">
                  {searchError}
                </p>
              )}
              {query.trim() && !searching && !searchError && matches.length === 0 && (
                <p className="text-sm text-muted-foreground">{a.noMatches}</p>
              )}
              <ol className="space-y-5">
                {matches.map(hit => {
                  const location = `${a[hit.locator]} ${hit.start}${hit.end !== hit.start ? `-${hit.end}` : ''}`
                  const citation = `${hit.path}, ${location}, SHA256 ${hit.sha256}, citation ${hit.citation_id}\n${hit.text}`

                  return (
                    <li className="space-y-2" key={hit.citation_id}>
                      <p className="break-all text-xs font-medium" dir="auto">
                        {hit.path}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {location} · {hit.is_current ? a.current : a.previous} · {hit.sha256.slice(0, 8)} ·{' '}
                        {fmtDayTime.format(new Date(hit.indexed_at * 1000))}
                      </p>
                      <blockquote className="whitespace-pre-wrap break-words text-sm" dir="auto">
                        {hit.text}
                      </blockquote>
                      <Button
                        disabled={!hit.is_current}
                        onClick={() => onOpenSource(hit.path)}
                        size="sm"
                        variant="ghost"
                      >
                        {a.openSource}
                      </Button>
                      <CopyButton buttonSize="sm" label={a.copy} showLabel text={citation} />
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
