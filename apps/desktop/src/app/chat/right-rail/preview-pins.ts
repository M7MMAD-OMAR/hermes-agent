/**
 * PREVIEW PINS — the bridge between the pin panel and the guest page.
 *
 * The guest page is out-of-process, so this rides the same
 * `executeJavaScript` runner registry that preview-tour and preview-act use.
 * One verb per round trip; the engine keeps its own state on a window global,
 * so a call is a message to something already living rather than a fresh start.
 *
 * Injection is idempotent and vanishes with the page — which is correct, and is
 * why `reattach` exists: after a navigation the engine is gone along with every
 * pin it held, so the app is the durable side and replays what it knows.
 *
 * Dynamic-imported by the panel so the engine payload stays out of the boot
 * path, matching how run-tour.ts treats the driver bundle.
 */

import { type PinCommand, pinEngineSource } from '@/lib/preview-pins/pin-in-page'
import type { PinEngineReport, PreviewPin } from '@/lib/preview-pins/types'

import { activePreviewCapture, activePreviewScriptRunner } from './preview-script-runner'

/** Where the engine and its pins live in the guest page. */
const HOLDER = '__hermesPinHolder'
const ENGINE = '__hermesPinEngine'

/**
 * Cap on one round trip.
 *
 * `drive_preview` and `annotate_preview` hang forever when the bridge does not
 * answer (#94272); a pin verb is a UI gesture, so a stall would freeze the
 * panel rather than a turn. Bound it here rather than inherit that bug.
 */
const VERB_TIMEOUT_MS = 4_000

/**
 * Restore pins the app is holding, for a page the engine has never seen.
 *
 * Filtered against the guest page's OWN location, not the pane's idea of the
 * URL — the pane's value lags a redirect, and a mismatch here is how every pin
 * from the previous page lands on this one and comes back marked detached.
 * The panel buckets by page too; this is the half that cannot be fooled.
 */
function seedScript(pins: PreviewPin[]): string {
  return `var here = String(location.href).replace(/#$/, '');
  var seed = (${JSON.stringify(pins)}).filter(function (pin) {
    return !pin.pageUrl || String(pin.pageUrl).replace(/#$/, '') === here;
  });
  w.${HOLDER}.__hermesPinState = {
    armed: false, drag: null, hidden: false, seq: seed.length,
    pins: seed
  };`
}

function buildScript(command: PinCommand, seed: PreviewPin[] | null): string {
  return `(function () {
  var w = window;
  if (!w.${ENGINE}) {
    w.${HOLDER} = {};
    w.${ENGINE} = ${pinEngineSource()};
    ${seed && seed.length ? seedScript(seed) : ''}
  }
  return w.${ENGINE}(document, w.${HOLDER}, ${JSON.stringify(command)});
})()`
}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`preview pins: ${label} did not answer`)), VERB_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/**
 * Send one verb to the active preview's pin engine.
 *
 * Returns null when there is no live page behind the pane — the panel renders
 * that as "open a page first" rather than an error, because it is a state, not
 * a failure.
 */
export async function pinVerb(command: PinCommand, seed: PreviewPin[] | null = null): Promise<PinEngineReport | null> {
  const run = activePreviewScriptRunner()

  if (!run) {
    return null
  }

  try {
    const report = (await withTimeout(run(buildScript(command, seed)) as Promise<PinEngineReport>, command.verb)) as
      PinEngineReport | undefined

    if (!report || !Array.isArray(report.pins)) {
      return null
    }

    return report
  } catch {
    // A verb that failed is not worth tearing the panel down over: the page may
    // have navigated mid-call, which the next `state` will show correctly.
    return null
  }
}

export const armPins = (seed: PreviewPin[] | null = null) => pinVerb({ verb: 'arm' }, seed)
export const disarmPins = () => pinVerb({ verb: 'disarm' })
/** Closing the panel: disarm AND unpaint, so the page is fully the user's again. */
export const hidePins = () => pinVerb({ verb: 'hide' })
export const showPins = (seed: PreviewPin[] | null = null) => pinVerb({ verb: 'show' }, seed)
export const readPins = () => pinVerb({ verb: 'state' })
export const reattachPins = (seed: PreviewPin[] | null = null) => pinVerb({ verb: 'reattach' }, seed)
export const commentPin = (id: string, comment: string) => pinVerb({ comment, id, verb: 'comment' })
export const togglePinResolved = (id: string) => pinVerb({ id, verb: 'resolve' })
export const removePin = (id: string) => pinVerb({ id, verb: 'remove' })
/** Tell the page what delivery did to a batch of comments: each one leaves the
 *  page (its marker and pending state with it) on success, or rolls back to
 *  pending on a failed send. One round trip for the whole batch. */
export const deliverPins = (ids: string[], delivered = true) => pinVerb({ delivered, ids, verb: 'deliver' })
/** The panel took the bubble's delivery requests — clear them from the page. */
export const ackDeliverRequests = () => pinVerb({ verb: 'deliver' })
export const clearPins = () => pinVerb({ verb: 'clear' })
/** Take one attached image's bytes out of the page and leave nothing behind. */
export const takeShot = (id: string) => pinVerb({ id, verb: 'take' })

/** Where to point the camera for one pin — and the overlay steps aside. */
export const aimPin = (id: string) => pinVerb({ id, verb: 'aim' })
/** Hand the crop back and put the overlay on screen again. */
export const shootPin = (id: string, data: string) => pinVerb({ data, id, verb: 'shoot' })

/** How much page to keep around the target, in CSS px. A crop cut exactly to
 *  the element reads as a floating fragment; a little of what surrounds it is
 *  what makes the picture legible as a place on a page. */
const CROP_PAD = 12

/**
 * Photograph one pin's target and attach the result to that pin.
 *
 * The two halves are deliberately split across the process boundary: only the
 * host can reach Chromium's capture, and only the page knows where the target
 * currently is or how to get the overlay out of the way. So the page aims,
 * the host shoots, and the page adopts.
 *
 * `shoot` runs in a finally on purpose. `aim` hides the whole overlay host,
 * and a capture that throws — a torn-down webview, a guest mid-navigation —
 * would otherwise leave the user's pins invisible with no way back short of a
 * reload.
 */
export async function capturePinShot(id: string): Promise<boolean> {
  const capture = activePreviewCapture()

  if (!capture) {
    return false
  }

  const aimed = await aimPin(id)
  const box = aimed?.aim

  if (!box) {
    return false
  }

  let data = ''

  try {
    data = await capture({
      height: box.height + CROP_PAD * 2,
      width: box.width + CROP_PAD * 2,
      x: box.left - CROP_PAD,
      y: box.top - CROP_PAD
    })
  } catch {
    // Not worth surfacing: the comment itself is intact and the user can
    // still attach an image by hand. Losing the overlay would be the real bug,
    // and the finally below is what prevents it.
  } finally {
    await shootPin(id, data)
  }

  return Boolean(data)
}
