import { type FormEvent, useCallback, useEffect, useState } from 'react'

import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useI18n } from '@/i18n'
import { ChevronLeft } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { fetchThreadTranscript, type SteerOutcome, steerThread, type ThreadRow } from '@/store/threads'

/**
 * One thread, opened.
 *
 * The transcript comes from `thread.transcript`, the durable message store,
 * not from the seven day live log under `cache/delegation/live`: that log is a
 * tailing convenience and expires, while these rows are the record.
 *
 * Steering goes through the existing `subagent.steer`. A finished thread has
 * no worker to receive anything, so the composer says so instead of silently
 * swallowing a sentence someone just typed.
 */

interface TranscriptMessage {
  content?: unknown
  role?: unknown
}

function messageText(message: TranscriptMessage): string {
  const content = message.content

  if (typeof content === 'string') {
    return content
  }

  // Tool results and structured content arrive as objects. A transcript that
  // renders "[object Object]" is worse than one that renders nothing.
  return content == null ? '' : JSON.stringify(content)
}

const ROLE_TONE: Record<string, string> = {
  assistant: 'text-foreground/85',
  tool: 'text-muted-foreground/70',
  user: 'text-foreground/95'
}

export interface ThreadDetailProps {
  onBack: () => void
  /** The conversation that owns this thread; `subagent.steer` is addressed to
   *  the OWNER session, not to the thread's own. */
  ownerSessionId: string
  row: ThreadRow
}

export function ThreadDetail({ onBack, ownerSessionId, row }: ThreadDetailProps) {
  const { t } = useI18n()
  const copy = t.threads
  const [messages, setMessages] = useState<null | TranscriptMessage[]>(null)
  const [truncated, setTruncated] = useState(false)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState<null | SteerOutcome>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false

    setMessages(null)
    setFailed(false)

    void fetchThreadTranscript(row.sessionId).then(result => {
      if (cancelled) {
        return
      }

      if (!result) {
        setFailed(true)

        return
      }

      setMessages(result.messages ?? [])
      setTruncated(Boolean(result.truncated))
    })

    return () => {
      cancelled = true
    }
  }, [row.sessionId])

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()

      if (!draft.trim() || sending) {
        return
      }

      setSending(true)
      const result = await steerThread(row, draft, ownerSessionId)

      setOutcome(result)
      setSending(false)

      // Only a delivered steer clears the box. A sentence that went nowhere
      // stays where its author can see it and try again.
      if (result === 'sent') {
        setDraft('')
      }
    },
    [draft, ownerSessionId, row, sending]
  )

  const steerable = row.live && Boolean(row.subagentId)

  const outcomeMessage =
    outcome === 'sent' ? copy.steerSent : outcome === 'unreachable' ? copy.steerFailed : copy.steerUnavailable

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.7rem] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {copy.backToThreads}
        </button>
      </div>

      <h2 className="truncate px-1 text-[0.85rem] text-foreground/90">{row.label}</h2>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-foreground/[0.03] p-2">
        {messages === null && !failed && (
          <div className="flex items-center gap-2 px-1 py-2 text-[0.72rem] text-muted-foreground/70">
            <GlyphSpinner ariaLabel={copy.loading} className="size-3.5" spinner="breathe" />
            {copy.loading}
          </div>
        )}

        {failed && <p className="px-1 py-2 text-[0.72rem] text-destructive">{copy.transcriptFailed}</p>}

        {messages !== null && messages.length === 0 && (
          <p className="px-1 py-2 text-[0.72rem] text-muted-foreground/60">{copy.transcriptEmpty}</p>
        )}

        {truncated && (
          <p className="px-1 pb-1.5 text-[0.65rem] text-muted-foreground/50">{copy.transcriptTail}</p>
        )}

        {(messages ?? []).map((message, index) => {
          const text = messageText(message)

          if (!text) {
            return null
          }

          return (
            <p
              className={cn(
                'whitespace-pre-wrap break-words px-1 py-1 text-[0.72rem] leading-relaxed',
                ROLE_TONE[String(message.role ?? '')] ?? 'text-foreground/80'
              )}
              key={index}
            >
              {text}
            </p>
          )
        })}
      </div>

      <form className="flex flex-col gap-1" onSubmit={onSubmit}>
        <div className="flex items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1">
          <input
            // The accessible name carries the REASON when the box is shut. A
            // disabled field still called "Steer this thread" tells a screen
            // reader nothing about why it will not accept anything.
            aria-label={steerable ? copy.steerPlaceholder : copy.steerUnavailable}
            className="min-w-0 flex-1 bg-transparent py-1 text-[0.75rem] text-foreground/90 outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
            disabled={!steerable || sending}
            onChange={event => setDraft(event.target.value)}
            placeholder={steerable ? copy.steerPlaceholder : copy.steerUnavailable}
            value={draft}
          />
          <button
            className="shrink-0 rounded px-1.5 py-0.5 text-[0.68rem] font-medium text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
            disabled={!steerable || sending || !draft.trim()}
            type="submit"
          >
            {copy.steerSend}
          </button>
        </div>
        {outcome && (
          <p
            className={cn(
              'px-1 text-[0.65rem]',
              outcome === 'sent' ? 'text-muted-foreground/70' : 'text-destructive/80'
            )}
            role="status"
          >
            {outcomeMessage}
          </p>
        )}
      </form>
    </div>
  )
}
