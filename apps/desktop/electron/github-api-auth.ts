// Credentials for the self-update check's api.github.com calls.
//
// The passive check asks the REST API for the branch tip SHA. Unauthenticated
// that budget is 60 requests/hour keyed on the *client IP*, so a shared exit —
// office NAT, VPN, a proxy node many users sit behind — exhausts the bucket for
// everyone on it and the check reports a rate limit that reads as "Hermes can't
// reach the update server". Authenticating moves the caller onto the token's
// 5,000/hour budget.
//
// Two rungs of the Python client's ladder (tools/skills_hub_github.py::
// GitHubAuth) are wired: the environment first (GITHUB_TOKEN, then GH_TOKEN),
// then the `gh` CLI's own login.
//
// The `gh` rung was deliberately left out at first, on the grounds that
// spending a user's CLI login on a background check is a product call. Made
// here, and this is the reasoning: a check runs at most once a day per client,
// so the cost against that token's 5,000/hour budget is a rounding error —
// while without it a machine with `gh` already logged in still reports
// "Hermes couldn't reach the update server" whenever anything else behind the
// same network address has spent the anonymous 60 (measured 19 September 2026
// on a developer machine: several isolated instances launched for testing were
// enough). Nothing is stored: `gh auth token` is asked at most once per
// process and kept in memory, and `HERMES_UPDATE_GH_CLI=0` turns the rung off.

/** Env vars consulted, in precedence order. */
export const GITHUB_TOKEN_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN'] as const

/** Set to 0/false/no/off to keep the update check off the `gh` CLI's login. */
export const GH_CLI_RUNG_ENV_VAR = 'HERMES_UPDATE_GH_CLI'

/** How long `gh auth token` gets. It reads a keyring, normally instantly; a
 *  keyring that stalls must not hold up an update check. */
export const GH_CLI_TIMEOUT_MS = 2_000

/** Reads `gh auth token`, or null when gh is missing, logged out, or slow.
 *  Injected so the resolver below stays a pure unit. */
export type GhTokenReader = () => null | string

/** First non-blank env token, trimmed. A blank value falls through to the next. */
export function githubTokenFromEnv(env: Record<string, string | undefined> = {}): string | null {
  for (const name of GITHUB_TOKEN_ENV_VARS) {
    const value = env[name]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function ghRungEnabled(env: Record<string, string | undefined>): boolean {
  return !['0', 'false', 'no', 'off'].includes((env[GH_CLI_RUNG_ENV_VAR] ?? '').trim().toLowerCase())
}

/**
 * The credential for an api.github.com call: the environment first, then the
 * `gh` CLI's login. Null means call anonymously, which is what happened before
 * either rung existed and is still the answer when neither has anything.
 */
export function resolveGitHubToken(
  env: Record<string, string | undefined> = {},
  readGhToken: GhTokenReader = () => null
): null | string {
  const fromEnv = githubTokenFromEnv(env)

  if (fromEnv || !ghRungEnabled(env)) {
    return fromEnv
  }

  const fromCli = readGhToken()

  return typeof fromCli === 'string' && fromCli.trim() ? fromCli.trim() : null
}

/**
 * Headers for api.github.com. The `token` scheme (not `Bearer`) matches the
 * Python client. Anonymous callers get the base headers untouched: an empty
 * `Authorization` header is a 401, so it must be absent, not blank.
 */
export function githubApiHeaders(base: Record<string, string>, token?: string | null): Record<string, string> {
  const headers = { ...base }

  if (token) {
    headers.Authorization = `token ${token}`
  }

  return headers
}

/**
 * True when api.github.com rejected the env token itself (HTTP 401 on an
 * authenticated call). A stale or revoked GITHUB_TOKEN must not fail the
 * update check closed — the caller retries anonymously, which is exactly what
 * worked before the token was wired in. Anonymous 401s and every other status
 * are not the token's fault and are surfaced as-is.
 */
export function envTokenRejected(error: { statusCode?: number; authenticated?: boolean } | null | undefined): boolean {
  return error?.statusCode === 401 && error?.authenticated === true
}
