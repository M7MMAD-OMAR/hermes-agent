/**
 * PIN PANEL — annotation mode's UI: the toggle, the list, and the ways a
 * review becomes a prompt.
 *
 * The pins themselves are drawn IN the page by the engine, because only the
 * page knows where its elements are after a scroll or a reflow. This panel is
 * the durable side: it holds what the engine would lose to a navigation, and it
 * is what replays them back afterwards. The book lives in a persistent store
 * (`pin-book-store.ts`), not in component memory — a remount, a window close or
 * an app restart must not cost the user their comments.
 *
 * Delivery is per comment: "Send" hands ONE comment to the chat now, "Queue"
 * parks it in the conversation's prompt queue, "Send all" delivers every
 * pending comment at once. A delivered comment leaves the pending list on its
 * own and its marker reads ✓ — nothing else is ever removed automatically.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { $annotateToggleRequest, $attachPinsRequest } from '@/app/chat/right-rail/preview-pin-requests'
import { Codicon } from '@/components/ui/codicon'
import { dataUrlToBlob } from '@/lib/embedded-images'
import { orderedShots, pinAttachmentLabel } from '@/lib/preview-pins/pin-block'
import { allPins, mergeReport, otherPages, type PinBook, pinsForPage } from '@/lib/preview-pins/pin-book'
import { $pinBook, setPinBook } from '@/lib/preview-pins/pin-book-store'
import type { PreviewPin } from '@/lib/preview-pins/types'
import { cn } from '@/lib/utils'
import {
  addComposerAttachment,
  type ComposerAttachment,
  createComposerAttachmentOccurrenceId
} from '@/store/composer'
import { enqueueQueuedPrompt } from '@/store/composer-queue'
import { relayComposerAttachment } from '@/store/composer-relay'
import { notify } from '@/store/notifications'
import { $activeSessionId, $sessions, resolveComposerSessionKey, sessionMatchesStoredId } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { isBrowserWindow } from '@/store/windows'

import {
  ackDeliverRequests,
  armPins,
  clearPins,
  deliverPin,
  disarmPins,
  hidePins,
  readPins,
  reattachPins,
  removePin,
  showPins,
  takeShot,
  togglePinResolved
} from './preview-pins'

/** How often to re-read while armed. The engine owns placement, so the panel
 *  only learns about a new pin by asking — and a gesture the list does not
 *  reflect within a beat reads as the click having missed. */
const POLL_MS = 700

/** Poll period while a comment bubble is open in the page. The bubble's send
 *  shortcuts reach the panel only through a state read, and a 700 ms gap
 *  between the keypress and the delivery reads as the shortcut having missed. */
const POLL_BUBBLE_MS = 200

/** How many comments the panel shows before it asks to be expanded. */
const COLLAPSED_ROWS = 2

/** The conversation the send paths address. The route-driven key the composer
 *  itself uses is not reachable from the rail, so this resolves the same
 *  durable key from the active session — the queue panel and this panel then
 *  agree about which conversation owns an entry. */
function conversationKey(): null | string {
  return resolveComposerSessionKey($activeSessionId.get(), $sessions.get())
}

/** Is that conversation mid-turn? Session states are keyed by RUNTIME id and
 *  carry the stored id they belong to, so match on that: the send path only
 *  queues when a real turn is in flight, never when the panel merely guessed. */
function isSessionBusy(key: string): boolean {
  return Object.values($sessionStates.get()).some(state => {
    if (!state.busy || !state.storedSessionId) {
      return false
    }

    // The key is a lineage root; the state carries the stored id it belongs
    // to. Match through the same table the composer scope resolves with, so
    // the two never disagree about whether a conversation is mid-turn.
    return state.storedSessionId === key || $sessions.get().some(
      session => sessionMatchesStoredId(session, state.storedSessionId ?? '') && sessionMatchesStoredId(session, key)
    )
  })
}

export function PreviewPinPanel({ open, url }: { open: boolean; url: string }) {
  const book = useStore($pinBook)
  const [pins, setPins] = useState<PreviewPin[]>([])
  const [armed, setArmed] = useState(false)
  const [live, setLive] = useState(true)
  const [elsewhere, setElsewhere] = useState({ count: 0, pages: 0 })
  const [expanded, setExpanded] = useState(false)

  /** Full image bytes, drained out of the page and owned here. */
  const bytes = useState(() => new Map<string, string>())[0]

  /** Execute the bubble's delivery requests: Send → sendOne, Queue → queueOne.
   *  The pin is sourced from the BOOK, not the report — the report was read
   *  before the user pressed the shortcut, so it lacks their last keystrokes;
   *  the live `input` handler kept the book's copy current. */
  const runDeliverRequests = useCallback(
    async (requests: { id: string; mode: 'now' | 'queue' }[]) => {
      for (const { id, mode } of requests) {
        const pin = allPins($pinBook.get()).find(entry => entry.id === id)

        if (!pin) {continue}

        if (mode === 'queue') {
          await queueOneRef.current(pin)
        } else {
          await sendOneRef.current(pin)
        }
      }
    },
    []
  )

  // The handlers below close over page state that changes every render; the
  // request executor above must not. Refs bridge the two without re-arming
  // the poll or the sync chain on every keystroke.
  const sendOneRef = useRef<(pin: PreviewPin) => Promise<void>>(async () => {})
  const queueOneRef = useRef<(pin: PreviewPin) => Promise<void>>(async () => {})

  const sync = useCallback(async (report: Awaited<ReturnType<typeof readPins>>) => {
    if (!report) {
      setLive(false)

      return
    }

    // Drain first, and after every verb rather than only while annotating: an
    // image pasted and then left alone still has to get out of the page before
    // the next navigation takes the page with it.
    for (const id of report.pendingShots ?? []) {
      if (bytes.has(id)) {continue}
      const answer = await takeShot(id)

      if (answer?.shot) {bytes.set(id, answer.shot)}
    }

    setLive(true)
    setArmed(report.armed === true)
    setBubbleOpen(report.bubbleOpen === true)
    setPins(report.pins)
    // File under the page's OWN url, not the pane's — the pane's value lags a
    // redirect, and filing under the wrong key is how a page's comments end up
    // replayed onto a different page. The book is the persistent store: writing
    // it here is what makes a review survive a remount.
    setPinBook(mergeReport($pinBook.get(), report.url, report.pins))
    setElsewhere(otherPages($pinBook.get(), report.url))

    // The bubble's send shortcuts arrive HERE — the guest page has no bridge
    // to the composer, so its bubble can only write the intent and let the
    // next state read carry it out. Each request is executed once and then
    // acked, so a lost panel tick retries through the next poll, not a resend.
    const requests = report.deliver ?? []

    if (requests.length) {
      await ackDeliverRequests()
      await runDeliverRequests(requests)
    }
  }, [bytes, runDeliverRequests])

  // Poll while the panel is open — not only while armed. A marker stays
  // clickable after disarming, so a comment can be edited or an image pasted
  // with annotation mode off, and those bytes need draining too. Closed, this
  // stops entirely: a poll against a page nobody is reviewing is a round trip
  // into the guest document every beat for nothing. While a comment bubble is
  // open in the page the poll tightens: the bubble's send shortcuts reach the
  // panel only through a state read, and a 700 ms wait between the keypress
  // and the delivery reads as the shortcut having missed.
  const [bubbleOpen, setBubbleOpen] = useState(false)
  useEffect(() => {
    if (!open) {return}
    const period = bubbleOpen ? POLL_BUBBLE_MS : POLL_MS
    const timer = setInterval(() => void readPins().then(sync), period)

    return () => clearInterval(timer)
  }, [open, bubbleOpen, sync])

  // Closing the panel hands the page back. Without this the engine stays armed
  // behind a UI that is no longer on screen: the next click on a link is eaten
  // by the review overlay instead of navigating, and nothing visible explains
  // why. Opening repaints what the page is still holding.
  useEffect(() => {
    if (!open) {
      void hidePins()

      return
    }

    void showPins(pinsForPage($pinBook.get(), url)).then(sync)
  }, [open, sync, url])

  // A pane teardown is a close the effect above never sees.
  useEffect(() => () => void hidePins(), [])

  // Keybind requests: mod+shift+a toggles annotation, the attach chord delivers
  // everything pending. Counters (not flags) so two taps toggle twice. The
  // panel only acts while it is open — a hotkey pressed over a chat with no
  // browser pane must not arm a page the user is not looking at.
  const annotateRequest = useStore($annotateToggleRequest)
  const attachRequest = useStore($attachPinsRequest)

  useEffect(() => {
    if (open && annotateRequest > 0) {void toggleArmed()}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request counter IS the trigger
  }, [annotateRequest])

  useEffect(() => {
    if (open && attachRequest > 0) {void attach()}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request counter IS the trigger
  }, [attachRequest])

  // A navigation destroys the engine and every pin with it. Seed the new one
  // from this page's bucket — and only this page's — then re-run the ladder.
  useEffect(() => {
    if (!open) {return}
    void reattachPins(pinsForPage($pinBook.get(), url)).then(sync)
  }, [open, sync, url])

  const toggleArmed = async () => {
    const report = armed ? await disarmPins() : await armPins(pinsForPage($pinBook.get(), url))
    await sync(report)
  }

  /**
   * Stage one comment's payload: the `pins` chip plus its images as ordinary
   * image attachments. Shared by Send and Send-all so both roads a comment
   * takes into the chat carry the same things.
   *
   * Returns the staged parts (locally added) plus the relay acknowledgements —
   * a popped-out Browser has no composer of its own, so "did it land?" is only
   * answerable after the relays answer, and a failed delivery must NOT be
   * marked delivered.
   */
  const stage = async (sending: PreviewPin[]): Promise<{ acks: Promise<boolean>[]; parts: ComposerAttachment[] }> => {
    const parts: ComposerAttachment[] = []
    const acks: Promise<boolean>[] = []

    const stagePart = (attachment: ComposerAttachment) => {
      if (isBrowserWindow()) {
        acks.push(relayComposerAttachment(attachment))

        return
      }

      addComposerAttachment(attachment)
      parts.push(attachment)
    }

    stagePart({
      detail: JSON.stringify(sending),
      // Derived from the pins alone: once a batch spans pages, no single url
      // identifies it.
      id: `pins:${sending.map(pin => pin.id).join(',')}`,
      kind: 'pins',
      label: pinAttachmentLabel(sending),
      refText: `${sending.length} preview comment${sending.length === 1 ? '' : 's'}`
    })

    let index = 0

    for (const { shot } of orderedShots(sending)) {
      index += 1
      const data = bytes.get(shot.id)
      const blob = data ? dataUrlToBlob(data) : null

      if (!blob) {continue}

      try {
        const buffer = new Uint8Array(await blob.arrayBuffer())
        const path = await window.hermesDesktop?.saveImageBuffer(buffer, blob.type === 'image/png' ? '.png' : '.jpg')

        if (!path) {continue}

        stagePart({
          detail: path,
          id: `pin-image:${shot.id}`,
          kind: 'image',
          // Matches the "[image 2]" marker in the block above.
          label: `image ${index}`,
          occurrenceId: createComposerAttachmentOccurrenceId(),
          path,
          thumbnailUrl: shot.thumb
        })
      } catch {
        // One picture that would not stage is not worth losing the comments
        // over; the block still describes what the user meant.
        continue
      }
    }

    return { acks, parts }
  }

  /** A delivered comment leaves the pending list and its marker reads ✓. */
  const markDelivered = async (ids: string[], delivered: boolean) => {
    const next: PinBook = { ...$pinBook.get() }
    const set = new Set(ids)

    for (const [key, pagePins] of Object.entries(next)) {
      next[key] = pagePins.map(pin => (set.has(pin.id) ? { ...pin, delivered } : pin))
    }

    setPinBook(next)
    setPins(current => current.map(pin => (set.has(pin.id) ? { ...pin, delivered } : pin)))

    for (const id of ids) {
      await deliverPin(id, delivered)
    }
  }

  /** Deliver staged parts into the conversation: queue when the turn is busy
   *  (the queue drains it next turn), otherwise submit through the composer. */
  const deliverNow = async (text: string, parts: ComposerAttachment[]): Promise<boolean> => {
    const key = conversationKey()

    if (key && isSessionBusy(key)) {
      return Boolean(enqueueQueuedPrompt(key, { attachments: parts, text }))
    }

    const submitted = requestComposerSubmit(text)

    return submitted || Boolean(key && enqueueQueuedPrompt(key, { attachments: parts, text }))
  }

  /** One comment, one send. The comment's own words are the prompt; the chip
   *  and its images ride as attachments. */
  const sendOne = async (pin: PreviewPin) => {
    const text = pin.comment.trim() || `Review this: ${pin.target || pin.kind}`

    const { acks, parts } = await stage([pin])

    if (!parts.length && !acks.length) {return}

    if (await deliverNow(text, parts)) {
      await markDelivered([pin.id], true)
      notify({ kind: 'success', message: 'Comment sent to the chat.', title: 'Sent' })
    } else {
      notify({ kind: 'error', message: 'No conversation is open to receive it.', title: 'Could not send' })
    }
  }

  /** Park one comment in the conversation's prompt queue, attachments and all.
   *  Deliberately NOT a send: it drains when the current turn settles. */
  const queueOne = async (pin: PreviewPin) => {
    const key = conversationKey()

    if (!key) {
      notify({ kind: 'error', message: 'No conversation is open to queue it in.', title: 'Could not queue' })

      return
    }

    const text = pin.comment.trim() || `Review this: ${pin.target || pin.kind}`
    const { parts } = await stage([pin])

    if (enqueueQueuedPrompt(key, { attachments: parts, text })) {
      await markDelivered([pin.id], true)
      notify({ kind: 'success', message: 'Comment parked in the queue.', title: 'Queued' })
    } else {
      notify({ kind: 'error', message: 'The queue rejected the comment.', title: 'Could not queue' })
    }
  }

  // Keep the request executor pointed at the CURRENT handlers. Assigned during
  // render (idempotent, no effect needed): the bubble's Ctrl+Enter may arrive
  // on the very next poll tick, and a mount-order effect would miss it.
  sendOneRef.current = sendOne
  queueOneRef.current = queueOne

  const attach = async () => {
    // The whole review, not just the page in front of us — and only what is
    // still pending: resolved work the user accepted and already-delivered
    // comments are history, not instructions.
    const held = allPins($pinBook.get()).filter(pin => !pin.resolved && !pin.delivered)

    if (!held.length) {return}

    // Drop any image whose bytes never reached us — a page closed before the
    // drain, say. The block numbers images off this list and the attachments
    // are built from the same walk, so pruning here keeps "[image 2]" and the
    // second picture the same picture by construction.
    const sending = held.map(pin => {
      const shots = (pin.shots ?? []).filter(shot => bytes.has(shot.id))

      return shots.length === (pin.shots?.length ?? 0) ? pin : { ...pin, shots }
    })

    const { acks } = await stage(sending)

    // Delivered only when something actually landed. A popped-out Browser with
    // no composer answers false on every relay — marking the batch delivered
    // there would be exactly the silent loss this panel exists to prevent.
    const delivered = acks.length === 0 || (await Promise.all(acks)).some(Boolean)

    notify(
      delivered
        ? {
            kind: 'success',
            message: `${sending.length} comment${sending.length === 1 ? '' : 's'} ready in the composer`,
            title: 'Added to chat'
          }
        : { kind: 'error', message: 'No composer window is open to receive them.', title: 'Could not add to chat' }
    )

    if (delivered) {
      // Delivered is delivered: the batch left for the chat, so every one of
      // these leaves the pending list on its own. Nothing was deleted —
      // Resolve, Delete and Clear stay the only destructive acts.
      await markDelivered(sending.map(pin => pin.id), true)
    }
  }

  const clearEverything = async () => {
    setPinBook({})
    setElsewhere({ count: 0, pages: 0 })
    await clearPins().then(sync)
  }

  if (!open) {return null}

  // The pending list: what still owes the chat a delivery. Delivered comments
  // leave this list the moment they arrive — that IS the auto-clear, one
  // comment at a time. Nothing not delivered is ever removed without the user
  // pressing Clear, Resolve or Delete.
  const pending = pins.filter(pin => !pin.delivered)
  const openCount = pending.filter(pin => !pin.resolved).length

  // Newest first, and only a couple of them: the panel sits above the page it
  // is describing, and a comment list that grows without bound eats the very
  // thing being reviewed. The number stays the pin's own, so a row and the
  // marker on the page always agree even when the order does not.
  const numbered = pins
    .map((pin, index) => ({ number: index + 1, pin }))
    .reverse()
    .filter(({ pin }) => !pin.delivered)

  const listed = expanded ? numbered : numbered.slice(0, COLLAPSED_ROWS)

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors',
            armed ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
          )}
          onClick={() => void toggleArmed()}
          type="button"
        >
          <Codicon name="comment-draft" size="0.8125rem" />
          {armed ? 'Annotating' : 'Annotate'}
        </button>

        <span className="truncate text-muted-foreground">
          {!live
            ? 'no live page'
            : armed
              ? 'click an element, or drag a region · Esc to stop'
              : `${openCount} open`}
          {/* Comments left on pages the user has since navigated away from.
              Without this the panel looks empty on a fresh page and the review
              they already wrote appears to have been lost. */}
          {!armed && elsewhere.count > 0 && (
            <span className="ms-1 text-muted-foreground/70">
              · {elsewhere.count} on {elsewhere.pages} other page{elsewhere.pages === 1 ? '' : 's'}
            </span>
          )}
        </span>

        <div className="ms-auto flex shrink-0 items-center gap-1">
          <button
            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
            disabled={!openCount && !elsewhere.count}
            onClick={() => void attach()}
            title="Add every pending comment, across every page, to the chat"
            type="button"
          >
            Send all
          </button>
          <button
            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
            disabled={!pins.length && !elsewhere.count}
            onClick={() => void clearEverything()}
            title="Discard the whole review, every page"
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      {listed.length > 0 && (
        <ul className={cn('flex flex-col gap-0.5', expanded && 'max-h-40 overflow-y-auto pe-0.5')}>
          {listed.map(({ number, pin }) => (
            <li
              className={cn(
                // One line per comment. Two lines each turned four comments
                // into half the preview, which is the space the page needs.
                'flex items-center gap-2 rounded px-2 py-1',
                pin.resolved ? 'opacity-50' : 'bg-muted/40'
              )}
              key={pin.id}
            >
              <span className="font-mono text-[10px] text-muted-foreground">{number}</span>
              {/* The thumbnail the user pasted, at list size. Seeing it here is
                  what makes the strip inside the bubble discoverable at all. */}
              {pin.shots?.length ? (
                <img
                  alt=""
                  className="size-5 shrink-0 rounded-sm border border-border/60 object-cover"
                  src={pin.shots[0].thumb}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{pin.target || 'region'}</span>
                {(pin.shots?.length ?? 0) > 1 && (
                  <span className="ms-1 text-muted-foreground">·{pin.shots!.length} images</span>
                )}
                {/* A pin that came back on a weak rung is worth seeing. The
                    comment is still attached to something, but not to the
                    thing the page promised it. */}
                {pin.orphaned && <span className="ms-1.5 text-amber-500">· detached</span>}
                <span className="ms-1.5 text-muted-foreground">{pin.comment || 'no comment yet'}</span>
              </span>
              <button
                className="rounded px-1 hover:bg-muted"
                onClick={() => void sendOne(pin)}
                title="Send this comment to the chat now"
                type="button"
              >
                <Codicon name="send" size="0.75rem" />
              </button>
              <button
                className="rounded px-1 hover:bg-muted"
                onClick={() => void queueOne(pin)}
                title="Add this comment to the conversation's queue"
                type="button"
              >
                <Codicon name="list-ordered" size="0.75rem" />
              </button>
              <button
                className="rounded px-1 hover:bg-muted"
                onClick={() => void togglePinResolved(pin.id).then(sync)}
                title={pin.resolved ? 'Reopen' : 'Mark resolved'}
                type="button"
              >
                <Codicon name={pin.resolved ? 'circle-outline' : 'check'} size="0.75rem" />
              </button>
              <button
                className="rounded px-1 hover:bg-muted"
                onClick={() => void removePin(pin.id).then(sync)}
                title="Delete"
                type="button"
              >
                <Codicon name="trash" size="0.75rem" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending.length > COLLAPSED_ROWS && (
        <button
          className="self-start rounded px-1 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(open => !open)}
          type="button"
        >
          {expanded ? 'Show fewer' : `Show all ${pending.length}`}
        </button>
      )}
    </div>
  )
}
