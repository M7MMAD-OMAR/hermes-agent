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
 * The compositor does say one thing truthfully, by not saying it: a surface
 * that is not being presented stops getting `wl_surface.frame` callbacks, and
 * those are what drive `requestAnimationFrame`. A frame is therefore not a
 * heuristic standing in for a real signal, it is the compositor answering
 * through the only channel it uses. A frame proves presentation; a long
 * silence while timers keep firing proves the opposite.
 *
 * **Who needs to ask.** rAF-shaped work does not: a `requestAnimationFrame`
 * loop (everything built on `createBudgetedLoop`) stops dead on its own when
 * the frames stop, which is why the decorative animations were fixed by moving
 * onto that loop rather than by calling in here. Only TIMER-shaped work has to
 * ask — a `setInterval` clock, a `setTimeout` flush floor — because a timer
 * keeps its cadence whatever the compositor is doing.
 *
 * The one false positive worth naming: a main thread blocked for longer than
 * `PRESENT_STALE_MS` starves the probe too, so a very busy visible window can
 * read as not presented. Callers must therefore treat this as a hint for how
 * much COSMETIC work to do (flush cadence, decorative clocks), never as a
 * condition for correctness. The state corrects itself on the next frame.
 */

/** No frame for this long, while timers keep running, means "not presented". */
export const PRESENT_STALE_MS = 1_200

/** How often presentation is probed, and how often the push path re-checks.
 *  The detector PROBES for a frame at this cadence instead of riding every
 *  one: a chain that re-arms inside its own callback is a main-thread task per
 *  vsync for the life of the renderer (240 a second on this workstation's
 *  panel), which is the very cost this module exists to remove elsewhere.
 *  Three probes fit inside `PRESENT_STALE_MS`, so detection latency is
 *  unchanged. */
export const PRESENT_CHECK_MS = 400

type Listener = (presented: boolean) => void

const listeners = new Set<Listener>()

/** The last value handed to listeners: the dedupe for `publish`, and nothing
 *  else. The live answer is always `evaluate()`. */
let lastPublished = true
let armed = false
let lastFrameAt = 0
let lastProbeAt = 0
let frameHandle: null | number = null
let checkHandle: null | number = null

function now(): number {
  return performance.now()
}

/** The current answer, from the frame stamp — no timer involved. A hidden
 *  document is not presented whatever the frame clock says, which is the
 *  platform telling the truth where it can (minimise on macOS/Windows, and a
 *  window Electron itself hid). */
function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function evaluate(): boolean {
  if (documentHidden()) {
    return false
  }

  return now() - lastFrameAt < PRESENT_STALE_MS
}

function publish(next: boolean): void {
  if (lastPublished === next) {
    return
  }

  lastPublished = next

  // An off-screen window should cost zero wakeups, and it can: the frame
  // already requested is parked, it can only fire when the compositor paints
  // again, and it publishes for itself. So the clock stops.
  //
  // Except when the DOCUMENT is the one reporting hidden (a minimise, a window
  // Electron hid). There frames may keep arriving and being discarded, so the
  // parked frame fires, finds `visibilityState` still hidden, and publishes
  // nothing — with the clock stopped, nothing would ever ask again and the
  // window would come back to clocks that never restarted.
  if (next || documentHidden()) {
    startClock()
  } else {
    stopClock()
  }

  for (const listener of [...listeners]) {
    listener(next)
  }
}

/** The frame that proves presentation. A named function so a test that stubs
 *  rAF can tell this probe apart from the frames its own subject scheduled;
 *  see `isPresentationProbeFrame`. */
function presentationProbeFrame(): void {
  frameHandle = null
  lastFrameAt = now()
  publish(evaluate())
}

/** True for the callback this module schedules. Exported so a test filters on
 *  a real reference instead of a copied string. */
export function isPresentationProbeFrame(callback: unknown): boolean {
  return typeof callback === 'function' && callback.name === presentationProbeFrame.name
}

/** Ask for one frame, at most one per `PRESENT_CHECK_MS`. A request left
 *  pending while the window is away costs nothing and is exactly what fires on
 *  the way back in. */
function probe(): void {
  if (frameHandle !== null || !armed || typeof window === 'undefined') {
    return
  }

  const at = now()

  if (at - lastProbeAt < PRESENT_CHECK_MS) {
    return
  }

  lastProbeAt = at
  frameHandle = window.requestAnimationFrame(presentationProbeFrame)
}

function tick(): void {
  probe()
  publish(evaluate())
}

function startClock(): void {
  if (typeof window === 'undefined' || checkHandle !== null || listeners.size === 0) {
    return
  }

  checkHandle = window.setInterval(tick, PRESENT_CHECK_MS)
}

function stopClock(): void {
  if (checkHandle !== null) {
    window.clearInterval(checkHandle)
    checkHandle = null
  }
}

function start(): void {
  if (typeof window === 'undefined' || armed) {
    return
  }

  armed = true
  lastFrameAt = now()
  lastPublished = true
}

/**
 * Whether the window is being presented. The first call arms the detector and
 * answers `true`: until a frame has had the chance to arrive, the safe answer
 * is the one that does the work. Cheap enough for a scheduling path — a
 * timestamp compare plus, at most every `PRESENT_CHECK_MS`, one frame request.
 */
export function isWindowPresented(): boolean {
  start()
  probe()

  return evaluate()
}

/** Subscribe to presentation changes. Edges need a clock of their own, since
 *  the premise is that no frame arrives to announce the bad news; it runs only
 *  while someone is listening, and only while the window is up. */
export function subscribeWindowPresented(listener: Listener): () => void {
  listeners.add(listener)
  start()
  probe()
  startClock()

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      stopClock()
    }
  }
}

/** Test seam: drop every subscriber, cancel the probe, and return to the
 *  "presented until proven otherwise" default. */
export function resetWindowPresentedForTests(): void {
  listeners.clear()
  stopClock()

  if (frameHandle !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(frameHandle)
  }

  frameHandle = null
  armed = false
  lastProbeAt = 0
}
