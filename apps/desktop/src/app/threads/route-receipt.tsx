import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { useI18n } from '@/i18n'
import { ChevronLeft } from '@/lib/icons'
import {
  $threadRouteReceipt,
  $threadRouteUndo,
  clearThreadRouteReceipt,
  consumeThreadRouteUndo,
  requestThread,
  undoThreadRoute
} from '@/store/threads'

/**
 * The receipt shown after a message went to a thread instead of to the chat.
 *
 * A redirect must never be silent. Someone typed a sentence into one place and
 * it went somewhere else, so the very next thing they see says where it went,
 * names the thread, and offers to take it back. Without this the feature is
 * indistinguishable from losing the message.
 *
 * It also carries the recovery path: when a steer fails after the receipt was
 * shown, the words are handed back to the composer rather than left claimed by
 * a thread that never received them.
 */

/** Long enough to read and act on, short enough that it is not clutter. The
 *  receipt is informational; the undo it offers is the part that matters. */
const RECEIPT_TTL_MS = 30_000

export interface ThreadRouteReceiptBarProps {
  /** Put the words back where they were typed. */
  onRestore: (text: string) => void
}

export function ThreadRouteReceiptBar({ onRestore }: ThreadRouteReceiptBarProps) {
  const { t } = useI18n()
  const copy = t.threads
  const receipt = useStore($threadRouteReceipt)
  const pendingUndo = useStore($threadRouteUndo)

  // A failed steer, or an undo the user asked for, both surface the same way:
  // the text returns to the composer.
  useEffect(() => {
    if (pendingUndo === null) {
      return
    }

    const text = consumeThreadRouteUndo()

    if (text) {
      onRestore(text)
    }
  }, [onRestore, pendingUndo])

  useEffect(() => {
    if (!receipt) {
      return
    }

    const timer = setTimeout(clearThreadRouteReceipt, RECEIPT_TTL_MS)

    return () => clearTimeout(timer)
  }, [receipt])

  if (!receipt) {
    return null
  }

  return (
    <div
      className="flex items-center gap-2 rounded-md bg-foreground/5 px-2 py-1 text-[0.7rem]"
      role="status"
    >
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {copy.routedTo}{' '}
        <button
          className="text-primary underline-offset-2 hover:underline"
          onClick={() => requestThread(receipt.threadSessionId)}
          type="button"
        >
          {receipt.threadLabel}
        </button>
      </span>
      <button
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={undoThreadRoute}
        type="button"
      >
        <ChevronLeft aria-hidden className="size-3" />
        {copy.routeUndo}
      </button>
    </div>
  )
}
