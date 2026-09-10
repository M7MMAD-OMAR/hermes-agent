/**
 * The HerWork tab body: the desk panel.
 *
 * Three sections over one fixed desk, in the order the work flows: start a job,
 * pick up an earlier one, see what the open job produced.
 *
 *   · Jobs  — the desk's own chats, newest first. The `+` in the tab bar routes
 *             here too; this button exists because the panel is where the eye
 *             already is, and because an empty desk otherwise offers no door.
 *   · Delivered  what `output/` holds, newest first, opened in the preview
 *             rail. The point of the workspace is "hand over a job, get
 *             finished files back", so the files are the deliverable, not a
 *             detail buried in a tree. The three desk folders sit under it as
 *             doors into the file manager.
 *   · Steps — the open job's plan, the same list the composer status stack
 *             renders, pinned where it stays readable while the turn runs.
 *
 * Everything here reads through `@hermes/plugin-sdk`; the pane owns no state
 * that core does not already hold, so a reload rebuilds it exactly.
 */

import type { HermesReadDirEntry, SessionInfo, TodoItem } from '@hermes/plugin-sdk'
import { Codicon, host, relativeTime, useQuery, useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useState } from 'react'

import { HERWORK_OWNER_KEY, HERWORK_PROFILE, herworkDeskCwd, herworkRoute, homeOf } from './desk'
import { type HerworkMessages, useHerwork } from './i18n'

/** Newest first. `started_at` is seconds on some rows and ms on others across
 *  backend versions; compare on the normalised value so the order cannot flip. */
const startedMs = (session: SessionInfo): number => {
  const raw = Number(session.started_at) || 0

  return raw > 1e12 ? raw : raw * 1000
}

function Section({ children, title, action }: { children: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <header className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[0.68rem] font-medium tracking-wide text-(--ui-text-tertiary) uppercase">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="m-0 px-1 py-1 text-xs leading-relaxed text-(--ui-text-tertiary)">{children}</p>
)

/** The desk's chats. Read from the owning source rather than the live gateway
 *  so the list is there before the desk profile has been dialled even once. */
function Jobs({ m }: { m: HerworkMessages }) {
  const connectionId = useValue(host.state.connectionId)
  const focused = useValue(host.state.focusedStoredSessionId)
  const route = herworkRoute(connectionId)

  const jobs = useQuery({
    enabled: Boolean(route),
    queryKey: ['herwork', 'jobs', connectionId ?? ''],
    queryFn: async () => {
      const page = await host.listPersistedSessions(route, { profile: HERWORK_PROFILE, limit: 50 })

      return [...(page.sessions ?? [])].sort((a, b) => startedMs(b) - startedMs(a))
    },
    // The list must not go stale behind a finished job, and nothing pushes a
    // session-created event at this pane.
    refetchInterval: 15_000,
    staleTime: 5_000
  })

  const rows = jobs.data ?? []

  if (!rows.length) {
    return <Empty>{m.desk.noChats}</Empty>
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-px p-0">
      {rows.map(session => {
        const active = Boolean(focused) && session.id === focused

        return (
          <li key={session.id}>
            <button
              aria-current={active || undefined}
              className={`flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-(--ui-bg-hover) ${
                active ? 'bg-(--ui-bg-selected) text-(--ui-text-primary)' : 'text-(--ui-text-secondary)'
              }`}
              onClick={() => void host.openSession(session.id)}
              type="button"
            >
              <span className="w-full truncate text-xs">{session.title || m.desk.chats}</span>
              <span className="text-[0.65rem] text-(--ui-text-tertiary)">{relativeTime(startedMs(session))}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Bytes as a person reads them. Two significant figures at most: a size in a
 *  side panel is for telling a 40 KB stub from a 4 MB deck, not for auditing. */
function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return ''
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kb = bytes / 1024

  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }

  const mb = kb / 1024

  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** What the preview rail renders as itself rather than as source text. */
const PREVIEWABLE = /\.(pdf|png|jpe?g|gif|webp|svg|md|txt|csv|json|html?)$/i

/** `output/` and one level of job folders under it, newest file first. Two
 *  levels because the mandate says "one subfolder per job when it has several
 *  files": deeper than that is the agent's scratch, not a deliverable. */
async function listDeliverables(outputDir: string): Promise<{ entries: HermesReadDirEntry[]; error?: string }> {
  const top = await host.readDir(outputDir)

  if (top.error) {
    return { entries: [], error: top.error }
  }

  const files = top.entries.filter(entry => !entry.isDirectory)
  const folders = top.entries.filter(entry => entry.isDirectory)
  const nested = await Promise.all(folders.map(folder => host.readDir(folder.path)))

  for (const listing of nested) {
    files.push(...listing.entries.filter(entry => !entry.isDirectory))
  }

  files.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))

  return { entries: files }
}

/** What the desk has produced. This is the point of the workspace ("hand over
 *  a job, get finished files back"), so it reads like a delivery list, not a
 *  file tree: newest first, with the job folder as a quiet prefix. A PDF or
 *  image opens in the preview rail beside the chat; anything else is revealed
 *  in the file manager, because the rail would only show it as text. */
function Deliverables({ desk, m }: { desk: string; m: HerworkMessages }) {
  const [entries, setEntries] = useState<HermesReadDirEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const outputDir = desk ? `${desk}/output` : ''

  const load = useCallback(async () => {
    if (!outputDir) {
      setEntries([])

      return
    }

    const result = await listDeliverables(outputDir)

    // No output folder yet is the ordinary first-run state, not a failure: the
    // first delivered job creates it.
    setFailed(Boolean(result.error) && result.error !== 'ENOENT')
    setEntries(result.entries)
  }, [outputDir])

  useEffect(() => {
    void load()

    const timer = setInterval(() => void load(), 10_000)

    return () => clearInterval(timer)
  }, [load])

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Empty>{m.desk.filesUnavailable}</Empty>
        <button
          className="rounded px-1 text-[0.65rem] text-(--ui-text-secondary) underline-offset-2 hover:underline"
          onClick={() => void load()}
          type="button"
        >
          {m.desk.retry}
        </button>
      </div>
    )
  }

  if (!entries?.length) {
    return <Empty>{m.desk.noDeliverables}</Empty>
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-px p-0">
      {entries.map(entry => {
        const job = entry.path.slice(outputDir.length + 1).split('/').slice(0, -1).join('/')
        const previewable = PREVIEWABLE.test(entry.name)

        return (
          <li key={entry.path}>
            <button
              className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1 text-left transition-colors hover:bg-(--ui-bg-hover)"
              data-deliverable={previewable ? 'preview' : 'reveal'}
              onClick={() => {
                if (!previewable || !host.openPreview(entry.path)) {
                  void host.revealPath(entry.path)
                }
              }}
              title={previewable ? m.desk.preview : m.desk.openFolder}
              type="button"
            >
              <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-(--ui-text-secondary)">
                <Codicon
                  aria-hidden
                  className="shrink-0 text-(--ui-text-tertiary)"
                  name={previewable ? 'file-media' : 'file'}
                  size="0.8rem"
                />
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="flex w-full min-w-0 gap-2 ps-5 text-[0.65rem] text-(--ui-text-tertiary)">
                {job ? <span className="truncate">{job}</span> : null}
                <span className="shrink-0 tabular-nums">{humanSize(entry.size)}</span>
                {entry.mtimeMs ? <span className="shrink-0">{relativeTime(entry.mtimeMs)}</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The three desk folders, as doors: reveal each in the file manager. */
function Folders({ desk, m }: { desk: string; m: HerworkMessages }) {
  if (!desk) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1">
      {(['inbox', 'work', 'output'] as const).map(name => (
        <button
          className="flex items-center gap-1 rounded border border-(--ui-border) px-1.5 py-0.5 font-mono text-[0.68rem] text-(--ui-text-secondary) transition-colors hover:bg-(--ui-bg-hover)"
          key={name}
          onClick={() => void host.revealPath(`${desk}/${name}`)}
          title={m.desk.openFolder}
          type="button"
        >
          <Codicon aria-hidden name="folder" size="0.75rem" />
          {name}
        </button>
      ))}
    </div>
  )
}

const STEP_ICON: Record<TodoItem['status'], string> = {
  cancelled: 'circle-slash',
  completed: 'pass-filled',
  in_progress: 'sync',
  pending: 'circle-large-outline'
}

/** The open job's plan. Cancelled steps stay listed but struck through: what
 *  the agent dropped is part of the account of the turn. */
function Steps({ m }: { m: HerworkMessages }) {
  const todos = useValue(host.state.focusedTodos)

  if (!todos.length) {
    return <Empty>{m.desk.noTasks}</Empty>
  }

  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
      {todos.map(todo => (
        <li
          className={`flex items-start gap-1.5 px-2 py-0.5 text-xs ${
            todo.status === 'completed' || todo.status === 'cancelled'
              ? 'text-(--ui-text-tertiary)'
              : 'text-(--ui-text-secondary)'
          } ${todo.parent ? 'ps-5' : ''}`}
          key={todo.id}
        >
          <Codicon
            aria-hidden
            className={`mt-0.5 shrink-0 ${todo.status === 'in_progress' ? 'text-(--ui-accent)' : ''}`}
            name={STEP_ICON[todo.status]}
            size="0.75rem"
          />
          <span className={todo.status === 'cancelled' ? 'line-through' : undefined}>{todo.content}</span>
        </li>
      ))}
    </ol>
  )
}

export function HerworkPane() {
  const m = useHerwork()
  const cwd = useValue(host.state.cwd)
  const connectionId = useValue(host.state.connectionId)
  const desk = herworkDeskCwd(homeOf(cwd))
  const route = herworkRoute(connectionId, homeOf(cwd))

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto px-3 py-3 text-sm" data-slot="herwork_pane">
      <div className="flex items-center gap-2 text-(--ui-text-primary)">
        <Codicon aria-hidden name="folder-opened" size="0.95rem" />
        <span className="font-medium">{m.pane.title}</span>
      </div>

      {/* The desk's own `+`. Disabled rather than hidden without a local
          connection: a missing door is more confusing than a dimmed one. */}
      <button
        className="flex items-center justify-center gap-1.5 rounded border border-(--ui-border) px-2 py-1.5 text-xs font-medium text-(--ui-text-primary) transition-colors hover:bg-(--ui-bg-hover) disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!route}
        onClick={() =>
          route && host.newChat(route, { workspaceMode: 'herwork', workspaceOwnerKey: HERWORK_OWNER_KEY })
        }
        type="button"
      >
        <Codicon aria-hidden name="add" size="0.8rem" />
        {m.desk.newChat}
      </button>

      <Section title={m.desk.chats}>
        <Jobs m={m} />
      </Section>

      <Section title={m.desk.deliverables}>
        <Deliverables desk={desk} m={m} />
      </Section>

      <Section title={m.desk.folders}>
        <Folders desk={desk} m={m} />
      </Section>

      <Section title={m.desk.tasks}>
        <Steps m={m} />
      </Section>

      <dl className="m-0 mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-(--ui-border) pt-2 text-[0.65rem]">
        <dt className="text-(--ui-text-tertiary)">cwd</dt>
        <dd className="m-0 truncate font-mono text-(--ui-text-secondary)" title={desk || undefined}>
          {desk || '~/herwork'}
        </dd>
        <dt className="text-(--ui-text-tertiary)">profile</dt>
        <dd className="m-0 font-mono text-(--ui-text-secondary)">{HERWORK_PROFILE}</dd>
      </dl>
    </div>
  )
}
