import type { ThreadRow } from './threads'

/**
 * Should this message go to a running thread instead of the conversation?
 *
 * This is the most dangerous idea in the Threads feature. A message routed
 * wrongly does not produce a bad answer, it produces NO answer: the user's
 * words vanish into a background worker they were not addressing, and the
 * conversation they typed into says nothing back.
 *
 * So the bias is absolute, and it runs one direction:
 *
 * - **Answering inline is always safe.** The worst case is that the user
 *   repeats themselves into the thread. Nothing is lost.
 * - **Routing is never safe.** The worst case is a lost message.
 *
 * Therefore routing requires an EXPLICIT, unambiguous reference: the user
 * named exactly one running thread, and named it clearly enough that no other
 * running thread also matches. Everything else answers inline. There is no
 * similarity score, no keyword overlap and no "probably meant" heuristic here,
 * because every one of those is a way to lose a sentence.
 *
 * Even a confident route is reversible: this module only DECIDES, and the
 * caller renders a receipt whose undo sends the original words inline after
 * all. Nothing here sends anything.
 */

export type RouteDecision =
  | { kind: 'inline' }
  | { kind: 'route'; reason: RouteReason; row: ThreadRow }

/** Why a route was chosen. Shown to the user on the receipt so the decision is
 *  legible rather than magical. */
export type RouteReason = 'explicit-mention' | 'only-running-and-addressed'

/**
 * An address directed at a thread rather than at the assistant.
 *
 * Deliberately short and explicit: these are forms a person types on purpose,
 * not phrases they might stumble into. `take` says where the INSTRUCTION is,
 * which differs by form: in "tell the X thread to Y" the capture is the
 * thread's name and the instruction is what is left, while in "thread: Y" the
 * capture is the instruction itself.
 */
interface AddressPattern {
  pattern: RegExp
  take: 'capture' | 'remainder'
}

const ADDRESS_PATTERNS: readonly AddressPattern[] = [
  { pattern: /(?:^|\s)@thread(?:\s|$)/i, take: 'remainder' },
  { pattern: /(?:^|\s)(?:tell|ask|send\s+to|in)\s+the\s+(.+?)\s+thread\b/i, take: 'remainder' },
  { pattern: /(?:^|\s)thread\s*:\s*(.+)$/i, take: 'capture' }
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Threads a message names outright.
 *
 * A thread is named when its whole label appears in the message, or the
 * message's thread-address clause matches its label. Partial word overlap does
 * NOT count: "the review" does not name "Review a code diff for CODE REUSE
 * problems", because three other threads that day matched that too.
 */
export function namedThreads(message: string, rows: readonly ThreadRow[]): ThreadRow[] {
  const haystack = normalize(message)

  if (!haystack) {
    return []
  }

  return rows.filter(row => {
    const label = normalize(row.label)

    // A one or two word label is too weak an identifier to route on: "deck"
    // appears in sentences that have nothing to do with the deck thread.
    if (!label || label.split(' ').length < 3) {
      return false
    }

    return haystack.includes(label)
  })
}

/** True when the message is addressed at a thread at all. Without this even an
 *  exact label match stays inline: quoting a thread's name while talking to the
 *  assistant is ordinary conversation, not a redirect. */
export function addressesAThread(message: string): boolean {
  return ADDRESS_PATTERNS.some(({ pattern }) => pattern.test(message))
}

/**
 * Decide where a message goes.
 *
 * Returns `inline` unless the user addressed a thread AND exactly one running
 * thread answers to that address. Every ambiguity resolves to `inline`.
 */
export function routeMessage(message: string, rows: readonly ThreadRow[]): RouteDecision {
  const body = message.trim()

  if (!body || !addressesAThread(body)) {
    return { kind: 'inline' }
  }

  // Only a running thread can receive anything. A finished thread has no
  // worker, so "sending" to it would be the same lost message by another route.
  const running = rows.filter(row => row.live && row.state === 'working' && row.subagentId)

  if (running.length === 0) {
    return { kind: 'inline' }
  }

  const named = namedThreads(body, running)

  if (named.length === 1) {
    return { kind: 'route', reason: 'explicit-mention', row: named[0]! }
  }

  // Two threads matched, so the user's words fit both and we cannot know which.
  // Answering inline costs them a repeat; guessing costs them the message.
  if (named.length > 1) {
    return { kind: 'inline' }
  }

  // Addressed a thread, named none, and exactly one is running. "@thread" with
  // a single worker is unambiguous by arithmetic rather than by guessing.
  if (running.length === 1 && /(?:^|\s)@thread(?:\s|$)/i.test(body)) {
    return { kind: 'route', reason: 'only-running-and-addressed', row: running[0]! }
  }

  return { kind: 'inline' }
}

/** The message with its routing address stripped, which is what the thread
 *  should actually receive. "@thread check the lineage" reaches the worker as
 *  "check the lineage". */
export function messageForThread(message: string): string {
  let body = message.trim()

  for (const { pattern, take } of ADDRESS_PATTERNS) {
    const match = pattern.exec(body)

    if (!match) {
      continue
    }

    body =
      take === 'capture'
        ? (match[1] ?? '')
        : body.slice(0, match.index) + body.slice(match.index + match[0].length)
  }

  // "tell the X thread TO do Y" leaves a dangling "to"; it is an artifact of
  // the form that matched, not part of the instruction.
  const cleaned = body
    .replace(/^[\s,:.]+/, '')
    .replace(/^to\s+/i, '')
    .trim()

  // Stripping everything would send a blank steer, which is worse than sending
  // the original words.
  return cleaned || message.trim()
}
