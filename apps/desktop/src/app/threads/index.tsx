import { useStore } from '@nanostores/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Tip } from '@/components/ui/tooltip'
import { type Translations, useI18n } from '@/i18n'
import { AlertCircle, CheckCircle2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $subagentsBySession } from '@/store/subagents'
import {
  $requestedThreadSessionId,
  $threadCountsByCoordinator,
  $threadsByCoordinator,
  $threadsLoading,
  clearThreadRequest,
  groupThreadRows,
  mergeThreadRows,
  threadCounts,
  threadDuration,
  type ThreadRow,
  type ThreadState
} from '@/store/threads'

import { Panel, PanelEmpty, PanelHeader, PanelSectionLabel } from '../overlays/panel'

import { ThreadDetail } from './thread-detail'

/**
 * The Threads dock.
 *
 * Sections are always rendered, including empty ones: a header that vanishes
 * at zero reads as a missing feature rather than as an empty inbox, and the
 * point of an inbox is that you can see it is clear.
 *
 * `Waiting on you` is deliberately absent. A delegated child installs a
 * non-interactive approval callback (`tools/delegate_tool_child_run.py`), so
 * nothing can currently ask the user anything. Rendering the section with a
 * permanent zero would promise a channel that does not exist yet.
 */

// Order is the reading order of the dock: what needs attention, then what is
// done, then what went wrong and can be retried.
const SECTIONS: readonly ThreadState[] = ['working', 'resolved', 'failed']

function stateGlyph(state: ThreadState, copy: Translations['threads']): ReactNode {
  if (state === 'working') {
    return (
      <GlyphSpinner
        ariaLabel={copy.working}
        className="size-3.5 shrink-0 text-[0.95rem] text-muted-foreground/80"
        spinner="breathe"
      />
    )
  }

  // `role="img"` alongside the label: a bare labelled <svg> has no reliable
  // role, so assistive tech skips the status the row exists to convey.
  if (state === 'failed') {
    return <AlertCircle aria-label={copy.failed} className="size-3.5 shrink-0 text-destructive" role="img" />
  }

  return <CheckCircle2 aria-label={copy.resolved} className="size-3.5 shrink-0 text-(--ui-success)/85" role="img" />
}

/** Compact elapsed time: "2m", "3h". Under a minute reads as seconds, because
 *  a thread that finished in eight seconds should say so. */
export function threadElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.round(seconds / 60)

  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

/** Compact age, in the user's own relative terms. Seconds read as "now": a
 *  counter ticking through single seconds is noise on a list that refreshes. */
export function threadAge(startedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - startedAt * 1000) / 1000))

  if (seconds < 60) {
    return 'now'
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.round(minutes / 60)

  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

interface ThreadRowViewProps {
  copy: Translations['threads']
  onOpen?: (row: ThreadRow) => void
  row: ThreadRow
}

function ThreadRowView({ copy, onOpen, row }: ThreadRowViewProps) {
  // The second line is the live step while one exists, and otherwise what the
  // thread actually did. A finished thread reporting only its message count
  // says nothing about the work; its tool calls and its runtime do.
  const duration = threadDuration(row)

  const done = [
    row.toolCallCount > 0 ? `${row.toolCallCount} ${copy.tools.toLowerCase()}` : '',
    duration === null ? '' : threadElapsed(duration)
  ]
    .filter(Boolean)
    .join(' · ')

  const detail = row.activity || done || `${row.messageCount} ${copy.messages.toLowerCase()}`

  return (
    <Tip label={copy.openThread}>
    <button
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start transition-colors',
        'hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none'
      )}
      onClick={() => onOpen?.(row)}
      type="button"
    >
      <span className="mt-0.5">{stateGlyph(row.state, copy)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.78rem] text-foreground/90">{row.label}</span>
        <span className="block truncate text-[0.7rem] text-muted-foreground/70">{detail}</span>
      </span>
      {row.childCount > 0 && (
        <span
          aria-label={copy.subagents}
          className="mt-0.5 shrink-0 rounded-full bg-foreground/10 px-1.5 text-[0.62rem] text-muted-foreground"
        >
          {row.childCount}
        </span>
      )}
      <span className="mt-0.5 shrink-0 text-[0.65rem] tabular-nums text-muted-foreground/55">
        {threadAge(row.startedAt)}
      </span>
    </button>
    </Tip>
  )
}

interface ThreadSectionProps {
  copy: Translations['threads']
  count: number
  onOpen?: (row: ThreadRow) => void
  rows: readonly ThreadRow[]
  state: ThreadState
}

function ThreadSection({ copy, count, onOpen, rows, state }: ThreadSectionProps) {
  const title = copy[state]
  const description = copy[`${state}Desc` as const]

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 px-2">
        <PanelSectionLabel>{title}</PanelSectionLabel>
        <span className="text-[0.65rem] tabular-nums text-muted-foreground/45">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 pb-1 text-[0.7rem] text-muted-foreground/50">{description}</p>
      ) : (
        rows.map(row => <ThreadRowView copy={copy} key={row.sessionId} onOpen={onOpen} row={row} />)
      )}
    </section>
  )
}

export interface ThreadsViewProps {
  /** The conversation whose threads this dock shows. */
  coordinatorSessionId: null | string
  onClose: () => void
  /** Overrides opening a thread in place; the dock opens its own detail view
   *  when this is absent. */
  onOpenThread?: (row: ThreadRow) => void
  /** Injected so the view owns no gateway routing; the caller supplies a
   *  profile-scoped request. */
  onRefresh?: (coordinatorSessionId: string) => Promise<unknown>
}

export function ThreadsView({ coordinatorSessionId, onClose, onOpenThread, onRefresh }: ThreadsViewProps) {
  const { t } = useI18n()
  const copy = t.threads
  const durableByCoordinator = useStore($threadsByCoordinator)
  const countsByCoordinator = useStore($threadCountsByCoordinator)
  const subagentsBySession = useStore($subagentsBySession)
  const loading = useStore($threadsLoading)

  useEffect(() => {
    if (coordinatorSessionId && onRefresh) {
      void onRefresh(coordinatorSessionId)
    }
  }, [coordinatorSessionId, onRefresh])

  const rows = useMemo(() => {
    const durable = coordinatorSessionId ? (durableByCoordinator[coordinatorSessionId] ?? []) : []

    // This conversation's live children only. The flattened roster would show
    // another conversation's workers as this one's threads.
    const liveHere = coordinatorSessionId ? (subagentsBySession[coordinatorSessionId] ?? []) : []

    return mergeThreadRows(durable, liveHere, coordinatorSessionId)
  }, [coordinatorSessionId, durableByCoordinator, subagentsBySession])

  const grouped = useMemo(() => groupThreadRows(rows), [rows])

  const counts = useMemo(() => {
    const durable = coordinatorSessionId ? countsByCoordinator[coordinatorSessionId] : undefined

    return threadCounts(rows, durable)
  }, [coordinatorSessionId, countsByCoordinator, rows])

  const isLoading = Boolean(coordinatorSessionId && loading.has(coordinatorSessionId))

  const [openSessionId, setOpenSessionId] = useState<null | string>(null)
  const requested = useStore($requestedThreadSessionId)

  // An inline chip in the transcript asks the dock to open one thread. The
  // request is consumed once, so closing the thread afterwards does not bounce
  // straight back into it.
  useEffect(() => {
    if (!requested) {
      return
    }

    setOpenSessionId(requested)
    clearThreadRequest()
  }, [requested])

  // Resolved against the LIVE rows, not captured at click time: an open thread
  // that finishes while it is on screen must stop offering a steer box.
  const openRow = openSessionId ? (rows.find(row => row.sessionId === openSessionId) ?? null) : null

  const handleOpen = useCallback(
    (row: ThreadRow) => {
      if (onOpenThread) {
        onOpenThread(row)

        return
      }

      setOpenSessionId(row.sessionId)
    },
    [onOpenThread]
  )

  const handleBack = useCallback(() => setOpenSessionId(null), [])

  if (openRow && coordinatorSessionId) {
    return (
      <Panel closeLabel={copy.close} onClose={onClose}>
        <ThreadDetail onBack={handleBack} ownerSessionId={coordinatorSessionId} row={openRow} />
      </Panel>
    )
  }

  return (
    <Panel closeLabel={copy.close} onClose={onClose}>
      <PanelHeader subtitle={copy.subtitle} title={copy.title} />
      {rows.length === 0 ? (
        <PanelEmpty
          description={isLoading ? copy.loading : copy.emptyDesc}
          icon="git-branch"
          title={isLoading ? copy.title : copy.emptyTitle}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1">
          {SECTIONS.map(state => (
            <ThreadSection
              copy={copy}
              count={counts[state] ?? 0}
              key={state}
              onOpen={handleOpen}
              rows={grouped[state]}
              state={state}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
