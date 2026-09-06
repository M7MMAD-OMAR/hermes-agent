/**
 * Which chat the statusbar workspace chip acts on.
 *
 * The chip labels the FOCUSED transcript, so its folder picker has to move that
 * same one. Getting this backwards is silent and destructive: the panel would
 * name one chat's folder while re-homing another chat that is also on screen,
 * and the user would have no way to tell from the menu which one moved.
 *
 * `focusedStoredSessionId` follows the interaction tracker across tiles and is
 * empty only when nothing is focused, which is when the primary view owns the
 * bar. `selectedStoredSessionId` is that primary. A draft has neither, and null
 * leaves the panel read-only rather than moving whatever the gateway last
 * resolved.
 */
export function workspaceMoveTargetSessionId(
  focusedStoredSessionId: null | string | undefined,
  selectedStoredSessionId: null | string | undefined
): null | string {
  return focusedStoredSessionId || selectedStoredSessionId || null
}
