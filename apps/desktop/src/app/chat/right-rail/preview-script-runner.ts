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

import type { CaptureFormat } from '../../../../electron/preview-capture'
import type { PreviewUploadResult } from '../../../../electron/preview-upload'

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
/** With no rect, the whole guest viewport. A rect crops it, in the guest's own
 *  CSS pixels. `format` caps and re-encodes the picture on the host, which is
 *  where the bytes already are. */
export type PreviewCapture = (
  rect?: { height: number; width: number; x: number; y: number },
  format?: CaptureFormat
) => Promise<string>

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

/** The AGENT's tab's capture, so `look` photographs the page the agent is
 *  driving rather than whichever tab the reader happens to be looking at. */
export function agentPreviewCapture(sessionId: null | string): null | PreviewCapture {
  const id = agentPreviewTabId(sessionId)

  return (id && captures.get(id)) || null
}

/**
 * Puts workspace files into the guest page's file input.
 *
 * Registered beside the capture for the same reason: only the host can hand a
 * page a local file, so the pane publishes a door to the main process rather
 * than anything a guest script could do.
 */
export type PreviewUpload = (paths: string[], selector?: string) => Promise<PreviewUploadResult>

const uploads = new Map<string, PreviewUpload>()

export function registerPreviewUpload(tabId: string, upload: PreviewUpload): () => void {
  uploads.set(tabId, upload)

  return () => {
    if (uploads.get(tabId) === upload) {
      uploads.delete(tabId)
    }
  }
}

/** The AGENT's tab's upload door. Null = no live page behind it. */
export function agentPreviewUpload(sessionId: null | string): null | PreviewUpload {
  const id = agentPreviewTabId(sessionId)

  return (id && uploads.get(id)) || null
}
