import { useEffect, useRef } from 'react'

import { isWindowPresented, subscribeWindowPresented } from '@/lib/window-presented'

/** Run a UI-only clock while this document is actually being viewed.
 *
 * "Viewed" used to mean visible AND focused, because visibility alone lies:
 * macOS can leave an occluded window `visible`, and active streaming
 * deliberately disables Chromium's background timer throttling. Focus was the
 * honest half of that pair and the wrong half. On a second monitor a window
 * keeps showing its pixels after the user clicks something else, so pairing
 * with focus froze every elapsed counter the moment attention moved: the turn
 * timer, the subagent list, the status bar duration all stopped in plain sight
 * and jumped forward when the window was clicked again.
 *
 * Presentation is the honest signal (see lib/window-presented): a window whose
 * frames have stopped is off screen and its clocks can park, a window still
 * being painted keeps counting whether or not anyone has focused it. A leading
 * tick on return catches the label up immediately.
 */
export function useViewedInterval(callback: () => void, intervalMs: number, enabled = true): void {
  const callbackRef = useRef(callback)

  // eslint-disable-next-line no-restricted-syntax -- latest-callback ref avoids restarting the interval each render
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let intervalId: null | number = null

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const sync = (presented: boolean) => {
      if (!presented) {
        stop()

        return
      }

      if (intervalId === null) {
        callbackRef.current()
        intervalId = window.setInterval(() => callbackRef.current(), intervalMs)
      }
    }

    const unsubscribe = subscribeWindowPresented(sync)

    sync(isWindowPresented())

    return () => {
      unsubscribe()
      stop()
    }
  }, [enabled, intervalMs])
}
