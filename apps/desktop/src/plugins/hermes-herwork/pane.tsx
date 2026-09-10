/**
 * The HerWork tab body: the desk panel.
 *
 * Three sections over one fixed desk, in the order the work flows: start a job,
 * pick up an earlier one, see what the open job produced.
 *
 *   · Jobs  — the desk's own chats, newest first. The `+` in the tab bar routes
 *             here too; this button exists because the panel is where the eye
 *             already is, and because an empty desk otherwise offers no door.
 *   · Desk  — what is actually in the desk folder. The point of the workspace
 *             is "hand over a job, get finished files back", so the files are
 *             the deliverable, not a detail.
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

/** What is on the desk. Directories first, then files, as the bridge sorts
 *  them; a click reveals the entry in the OS file manager, which is the only
 *  thing this pane can usefully do with a path it does not own. */
function Desk({ cwd, m }: { cwd: string; m: HerworkMessages }) {
  const [entries, setEntries] = useState<HermesReadDirEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!cwd) {
      setEntries([])

      return
    }

    const result = await host.readDir(cwd)

    // A desk folder that does not exist yet is the ordinary first-run state,
    // not a failure: the first job creates it.
    setFailed(Boolean(result.error) && result.error !== 'ENOENT')
    setEntries(result.entries)
  }, [cwd])

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
    return <Empty>{m.desk.noFiles}</Empty>
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-px p-0">
      {entries.map(entry => (
        <li key={entry.path}>
          <button
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-(--ui-text-secondary) transition-colors hover:bg-(--ui-bg-hover)"
            onClick={() => void host.revealPath(entry.path)}
            title={m.desk.openFolder}
            type="button"
          >
            <Codicon
              aria-hidden
              className="shrink-0 text-(--ui-text-tertiary)"
              name={entry.isDirectory ? 'folder' : 'file'}
              size="0.8rem"
            />
            <span className="truncate">{entry.name}</span>
          </button>
        </li>
      ))}
    </ul>
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

      <Section
        action={
          desk ? (
            <button
              aria-label={m.desk.openFolder}
              className="rounded p-0.5 text-(--ui-text-tertiary) transition-colors hover:text-(--ui-text-primary)"
              onClick={() => void host.revealPath(desk)}
              title={desk}
              type="button"
            >
              <Codicon aria-hidden name="link-external" size="0.75rem" />
            </button>
          ) : undefined
        }
        title={m.desk.files}
      >
        <Desk cwd={desk} m={m} />
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
