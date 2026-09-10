import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { $pluginRecords } from '@/contrib/plugins-store'
import { localeDirection, useI18n } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile, $profileScope, ALL_PROFILES } from '@/store/profile'
import { requestStartWorkSession } from '@/store/projects'

import type { ResultsRequest } from './result-index'

interface ActionProposal {
  id: string
  title: string
  quote: string
  owner: string | null
  due_text: string | null
  user_edited: number
  state: 'pending' | 'accepting' | 'accepted' | 'dismissed'
  task_id: string | null
  board: string | null
  last_error: string | null
  citation: {
    path: string
    locator: 'page' | 'paragraph' | 'comment' | 'line'
    start: number
    end: number
    sha256: string
    is_current: number
  }
}

interface Props {
  projectId: string
  files: { id: string; path: string; status: string }[]
  request: ResultsRequest
}

interface ActionsPage {
  actions: ActionProposal[]
  board: string
  next_before: string | null
}

export function ProjectActions({ projectId, files, request }: Props) {
  const { t, locale } = useI18n()
  const a = t.projectActions
  const [data, setData] = useState<ActionsPage | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const alive = useRef(true)

  // eslint-disable-next-line no-restricted-syntax -- Tracks component lifetime for async work.
  useEffect(() => {
    alive.current = true
    let active = true
    void request<ActionsPage>('projects.actions.list', { id: projectId })
      .then(value => {
        if (active) {
          setData(value)
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
  }, [projectId, request, revision])

  async function loadMore() {
    if (!data?.next_before) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const page = await request<ActionsPage>('projects.actions.list', { id: projectId, before: data.next_before })

      if (alive.current) {
        setData(current =>
          current
            ? {
                ...page,
                actions: [
                  ...current.actions,
                  ...page.actions.filter(action => !current.actions.some(existing => existing.id === action.id))
                ]
              }
            : page
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

  async function change(method: string, fields: Record<string, unknown>) {
    setBusy(true)
    setError(null)

    try {
      await request(method, { id: projectId, ...fields })

      if (alive.current) {
        setRevision(value => value + 1)
      }
    } catch (err) {
      if (alive.current) {
        setError(String(err))
        setRevision(value => value + 1)
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  async function extract() {
    const owner = { connectionId: $activeConnectionId.get(), profile: $activeGatewayProfile.get() }
    setBusy(true)
    setError(null)

    try {
      const result = await request<{ cwd: string; draft: string }>('projects.actions.draft', {
        id: projectId,
        file_id: source
      })

      if (
        !alive.current ||
        owner.connectionId !== $activeConnectionId.get() ||
        owner.profile !== $activeGatewayProfile.get() ||
        $profileScope.get() === ALL_PROFILES
      ) {
        return
      }

      requestStartWorkSession(result.cwd, result.draft, {
        openTab: true,
        route: { connectionId: owner.connectionId || 'local', profile: owner.profile }
      })
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

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{a.title}</h3>
      <p className="text-xs text-muted-foreground">{a.hint}</p>
      <Select dir={localeDirection(locale)} onValueChange={setSource} value={source}>
        <SelectTrigger aria-label={a.source} className="w-full">
          <SelectValue placeholder={a.source} />
        </SelectTrigger>
        <SelectContent>
          {files
            .filter(file => ['ready', 'partial'].includes(file.status))
            .map(file => (
              <SelectItem key={file.id} value={file.id}>
                {file.path}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !source} onClick={() => void extract()} size="sm">
          {a.extract}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setError(null)
            setRevision(value => value + 1)
          }}
          size="sm"
          variant="outline"
        >
          {a.refresh}
        </Button>
      </div>
      {error && (
        <p className="break-words text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {data && (
        <p className="text-xs text-muted-foreground">
          {a.board}: {data.board}
        </p>
      )}
      {data?.actions.length === 0 && <p className="text-sm text-muted-foreground">{a.empty}</p>}
      {data?.actions.map(action => (
        <ActionRow action={action} busy={busy} change={change} key={action.id} />
      ))}
      {data?.next_before && (
        <Button disabled={busy} onClick={() => void loadMore()} size="sm" variant="outline">
          {t.sidebar.loadMore}
        </Button>
      )}
    </section>
  )
}

function ActionRow({
  action,
  busy,
  change
}: {
  action: ActionProposal
  busy: boolean
  change: (method: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const plugins = useStore($pluginRecords)
  const a = t.projectActions
  const [title, setTitle] = useState(action.title)
  const [owner, setOwner] = useState(action.owner || '')
  const [due, setDue] = useState(action.due_text || '')
  const dirty = title !== action.title || owner !== (action.owner || '') || due !== (action.due_text || '')
  const editable = action.state === 'pending'
  const citation = action.citation
  const sourceText = `${citation.path}, ${t.projectBrief[citation.locator]} ${citation.start}-${citation.end}, SHA256 ${citation.sha256}\n${action.quote}`

  return (
    <article className="space-y-2 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        {a[action.state]}
        {action.user_edited ? ` · ${a.edited}` : ''}
      </p>
      {editable ? (
        <>
          <Input
            aria-label={a.task}
            dir="auto"
            maxLength={500}
            onChange={event => setTitle(event.target.value)}
            value={title}
          />
          <Input
            aria-label={a.owner}
            dir="auto"
            maxLength={200}
            onChange={event => setOwner(event.target.value)}
            placeholder={a.owner}
            value={owner}
          />
          <Input
            aria-label={a.due}
            dir="auto"
            maxLength={200}
            onChange={event => setDue(event.target.value)}
            placeholder={a.due}
            value={due}
          />
        </>
      ) : (
        <p className="break-words text-sm" dir="auto">
          {action.title}
        </p>
      )}
      {!editable && action.owner && (
        <p className="break-words text-xs" dir="auto">
          {a.owner}: {action.owner}
        </p>
      )}
      {!editable && action.due_text && (
        <p className="break-words text-xs" dir="auto">
          {a.due}: {action.due_text}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs">
          {a.quote} · {citation.is_current ? t.projectBrief.current : t.projectBrief.previous}
        </summary>
        <p className="break-all text-xs" dir="auto">
          {citation.path}
        </p>
        <p className="text-xs">
          {t.projectBrief[citation.locator]} {citation.start}-{citation.end} · {citation.sha256.slice(0, 8)}
        </p>
        <blockquote className="whitespace-pre-wrap break-words text-sm" dir="auto">
          {action.quote}
        </blockquote>
        <CopyButton label={t.projectBrief.copy} text={sourceText} />
      </details>
      {action.last_error && <p className="break-words text-xs text-destructive">{action.last_error}</p>}
      {action.task_id && (
        <p className="break-all text-xs">
          {a.task}: {action.task_id} · {a.board}: {action.board}
        </p>
      )}
      {action.task_id && plugins.kanban?.status === 'loaded' && (
        <Button
          onClick={() =>
            navigate(`/kanban?${new URLSearchParams({ board: action.board || 'default', task: action.task_id || '' })}`)
          }
          size="sm"
          variant="outline"
        >
          {a.task}: {action.task_id}
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button
            disabled={busy || !dirty || !title.trim()}
            onClick={() => void change('projects.actions.edit', { action_id: action.id, title, owner, due_text: due })}
            size="sm"
            variant="outline"
          >
            {a.save}
          </Button>
        )}
        {(editable || action.state === 'accepting') && (
          <Button
            disabled={busy || dirty}
            onClick={() => void change('projects.actions.accept', { action_id: action.id })}
            size="sm"
          >
            {action.state === 'accepting' ? a.accepting : a.accept}
          </Button>
        )}
        {editable && (
          <Button
            disabled={busy}
            onClick={() => void change('projects.actions.dismiss', { action_id: action.id })}
            size="sm"
            variant="ghost"
          >
            {a.dismiss}
          </Button>
        )}
      </div>
    </article>
  )
}
