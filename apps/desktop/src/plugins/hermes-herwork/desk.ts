/**
 * The desk: one fixed owner, one fixed cwd, one fixed profile.
 *
 * Owner keys are opaque exact strings that nothing parses (workspace-scope.ts
 * header), so this is a constant, not a format. If a second desk is ever
 * wanted, this becomes a per-desk value and the plugin grows a picker; nothing
 * in core changes.
 *
 * Three things here are the desk's existence conditions rather than its shape,
 * and each of them used to be assumed rather than established: the profile the
 * desk routes to, the home the desk sits under, and the skill bundle the first
 * prompt is prefixed with. A machine that has never run this plugin has none
 * of the three.
 */

import { host } from '@hermes/plugin-sdk'

export const HERWORK_OWNER_KEY = 'herwork:desk'
export const HERWORK_PROFILE = 'herwork'

/** The separator a path is already written with.
 *
 *  A cwd reaches the renderer as a string, from this machine or from a remote
 *  one, so the platform this code runs on says nothing about which separator
 *  belongs in it. Joining a Windows home with a forward slash produced
 *  `C:\\Users\\ada/herwork`, which every path comparison in the app treats as a
 *  different directory from the one the desk actually opens at. */
function separatorOf(base: string): string {
  return base.includes('\\') && !base.includes('/') ? '\\' : '/'
}

/** Join a path segment onto a base, in the base's own separator. */
export function deskPathJoin(base: string, segment: string): string {
  return `${base}${separatorOf(base)}${segment}`
}

/** Absolute, never `~`: renderer stores compare cwd paths literally and the
 *  backend expands `~` only on its own side (design doc, Part 3). Empty home
 *  yields '' so a caller can fall back rather than build `/herwork`. */
export function herworkDeskCwd(home: string): string {
  const base = home.replace(/[\\/]+$/, '')

  return base ? deskPathJoin(base, 'herwork') : ''
}

/** Where home directories live, as a prefix pattern per layout.
 *
 *  `$HOME` is not exposed to the renderer, and a remote cwd's home is not this
 *  machine's home even when it is, so the home is read out of the cwd itself.
 *  The list is the shape of the answer: every layout missing from it is a user
 *  whose desk silently falls back to the ambient directory. `/var/home` is
 *  ostree (Fedora Silverblue, Bluefin); `/root` is a container or a login as
 *  root, where the home has no user segment at all. */
const HOME_LAYOUTS = /^(\/(?:var\/)?home\/[^/]+|\/Users\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/

/** The home directory the given cwd sits under, or '' when it sits outside
 *  one. A cwd outside a home directory (or empty) yields ''. */
export function homeOf(cwd: string): string {
  return HOME_LAYOUTS.exec(cwd)?.[1] ?? ''
}

/** The real home directory, as Electron reports it (`app.getPath('home')`,
 *  surfaced through the default-project-dir setting), cached for the window.
 *
 *  `homeOf(cwd)` is a guess about someone else's disk layout, and it is wrong
 *  for every user whose projects live outside a home directory: `/opt`,
 *  `/srv`, `/mnt/data` and `/workspace` all answer '', which drops `cwd`,
 *  `downloadDir` and `dropDir` from the route and leaves the desk pointing at
 *  whichever project happened to be open last. The shell knows the answer, so
 *  ask it and keep the pattern match only for the cases where there is no
 *  shell to ask: a plain browser, or a build that predates the setting. */
let reportedHome = ''
let homeFlight: Promise<string> | null = null

/** The desk's home without waiting: the reported one when it has landed, else
 *  the cwd guess. Callers that publish a route synchronously need this; they
 *  should also `primeDeskHome()` and republish when the answer changes. */
export function deskHome(cwd = ''): string {
  return reportedHome || homeOf(cwd)
}

/** Ask the shell for the home directory, once per window. Resolves to '' when
 *  there is nothing to ask, which is the signal to keep guessing. */
export function primeDeskHome(): Promise<string> {
  homeFlight ??= Promise.resolve(window.hermesDesktop?.settings?.getDefaultProjectDir?.())
    .then(settings => {
      reportedHome = String(settings?.defaultLabel ?? '').trim()

      return reportedHome
    })
    .catch(() => '')

  return homeFlight
}

/** Drop the cached home. Test seam: the cache is per-window in the app, and a
 *  suite that drives several shells needs each one answered afresh. */
export function resetDeskHome(): void {
  reportedHome = ''
  homeFlight = null
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
    ...(cwd ? { cwd, downloadDir: deskPathJoin(cwd, 'work'), dropDir: deskPathJoin(cwd, 'inbox') } : {}),
    bundle: HERWORK_BUNDLE
  }
}

/** What the desk profile is for, as `hermes profile list` will show it. */
const HERWORK_PROFILE_DESCRIPTION = 'The HerWork desk: jobs handed over here deliver finished files.'

/** Nothing else creates the desk profile, and a session on a profile that is
 *  not there fails the spawn with `FileNotFoundError: Profile 'herwork' does
 *  not exist`, so on a fresh machine both `+` doors were dead and silent.
 *
 *  Single-flighted at module level because there are two of those doors: the
 *  tab bar's `+`, which consumes the route the plugin publishes and is not
 *  ours to intercept, and the pane's own button. A settled failure clears the
 *  slot so a later click retries; a success is kept, so at most one
 *  `profiles.create` ever goes out per window. */
let profileFlight: Promise<void> | null = null

/** An error from a create that lost a race with another window (or with the
 *  user's own `hermes profile create`). The profile exists, which is all the
 *  caller asked for. */
function alreadyExists(error: unknown): boolean {
  return /exists|already/i.test(error instanceof Error ? error.message : String(error))
}

async function createDeskProfile(): Promise<void> {
  const listed = await host.request<{ profiles?: { name?: string }[] }>('profiles.list', { include_sessions: false })

  const known = (listed?.profiles ?? []).some(
    row => String(row?.name ?? '').trim().toLowerCase() === HERWORK_PROFILE
  )

  if (known) {
    return
  }

  try {
    // On the LIVE gateway, never on the desk route: routing a create to
    // `herwork` dials a backend for the profile being born and fails with the
    // very error this is here to prevent.
    await host.request('profiles.create', { name: HERWORK_PROFILE, description: HERWORK_PROFILE_DESCRIPTION })
  } catch (error) {
    if (!alreadyExists(error)) {
      throw error
    }
  }
}

/** Make sure the desk profile exists before anything routes a chat to it. */
export function ensureHerworkProfile(): Promise<void> {
  profileFlight ??= createDeskProfile().catch(error => {
    profileFlight = null

    throw error
  })

  return profileFlight
}

/** Forget the in-flight profile check. Test seam, like `resetDeskHome`. */
export function resetHerworkProfileFlight(): void {
  profileFlight = null
}

/** Does the desk's skill bundle resolve on the desk profile's backend?
 *
 *  The route names `herwork` as its bundle and the backend prefixes the first
 *  prompt of every desk chat with it, but bundles are user data under
 *  `<HERMES_HOME>/skill-bundles/` and the repo ships none. A bundle that does
 *  not resolve is a debug log on the backend and nothing at all here, so the
 *  desk mandate the whole workspace is built around silently vanishes from
 *  every chat on a fresh machine. `complete.slash` is the one door that reads
 *  the bundle registry, so ask it. */
async function deskBundleResolves(route: HerworkRoute): Promise<boolean> {
  const reply = await host.requestProfile<{ items?: { text?: string }[] }>(route, 'complete.slash', {
    text: `/${HERWORK_BUNDLE}`
  })

  return (reply?.items ?? []).some(
    item =>
      String(item?.text ?? '')
        .trim()
        .split(/\s+/)[0]
        ?.replace(/^\//, '')
        .toLowerCase() === HERWORK_BUNDLE
  )
}

/** One notice per window, and only once the answer is actually known. */
let bundleChecked = false

/** Say so, once, when the desk bundle is missing. Called after the chat is
 *  already open: a slow or unreachable probe must cost the user nothing, and a
 *  probe that could not run is not evidence of anything, so it leaves the door
 *  open for the next attempt. */
export async function warnOnMissingDeskBundle(route: HerworkRoute): Promise<void> {
  if (bundleChecked) {
    return
  }

  bundleChecked = true

  try {
    if (await deskBundleResolves(route)) {
      return
    }
  } catch {
    bundleChecked = false

    return
  }

  host.notify({
    kind: 'warning',
    title: 'The HerWork desk bundle is not installed',
    message: `Desk chats run without the desk mandate until a "${HERWORK_BUNDLE}" bundle exists.`,
    detail: `Create <HERMES_HOME>/skill-bundles/${HERWORK_BUNDLE}.yaml listing the skills the desk should load, then install the herwork skill with: hermes skills install ${HERWORK_BUNDLE}`
  })
}

/** Forget that the bundle notice was shown. Test seam, like `resetDeskHome`. */
export function resetDeskBundleCheck(): void {
  bundleChecked = false
}
