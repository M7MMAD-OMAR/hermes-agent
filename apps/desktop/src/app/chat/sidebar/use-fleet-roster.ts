import { useEffect } from 'react'

import { subscribeWindowReturn } from '@/lib/window-return'
import { refreshFleetRoster } from '@/store/fleet-roster'
import { $gatewayState } from '@/store/session'

/**
 * Keep the fleet roster fresh for the profile rail while more than one
 * gateway is registered: pull on mount, once per return to the window,
 * immediately when the connection registry changes, and when the gateway
 * (re)opens. No timer: the multi-connection contract rules out periodic fleet
 * polling from the sidebar, and a 60s stale window in the store absorbs focus
 * churn.
 *
 * The open edge matters on a cold start: the first pull races `gateway
 * ensure`, whose boot outlives the roster's per-source deadline, so This
 * device enumerates as unreachable (one square instead of its profiles) and
 * nothing else would ask again until a window focus.
 */
export function useFleetRoster(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    void refreshFleetRoster()

    const offReturn = subscribeWindowReturn(() => void refreshFleetRoster())
    const offRegistry = window.hermesDesktop?.connections?.onChanged?.(() => void refreshFleetRoster({ force: true }))
    let wasOpen = $gatewayState.get() === 'open'

    const offGateway = $gatewayState.listen(state => {
      const open = state === 'open'

      if (open && !wasOpen) {
        void refreshFleetRoster({ force: true })
      }

      wasOpen = open
    })

    return () => {
      offReturn()
      offRegistry?.()
      offGateway()
    }
  }, [enabled])
}
