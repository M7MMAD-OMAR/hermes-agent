// ── Which "bot" a model preference belongs to ───────────────────────────────
// Model curation (Edit Models) and provider collapse are per-profile: someone
// running a profile as a bot wants that bot pinned to its own provider, and
// tidying its menu must not retune every other bot's menu. A profile name is
// only unique inside one registry connection, so a remote connection's profile
// carries its connection id in the scope.

/** Scope key for a (connection, profile) pair. `default` for the unnamed
 *  profile, so a single-profile install keeps one stable bucket. */
export function modelPrefsScope(profile?: null | string, ownerConnectionId?: null | string): string {
  const name = (profile ?? '').trim().toLowerCase() || 'default'
  const connection = (ownerConnectionId ?? '').trim().toLowerCase()

  return connection ? `${connection}/${name}` : name
}
