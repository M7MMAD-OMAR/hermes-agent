/**
 * PREVIEW SCRIPT RUNNER REGISTRY — the one way anything in the app reaches into
 * the preview pane's guest page, the script analog of preview-nav's handle
 * registry.
 *
 * A live browser pane registers its webview's `executeJavaScript` here, keyed
 * by tab id; `activePreviewScriptRunner` resolves the ACTIVE tab from the
 * store. Both guest-page features ride it — the tour tool (preview-tour.ts)
 * and the interaction tool (preview-act.ts) — so their heavy payloads stay out
 * of the pane component's static import graph and only load when used.
 */

import { $rightRailActiveTabId } from '@/store/layout'
import { $previewTabs, agentPreviewTabId } from '@/store/preview'

/** Runs JS source in the pane's guest page, resolving its completion value. */
export type PreviewScriptRunner = (code: string) => Promise<unknown>

const runners = new Map<string, PreviewScriptRunner>()

/** Register a live preview's script runner; returns an idempotent unregister. */
export function registerPreviewScriptRunner(tabId: string, runner: PreviewScriptRunner): () => void {
  runners.set(tabId, runner)

  return () => {
    if (runners.get(tabId) === runner) {
      runners.delete(tabId)
    }
  }
}

/** The AGENT's tab's script runner — where its engine and handle book live. */
export function agentPreviewScriptRunner(sessionId: null | string): PreviewScriptRunner | null {
  const id = agentPreviewTabId(sessionId)

  return (id && runners.get(id)) || null
}

/** The ACTIVE preview tab's script runner. Null = no live page behind it. */
export function activePreviewScriptRunner(): PreviewScriptRunner | null {
  return activeFor(runners)
}

/**
 * Photographs a rectangle of the guest page, resolving a data URL.
 *
 * Registered beside the script runner rather than derived from it: a crop
 * needs Chromium's capture on the host side, which no amount of guest-page
 * JavaScript can reach. Comments use it to attach a picture of what they
 * point at, so the model reads the same thing the user was looking at.
 */
export type PreviewCapture = (rect: { height: number; width: number; x: number; y: number }) => Promise<string>

const captures = new Map<string, PreviewCapture>()

function activeFor<T>(book: Map<string, T>): null | T {
  const tabs = $previewTabs.get()
  const tab = tabs.find(t => t.id === $rightRailActiveTabId.get()) ?? tabs[0]

  return (tab && book.get(tab.id)) || null
}

/** Register a live preview's capture; returns an idempotent unregister. */
export function registerPreviewCapture(tabId: string, capture: PreviewCapture): () => void {
  captures.set(tabId, capture)

  return () => {
    if (captures.get(tabId) === capture) {
      captures.delete(tabId)
    }
  }
}

/** The ACTIVE preview tab's capture. Null = nothing to photograph. */
export function activePreviewCapture(): null | PreviewCapture {
  return activeFor(captures)
}
