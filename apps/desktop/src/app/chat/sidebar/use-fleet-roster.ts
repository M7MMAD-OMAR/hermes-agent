import { useEffect } from 'react'

import { subscribeWindowReturn } from '@/lib/window-return'
import { refreshFleetRoster } from '@/store/fleet-roster'

/**
 * Keep the fleet roster fresh for the profile rail while more than one
 * gateway is registered: pull on mount, once per return to the window, and
 * immediately when the connection registry changes. No timer
 * — the multi-connection contract rules out periodic fleet polling from the
 * sidebar, and a 60s stale window in the store absorbs focus churn.
 */
export function useFleetRoster(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    void refreshFleetRoster()

    const offReturn = subscribeWindowReturn(() => void refreshFleetRoster())
    const offRegistry = window.hermesDesktop?.connections?.onChanged?.(() => void refreshFleetRoster({ force: true }))

    return () => {
      offReturn()
      offRegistry?.()
    }
  }, [enabled])
}
