// How tall does the browser assume a turn is, before it has ever rendered one?
//
// Virtualized turns carry `contain-intrinsic-size: auto <fallback>`. The `auto`
// half is exact: once a turn has rendered, the browser remembers its real size
// and the placeholder is the truth. The fallback is what every turn that has
// NEVER rendered gets, and a long transcript is mostly those — open a 200-turn
// session and scroll up and you are scrolling through an estimate.
//
// The estimate used to be a constant 37.5rem. Measured on a real transcript (19
// September 2026) the turns were ~419px against that 600px guess, so the
// scroller claimed 89,646px of content where ~63,000px existed: a scrollbar
// 40% longer than the conversation, a thumb that never matches the distance
// travelled, and every jump-to-position landing short.
//
// A conversation's own turns are the only honest reference, so this measures
// the ones already on screen and hands their median back as the fallback. The
// median, not the mean: one tool-call turn the size of a page would drag an
// average up and put the scrollbar out by more than the constant did.

import { type RefObject, useEffect, useRef } from 'react'

/** The old hard-coded guess, still the answer until a turn has been measured. */
export const TURN_ESTIMATE_FALLBACK_PX = 600

/** Bounds on a published estimate. A collapsed pane measures near zero and a
 *  single enormous turn measures near the document; neither is a fallback that
 *  helps the turns nobody has seen yet. */
export const TURN_ESTIMATE_MIN_PX = 120
export const TURN_ESTIMATE_MAX_PX = 2_000

/** Republish only when the estimate moves this much, relatively. Every change
 *  re-lays-out every skipped turn and moves the scrollbar under the user's
 *  hand, so a few pixels of drift is not worth the jump. */
export const TURN_ESTIMATE_CHANGE_RATIO = 0.2

/** The CSS custom property TurnRow reads for its `contain-intrinsic-size`. */
export const TURN_ESTIMATE_PROPERTY = '--aui-turn-estimate'

/** Rendered turns only: a virtualized one reports the placeholder, so measuring
 *  it would just feed the estimate back to itself. */
export const RENDERED_TURN_SELECTOR = '[data-slot="aui_message-group"][data-virtualized="false"]'

/** The middle height of what is on screen, clamped, or null when there is
 *  nothing measurable (an empty thread, a pane with no layout). */
export function medianTurnHeight(heights: readonly number[]): null | number {
  const usable = heights.filter(height => height > 0).sort((a, b) => a - b)

  if (usable.length === 0) {
    return null
  }

  const middle = usable[(usable.length - 1) >> 1] ?? 0

  return Math.min(TURN_ESTIMATE_MAX_PX, Math.max(TURN_ESTIMATE_MIN_PX, Math.round(middle)))
}

/** True when the difference is worth moving every placeholder for. */
export function worthRepublishing(previous: null | number, next: number): boolean {
  if (previous === null) {
    return true
  }

  return Math.abs(next - previous) / previous > TURN_ESTIMATE_CHANGE_RATIO
}

/**
 * Publish the measured turn height on *contentRef* as a CSS variable.
 *
 * Runs after a paint (the rows have to exist before they can be measured) and
 * only when the row set changes, which is also when a new turn has landed and
 * the estimate could have moved. It reads only rendered rows, so it never
 * forces layout inside content-visibility's skipped subtrees.
 */
export function useTurnSizeEstimate({
  contentRef,
  paneVisible,
  rows
}: {
  contentRef: RefObject<HTMLElement | null>
  paneVisible: boolean
  rows: unknown
}): void {
  const publishedRef = useRef<null | number>(null)

  // eslint-disable-next-line no-restricted-syntax -- the ref holds the last PUBLISHED pixel value, measured from the DOM inside the effect; there is no atom behind it to read instead
  useEffect(() => {
    const content = contentRef.current

    if (!content || !paneVisible || typeof window === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const heights = [...content.querySelectorAll(RENDERED_TURN_SELECTOR)].map(
        row => row.getBoundingClientRect().height
      )

      const estimate = medianTurnHeight(heights)

      if (estimate === null || !worthRepublishing(publishedRef.current, estimate)) {
        return
      }

      publishedRef.current = estimate
      content.style.setProperty(TURN_ESTIMATE_PROPERTY, `${estimate}px`)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [contentRef, paneVisible, rows])
}
