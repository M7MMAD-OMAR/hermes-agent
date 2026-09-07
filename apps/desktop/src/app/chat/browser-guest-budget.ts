import { $rightRailActiveTabId } from '@/store/layout'
import { $previewTabs, closeRightRailTab, type PreviewTab } from '@/store/preview'
import { $sessionStates } from '@/store/session-states'

/**
 * BROWSER GUEST BUDGET: a ceiling on how many live pages the app keeps.
 *
 * Every Browser tab is a `<webview>` guest, a renderer process of its own
 * (60 to 150 MB, a share of the iGPU, its own compositor). Nothing bounded
 * their number: hidden tabs stay mounted on purpose (a page an agent is
 * driving must survive a chat switch), so a day of opening pages across many
 * conversations left N guests alive for N tabs ever opened. Measured on
 * 2026-09-07: Hermes was 39% of a saturated iGPU with no bound on this.
 *
 * The rule is ending, not throttling. Over the ceiling, the least recently
 * shown tab is closed through the ONE close path (`closeRightRailTab`), so
 * every per-tab registry releases with it. Two tabs are never closed this way:
 *
 *  - the tab on screen, whatever its age;
 *  - a tab whose owner conversation is mid-turn, because the agent may be on
 *    that page right now, and losing its scroll and form state under it is
 *    worse than one extra guest.
 *
 * Unowned tabs (a file you opened, a link you clicked) count and can be
 * evicted like any other: they belong to nobody, so nobody is mid-turn on them.
 */
export const MAX_BROWSER_GUESTS = 6

/** When each Browser tab was last on screen. Module state, not persisted: a
 *  restored tab is "never shown" until it is, which makes it the first to go,
 *  and that is the right order for pages nobody has looked at since a restart. */
const lastShownAt = new Map<string, number>()

const isBrowserTab = (tab: PreviewTab): boolean => tab.target.kind === 'url'

function ownerBusy(tab: PreviewTab): boolean {
  return Boolean(tab.owner && $sessionStates.get()[tab.owner]?.busy)
}

/** The tabs the budget would close, oldest first, for `tabs` and `activeId`.
 *  Pure, so the policy is testable without a store. */
export function browserGuestEvictions(
  tabs: readonly PreviewTab[],
  activeId: null | string,
  shownAt: ReadonlyMap<string, number>,
  isBusy: (tab: PreviewTab) => boolean,
  max: number = MAX_BROWSER_GUESTS
): string[] {
  const guests = tabs.filter(isBrowserTab)
  const over = guests.length - max

  if (over <= 0) {
    return []
  }

  return guests
    .filter(tab => tab.id !== activeId && !isBusy(tab))
    .sort((a, b) => (shownAt.get(a.id) ?? 0) - (shownAt.get(b.id) ?? 0))
    .slice(0, over)
    .map(tab => tab.id)
}

function enforce(): void {
  for (const id of browserGuestEvictions($previewTabs.get(), $rightRailActiveTabId.get(), lastShownAt, ownerBusy)) {
    closeRightRailTab(id)
    lastShownAt.delete(id)
  }
}

/** Call once from the root, beside `watchPreviewTiles`. */
export function watchBrowserGuestBudget(): void {
  const touch = (id: null | string) => {
    if (id) {
      lastShownAt.set(id, Date.now())
    }
  }

  touch($rightRailActiveTabId.get())
  $rightRailActiveTabId.listen(touch)
  // Enforced on tab-list growth only: a turn ending is not a reason to close a
  // page, and a busy owner protecting its tab today may release it at the next
  // open, which is when a decision is actually needed.
  $previewTabs.listen((tabs, prev) => {
    if (tabs.filter(isBrowserTab).length > prev.filter(isBrowserTab).length) {
      enforce()
    }
  })
}
