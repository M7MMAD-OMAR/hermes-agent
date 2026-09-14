/**
 * Fail-closed owner resolution for session-scoped RPCs.
 *
 * A request that carries a `session_id` only means anything on the backend
 * that OWNS that session. When every rung of the owner ladder (tile route →
 * exact owner hint → connection-tagged / profiled row → cross-profile REST
 * probe) misses, the request must NOT quietly ride the ambient presentation
 * gateway: "active" is presentation state with no routing authority, and an
 * ambient fallback turns missing ownership metadata into a misleading backend
 * "session not found" (or, worse, an answer from a backend that merely happens
 * to know a same-named session). Surface an explicit owner-resolution error
 * instead — the caller's error UX shows it, and the runtime that minted the
 * session is left untouched for the next correctly-routed attempt.
 *
 * The ONE case where the ambient gateway is not a fallback but the owner by
 * construction: no registry topology exists (legacy v1 primary) AND at most
 * one profile exists — a single backend serves every session, so there is
 * nothing to misroute to. Older single-profile backends omit `profile` on
 * their rows entirely; those users keep working unchanged.
 */
import { hasRegistryTopology } from './connection-registry-state'
import { $profiles } from './profile'
import { isSessionOwnerRoute, type SessionOwnerScope } from './session-request-router'

export class SessionOwnerResolutionError extends Error {
  constructor(
    readonly sessionId: string,
    readonly method: string
  ) {
    super(
      `Session owner could not be resolved for "${sessionId}" (${method}): ` +
        'no owner route, hint, connection-tagged row or profile probe named the backend that holds this session, ' +
        'and routing it to the active gateway would be a guess.'
    )
    this.name = 'SessionOwnerResolutionError'
  }
}

export function isSessionOwnerResolutionError(error: unknown): error is SessionOwnerResolutionError {
  return (
    error instanceof SessionOwnerResolutionError ||
    (error as { name?: unknown })?.name === 'SessionOwnerResolutionError'
  )
}

/** True when the ambient gateway is provably the only backend any session
 *  can live on (legacy single-backend Desktop): Electron has published no
 *  connection registry and there is at most one profile. The active route is
 *  presentation state; a null active connection does not prove sole topology. */
export function ambientGatewayOwnsEverySession(): boolean {
  return !hasRegistryTopology() && $profiles.get().length <= 1
}

/** True when `owner` names a backend: an exact connection route, or a bare
 *  profile. A bare profile stays an owner in registry topology too — a profile
 *  pick on the primary or the explicit `local` source takes the legacy
 *  profile-only door (store/profile activateOnCurrentSource, so a per-profile
 *  remote override resolves), and a session minted there is owned by that
 *  profile's pool socket, which requestForSessionProfile dials by name. */
export function sessionOwnerIsKnown(owner: SessionOwnerScope): boolean {
  if (isSessionOwnerRoute(owner)) {
    return Boolean(owner.connectionId.trim())
  }

  return owner != null && Boolean(String(owner).trim())
}

/**
 * Gate before a session-scoped RPC falls to the ambient dispatcher. Throws
 * SessionOwnerResolutionError when the session's owner is unknown and the
 * ambient gateway is not the sole backend; otherwise returns normally.
 */
export function assertSessionOwnerResolved(
  owner: SessionOwnerScope,
  context: { method: string; sessionId: null | string | undefined }
): void {
  if (!context.sessionId || sessionOwnerIsKnown(owner) || ambientGatewayOwnsEverySession()) {
    return
  }

  throw new SessionOwnerResolutionError(context.sessionId, context.method)
}

/**
 * ASYNC last rung of the owner ladder, registered by the app layer.
 *
 * The sync ladder (tile route, hint, row, runtime ledger) only ever sees rows
 * the sidebar already loaded, and that listing is a PAGE: recents are capped
 * and scoped to one profile, so a conversation older than the window (or newer
 * than the next list refresh) carries no row at all. The window's own
 * dispatcher already covers that with a by-id REST probe across profiles
 * (resolveSessionOwner), but every caller that goes through
 * requestForOwnedSession skipped it and failed closed instead, which is how a
 * plain conversation open raised "Session owner could not be resolved" for a
 * background `session.control.read` on a multi-profile install.
 *
 * The store cannot import the app-layer resolver without a cycle, so the app
 * registers it here. Registration is optional: with no probe the ladder keeps
 * its previous fail-closed behavior.
 */
export type SessionOwnerProbe = (storedSessionId: string) => Promise<SessionOwnerScope>

let sessionOwnerProbe: null | SessionOwnerProbe = null
const probesInFlight = new Map<string, Promise<SessionOwnerScope>>()

// A probe that named nobody is remembered briefly. Background pollers
// (processes, controls) re-ask for the same session on a timer, and a session
// no backend can claim would otherwise pay a cross-profile REST sweep on every
// tick. Short enough that a genuinely late binding is picked up on the next
// window; a session whose row or hint arrives meanwhile never reaches here,
// because the sync ladder resolves it first.
const PROBE_MISS_TTL_MS = 30_000
const probeMisses = new Map<string, number>()

export function setSessionOwnerProbe(probe: null | SessionOwnerProbe): void {
  sessionOwnerProbe = probe
  probesInFlight.clear()
  probeMisses.clear()
}

/**
 * Probe the owner of `storedSessionId`, one flight per id: a session opening
 * fires several session-scoped RPCs at once (controls, background processes,
 * goal), and each of them missing the sync ladder must not cost its own
 * cross-profile REST sweep. Failures resolve to undefined so the caller's
 * fail-closed assertion, not this rung, decides what the user sees.
 */
export async function probeSessionOwner(storedSessionId: null | string | undefined): Promise<SessionOwnerScope> {
  const probe = sessionOwnerProbe

  if (!probe || !storedSessionId) {
    return undefined
  }

  const pending = probesInFlight.get(storedSessionId)

  if (pending) {
    return pending
  }

  const missedAt = probeMisses.get(storedSessionId)

  if (missedAt !== undefined) {
    if (Date.now() - missedAt < PROBE_MISS_TTL_MS) {
      return undefined
    }

    probeMisses.delete(storedSessionId)
  }

  const flight = probe(storedSessionId)
    .catch(() => undefined)
    .then(owner => {
      if (owner === undefined || owner === null) {
        probeMisses.set(storedSessionId, Date.now())
      }

      return owner
    })
    .finally(() => probesInFlight.delete(storedSessionId))

  probesInFlight.set(storedSessionId, flight)

  return flight
}
