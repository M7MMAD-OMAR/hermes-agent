import { type RefObject, useCallback, useLayoutEffect, useState } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'
import { $connection } from '@/store/session'

/** The window-chrome inputs that move the fixed titlebar clusters without
 *  changing their size (macOS fullscreen hides the traffic lights → the left
 *  cluster pins to the window edge). */
function chromeKey(): string {
  const connection = $connection.get()
  const position = connection?.windowButtonPosition

  return `${connection?.isFullscreen ? 1 : 0}:${position?.x ?? ''}:${position?.y ?? ''}`
}

/** Reserve actual chrome intersections, including after a neighbor becomes a rail. */
export function usePanelTitlebar(ref: RefObject<HTMLElement | null>, enabled: boolean, minimized: boolean) {
  const [belowControls, setBelowControls] = useState(true)

  const measure = useCallback(() => {
    const element = ref.current

    if (!enabled || !element) {
      return
    }

    const rect = element.getBoundingClientRect()

    if (!rect.width) {
      return
    }

    const leftControls = document.querySelector<HTMLElement>('[data-titlebar-cluster="left"]')?.getBoundingClientRect()

    const rightControls = document
      .querySelector<HTMLElement>('[data-titlebar-cluster="right"]')
      ?.getBoundingClientRect()

    // Empty chrome during a route overlay retains the last safe reservation.
    if (!leftControls || !rightControls) {
      return
    }

    const left = Math.min(rect.width, Math.max(0, leftControls.right + 12 - rect.left))
    const right = Math.min(rect.width - left, Math.max(0, rect.right - rightControls.left + 24))
    element.style.setProperty('--panel-titlebar-left', `${left}px`)
    element.style.setProperty('--panel-titlebar-right', `${right}px`)
    // A STRIP TOO NARROW TO NAME ITS TABS DROPS BELOW THE CONTROLS. Sharing
    // the window-control band costs a zone everything the clusters reserve,
    // and what is left over in a side rail is not enough for three tabs to say
    // what they are: at 120 the sessions rail kept its tabs up here and showed
    // "Ses..." / "Bots" / "Her...". Below the controls the strip gets the
    // zone's full width, which is where the files rail already renders and
    // reads cleanly. The floor is the room three readable tabs need, not the
    // room one tab needs to exist.
    setBelowControls(minimized || rect.width - left - right < 200)
  }, [enabled, minimized, ref])

  useResizeObserver(measure, ref)
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }

    measure()
    const observer = new ResizeObserver(measure)

    for (const element of document.querySelectorAll('[data-titlebar-cluster], [data-tree-group]')) {
      observer.observe(element)
    }

    window.addEventListener('resize', measure)

    // A fullscreen transition first fires `resize` (measured against the
    // pre-transition cluster) and only then lands the window-state IPC that
    // translates the fixed clusters — same size, new position — so neither
    // ResizeObserver nor `resize` re-runs. Re-measure after the frame that
    // repaints the clusters from the new chrome vars.
    let lastChrome = chromeKey()
    let frame = 0
    const unsubscribeChrome = $connection.subscribe(() => {
      const nextChrome = chromeKey()

      if (nextChrome === lastChrome) {
        return
      }

      lastChrome = nextChrome
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(measure)
      })
    })

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      unsubscribeChrome()
      cancelAnimationFrame(frame)
    }
  }, [enabled, measure])

  return enabled && belowControls
}
