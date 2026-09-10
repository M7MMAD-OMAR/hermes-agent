import { ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ComponentProps, type FC, useMemo, useRef } from 'react'

import { TimelineTimestamp } from '@/components/assistant-ui/thread/timeline-timestamp'
import { summarizeToolRun, type ToolCallLike } from '@/components/assistant-ui/tool/run-summary'
import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { FadeText } from '@/components/ui/fade-text'
import { useI18n } from '@/i18n'
import type { TurnOutcome } from '@/lib/turn-outcome'
import { cn } from '@/lib/utils'
import { $toolDisclosureOpen, setToolDisclosureOpen } from '@/store/tool-view'
import { $turnOutcome } from '@/store/turn-outcome'

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
 *
 * And the OUTCOME: the backend's three-line account of what the turn
 * delivered, what failed and what is still open (`agent/turn_outcome.py`). The
 * header's tally says how much happened; the outcome says what the user got.
 * It sits outside the fold, between the header and the tail (or under the tail
 * when nothing folded), and stays for the life of the thread. It is read from
 * its own per-key store, never from the digest, so a text delta on the tail
 * cannot re-render it and an outcome landing cannot re-render the turn.
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

function isTurnOutcome(value: unknown): value is TurnOutcome {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as TurnOutcome).delivered)
}

/** The outcome a rehydrated turn carries on its final assistant message
 *  (`metadata.custom.turnOutcome`, from `display_metadata.turn_outcome`). The
 *  selector returns the stored object itself, so Object.is holds across text
 *  deltas and nothing re-renders until the message list is rebuilt. */
function useHydratedOutcome(indices: readonly number[]): TurnOutcome | undefined {
  return useAuiState(state => {
    const messages = (state as unknown as DigestThreadSlice).thread.messages

    for (let position = indices.length - 1; position >= 0; position--) {
      const candidate = messages[indices[position]]?.metadata?.custom?.turnOutcome

      if (isTurnOutcome(candidate)) {
        return candidate
      }
    }

    return undefined
  })
}

/**
 * The outcome row. A live outcome (this session, this turn) wins over the
 * rehydrated copy: both come from the same producer, and the live one is the
 * newer write. Model text is isolated per item (`<bdi>`) because it is in the
 * conversation's language, which need not be the app's direction.
 */
export const TurnOutcomeRow: FC<{ indices: readonly number[]; sessionId: null | string; turnId: string }> = ({
  indices,
  sessionId,
  turnId
}) => {
  const { t } = useI18n()
  const live = useStore(useMemo(() => $turnOutcome(sessionId, turnId), [sessionId, turnId]))
  const hydrated = useHydratedOutcome(indices)
  const outcome = live ?? hydrated

  if (!outcome) {
    return null
  }

  const labels = t.assistant.thread

  const sections: Array<[string, readonly string[], string]> = [
    [labels.turnOutcomeDelivered, outcome.delivered, 'text-(--conversation-scaffold-text)'],
    [labels.turnOutcomeFailed, outcome.failed, 'text-destructive'],
    [labels.turnOutcomeOpen, outcome.open, 'text-primary']
  ]

  return (
    <div
      aria-label={labels.turnOutcomeTitle}
      className="grid min-w-0 max-w-full gap-1"
      data-conversation-scaffold=""
      data-turn-outcome=""
      data-turn-outcome-source={outcome.source}
      role="group"
    >
      {sections.map(([label, items, tone]) =>
        items.length === 0 ? null : (
          <div className={cn(SCAFFOLD_LABEL_CLASS, 'flex min-w-0 gap-2')} data-turn-outcome-section={label} key={label}>
            <span className="w-[5.5rem] shrink-0 text-[0.625rem] uppercase tracking-wide text-(--conversation-scaffold-meta)">
              {label}
            </span>
            <ul className={cn('m-0 min-w-0 flex-1 list-none p-0', tone)}>
              {items.map(item => (
                <li className="min-w-0 break-words" key={item}>
                  <bdi>{item}</bdi>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  )
}

export const TurnDigest: FC<{
  components: ThreadMessageComponents
  indices: readonly number[]
  /** The runtime session id the outcome store is keyed by; null in a thread
   *  with no session (a preview), which then shows only rehydrated outcomes. */
  sessionId?: null | string
  /** Stable id of the turn (its user message), keying the remembered disclosure
   *  and, being the id sent with prompt.submit, the outcome the backend echoes. */
  turnId: string
}> = ({ components, indices, sessionId = null, turnId }) => {
  const { t } = useI18n()
  const digest = useTurnDigest(indices, t.assistant.thread.turnDigestNotes)
  const disclosureId = `turn-digest:${turnId}`
  const persistedOpen = useStore(useMemo(() => $toolDisclosureOpen(disclosureId), [disclosureId]))
  const outcome = <TurnOutcomeRow indices={indices} sessionId={sessionId} turnId={turnId} />

  if (digest.folded.length === 0) {
    return (
      <>
        <TurnProgress indices={indices} />
        {digest.visible.map(index => (
          <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
        ))}
        {outcome}
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
      {outcome}
      {digest.visible.map(index => (
        <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
      ))}
    </>
  )
}
