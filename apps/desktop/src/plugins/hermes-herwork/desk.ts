/**
 * The desk: one fixed owner, one fixed cwd, one fixed profile.
 *
 * Owner keys are opaque exact strings that nothing parses (workspace-scope.ts
 * header), so this is a constant, not a format. If a second desk is ever
 * wanted, this becomes a per-desk value and the plugin grows a picker; nothing
 * in core changes.
 */

export const HERWORK_OWNER_KEY = 'herwork:desk'
export const HERWORK_PROFILE = 'herwork'

/** Absolute, never `~`: renderer stores compare cwd paths literally and the
 *  backend expands `~` only on its own side (design doc, Part 3). Empty home
 *  yields '' so a caller can fall back rather than build `/herwork`. */
export function herworkDeskCwd(home: string): string {
  const base = home.replace(/[\\/]+$/, '')

  return base ? `${base}/herwork` : ''
}

/** `$HOME` is not exposed to the renderer; the desk lives under the same home
 *  the given cwd does. A cwd outside a home directory (or empty) yields ''. */
export function homeOf(cwd: string): string {
  const match = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(cwd)

  return match ? match[1]! : ''
}

export type HerworkRoute = {
  connectionId: string
  mode: 'local'
  profile: string
  targetProfile: string
}

/** The `+` route for a new desk chat: the local connection on the herwork
 *  profile, or `null` when no local connection is known yet. Pure so it is
 *  testable; the caller decides how to publish it. */
export function herworkRoute(localConnectionId: null | string | undefined): HerworkRoute | null {
  const connectionId = String(localConnectionId ?? '').trim()

  return connectionId
    ? { connectionId, mode: 'local', profile: HERWORK_PROFILE, targetProfile: HERWORK_PROFILE }
    : null
}
