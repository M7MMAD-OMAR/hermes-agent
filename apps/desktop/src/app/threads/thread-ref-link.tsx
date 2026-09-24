import type { ThreadSummary } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import type { FC } from 'react'

import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { parseSessionRefValue } from '@/lib/session-refs'
import { cn } from '@/lib/utils'
import { $subagentsBySession, allSubagents, type SubagentProgress } from '@/store/subagents'
import { $threadsByCoordinator, findLoadedThread, requestThread, type ThreadState, threadStateForSubagent } from '@/store/threads'

/**
 * An inline reference to a thread, inside assistant prose.
 *
 * The agent writes an ordinary `@session:<profile>/<id>` reference. When that
 * id belongs to a delegated thread this renders instead of the plain session
 * link, because the two mean different things: a session link switches you to
 * a conversation, while a thread is work you look in on without leaving the
 * one you are reading.
 *
 * `useThreadRef` returns null for anything not currently loaded as a thread,
 * and the caller then renders the ordinary session link. A chip that cannot
 * say anything true about a thread's state must not pretend to be one.
 */

const STATE_DOT: Record<ThreadState, string> = {
  failed: 'bg-destructive',
  resolved: 'bg-(--ui-success)/80',
  working: 'bg-primary animate-pulse'
}

export interface ResolvedThreadRef {
  /** The live step, for the hover card. Empty when nothing is running. */
  activity: string
  label: string
  sessionId: string
  state: ThreadState
}

/**
 * Join one reference to what is known about that thread.
 *
 * Live wins on state: a durable snapshot can predate the current run, so a
 * thread that restarted would otherwise render as resolved while it works.
 */
export function resolveThreadRef(
  durable: null | ThreadSummary,
  live: SubagentProgress | undefined
): null | ResolvedThreadRef {
  if (!durable) {
    return null
  }

  return {
    activity: live?.currentTool || live?.stream.at(-1)?.text || '',
    label: durable.label,
    sessionId: durable.session_id,
    state: live ? threadStateForSubagent(live.status) : durable.state
  }
}

/** Resolve a `@session:` ref against the loaded threads, or null when it is
 *  not one. Safe to call unconditionally; the caller branches on the result. */
export function useThreadRef(value: string): null | ResolvedThreadRef {
  const byCoordinator = useStore($threadsByCoordinator)
  const subagentsBySession = useStore($subagentsBySession)
  const { sessionId } = parseSessionRefValue(value)

  const durable = findLoadedThread(sessionId, byCoordinator)
  const live = allSubagents(subagentsBySession).find(item => (item.sessionId || item.id) === sessionId)

  return resolveThreadRef(durable, live)
}

export const ThreadRefLink: FC<{ thread: ResolvedThreadRef }> = ({ thread }) => {
  const { t } = useI18n()
  const copy = t.threads

  // The hover card is one line saying what the thread is doing right now,
  // so a reader does not have to open it to find out.
  const title = thread.activity ? `${thread.label}: ${thread.activity}` : thread.label

  return (
    <Tip label={title}>
    <button
      className="inline-flex max-w-full items-center gap-1 rounded px-1 align-baseline text-[0.95em] text-primary transition-colors hover:bg-primary/10"
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        requestThread(thread.sessionId)
      }}
      type="button"
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[thread.state])} />
      <span className="truncate">{thread.label}</span>
      <span className="sr-only">{copy[thread.state]}</span>
    </button>
    </Tip>
  )
}
