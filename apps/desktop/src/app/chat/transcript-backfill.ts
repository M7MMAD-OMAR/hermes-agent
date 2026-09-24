/**
 * ON-DEMAND OLDER-PAGE BACKFILL for the transcript window.
 *
 * Tail hydration (`getLatestSessionMessages`) loads only the newest page of a
 * session. "Show earlier" first pages the DOM budget, then the in-memory store
 * window — and when the whole in-memory transcript is materialized but the
 * REST hydration was truncated (`transcript-tail` bookkeeping), this module
 * fetches the next older page and merges it into the session store.
 *
 * Offsets follow the backend's `order: 'latest'` semantics: measured back
 * from the NEWEST persisted row. Rows persisted after hydration shift that
 * origin, so a fetched page can overlap rows we already hold and even extend
 * past the cached tail. Shared durable rows anchor the merge on either side;
 * the offset still advances by the fetched count, which self-corrects the
 * drift on the next page.
 */

import { getOlderSessionMessages } from '@/hermes'
import { type ChatMessage, type ChatMessagePart, chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { recordTranscriptBackfillPage, type TranscriptProfileScope, transcriptTailState } from '@/store/transcript-tail'

/** Older rows likely exist beyond what the in-memory store holds. */
export function transcriptBackfillAvailable(
  storedSessionId: null | string | undefined,
  profile?: TranscriptProfileScope
): boolean {
  return Boolean(transcriptTailState(storedSessionId, profile)?.possiblyTruncated)
}

/**
 * Identity of one logical message across compaction generations.
 *
 * Compaction copies the protected tail into a NEW generation of rows: same
 * role, content and timestamp, but fresh `messages.id` values, while the old
 * copies are retired as `compacted`. The backend's display projection dedupes
 * on exactly that (role, content, timestamp) triple, so a refreshed page names
 * every recent row by an id the renderer has never seen. Matching by durable
 * row id alone therefore fails right after a compaction, and the rendered ids
 * (`timestamp-index-role`) shift with the page offset. This key is the third
 * rung: a row without a timestamp never matches through it.
 */
function logicalMessageKey(message: ChatMessage): null | string {
  if (message.timestamp === undefined) {
    return null
  }

  const toolCallIds = message.parts
    .filter((part): part is Extract<ChatMessagePart, { type: 'tool-call' }> => part.type === 'tool-call')
    .map(part => part.toolCallId)
    .join(',')

  return `${message.role}\u0000${message.timestamp}\u0000${chatMessageText(message)}\u0000${toolCallIds}`
}

/** Index of the rows a store already holds, by every identity a row can carry.
 *  Each identity maps to the row's position, so a fetched page can be placed
 *  around the rows it shares with the store. */
class MessageIdentityIndex {
  readonly #rowIds = new Map<number, number>()
  readonly #ids = new Map<string, number>()
  readonly #logicalKeys = new Map<string, number>()

  constructor(messages: readonly ChatMessage[]) {
    messages.forEach((message, index) => {
      if (message.rowId !== undefined) {
        this.#rowIds.set(message.rowId, index)
      }

      this.#ids.set(message.id, index)

      const key = logicalMessageKey(message)

      if (key !== null) {
        this.#logicalKeys.set(key, index)
      }
    })
  }

  /** Position of the held copy of `message`, or undefined when it is new. */
  indexOf(message: ChatMessage): number | undefined {
    const byRow = message.rowId !== undefined ? this.#rowIds.get(message.rowId) : undefined

    if (byRow !== undefined) {
      return byRow
    }

    const byId = this.#ids.get(message.id)

    if (byId !== undefined) {
      return byId
    }

    const key = logicalMessageKey(message)

    return key === null ? undefined : this.#logicalKeys.get(key)
  }
}

/** The same row, by durable id, rendered id, or compaction-generation identity. */
function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  if (a.rowId !== undefined && b.rowId !== undefined && a.rowId === b.rowId) {
    return true
  }

  if (a.id === b.id) {
    return true
  }

  const key = logicalMessageKey(a)

  return key !== null && key === logicalMessageKey(b)
}

/**
 * Merge a fetched page into the in-memory transcript, deduplicating rows the
 * store already holds (offset drift makes overlap normal, and a compaction
 * generation copy carries a new row id for a row already on screen). A page
 * with no shared row is presumed older; overlapping pages use their shared
 * rows to place fresh messages before, within, or after the cached tail.
 * Preserves reference identity when nothing changes: handing React a fresh
 * array of the same messages re-renders the runtime for nothing.
 */
export function mergeOlderTranscriptPage(existing: ChatMessage[], olderPage: ChatMessage[]): ChatMessage[] {
  // Backfill only makes sense under an already-hydrated tail. An empty store
  // here means the session was swapped or wiped mid-fetch; prepending would
  // paint the older page as the whole conversation.
  if (existing.length === 0 || olderPage.length === 0) {
    return existing
  }

  const held = new MessageIdentityIndex(existing)

  // The offset counts backwards from the newest durable row. While a long
  // turn persists, an "older" page can overlap the cached tail AND extend
  // beyond its end. Position fresh rows by the shared anchors, not by the
  // page's requested direction.
  const insertions = new Map<number, ChatMessage[]>()
  let pending: ChatMessage[] = []
  let lastAnchor = -1

  for (const message of olderPage) {
    const anchor = held.indexOf(message)

    if (anchor === undefined) {
      pending.push(message)

      continue
    }

    if (pending.length) {
      insertions.set(anchor, [...(insertions.get(anchor) ?? []), ...pending])
      pending = []
    }

    lastAnchor = anchor
  }

  if (pending.length) {
    const position = lastAnchor < 0 ? 0 : lastAnchor + 1
    insertions.set(position, [...(insertions.get(position) ?? []), ...pending])
  }

  if (insertions.size === 0) {
    return existing
  }

  const merged: ChatMessage[] = []

  for (let index = 0; index <= existing.length; index++) {
    const additions = insertions.get(index)

    if (additions) {
      merged.push(...additions)
    }

    if (index < existing.length) {
      merged.push(existing[index])
    }
  }

  return merged
}

/**
 * Re-anchor a refreshed TAIL onto a transcript that has backfilled older
 * pages. Background refreshes and post-turn rehydrates re-read only the
 * newest page; replacing the store with that page outright would silently
 * drop everything "Show earlier" already loaded. Find where the refreshed
 * tail begins inside the previous transcript and keep the older prefix.
 *
 * The anchor accepts a compaction generation copy of a row already held (see
 * `logicalMessageKey`): the post-compaction rehydrate used to find no anchor,
 * replace a long transcript with its newest page, and jump the view to the
 * bottom with every earlier turn gone. When no anchor is found at all (a
 * different session, or a tail older than anything held), the refreshed tail
 * is authoritative, same as before backfill existed.
 */
export function graftRefreshedTailOntoBackfill(refreshedTail: ChatMessage[], previous: ChatMessage[]): ChatMessage[] {
  if (refreshedTail.length === 0 || previous.length === 0) {
    return refreshedTail
  }

  const first = refreshedTail[0]
  const anchor = previous.findIndex(message => sameMessage(message, first))

  if (anchor <= 0) {
    return refreshedTail
  }

  return [...previous.slice(0, anchor), ...refreshedTail]
}

export interface BackfillRequest {
  /** Durable stored session id — the tail bookkeeping key. */
  storedSessionId: string
  /** Owner scope captured when the tail was hydrated. */
  profile?: TranscriptProfileScope
  /** Stale-response guard: called after the fetch resolves; when it reports
   *  false (the user switched sessions mid-flight) the page is discarded and
   *  the bookkeeping is left untouched, mirroring the isCurrentResume()
   *  pattern in use-session-actions. */
  isCurrent: () => boolean
  /** Apply the converted older page to the session's message store. The
   *  callback owns WHERE the messages live (session-state cache vs the global
   *  draft atom) and must merge via `mergeOlderTranscriptPage`. */
  applyOlderPage: (olderPage: ChatMessage[]) => void
}

// One fetch per stored session at a time. Keyed by stored id (not runtime id)
// so a mid-fetch runtime rebind cannot double-fetch the same page.
const inflightByStoredSessionId = new Map<string, Promise<boolean>>()

/** Test-only: drop in-flight guards between cases. */
export function _resetTranscriptBackfillForTests(): void {
  inflightByStoredSessionId.clear()
}

/**
 * Fetch the next older page for a session and prepend it via
 * `applyOlderPage`. Resolves true when a page was applied. Concurrent calls
 * for the same session share one fetch.
 */
export function backfillOlderTranscriptPage(request: BackfillRequest): Promise<boolean> {
  const { profile, storedSessionId } = request
  const inflightKey = JSON.stringify([profile || null, storedSessionId])
  const inflight = inflightByStoredSessionId.get(inflightKey)

  if (inflight) {
    return inflight
  }

  const run = (async () => {
    const tail = transcriptTailState(storedSessionId, profile)

    if (!tail?.possiblyTruncated) {
      return false
    }

    let page

    try {
      page = await getOlderSessionMessages(storedSessionId, tail.profile, tail.nextOffset)
    } catch {
      // Non-fatal: the action stays available and the next click retries.
      return false
    }

    // A route can stay put while rewind or revalidation replaces its tail.
    // This page belongs to the exact tail generation we fetched against, not
    // merely the same stored id. Never graft it onto a newer display history.
    if (!request.isCurrent() || transcriptTailState(storedSessionId, profile) !== tail) {
      return false
    }

    // A response without pagination metadata is a legacy backend that ignored
    // the paging query and returned the FULL transcript one-shot. The merge
    // below prepends whatever prefix the store is missing, and the recorded
    // state marks the session fully loaded so the REST action retires.
    recordTranscriptBackfillPage(storedSessionId, page, profile)
    request.applyOlderPage(toChatMessages(page.messages))

    return true
  })().finally(() => {
    inflightByStoredSessionId.delete(inflightKey)
  })

  inflightByStoredSessionId.set(inflightKey, run)

  return run
}
