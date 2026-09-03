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
 * Delivery is per comment, and both roads — "Send" now, "Queue" parked — go
 * through ONE seam (`store/prompt-delivery`): the comment's words ride with its
 * chip and images into the conversation, the composer's own input is never
 * touched by a send, and a popped-out Browser relays to the window that owns
 * the composer and the queue. A delivered comment leaves the pending list AND
 * the page on its own — nothing is left active to delete by hand.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { $annotateToggleRequest, $attachPinsRequest } from '@/app/chat/right-rail/preview-pin-requests'
import { Codicon } from '@/components/ui/codicon'
import { dataUrlToBlob } from '@/lib/embedded-images'
import { orderedShots, pinAttachmentLabel } from '@/lib/preview-pins/pin-block'
import { allPins, mergeReport, normalizePageUrl, otherPages, type PinBook, pinsForPage } from '@/lib/preview-pins/pin-book'
import { $pinBook, setPinBook } from '@/lib/preview-pins/pin-book-store'
import type { PreviewPin } from '@/lib/preview-pins/types'
import { cn } from '@/lib/utils'
import { addComposerAttachment, type ComposerAttachment, createComposerAttachmentOccurrenceId } from '@/store/composer'
import { relayComposerAttachment } from '@/store/composer-relay'
import { notify } from '@/store/notifications'
import { deliverPrompt } from '@/store/prompt-delivery'
import { isBrowserWindow } from '@/store/windows'

import {
  ackDeliverRequests,
  armPins,
  capturePinShot,
  clearPins,
  deliverPins,
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

/** Poll period while the review sits idle — panel open, nothing armed, no
 *  bubble. The engine's rev counter (checked before any state write) makes an
 *  idle read nearly free, but it is still a round trip into the guest page, so
 *  a review nobody is touching reads at half the active rate. */
const POLL_IDLE_MS = 1_600

/** How many comments the panel shows before it asks to be expanded. */
const COLLAPSED_ROWS = 2

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
  const runDeliverRequests = useCallback(async (requests: { id: string; mode: 'now' | 'queue' }[]) => {
    for (const { id, mode } of requests) {
      const pin = allPins($pinBook.get()).find(entry => entry.id === id)

      if (!pin) {
        continue
      }

      if (mode === 'queue') {
        await queueOneRef.current(pin)
      } else {
        await sendOneRef.current(pin)
      }
    }
  }, [])

  // The handlers below close over page state that changes every render; the
  // request executor above must not. Refs bridge the two without re-arming
  // the poll or the sync chain on every keystroke.
  const sendOneRef = useRef<(pin: PreviewPin) => Promise<void>>(async () => {})
  const queueOneRef = useRef<(pin: PreviewPin) => Promise<void>>(async () => {})

  /** The engine's mutation counter as of the last report this panel acted on,
   *  and the page it came from. Equal rev on the same page means the page has
   *  not moved since — an idle review — so the expensive half of sync (pins
   *  state, book merge, localStorage write, re-render) is skipped and the poll
   *  costs one cheap guest-page read. A different page is always a merge: a
   *  fresh engine restarts its rev at 0, and the seed's verdict (orphaned or
   *  not) must reach the book regardless. */
  const lastSyncRef = useRef<{ rev: null | number; url: string }>({ rev: null, url: '' })

  /** Pins this panel has already pointed the camera at. */
  const shotRef = useRef(new Set<string>())

  const sync = useCallback(
    async (report: Awaited<ReturnType<typeof readPins>>) => {
      if (!report) {
        setLive(false)

        return
      }

      // Drain first, and after every verb rather than only while annotating: an
      // image pasted and then left alone still has to get out of the page before
      // the next navigation takes the page with it.
      let shotsPending = false

      for (const id of report.pendingShots ?? []) {
        if (bytes.has(id)) {
          continue
        }

        shotsPending = true
        const answer = await takeShot(id)

        if (answer?.shot) {
          bytes.set(id, answer.shot)
        }
      }

      setLive(true)
      setArmed(report.armed === true)
      setBubbleOpen(report.bubbleOpen === true)

      // Photograph what a new comment points at, once, the first time this
      // panel sees it. A comment about a page is half about how it LOOKS, and
      // asking the user to go and screenshot the thing they just clicked is
      // the step that makes them not bother.
      //
      // Attempted-set rather than a shots check: a capture that legitimately
      // yields nothing (a torn-down guest, a pin scrolled to nowhere) must not
      // be retried on every poll, and a user who deletes the auto shot has
      // said no — re-adding it next beat would be the panel arguing.
      for (const pin of report.pins) {
        if (shotRef.current.has(pin.id)) {
          continue
        }

        shotRef.current.add(pin.id)

        if (!(pin.shots ?? []).length && !pin.orphaned) {
          await capturePinShot(pin.id)
        }
      }

      const changed =
        typeof report.rev !== 'number' ||
        report.rev !== lastSyncRef.current.rev ||
        normalizePageUrl(report.url) !== lastSyncRef.current.url ||
        shotsPending

      if (changed) {
        lastSyncRef.current = { rev: typeof report.rev === 'number' ? report.rev : null, url: report.url }
        setPins(report.pins)
        // File under the page's OWN url, not the pane's — the pane's value lags a
        // redirect, and filing under the wrong key is how a page's comments end up
        // replayed onto a different page. The book is the persistent store: writing
        // it here is what makes a review survive a remount.
        setPinBook(mergeReport($pinBook.get(), report.url, report.pins))
        setElsewhere(otherPages($pinBook.get(), report.url))
      }

      // The bubble's send shortcuts arrive HERE — the guest page has no bridge
      // to the composer, so its bubble can only write the intent and let the
      // next state read carry it out. Each request is executed once and then
      // acked, so a lost panel tick retries through the next poll, not a resend.
      const requests = report.deliver ?? []

      if (requests.length) {
        await ackDeliverRequests()
        await runDeliverRequests(requests)
      }
    },
    [bytes, runDeliverRequests]
  )

  // Poll while the panel is open — not only while armed. A marker stays
  // clickable after disarming, so a comment can be edited or an image pasted
  // with annotation mode off, and those bytes need draining too. Closed, this
  // stops entirely: a poll against a page nobody is reviewing is a round trip
  // into the guest document every beat for nothing. While a comment bubble is
  // open in the page the poll tightens: the bubble's send shortcuts reach the
  // panel only through a state read, and a 700 ms wait between the keypress
  // and the delivery reads as the shortcut having missed. Idle (nothing armed,
  // no bubble) it relaxes — the rev gate makes a no-change read cost nothing
  // on this side, and several review windows open at once is exactly when
  // those no-change reads should stop piling up. A hidden window polls not at
  // all: nothing user-facing is on screen, and a visibility change reads
  // immediately so a backgrounded review catches up the moment it returns.
  const [bubbleOpen, setBubbleOpen] = useState(false)
  useEffect(() => {
    if (!open) {
      return
    }

    let inFlight = false

    const tick = () => {
      // A background window's review has no visible state to update, and a
      // poll per beat per hidden window is the multi-window cost the rev gate
      // cannot remove. The visibilitychange listener syncs on return.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      if (inFlight) {
        return
      }

      inFlight = true

      void readPins()
        .then(sync)
        .finally(() => {
          inFlight = false
        })
    }

    const period = bubbleOpen ? POLL_BUBBLE_MS : armed ? POLL_MS : POLL_IDLE_MS
    const timer = setInterval(tick, period)

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tick()
      }
    }

    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [armed, bubbleOpen, open, sync])

  // A navigation destroys the engine and every pin with it; a reopen repaints.
  // Both seed from this page's bucket — and only this page's — and delivered
  // comments are never re-seeded: they are history (they left for the chat
  // already), and a returning page must not resurrect sent markers.
  const seedForPage = useCallback(
    (bookUrl: string): PreviewPin[] => pinsForPage($pinBook.get(), bookUrl).filter(pin => !pin.delivered),
    []
  )

  // Closing the panel hands the page back. Without this the engine stays armed
  // behind a UI that is no longer on screen: the next click on a link is eaten
  // by the review overlay instead of navigating, and nothing visible explains
  // why. Opening repaints what the page is still holding.
  useEffect(() => {
    if (!open) {
      void hidePins()

      return
    }

    void showPins(seedForPage(url)).then(sync)
  }, [open, seedForPage, sync, url])

  // A pane teardown is a close the effect above never sees.
  useEffect(() => () => void hidePins(), [])

  // Keybind requests: mod+shift+a toggles annotation, the attach chord delivers
  // everything pending. Counters (not flags) so two taps toggle twice. The
  // panel only acts while it is open — a hotkey pressed over a chat with no
  // browser pane must not arm a page the user is not looking at.
  const annotateRequest = useStore($annotateToggleRequest)
  const attachRequest = useStore($attachPinsRequest)

  useEffect(() => {
    if (open && annotateRequest > 0) {
      void toggleArmed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request counter IS the trigger
  }, [annotateRequest])

  useEffect(() => {
    if (open && attachRequest > 0) {
      void attach()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request counter IS the trigger
  }, [attachRequest])

  // A navigation destroys the engine and every pin with it. Seed the new one
  // from this page's bucket — and only this page's — then re-run the ladder.
  useEffect(() => {
    if (!open) {
      return
    }

    void reattachPins(seedForPage(url)).then(sync)
  }, [open, seedForPage, sync, url])

  const toggleArmed = async () => {
    const report = armed ? await disarmPins() : await armPins(seedForPage(url))
    await sync(report)
  }

  /**
   * Build one delivery's attachments — the `pins` chip plus its images as
   * ordinary image attachments — WITHOUT touching any composer. Shared by
   * Send, Queue and Send-all so every road a comment takes into the chat
   * carries the same things.
   */
  const buildParts = async (sending: PreviewPin[]): Promise<ComposerAttachment[]> => {
    const parts: ComposerAttachment[] = []

    parts.push({
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

      if (!blob) {
        continue
      }

      try {
        const buffer = new Uint8Array(await blob.arrayBuffer())
        const path = await window.hermesDesktop?.saveImageBuffer(buffer, blob.type === 'image/png' ? '.png' : '.jpg')

        if (!path) {
          continue
        }

        parts.push({
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

    return parts
  }

  /**
   * Stage a batch as a composer chip the user sends themselves — the Send-all
   * road: the whole review lands in the input for the user to frame with their
   * own words. In a popped-out Browser there is no composer here to fill, so
   * every part relays to the window that owns one.
   *
   * Returns the staged parts (locally added) plus the relay acknowledgements —
   * a popped-out Browser has no composer of its own, so "did it land?" is only
   * answerable after the relays answer, and a failed delivery must NOT be
   * marked delivered.
   */
  const stage = async (sending: PreviewPin[]): Promise<{ acks: Promise<boolean>[]; parts: ComposerAttachment[] }> => {
    const built = await buildParts(sending)
    const parts: ComposerAttachment[] = []
    const acks: Promise<boolean>[] = []

    for (const attachment of built) {
      if (isBrowserWindow()) {
        acks.push(relayComposerAttachment(attachment))

        continue
      }

      addComposerAttachment(attachment)
      parts.push(attachment)
    }

    return { acks, parts }
  }

  /** A delivered comment leaves the pending list AND the page — the marker
   *  goes with it, so nothing sent is ever left active to delete by hand. */
  const markDelivered = async (ids: string[], delivered: boolean) => {
    const next: PinBook = { ...$pinBook.get() }
    const set = new Set(ids)

    for (const [key, pagePins] of Object.entries(next)) {
      next[key] = pagePins.map(pin => (set.has(pin.id) ? { ...pin, delivered } : pin))
    }

    setPinBook(next)
    setPins(current => current.map(pin => (set.has(pin.id) ? { ...pin, delivered } : pin)))

    if (ids.length) {
      await deliverPins(ids, delivered)
    }
  }

  /** One comment, one send. The comment's own words are the prompt; the chip
   *  and its images ride WITH the submit — never dropped, never parked in the
   *  input field. The one delivery seam decides: composer now, queue when a
   *  turn is in flight, relay when this window has no composer. */
  const sendOne = async (pin: PreviewPin) => {
    const text = pin.comment.trim() || `Review this: ${pin.target || pin.kind}`

    const parts = await buildParts([pin])

    if (await deliverPrompt({ attachments: parts, mode: 'now', text })) {
      await markDelivered([pin.id], true)
      notify({ kind: 'success', message: 'Comment sent to the chat.', title: 'Sent' })
    } else {
      notify({ kind: 'error', message: 'No conversation is open to receive it.', title: 'Could not send' })
    }
  }

  /** Park one comment in the conversation's prompt queue, attachments and all.
   *  Deliberately NOT a send: it drains when the current turn settles. Nothing
   *  lands in the input field — that was the old Queue's bug. */
  const queueOne = async (pin: PreviewPin) => {
    const text = pin.comment.trim() || `Review this: ${pin.target || pin.kind}`
    const parts = await buildParts([pin])

    if (await deliverPrompt({ attachments: parts, mode: 'queue', text })) {
      await markDelivered([pin.id], true)
      notify({ kind: 'success', message: 'Comment parked in the queue.', title: 'Queued' })
    } else {
      notify({ kind: 'error', message: 'No conversation is open to queue it in.', title: 'Could not queue' })
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

    if (!held.length) {
      return
    }

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
      // these leaves the pending list and the page on its own — the same
      // auto-clear a per-comment Send gets.
      await markDelivered(
        sending.map(pin => pin.id),
        true
      )
    }
  }

  const clearEverything = async () => {
    setPinBook({})
    setElsewhere({ count: 0, pages: 0 })
    await clearPins().then(sync)
  }

  if (!open) {
    return null
  }

  // The pending list: what still owes the chat a delivery. Delivered comments
  // leave this list AND the page the moment they arrive — that IS the
  // auto-clear, one comment at a time. Nothing not delivered is ever removed
  // without the user pressing Clear, Resolve or Delete.
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
          {!live ? 'no live page' : armed ? 'click an element, or drag a region · Esc to stop' : `${openCount} open`}
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
