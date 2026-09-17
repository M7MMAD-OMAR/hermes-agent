import { useEffect } from 'react'

import { subscribeWindowReturn } from '@/lib/window-return'
import { refreshActiveProfile } from '@/store/profile'

/**
 * Re-pull the running profile + list on mount, and again whenever the user
 * returns to the window -- a profile created, deleted, or renamed by
 * another surface (Manage Profiles, another window, the CLI) leaves the
 * rail's cached $profiles stale until something re-fetches it. Without this,
 * a deleted profile's square lingers in the rail until the user happens to
 * open Manage Profiles (whose own refresh() call was the only other reader).
 *
 * Cheap and best-effort, riding the shared window-return signal the rest of
 * the sidebar uses (see refreshProjects/refreshProjectTree), so a return
 * costs this one request instead of one per raw focus/visibility event.
 * Extracted into its own hook (rather than left inline in ProfileRail) so the
 * wiring is unit-testable without rendering the whole rail.
 */
export function useProfileRailRefreshOnActive(): void {
  useEffect(() => {
    void refreshActiveProfile()

    return subscribeWindowReturn(() => void refreshActiveProfile())
  }, [])
}
