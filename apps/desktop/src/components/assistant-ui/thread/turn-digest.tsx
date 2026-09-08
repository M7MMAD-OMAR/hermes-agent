import { ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ComponentProps, type FC, useMemo, useRef } from 'react'

import { TimelineTimestamp } from '@/components/assistant-ui/thread/timeline-timestamp'
import { summarizeToolRun, type ToolCallLike } from '@/components/assistant-ui/tool/run-summary'
import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { FadeText } from '@/components/ui/fade-text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $toolDisclosureOpen, setToolDisclosureOpen } from '@/store/tool-view'

import { TurnProgress } from './turn-progress'

type ThreadMessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']

/**
 * TURN DIGEST: the one line that stands in for a turn's working while it is
 * over, and for its finished part while it is still going.
 *
 * A long turn is many assistant messages: sealed mid-turn commentary ("Now the
 * navigation block"), tool runs, then the reply. Read back later, only the
 * reply and the questions asked of the user matter; the working is a record to
 * open when something needs checking. So every settled message before the last
 * one folds under a single header that says what the work amounted to
 * ("Edited 12 files, ran 30 commands") and when it ran. The tail message stays
 * in view: live, that is the ticker narrating the current step; settled, it is
 * the reply itself with its own footer, changed files and next moves.
 *
 * What never folds: a message that ended in an error (the user has to see it,
 * and it interrupts the fold so the messages after it render in place), and
 * the tail. A pending question (approval, clarify) lives on the tail by
 * construction, so it can never be behind the header.
 */
interface TurnDigestState {
  completedAt?: number
  /** Thread indices folded under the header, in order. Empty means no digest. */
  folded: readonly number[]
  key: string
  live: boolean
  noteCount: number
  startedAt?: number
  summary: string
  toolCount: number
  /** Thread indices rendered in place after the fold. */
  visible: readonly number[]
}

interface DigestMessage {
  content: readonly { completedAt?: number; result?: unknown; timestamp?: number; type: string }[]
  metadata?: { custom?: Record<string, unknown> }
  role: string
  status?: { type: string }
}

interface DigestThreadSlice {
  thread: { isRunning: boolean; messages: readonly DigestMessage[] }
}

const NO_DIGEST: TurnDigestState = {
  folded: [],
  key: '',
  live: false,
  noteCount: 0,
  summary: '',
  toolCount: 0,
  visible: []
}

function customNumber(message: DigestMessage, key: string): number | undefined {
  const value = message.metadata?.custom?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Pure half of the digest: which of a turn's assistant messages fold, and what the header says. */
export function computeTurnDigest(
  slice: DigestThreadSlice,
  indices: readonly number[],
  notesLabel: (count: number) => string
): TurnDigestState {
  const messages = slice.thread.messages

  if (indices.length < 2) {
    return { ...NO_DIGEST, visible: indices }
  }

  const tailIndex = indices[indices.length - 1]
  const tail = messages[tailIndex]
  const live = slice.thread.isRunning && tail?.status?.type === 'running'
  const folded: number[] = []

  for (const index of indices.slice(0, -1)) {
    const message = messages[index]

    // An errored message is the one thing in the working the user must see;
    // it also ends the fold so nothing after it hides behind the header.
    if (!message || message.role !== 'assistant' || message.status?.type === 'incomplete') {
      break
    }

    folded.push(index)
  }

  if (folded.length === 0) {
    return { ...NO_DIGEST, live, visible: indices }
  }

  const tools: ToolCallLike[] = []
  let noteCount = 0
  let startedAt: number | undefined
  let completedAt: number | undefined

  const widen = (start?: number, end?: number) => {
    if (start !== undefined) {
      startedAt = startedAt === undefined ? start : Math.min(startedAt, start)
    }

    if (end !== undefined) {
      completedAt = completedAt === undefined ? end : Math.max(completedAt, end)
    }
  }

  for (const index of folded) {
    const message = messages[index]
    widen(customNumber(message, 'timelineTimestamp'), customNumber(message, 'timelineCompletedAt'))

    for (const part of message.content) {
      if (part.type === 'tool-call') {
        tools.push(part as unknown as ToolCallLike)
        widen(part.timestamp, part.completedAt)
      } else if (part.type === 'text') {
        noteCount += 1
      }
    }
  }

  // The folded messages are sealed even while the turn runs, so the header
  // always reads in the past tense; the live shimmer says the turn goes on and
  // the tail below narrates the current step.
  const summary = tools.length > 0 ? summarizeToolRun(tools, false) : notesLabel(noteCount)

  return {
    completedAt,
    folded,
    key: `${folded[0]}:${folded.length}`,
    live,
    noteCount,
    startedAt,
    summary,
    toolCount: tools.length,
    visible: indices.slice(folded.length)
  }
}

// assistant-ui compares selector results with Object.is and re-runs them on
// every store update; a fresh object per run would re-render the turn on each
// text delta. Cache on the facts the digest is made of.
function useTurnDigest(indices: readonly number[], notesLabel: (count: number) => string): TurnDigestState {
  const cache = useRef<null | { signature: string; value: TurnDigestState }>(null)

  return useAuiState(state => {
    const slice = state as unknown as DigestThreadSlice
    const messages = slice.thread.messages

    const signature = indices
      .map(index => {
        const message = messages[index]

        if (!message) {
          return `${index}:missing`
        }

        const settledTools = message.content.filter(part => part.type === 'tool-call' && part.result !== undefined)

        return `${index}:${message.role}:${message.status?.type ?? ''}:${message.content.length}:${settledTools.length}`
      })
      .concat(String(slice.thread.isRunning))
      .join('|')

    if (cache.current?.signature !== signature) {
      cache.current = { signature, value: computeTurnDigest(slice, indices, notesLabel) }
    }

    return cache.current.value
  })
}

export const TurnDigest: FC<{
  components: ThreadMessageComponents
  indices: readonly number[]
  /** Stable id of the turn (its user message), keying the remembered disclosure. */
  turnId: string
}> = ({ components, indices, turnId }) => {
  const { t } = useI18n()
  const digest = useTurnDigest(indices, t.assistant.thread.turnDigestNotes)
  const disclosureId = `turn-digest:${turnId}`
  const persistedOpen = useStore(useMemo(() => $toolDisclosureOpen(disclosureId), [disclosureId]))

  if (digest.folded.length === 0) {
    return (
      <>
        <TurnProgress indices={indices} />
        {digest.visible.map(index => (
          <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
        ))}
      </>
    )
  }

  // Folding is a presentation preference, never a lock on live history.
  // Preserve the user's choice as new messages arrive and the turn settles.
  const expanded = persistedOpen ?? false

  return (
    <>
      <TurnProgress indices={indices} />
      <div
        className="grid min-w-0 max-w-full gap-(--tool-row-gap)"
        data-conversation-scaffold=""
        data-turn-digest=""
        data-turn-digest-live={digest.live ? 'true' : undefined}
      >
        <ScaffoldRow
          onToggle={() => setToolDisclosureOpen(disclosureId, !expanded)}
          open={expanded}
          trailing={<TimelineTimestamp completedAt={digest.completedAt} timestamp={digest.startedAt} />}
        >
          <FadeText className={cn(SCAFFOLD_LABEL_CLASS, 'truncate')}>
            {digest.live ? <span className="shimmer">{digest.summary}</span> : digest.summary}
          </FadeText>
        </ScaffoldRow>
        {expanded && (
          <div className="flex min-w-0 flex-col gap-(--conversation-turn-gap)" data-turn-digest-body="">
            {digest.folded.map(index => (
              <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
            ))}
          </div>
        )}
      </div>
      {digest.visible.map(index => (
        <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
      ))}
    </>
  )
}
