import { modelPrefsScope } from '@/lib/model-scope'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { storedString } from '@/lib/storage'

// Pre-scoping key: one collapse set shared by every profile. Read-only
// fallback a scope inherits until it is toggled for the first time, so an
// existing layout survives the upgrade.
const LEGACY_STORAGE_KEY = 'hermes.desktop.collapsed-providers'

// Per-scope collapse: `{ "<connection>/<profile>": ["openrouter", ...] }`.
const STORAGE_KEY = 'hermes.desktop.collapsed-providers.by-scope'

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
  Codecs.json(sanitizeByScope)
)

// Read once at load; a scope with no bucket of its own inherits this on every
// render, and localStorage is synchronous.
const LEGACY_COLLAPSED = parseSlugList(storedString(LEGACY_STORAGE_KEY))

function parseSlugList(raw: null | string): null | string[] {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

// Persisted shapes are untrusted: a malformed record reads as "nothing
// collapsed" rather than throwing on module load.
function sanitizeByScope(parsed: unknown): Record<string, string[]> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const out: Record<string, string[]> = {}

  for (const [scope, slugs] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(slugs)) {
      out[scope] = slugs.filter((x): x is string => typeof x === 'string')
    }
  }

  return out
}

/** Collapsed slugs for one scope, inheriting the pre-scoping global set until
 *  that scope is toggled for the first time. */
export function collapsedProvidersForScope(byScope: Record<string, string[]>, scope: string): string[] {
  return byScope[scope] ?? LEGACY_COLLAPSED ?? []
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

export { modelPrefsScope }
