/**
 * One "the user came back" signal for every refresh-on-return listener.
 *
 * Coming back to the window fires BOTH `focus` and `visibilitychange`, and on
 * some compositors each of those arrives more than once (a workspace switch
 * raises, focuses, then re-focuses the surface). Every listener that keyed its
 * refresh on those raw events ran two or three times per return, so the moment
 * the window reappeared the renderer fired a burst of duplicate RPCs at a
 * backend that is often busy streaming other sessions, and painted their
 * responses while it was still rasterizing the first frame.
 *
 * `subscribeWindowReturn` collapses the raw events into one callback per return
 * and runs it AFTER the first frame has painted, so the reveal itself stays
 * cheap and the refreshes trail it. A listener that only wants stale data
 * refreshed passes `minIntervalMs`: a return that lands inside that window
 * (alt-tab away and straight back) is skipped for that listener.
 *
 * The events are still observed individually so a listener never misses a
 * return: `focus` alone covers macOS wake (no visibilitychange), and
 * `visibilitychange` alone covers a compositor that reveals without focusing.
 */

export interface WindowReturnOptions {
  /** Skip returns that land less than this many ms after the previous run. */
  minIntervalMs?: number
  /** Run right away on the return event instead of after the next paint. */
  immediate?: boolean
}

/** Raw return events inside this window collapse into one callback. */
export const WINDOW_RETURN_COALESCE_MS = 150

type Listener = {
  handler: () => void
  immediate: boolean
  lastRunAt: number
  minIntervalMs: number
}

const listeners = new Set<Listener>()
let coalesceTimer: number | null = null
let installed = false
let returnsSinceInstall = 0

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** Schedule `fn` after the next frame has painted (two frames, then a task). */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0)

    return
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(fn, 0)
    })
  })
}

function run(listener: Listener, at: number): void {
  if (listener.minIntervalMs > 0 && at - listener.lastRunAt < listener.minIntervalMs) {
    return
  }

  listener.lastRunAt = at

  try {
    listener.handler()
  } catch {
    // One listener's failure must not starve the others on this return.
  }
}

function dispatchReturn(): void {
  coalesceTimer = null

  if (document.visibilityState !== 'visible') {
    return
  }

  returnsSinceInstall += 1
  const at = now()
  const deferred: Listener[] = []

  for (const listener of listeners) {
    if (listener.immediate) {
      run(listener, at)
    } else {
      deferred.push(listener)
    }
  }

  if (deferred.length === 0) {
    return
  }

  afterPaint(() => {
    if (document.visibilityState !== 'visible') {
      return
    }

    const deferredAt = now()

    for (const listener of deferred) {
      if (listeners.has(listener)) {
        run(listener, deferredAt)
      }
    }
  })
}

function onRawReturn(): void {
  if (document.visibilityState !== 'visible') {
    return
  }

  if (coalesceTimer !== null) {
    return
  }

  coalesceTimer = window.setTimeout(dispatchReturn, WINDOW_RETURN_COALESCE_MS)
}

function install(): void {
  if (installed || typeof window === 'undefined') {
    return
  }

  installed = true
  window.addEventListener('focus', onRawReturn)
  document.addEventListener('visibilitychange', onRawReturn)
}

function uninstall(): void {
  if (!installed) {
    return
  }

  installed = false
  window.removeEventListener('focus', onRawReturn)
  document.removeEventListener('visibilitychange', onRawReturn)

  if (coalesceTimer !== null) {
    window.clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
}

/**
 * Run `handler` once per return to the window. Returns the unsubscribe.
 *
 * The handler is NOT run on subscribe: callers that want an initial pull do it
 * themselves, exactly as they did with raw listeners.
 */
export function subscribeWindowReturn(handler: () => void, options: WindowReturnOptions = {}): () => void {
  const listener: Listener = {
    handler,
    immediate: options.immediate === true,
    // A fresh subscriber has never run; a return right after mount counts.
    lastRunAt: Number.NEGATIVE_INFINITY,
    minIntervalMs: Math.max(0, options.minIntervalMs ?? 0)
  }

  listeners.add(listener)
  install()

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      uninstall()
    }
  }
}

/** Test seam: how many coalesced returns have been dispatched. */
export function windowReturnCount(): number {
  return returnsSinceInstall
}

/** Test seam: drop every listener and detach from the document. */
export function resetWindowReturnForTests(): void {
  listeners.clear()
  uninstall()
  returnsSinceInstall = 0
}
