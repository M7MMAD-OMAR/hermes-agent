import { Codecs, legacyStringList, persistentAtom } from '@/lib/persisted'

// Pre-scoping key: one collapse set shared by every profile. Read-only
// fallback a scope inherits until it is toggled for the first time, so an
// existing layout survives the upgrade.
const LEGACY_STORAGE_KEY = 'hermes.desktop.collapsed-providers'

// Per-scope collapse: `{ "<backendScopeKey>": ["openrouter", ...] }`.
const STORAGE_KEY = 'hermes.desktop.collapsed-providers.by-scope'

const LEGACY_COLLAPSED = legacyStringList(LEGACY_STORAGE_KEY)

// Returned for a scope with nothing collapsed. A shared frozen array, because
// a fresh literal per call has a new identity every render and would break the
// memo chain of every picker that lists it as a dependency.
const NOTHING_COLLAPSED: readonly string[] = Object.freeze([])

/** Provider slugs whose model groups are collapsed in the model picker, per
 *  (connection, profile) scope. Scoped rather than global because a profile
 *  run as a bot has its own provider: folding away the ones it never uses is
 *  part of pinning that bot, and doing it globally would fold them away for
 *  every other bot too.
 *
 *  We deliberately do NOT prune a scope's set when its catalog changes (key
 *  revoked, Refresh Models). Provider slugs come from a small bounded set, a
 *  dead entry costs a few bytes, and the render loop only visits providers
 *  present in the active groups.
 */
export const $collapsedProvidersByScope = persistentAtom<Record<string, string[]>>(
  STORAGE_KEY,
  {},
  Codecs.stringArrayRecord
)

/** Collapsed slugs for one scope, inheriting the pre-scoping global set until
 *  that scope is toggled for the first time. */
export function collapsedProvidersForScope(
  byScope: Record<string, string[]>,
  scope: string
): readonly string[] {
  return byScope[scope] ?? LEGACY_COLLAPSED ?? NOTHING_COLLAPSED
}

/** Toggle a provider slug in/out of one scope's collapsed set. */
export function toggleCollapsedProvider(scope: string, slug: string): void {
  const byScope = $collapsedProvidersByScope.get()
  const current = collapsedProvidersForScope(byScope, scope)

  $collapsedProvidersByScope.set({
    ...byScope,
    [scope]: current.includes(slug) ? current.filter(s => s !== slug) : [...current, slug]
  })
}
