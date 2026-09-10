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
  // Same three layouts as `lib/display-path`'s home inference; a plugin may
  // import only the SDK, so the rule is restated rather than reused.
  const match = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(cwd)

  return match ? match[1]! : ''
}

export const HERWORK_BUNDLE = 'herwork'

/** The desk's accent seed: a deep teal, unlike Sessions' authored primary and
 *  Bots' purple, so the tab and its chats read as one place at a glance. */
export const HERWORK_ACCENT = '#1f6f5c'

export type HerworkRoute = {
  connectionId: string
  mode: 'local'
  profile: string
  targetProfile: string
  /** Absolute desk path; omitted when the home cannot be derived, in which
   *  case the session opens at the ambient cwd rather than at `/herwork`. */
  cwd?: string
  /** `<desk>/work`: a file the desk's browser downloads lands here, beside
   *  the drafts of the job it was fetched for. */
  downloadDir?: string
  /** `<desk>/inbox`: an OS file dropped into a desk chat is copied here first,
   *  so the agent reads source material from the desk, where the mandate says
   *  it lives, not from a Downloads folder it must not write into. */
  dropDir?: string
  /** The mode bundle the backend prefixes onto the first prompt. */
  bundle: string
}

/** The `+` route for a new desk chat: the local connection on the herwork
 *  profile, at the desk, with the mode bundle; or `null` when no local
 *  connection is known yet. Pure so it is testable; the caller publishes it. */
export function herworkRoute(localConnectionId: null | string | undefined, home = ''): HerworkRoute | null {
  const connectionId = String(localConnectionId ?? '').trim()

  if (!connectionId) {
    return null
  }

  const cwd = herworkDeskCwd(home)

  return {
    connectionId,
    mode: 'local',
    profile: HERWORK_PROFILE,
    targetProfile: HERWORK_PROFILE,
    ...(cwd ? { cwd, downloadDir: `${cwd}/work`, dropDir: `${cwd}/inbox` } : {}),
    bundle: HERWORK_BUNDLE
  }
}
