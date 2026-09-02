import { useStore } from '@nanostores/react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react'

import { $restartPreviewServer } from '@/app/contrib/panes'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { guardGuestPointers } from '@/lib/guest-pointer-guard'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { rafCoalesce } from '@/lib/raf-coalesce'
import { cn } from '@/lib/utils'
import { $rightRailActiveTabId, selectRightRailTab } from '@/store/layout'
import { $paneWidthOverride, setPaneWidthOverride } from '@/store/panes'
import {
  $embeddedBrowserExpanded,
  $embeddedBrowserSessions,
  $previewReloadRequest,
  $previewTabs,
  closeRightRailTab,
  newBrowserTab,
  type PreviewTab,
  registerEmbeddedBrowserHost
} from '@/store/preview'

import { BrowserTabLabel, browserTabLabel } from './preview-tile'
import { PreviewPane } from './right-rail/preview-pane'

/**
 * EMBEDDED BROWSER — this conversation's browser docked INSIDE its chat
 * column, BESIDE the transcript (never above it) with its own mini tab strip.
 * The panes are the same `PreviewPane` the layout strip renders, from the same
 * store, with the same per-session ownership — only the home differs, which is
 * the whole point: the browser is part of the conversation, so it opens and
 * closes with it instead of living as a competing tab in the strip.
 *
 * SIDE, NOT TOP. A band across the top of the chat halves the height for both
 * surfaces at once — the transcript loses its scrollback and the page loses the
 * vertical run it is designed for, which is exactly the axis a web page needs.
 * Beside, the page keeps FULL column height and the width is the negotiable
 * axis, which is also the axis the device presets already scale on. The row is
 * `rtl:flex-row-reverse` in the parent, so the pane is on the physical right in
 * an RTL app too.
 *
 * FULL BLEED. No outer margin, radius, or ring: the only stroke is the single
 * seam facing the transcript, which is also the drag sash. A floating card here
 * reads as a light box pasted on the chat, and every edge of it is one more
 * bright line between two dark surfaces.
 *
 * While this conversation is the one on screen, `$dockedPreviewTabs` drops its
 * embedded browser tabs from the strip's mirror, so the page is hosted HERE
 * and nowhere else. Toggle the composer's globe to park it (collapsed, still
 * mounted — the page and the agent driving it survive) or bring it back.
 */

/** Pane-store key for the seam width. One width for the embedded browser
 *  everywhere, not per conversation: it is a property of how this user reads,
 *  not of the page on screen. */
const WIDTH_PANE_ID = 'chat.embedded-browser'

/** Below this the tab strip and the address bar stop being usable; the
 *  conversation keeps enough room to still be a conversation. */
const MIN_BROWSER_PX = 320
const MIN_CHAT_PX = 360

/** Wide enough that a desktop preset is legible rather than a thumbnail, while
 *  the transcript stays the larger half. */
const DEFAULT_BROWSER_FRACTION = 0.45

/**
 * THE GATE — mounted by every chat surface in the app, open or not.
 *
 * It subscribes to ONE atom and renders nothing until this conversation
 * actually has a browser. That split is the point: the body below holds eight
 * store subscriptions, two of them (`$previewTabs`, `$browserPages`) rewritten
 * by any tab open/close/navigate/title-tick ANYWHERE in the app. With the
 * subscriptions above the bail, every chat paid for that churn forever, whether
 * or not its user had ever opened the browser.
 */
export function EmbeddedBrowserPanel({ sessionId }: { sessionId: string }) {
  const embedded = useStore($embeddedBrowserSessions)

  // Announce that this conversation HAS somewhere to put a browser, for as long
  // as the surface is in the tree — including while it renders nothing, which is
  // the state every conversation starts in. `toggleEmbeddedBrowser` refuses to
  // mint a tab for a session with no host, so this registration is what decides
  // whether the globe embeds or falls back to the strip. It lives in the GATE,
  // not the body, because it must be true before the first press.
  useEffect(() => registerEmbeddedBrowserHost(sessionId), [sessionId])

  if (!embedded.has(sessionId)) {
    return null
  }

  return <EmbeddedBrowserBody sessionId={sessionId} />
}

/**
 * One tab in the mini strip.
 *
 * A DIV wrapping two buttons, not a button containing a second one: interactive
 * content cannot nest, and the ✕ was a `role="button"` span inside the tab's own
 * `<button>` — invalid markup that only worked because the inner click stopped
 * propagating. `PaneTab` has the same shape for the same reason.
 *
 * Close gestures come from the shared `middleClickHandlers` so this strip
 * answers a middle-click and a ⌘-click like every other tab strip in the app.
 * They are not a nicety here: the ✕ only appears on hover, so on a narrow pane
 * they are often the fastest way to shed a page.
 */
function EmbeddedTab({
  active,
  closeLabel,
  onClose,
  tab
}: {
  active: boolean
  closeLabel: string
  onClose: () => void
  tab: PreviewTab
}) {
  const middle = middleClickHandlers(onClose)

  return (
    <div
      className={cn(
        'group relative flex min-w-0 shrink-0 items-center rounded text-xs',
        active ? 'bg-(--ui-accent)/10 text-(--ui-text)' : 'text-(--ui-text-tertiary) hover:bg-(--ui-hover)'
      )}
      {...middle}
    >
      <button
        aria-label={browserTabLabel(tab.target)}
        className="min-w-0 max-w-40 truncate px-2 py-0.5 text-left"
        onClick={event => {
          // ⌘-click closes, matching PaneTab — claimed before the activate so a
          // closing click can't also select the tab it just removed.
          if (isMetaClose(event)) {
            event.preventDefault()
            onClose()

            return
          }

          selectRightRailTab(tab.id)
        }}
        type="button"
      >
        <BrowserTabLabel tabId={tab.id} />
      </button>
      <button
        aria-label={closeLabel}
        className="mr-1 hidden rounded p-px hover:bg-(--ui-hover) group-hover:block"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      >
        <Codicon name="close" size="0.6875rem" />
      </button>
    </div>
  )
}

function EmbeddedBrowserBody({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const expanded = useStore($embeddedBrowserExpanded)
  const tabs = useStore($previewTabs)
  const activeTabId = useStore($rightRailActiveTabId)
  const reloadRequest = useStore($previewReloadRequest)
  const restartPreviewServer = useStore($restartPreviewServer)
  const widthOverride = useStore($paneWidthOverride(WIDTH_PANE_ID))
  const [dragging, setDragging] = useState(false)

  // The seam is dragged in SCREEN pixels, so it reads the row's own box rather
  // than assuming which side it is on: `flex-row-reverse` under RTL puts the
  // browser on the right while the pointer axis still runs left-to-right, and a
  // hardcoded sign would invert the drag for exactly the users this pane was
  // re-homed for. Widening means "the seam moved away from the browser's outer
  // edge", whichever edge that is.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget
    const panel = handle.parentElement
    const row = panel?.parentElement

    if (!panel || !row || event.button !== 0) {
      return
    }

    event.preventDefault()

    const rowBox = row.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    // Which physical edge of the row this pane is pinned to. The seam is the
    // other one, and the pointer moves toward the pinned edge to widen.
    const pinnedRight = panelBox.right >= rowBox.right - 1
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = panelBox.width
    const max = Math.max(MIN_BROWSER_PX, rowBox.width - MIN_CHAT_PX)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    let width = startWidth
    let active = true

    try {
      handle.setPointerCapture?.(pointerId)
    } catch {
      // Synthetic events.
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    // NOT optional on this sash: it faces the transcript, so narrowing the
    // browser drags the pointer straight across the guest — and a <webview>
    // hit-tests in its own process, which swallows the rest of the gesture AND
    // the pointerup that would end it. Without this the drag freezes a few
    // pixels in and the move listener outlives the release, so ordinary mouse
    // movement keeps resizing the pane. Every sash in the app opens with it.
    const releaseGuests = guardGuestPointers()

    // Preview with an inline write; commit the store ONCE on release — the same
    // rule the layout tree's sash documents. `setPaneWidthOverride` persists:
    // one call is `JSON.stringify` of the whole pane-state map plus a
    // synchronous `localStorage.setItem`, then a re-render of this panel, then
    // PreviewPane's ResizeObserver and a zoom/emulate hop into the guest. Per
    // frame of a drag that is the entire frame budget.
    const preview = rafCoalesce<number>(next => {
      panel.style.width = `${next}px`
    })

    const onMove = (move: globalThis.PointerEvent) => {
      if (!active) {
        return
      }

      const delta = pinnedRight ? startX - move.clientX : move.clientX - startX

      width = Math.round(Math.min(max, Math.max(MIN_BROWSER_PX, startWidth + delta)))
      preview.push(width)
    }

    // Idempotent, and reached from every way a drag can end — a release over
    // the guest, a cancelled pointer, the window losing focus.
    const cleanup = () => {
      if (!active) {
        return
      }

      active = false
      preview.finish()
      releaseGuests()
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect

      try {
        handle.releasePointerCapture?.(pointerId)
      } catch {
        // Never captured.
      }

      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
      window.removeEventListener('blur', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      setDragging(false)

      // A press that never moved is not a resize. Committing it would freeze
      // the default fraction into a hard pixel width on a stray click — and
      // take the double-click reset with it, since that arrives as two of them.
      if (width !== startWidth) {
        setPaneWidthOverride(WIDTH_PANE_ID, width)
      }
    }

    setDragging(true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', cleanup, true)
    window.addEventListener('pointercancel', cleanup, true)
    window.addEventListener('blur', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
  }

  // OWNED, not merely visible-to. `previewTabBelongsToSession` also answers true
  // for a tab with no owner — a page opened from a tool result or a link, which
  // belongs to nobody and therefore stays in the layout strip. Every expanded
  // panel would list it, and the strip would go on showing it too: one tab, two
  // live guests, the page loaded twice and an agent driving the copy the user
  // cannot see.
  //
  // `$previewTabs` is rewritten WHOLESALE on every navigation commit, so without
  // the memo the filter reruns and `target` changes identity on each one — and
  // PreviewPane is memoized on exactly that prop.
  const mine = useMemo(
    () => tabs.filter(tab => tab.target.kind === 'url' && tab.owner === sessionId),
    [sessionId, tabs]
  )

  const active = mine.find(tab => tab.id === activeTabId) ?? mine.at(-1)
  const visible = expanded.has(sessionId)

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)',
        visible ? '' : 'hidden'
      )}
      data-embedded-browser=""
      data-embedded-browser-visible={visible ? '' : undefined}
      style={
        {
          // A stored width is honoured verbatim; the first open picks a
          // fraction of the row so the pane opens proportional to the window
          // instead of at some fixed px that is half the screen on a laptop.
          width: widthOverride === undefined ? `${DEFAULT_BROWSER_FRACTION * 100}%` : `${widthOverride}px`,
          minWidth: `${MIN_BROWSER_PX}px`
        } as CSSProperties
      }
    >
      {/* The seam: the pane's only stroke, and the drag target. Straddles the
          boundary so the grab area is 4px while the line itself stays hairline —
          it leans OUT rather than in, because the 2px it does cover belongs to a
          live web page. Double-click restores the default split. */}
      <div
        aria-hidden="true"
        // PHYSICAL left, not logical `start`: the pane is pinned to the physical
        // right in both directions (the row reverses under RTL), so the edge
        // facing the transcript is the left one either way — `start-0` would
        // put the sash on the window's outer edge under RTL.
        className="group/sash absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize"
        data-embedded-browser-sash=""
        onDoubleClick={() => setPaneWidthOverride(WIDTH_PANE_ID, undefined)}
        onPointerDown={startResize}
        // Straddles the seam in PHYSICAL pixels — a Tailwind `-translate-x-1/2`
        // would be at the mercy of direction-aware transforms, and this handle
        // must not wander to the far edge under RTL.
        style={{ marginLeft: '-2px' }}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-[2px] w-px transition-colors',
            dragging ? 'bg-(--ui-stroke-secondary)' : 'bg-(--ui-border) group-hover/sash:bg-(--ui-stroke-secondary)'
          )}
        />
      </div>
      {/* Scrolls rather than squashing: the pane is the narrow half of the
          column, so a handful of tabs is enough to run out of room. Same
          treatment as `PaneTabStrip` — hidden scrollbar, contained overscroll
          so a trackpad flick here can't page the chat behind it. */}
      <div
        className="flex items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-(--ui-border) px-1.5 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-embedded-browser-strip=""
      >
        {mine.map(tab => (
          <EmbeddedTab
            active={tab.id === active?.id}
            closeLabel={t.preview.embeddedCloseTab}
            key={tab.id}
            onClose={() => closeRightRailTab(tab.id)}
            tab={tab}
          />
        ))}
        <Tip label={t.preview.embeddedNewTab}>
          <button
            aria-label={t.preview.embeddedNewTab}
            className="rounded p-1 text-(--ui-text-tertiary) hover:bg-(--ui-hover) hover:text-(--ui-text)"
            onClick={() => newBrowserTab(sessionId)}
            type="button"
          >
            <Codicon name="add" size="0.8125rem" />
          </button>
        </Tip>
      </div>
      {active ? (
        <div className="min-h-0 flex-1">
          <PreviewPane
            embedded
            onRestartServer={restartPreviewServer ?? undefined}
            reloadRequest={reloadRequest}
            tabId={active.id}
            target={active.target}
          />
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-xs text-(--ui-text-tertiary)">
          {t.shell.statusbar.showBrowser}
        </div>
      )}
    </div>
  )
}
