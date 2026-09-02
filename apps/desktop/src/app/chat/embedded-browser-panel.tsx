import { useStore } from '@nanostores/react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useState } from 'react'

import { $restartPreviewServer } from '@/app/contrib/panes'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { rafCoalesce } from '@/lib/raf-coalesce'
import { cn } from '@/lib/utils'
import { $rightRailActiveTabId, selectRightRailTab } from '@/store/layout'
import { $paneWidthOverride, setPaneWidthOverride } from '@/store/panes'
import {
  $browserPages,
  $embeddedBrowserExpanded,
  $embeddedBrowserSessions,
  $previewReloadRequest,
  $previewTabs,
  closeRightRailTab,
  forgetBrowserPage,
  newBrowserTab,
  type PreviewTab,
  previewTabBelongsToSession,
  registerEmbeddedBrowserHost
} from '@/store/preview'

import { browserTabLabel } from './preview-tile'
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

export function EmbeddedBrowserPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const embedded = useStore($embeddedBrowserSessions)
  const expanded = useStore($embeddedBrowserExpanded)
  const tabs = useStore($previewTabs)
  const pages = useStore($browserPages)
  const activeTabId = useStore($rightRailActiveTabId)
  const reloadRequest = useStore($previewReloadRequest)
  const restartPreviewServer = useStore($restartPreviewServer)
  const widthOverride = useStore($paneWidthOverride(WIDTH_PANE_ID))
  const [dragging, setDragging] = useState(false)

  // Announce that this conversation HAS somewhere to put a browser, for as long
  // as the panel is in the tree — including while it renders nothing, which is
  // the state every conversation starts in. `toggleEmbeddedBrowser` refuses to
  // mint a tab for a session with no host, so this registration is what decides
  // whether the globe embeds or falls back to the strip.
  useEffect(() => registerEmbeddedBrowserHost(sessionId), [sessionId])

  // The seam is dragged in SCREEN pixels, so it reads the row's own box rather
  // than assuming which side it is on: `flex-row-reverse` under RTL puts the
  // browser on the right while the pointer axis still runs left-to-right, and a
  // hardcoded sign would invert the drag for exactly the users this pane was
  // re-homed for. Widening means "the seam moved away from the browser's outer
  // edge", whichever edge that is.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.parentElement
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
    const startX = event.clientX
    const startWidth = panelBox.width
    const max = Math.max(MIN_BROWSER_PX, rowBox.width - MIN_CHAT_PX)

    setDragging(true)

    // ONE width write per frame, not one per pointermove. The chain behind a
    // single write is long and entirely synchronous: `$paneStates.set` →
    // `JSON.stringify` of the whole pane-state map → `localStorage.setItem` →
    // this panel re-renders → the inline width changes → layout → PreviewPane's
    // ResizeObserver → `apply()` → a rect read and a zoom/emulate call into the
    // guest. A trackpad drag delivers those faster than a frame, so uncoalesced
    // it runs the chain several times for one painted frame.
    const commit = rafCoalesce<number>(width => setPaneWidthOverride(WIDTH_PANE_ID, width))

    const onMove = (move: globalThis.PointerEvent) => {
      const delta = pinnedRight ? startX - move.clientX : move.clientX - startX

      commit.push(Math.round(Math.min(max, Math.max(MIN_BROWSER_PX, startWidth + delta))))
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      // Commit the last position even if it arrived inside the pending frame,
      // or the pane settles a few pixels off where the pointer was released.
      commit.finish()
      setDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  if (!embedded.has(sessionId)) {
    return null
  }

  const mine = tabs.filter(tab => tab.target.kind === 'url' && previewTabBelongsToSession(tab, sessionId))
  const active = mine.find(tab => tab.id === activeTabId) ?? mine.at(-1)
  const visible = expanded.has(sessionId)

  const closeTab = (tab: PreviewTab) => {
    forgetBrowserPage(tab.id)
    closeRightRailTab(tab.id)
  }

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
      <div
        className="flex items-center gap-0.5 border-b border-(--ui-border) px-1.5 py-1"
        data-embedded-browser-strip=""
      >
        {mine.map(tab => (
          <button
            aria-label={browserTabLabel(tab.target, pages[tab.id])}
            className={cn(
              'group relative flex min-w-0 items-center rounded px-2 py-0.5 text-xs',
              tab.id === active?.id
                ? 'bg-(--ui-accent)/10 text-(--ui-text)'
                : 'text-(--ui-text-tertiary) hover:bg-(--ui-hover)'
            )}
            key={tab.id}
            onClick={() => selectRightRailTab(tab.id)}
            type="button"
          >
            <span className="max-w-40 truncate">{browserTabLabel(tab.target, pages[tab.id])}</span>
            <span
              aria-label={t.preview.embeddedCloseTab}
              className="ml-1 hidden rounded p-px hover:bg-(--ui-hover) group-hover:inline-block"
              onClick={event => {
                event.stopPropagation()
                closeTab(tab)
              }}
              role="button"
              tabIndex={-1}
            >
              <Codicon name="close" size="0.6875rem" />
            </span>
          </button>
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
