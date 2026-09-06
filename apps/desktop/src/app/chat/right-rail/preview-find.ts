/**
 * PREVIEW FIND — Cmd+F inside the embedded browser.
 *
 * The find bar had no way to search a page in the preview pane, by two
 * independent mechanisms:
 *
 *  1. The primary window searches with a renderer-side DOM walker over a
 *     captured scope element (lib/find-in-page-scope.ts). A `<webview>` guest
 *     is a separate frame tree in a separate process, so the walker cannot see
 *     a single character of it.
 *  2. The Electron fallback calls `findInPage` on the WINDOW's webContents
 *     (electron/find-in-page.ts). That is the host document; a guest's
 *     webContents is a different one, and is not searched either.
 *
 * So the pane registers its guest here, and the find bar drives the guest's own
 * `findInPage` when the search was started from inside the browser. Chromium
 * does the matching and the highlighting, which is why this returns no text: the
 * counts arrive asynchronously on the guest's `found-in-page` event.
 *
 * Keyed by tab id like every other preview registry (input, nav, reader, script
 * runner) so a closed tab cannot answer for the one on screen.
 */

/** The slice of Electron's `<webview>` this module drives. */
export interface PreviewFindTarget {
  addEventListener: (type: string, listener: (event: FoundInPageEvent) => void) => void
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
  removeEventListener: (type: string, listener: (event: FoundInPageEvent) => void) => void
  /** `clearSelection` leaves the page as the user found it; `keepSelection`
   *  would leave the last match selected after the bar closes. */
  stopFindInPage: (action: 'clearSelection' | 'keepSelection') => void
}

/** Electron's `found-in-page` event as it reaches a `<webview>` listener. */
export interface FoundInPageEvent {
  result?: { activeMatchOrdinal?: number; finalUpdate?: boolean; matches?: number }
}

export interface PreviewFindResult {
  activeOrdinal: number
  count: number
}

const targets = new Map<string, PreviewFindTarget>()

/** Register a tab's guest as a find target; returns an idempotent unregister. */
export function registerPreviewFind(tabId: string, target: PreviewFindTarget): () => void {
  targets.set(tabId, target)

  return () => {
    if (targets.get(tabId) === target) {
      targets.delete(tabId)
    }
  }
}

/** The registered guest for `tabId`, or null. */
export function previewFindTarget(tabId: null | string): PreviewFindTarget | null {
  return (tabId && targets.get(tabId)) || null
}

/** Test seam: drop every registration. */
export function resetPreviewFindForTest(): void {
  targets.clear()
}

/**
 * Search `target` and resolve with the counts Chromium reports.
 *
 * `findInPage` is fire-and-forget — the counts land later on `found-in-page` —
 * so this bridges the event back to a promise. Chromium emits SEVERAL results
 * per query as it walks the document; only `finalUpdate` carries the total, and
 * resolving on the first event reported a count that then kept changing under
 * the user. Intermediate events still resolve if no final one arrives (a guest
 * torn down mid-search), guarded by a timeout so the find bar can never hang.
 */
export function searchPreview(
  target: PreviewFindTarget,
  query: string,
  options: { forward?: boolean; findNext?: boolean } = {},
  timeoutMs = 2_000
): Promise<PreviewFindResult> {
  if (!query) {
    // An empty query is how the bar clears itself. Stop the search rather than
    // asking Chromium to match "", which it rejects.
    target.stopFindInPage('clearSelection')

    return Promise.resolve({ activeOrdinal: 0, count: 0 })
  }

  return new Promise<PreviewFindResult>(resolve => {
    let settled = false
    let latest: PreviewFindResult = { activeOrdinal: 0, count: 0 }
    let timer: null | ReturnType<typeof setTimeout> = null

    const finish = (result: PreviewFindResult) => {
      if (settled) {
        return
      }

      settled = true

      if (timer !== null) {
        clearTimeout(timer)
      }

      target.removeEventListener('found-in-page', onFound)
      resolve(result)
    }

    function onFound(event: FoundInPageEvent) {
      const result = event?.result

      latest = {
        activeOrdinal: Number(result?.activeMatchOrdinal ?? 0),
        count: Number(result?.matches ?? 0)
      }

      if (result?.finalUpdate) {
        finish(latest)
      }
    }

    target.addEventListener('found-in-page', onFound)
    timer = setTimeout(() => finish(latest), timeoutMs)

    try {
      target.findInPage(query, { forward: options.forward ?? true, findNext: options.findNext ?? false })
    } catch {
      // A guest torn down between registration and the call: report no matches
      // rather than rejecting into the find bar's keystroke handler.
      finish({ activeOrdinal: 0, count: 0 })
    }
  })
}

/** Clear the guest's highlights and selection. Safe on a torn-down guest. */
export function clearPreviewSearch(target: PreviewFindTarget): void {
  try {
    target.stopFindInPage('clearSelection')
  } catch {
    // Already gone — nothing to clear.
  }
}
