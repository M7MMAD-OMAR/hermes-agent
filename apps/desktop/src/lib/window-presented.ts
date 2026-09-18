/**
 * Is this window actually on a screen right now?
 *
 * Every other answer the renderer has is wrong on a Wayland desktop.
 * `document.visibilityState` is the one the platform is supposed to provide,
 * and measured on Hyprland/sway (18 September 2026) it reads `visible` for a
 * window parked on another workspace, with Chromium's own background
 * throttling left enabled: the compositor unmaps the surface without telling
 * the browser anything, so timers keep firing at full rate and every
 * visibility-gated guard in the renderer misses. `document.hasFocus()` is
 * honest about attention but not about pixels: a window on the second monitor
 * that nobody has clicked is fully presented, and pausing its clocks freezes a
 * counter the user is watching.
 *
 * The compositor does say one thing truthfully, by not saying it: when a
 * surface is not being presented, it stops asking for frames, so
 * `requestAnimationFrame` callbacks stop arriving while timers carry on. That
 * gap IS the signal. A frame proves presentation; a long silence with timers
 * still ticking means the pixels go nowhere.
 *
 * The one false positive worth naming: a main thread blocked for longer than
 * `PRESENT_STALE_MS` starves rAF too, so a very busy visible window can read as
 * not presented. Callers must therefore treat this as a hint for how much
 * COSMETIC work to do (flush cadence, decorative clocks), never as a condition
 * for correctness. The state corrects itself on the next frame.
 */

/** No frame for this long, while timers keep running, means "not presented". */
export const PRESENT_STALE_MS = 1_200

/** How often the PUSH path re-checks staleness. Answering `isWindowPresented()`
 *  needs no timer at all (the frame stamp is compared on demand); this interval
 *  exists only while something subscribes for edges. */
export const PRESENT_CHECK_MS = 400

type Listener = (presented: boolean) => void

const listeners = new Set<Listener>()

let presented = true
let armed = false
let lastFrameAt = 0
let frameHandle: null | number = null
let checkHandle: null | number = null

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function publish(next: boolean): void {
  if (presented === next) {
    return
  }

  presented = next

  for (const listener of [...listeners]) {
    listener(next)
  }
}

function onFrame(): void {
  frameHandle = null
  lastFrameAt = now()
  // Through evaluate(), not straight to true: a frame is strong evidence but
  // not the only evidence, and a document the platform has told us is hidden
  // stays hidden however many frames arrive.
  publish(evaluate())
  scheduleFrame()
}

function scheduleFrame(): void {
  if (frameHandle !== null || !armed || typeof window === 'undefined') {
    return
  }

  frameHandle = window.requestAnimationFrame(onFrame)
}

/** The current answer, computed from the frame stamp — no timer involved. A
 *  hidden document is not presented whatever the frame clock says, which is
 *  the platform telling the truth where it can (minimise on macOS/Windows, and
 *  a window Electron itself hid). */
function evaluate(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false
  }

  return now() - lastFrameAt < PRESENT_STALE_MS
}

function check(): void {
  publish(evaluate())
}

function start(): void {
  if (typeof window === 'undefined' || armed) {
    return
  }

  armed = true
  lastFrameAt = now()
  presented = true
  scheduleFrame()
}

/** Edge notifications need a clock of their own: the whole premise is that no
 *  frame arrives to tell us. Armed only while someone subscribes. */
function startPush(): void {
  if (typeof window === 'undefined' || checkHandle !== null) {
    return
  }

  checkHandle = window.setInterval(check, PRESENT_CHECK_MS)
}

function stop(): void {
  armed = false

  if (checkHandle !== null) {
    window.clearInterval(checkHandle)
    checkHandle = null
  }

  if (frameHandle !== null) {
    window.cancelAnimationFrame(frameHandle)
    frameHandle = null
  }
}

/**
 * Whether the window is being presented. The first call arms the detector and
 * answers `true`: until a frame has had the chance to arrive, the safe answer
 * is the one that does the work.
 */
export function isWindowPresented(): boolean {
  start()
  presented = evaluate()

  return presented
}

/** Subscribe to presentation changes. Arming is one rAF chain plus one 400ms
 *  timer for the whole renderer, so the detector stays armed once anything has
 *  asked rather than restarting per subscriber. */
export function subscribeWindowPresented(listener: Listener): () => void {
  listeners.add(listener)
  start()
  startPush()

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0 && checkHandle !== null) {
      window.clearInterval(checkHandle)
      checkHandle = null
    }
  }
}

/** Test seam: drop all subscribers and return to the "presented" default. */
export function resetWindowPresentedForTests(): void {
  listeners.clear()
  stop()
  presented = true
  lastFrameAt = 0
}
