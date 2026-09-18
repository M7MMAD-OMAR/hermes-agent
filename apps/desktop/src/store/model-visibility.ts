import type { ModelOptionProvider } from '@hermes/shared'
import { atom } from 'nanostores'

import { Codecs, legacyStringList, persistentAtom } from '@/lib/persisted'

// Pre-scoping key: ONE curation shared by every profile. Kept as a read-only
// fallback that never expires: a scope inherits it until that scope is edited
// for the first time, at which point the scope writes its own bucket and stops
// reading this. Not a one-time migration, so a profile created later still
// starts from the list the user had before scoping existed.
const LEGACY_STORAGE_KEY = 'hermes.desktop.visible-models'

// Per-scope curation: `{ "<backendScopeKey>": ["provider::model", ...] }`.
const STORAGE_KEY = 'hermes.desktop.visible-models.by-scope'

/** Models shown per provider in the status-bar dropdown before the user has
 *  customized the list. Backend `models` are already relevance-ordered. */
export const DEFAULT_VISIBLE_PER_PROVIDER = 50

/** Stable key for a provider/model pair (`::` avoids colliding with model ids
 *  that contain a single colon, e.g. `model:tag`). */
export const modelVisibilityKey = (provider: string, model: string): string => `${provider}::${model}`

/** Sentinel key suffix stored when the user explicitly hides ALL models for a
 *  provider.  Distinguishes "user hid everything" from "never customized" so
 *  `effectiveVisibleKeys` does not re-add defaults for that provider. */
export const EMPTY_PROVIDER_SENTINEL = ''

/** Build the sentinel key for a provider whose last model was toggled off. */
export const emptyProviderSentinelKey = (provider: string): string =>
  modelVisibilityKey(provider, EMPTY_PROVIDER_SENTINEL)

/** Check whether a stored key is a provider-hidden sentinel. */
export const isProviderSentinel = (key: string): boolean => key.endsWith('::')

/** A model and its optional `…-fast` sibling, collapsed into one logical row.
 *  `id` is the canonical (base) model; `fastId` is the fast variant if present. */
export interface ModelFamily {
  fastId: string | null
  id: string
}

/** Collapse a provider's model list so a base model and its `…-fast` variant
 *  become a single family (one row, one toggle). Order is preserved by the
 *  base model's position. A `…-fast` model with no base stands on its own. */
export function collapseModelFamilies(models: readonly string[]): ModelFamily[] {
  const present = new Set(models)
  const families: ModelFamily[] = []
  const consumed = new Set<string>()

  for (const model of models) {
    if (consumed.has(model)) {
      continue
    }

    if (/-fast$/i.test(model) && present.has(model.replace(/-fast$/i, ''))) {
      // Represented by its base entry — the base attaches it as `fastId`.
      continue
    }

    if (/-\d{8}$/.test(model) && present.has(model.replace(/-\d{8}$/, ''))) {
      // A date-pinned snapshot superseded by its rolling alias — drop the dupe.
      continue
    }

    const fastId = `${model}-fast`
    const hasFast = present.has(fastId)
    families.push({ fastId: hasFast ? fastId : null, id: model })
    consumed.add(model)

    if (hasFast) {
      consumed.add(fastId)
    }
  }

  return families
}

const LEGACY_VISIBLE = legacyStringList(LEGACY_STORAGE_KEY)

/** Curation per (connection, profile) scope. Read through
 *  `visibleModelsForScope` rather than directly: a scope with no entry of its
 *  own still inherits the pre-scoping global list. */
export const $visibleModelsByScope = persistentAtom<Record<string, string[]>>(
  STORAGE_KEY,
  {},
  Codecs.stringArrayRecord
)

export const $modelVisibilityOpen = atom(false)

/** Which catalog owner the Edit Models dialog should edit while it is open.
 *  A menu mounted for another bot (a kanban tile, a secondary pane) must not
 *  hand its Edit Models click to the app's own profile, or a toggle lands on
 *  the wrong bot's shortlist. Null falls back to the host surface's profile. */
export const $modelVisibilityTarget = atom<null | { ownerConnectionId?: string; profile: string }>(null)

/** Explicit set of visible `provider::model` keys for one scope, or null when
 *  that scope was never customized, in which case the curated default applies. */
export function visibleModelsForScope(byScope: Record<string, string[]>, scope: string): null | Set<string> {
  const own = byScope[scope]

  if (own) {
    return new Set(own)
  }

  return LEGACY_VISIBLE ? new Set(LEGACY_VISIBLE) : null
}

export function setVisibleModels(scope: string, keys: Set<string>): void {
  $visibleModelsByScope.set({ ...$visibleModelsByScope.get(), [scope]: [...keys] })
}

/** Toggle one model in a scope, reading the live set so two clicks landing
 *  before a re-render compose instead of the first being lost. */
export function toggleModelInScope(
  scope: string,
  providers: readonly ModelOptionProvider[],
  providerSlug: string,
  model: string
): void {
  setVisibleModels(scope, toggleModelVisibility(visibleModelsForScope($visibleModelsByScope.get(), scope), providers, providerSlug, model))
}

/** Flip a provider's master switch in a scope. Live read, as above. */
export function setProviderVisibleInScope(
  scope: string,
  providers: readonly ModelOptionProvider[],
  providerSlug: string,
  visible: boolean
): void {
  setVisibleModels(scope, setProviderVisibility(visibleModelsForScope($visibleModelsByScope.get(), scope), providers, providerSlug, visible))
}

export function setModelVisibilityOpen(
  open: boolean,
  target?: { ownerConnectionId?: string; profile: string }
): void {
  $modelVisibilityTarget.set(open ? (target ?? null) : null)
  $modelVisibilityOpen.set(open)
}

/** The default-visible key set: the curated top-N per provider. Used both as
 *  the dropdown fallback and to seed the Edit Models dialog. */
export function defaultVisibleKeys(providers: readonly ModelOptionProvider[]): Set<string> {
  const keys = new Set<string>()

  for (const provider of providers) {
    expandProviderDefaults(provider, keys)
  }

  return keys
}

/** Add a provider's curated default model keys to `target`. Prefers the
 *  backend's `featured_models` shortlist (one flagship per lab) for aggregator
 *  providers that would otherwise flood the default view with dozens of models;
 *  falls back to the top-N collapsed families when a provider ships no featured
 *  list. Shared by `defaultVisibleKeys` and `resolveVisibleKeys` so the
 *  expansion rule lives in exactly one place. */
function expandProviderDefaults(provider: ModelOptionProvider, target: Set<string>): void {
  const families = collapseModelFamilies(provider.models ?? [])

  const featured = provider.featured_models ?? []

  const defaults = featured.length
    ? families.filter(family => featured.includes(family.id))
    : families.slice(0, DEFAULT_VISIBLE_PER_PROVIDER)

  for (const family of defaults) {
    target.add(modelVisibilityKey(provider.slug, family.id))
  }
}

/** Resolve the canonical working set: the user's stored keys plus the curated
 *  default expansion for any provider they haven't customized. Hide-all
 *  sentinels are PRESERVED here — this is the set the toggle handler mutates and
 *  persists, so dropping a sentinel would silently re-enable a provider the user
 *  emptied. Use `effectiveVisibleKeys` for display (sentinels stripped). */
export function resolveVisibleKeys(stored: Set<string> | null, providers: readonly ModelOptionProvider[]): Set<string> {
  if (!stored) {
    return defaultVisibleKeys(providers)
  }

  if (stored.size === 0) {
    return new Set()
  }

  const next = new Set(stored)

  for (const provider of providers) {
    const providerPrefix = `${provider.slug}::`

    const hasStoredProvider = [...stored].some(key => key.startsWith(providerPrefix) && !isProviderSentinel(key))

    const hasSentinel = stored.has(emptyProviderSentinelKey(provider.slug))

    if (hasStoredProvider || hasSentinel) {
      continue
    }

    expandProviderDefaults(provider, next)
  }

  return next
}

/** Resolve which keys are currently visible for DISPLAY: the resolved working
 *  set with bookkeeping sentinels stripped (they are not real models). */
export function effectiveVisibleKeys(
  stored: Set<string> | null,
  providers: readonly ModelOptionProvider[]
): Set<string> {
  const next = resolveVisibleKeys(stored, providers)

  // Strip sentinel keys — they are bookkeeping, not real visibility entries.
  for (const key of [...next]) {
    if (isProviderSentinel(key)) {
      next.delete(key)
    }
  }

  return next
}

/** Compute the next persisted visibility set when one model row is toggled.
 *  Seeds from `resolveVisibleKeys` (NOT `effectiveVisibleKeys`) so other
 *  providers' hide-all sentinels survive the persist. When the last visible
 *  model of a provider is toggled off, a sentinel records the explicit
 *  hide-all; re-enabling a model clears THAT provider's sentinel (only). */
export function toggleModelVisibility(
  stored: Set<string> | null,
  providers: readonly ModelOptionProvider[],
  providerSlug: string,
  model: string
): Set<string> {
  // `resolveVisibleKeys` always returns a fresh Set, so we can mutate it directly.
  const next = resolveVisibleKeys(stored, providers)
  const key = modelVisibilityKey(providerSlug, model)
  const sentinel = emptyProviderSentinelKey(providerSlug)

  if (next.has(key)) {
    next.delete(key)

    // Check if this was the last real model for this provider.
    const remainingForProvider = [...next].some(k => k.startsWith(`${providerSlug}::`) && !isProviderSentinel(k))

    if (!remainingForProvider) {
      next.add(sentinel)
    }
  } else {
    // Re-enabling promotes a previously hidden-all provider to an explicit
    // set of exactly the one re-enabled model — the curated defaults are NOT
    // restored. Intentional: "you hid everything, you get back only what you
    // re-enable." (Locked in by the sentinel-clear-on-re-enable test.)
    next.delete(sentinel)
    next.add(key)
  }

  return next
}

/** Compute the next persisted visibility set when a provider's master switch is
 *  flipped. `visible=true` enables every one of the provider's collapsed model
 *  families (and clears its hide-all sentinel); `visible=false` removes them all
 *  and records the sentinel so the defaults are not silently re-expanded.
 *  Seeds from `resolveVisibleKeys` so other providers' state (including their
 *  sentinels) survives the persist, mirroring `toggleModelVisibility`. */
export function setProviderVisibility(
  stored: Set<string> | null,
  providers: readonly ModelOptionProvider[],
  providerSlug: string,
  visible: boolean
): Set<string> {
  const next = resolveVisibleKeys(stored, providers)
  const sentinel = emptyProviderSentinelKey(providerSlug)
  const provider = providers.find(p => p.slug === providerSlug)
  const families = collapseModelFamilies(provider?.models ?? [])

  // Drop every existing entry for this provider (real keys + sentinel); we
  // rebuild its state from scratch below.
  for (const key of [...next]) {
    if (key.startsWith(`${providerSlug}::`)) {
      next.delete(key)
    }
  }

  if (visible) {
    for (const family of families) {
      next.add(modelVisibilityKey(providerSlug, family.id))
    }

    // A provider with zero models can't be "all on" — leave it empty rather
    // than stranding a sentinel that reads as an explicit hide-all.
    if (families.length === 0) {
      next.delete(sentinel)
    }
  } else {
    next.add(sentinel)
  }

  return next
}
