import { useStore } from '@nanostores/react'

import { $restartPreviewServer } from '@/app/contrib/panes'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $rightRailActiveTabId, selectRightRailTab } from '@/store/layout'
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
  previewTabBelongsToSession
} from '@/store/preview'

import { browserTabLabel } from './preview-tile'
import { PreviewPane } from './right-rail/preview-pane'

/**
 * EMBEDDED BROWSER — this conversation's browser docked INSIDE its chat
 * column: a bordered panel above the transcript with its own mini tab strip.
 * The panes are the same `PreviewPane` the layout strip renders, from the same
 * store, with the same per-session ownership — only the home differs, which is
 * the whole point: the browser is part of the conversation, so it opens and
 * closes with it instead of living as a competing tab in the strip.
 *
 * While this conversation is the one on screen, `$dockedPreviewTabs` drops its
 * embedded browser tabs from the strip's mirror, so the page is hosted HERE
 * and nowhere else. Toggle the composer's globe to park it (collapsed, still
 * mounted — the page and the agent driving it survive) or bring it back.
 */
export function EmbeddedBrowserPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const embedded = useStore($embeddedBrowserSessions)
  const expanded = useStore($embeddedBrowserExpanded)
  const tabs = useStore($previewTabs)
  const pages = useStore($browserPages)
  const activeTabId = useStore($rightRailActiveTabId)
  const reloadRequest = useStore($previewReloadRequest)
  const restartPreviewServer = useStore($restartPreviewServer)

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
        'mx-3 mt-2 flex shrink-0 flex-col overflow-hidden rounded-lg border border-(--ui-border) bg-(--ui-chat-surface-background)',
        visible ? 'h-[45%] min-h-56' : 'hidden'
      )}
      data-embedded-browser=""
      data-embedded-browser-visible={visible ? '' : undefined}
    >
      <div className="flex items-center gap-0.5 border-b border-(--ui-border) px-1.5 py-1" data-embedded-browser-strip="">
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
