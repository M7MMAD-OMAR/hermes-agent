import type { ModelCapabilities, ModelOptionProvider, ModelOptionsResponse } from '@hermes/shared'

import { getGlobalModelOptions, type HermesGateway } from '@/hermes'

type CatalogProviderIdentity = Pick<ModelOptionProvider, 'aliases' | 'name' | 'slug'>

/** True when `currentProvider` is this catalog row — slug, display name, or
 *  a custom-provider alias (`custom:<key>` vs the bare config key, #87035). */
export function catalogProviderMatches(provider: CatalogProviderIdentity, currentProvider: string): boolean {
  if (!currentProvider) {
    return false
  }

  return (
    provider.slug === currentProvider ||
    provider.name === currentProvider ||
    (provider.aliases?.includes(currentProvider) ?? false)
  )
}

/** The catalog's option support for the current pick, or undefined while the
 *  catalog is loading / doesn't say. Callers treat undefined as "assume
 *  reasoning" so controls never flicker away during the fetch. */
export function currentModelCapabilities(
  options: ModelOptionsResponse | null | undefined,
  provider: string,
  model: string
): ModelCapabilities | undefined {
  return options?.providers?.find(row => catalogProviderMatches(row, provider))?.capabilities?.[model]
}

// A picked (provider, model) pair is never retargeted from catalog membership.
// Picker rows are hints (discovered / curated / capped lists); a custom endpoint
// or a newer release legitimately serves ids the row lacks, and the backend
// soft-accepts them. Diffing the pick against the catalog silently swapped
// `deepseek-v4.1-flash` for the row's `-0731` sibling. The only authority on a
// pick's validity is the gateway's switch result. That is why the catalog
// reconcilers this fork carried (selectionInCatalog, firstSelectableCatalogModel,
// reconcileSelectionAfterCatalogRefresh) are gone rather than merged.

/** True when a catalog provider row is the session's current provider. Custom
 *  providers report the canonical `custom:<key>` identity from `model.options`
 *  while the row's slug is the bare config key, so exact slug equality never
 *  matches — check the row's alias set too (#87035). */
export function isCurrentProvider(provider: ModelOptionProvider, currentProvider: string): boolean {
  return provider.slug === currentProvider || (provider.aliases?.includes(currentProvider) ?? false)
}

/** What the CURRENT model can do, resolved from the catalog snapshot the
 *  surface already holds. Capability-driven controls (the effort pill's slider
 *  and fast toggle) gate off this, so a model without reasoning never shows a
 *  slider that silently does nothing.
 *
 *  The sibling `currentModelCapabilities` returns the raw catalog row instead;
 *  this one resolves the `-fast` variant family and fills the defaults the
 *  composer pills need. */
export interface CurrentModelCaps {
  canDisableReasoning?: boolean
  fast: boolean
  /** The provider's live model list — the `-fast` variant check needs it. */
  providerModels: string[]
  reasoning: boolean
}

export function currentModelCaps(
  providers: ModelOptionProvider[] | undefined,
  provider: string,
  model: string
): CurrentModelCaps {
  const row = providers?.find(candidate => isCurrentProvider(candidate, provider))

  // Capabilities are keyed by the BASE model id; a `-fast` variant session
  // model inherits its family's row (the same keys the catalog menu reads).
  const baseId = model.replace(/-fast$/i, '')
  const caps = row?.capabilities?.[model] ?? row?.capabilities?.[baseId]

  return {
    canDisableReasoning: caps?.can_disable_reasoning,
    fast: caps?.fast ?? false,
    providerModels: row?.models ?? [],
    reasoning: caps?.reasoning ?? true
  }
}

interface ModelOptionsRequest {
  /** When false, include ambient/unconfigured providers (onboarding/setup
   *  surfaces). Chat pickers default to true so only explicitly configured
   *  providers are listed (#56974). */
  explicitOnly?: boolean
  gateway?: HermesGateway
  /** Owner-routed RPC. When set, catalog reads hit this dispatcher instead of
   *  `gateway.request` — a tile's model menu must not query the ambient
   *  chrome socket (#93892). */
  request?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  /** Profile for the REST recovery path. Must match the catalog owner so a
   *  secondary tile does not fall back to the launch profile's models. */
  profile?: null | string
  refresh?: boolean
  sessionId?: null | string
}

export function modelOptionsQueryKey(
  profile: null | string | undefined,
  sessionId?: null | string,
  ownerConnectionId?: null | string
) {
  const profileKey = (profile ?? '').trim() || 'default'
  const ownerKey = (ownerConnectionId ?? '').trim()

  return ['model-options', profileKey, sessionId || 'global', ...(ownerKey ? ['owner', ownerKey] : [])] as const
}

function hasSelectableModels(options: ModelOptionsResponse | null | undefined): boolean {
  return options?.providers?.some(provider => (provider.models?.length ?? 0) > 0) ?? false
}

function restModelOptions(
  explicitOnly: boolean,
  refresh: boolean,
  profile?: null | string
): Promise<ModelOptionsResponse> {
  const opts = { explicitOnly, ...(refresh ? { refresh: true } : {}) }
  const profileKey = (profile ?? '').trim()

  return profileKey ? getGlobalModelOptions(opts, profileKey) : getGlobalModelOptions(opts)
}

export async function requestModelOptions({
  explicitOnly = true,
  gateway,
  profile,
  refresh = false,
  request,
  sessionId
}: ModelOptionsRequest): Promise<ModelOptionsResponse> {
  const dispatch = request ?? (gateway ? gateway.request.bind(gateway) : null)

  if (dispatch) {
    const params: Record<string, unknown> = {}

    if (sessionId) {
      params.session_id = sessionId
    }

    if (refresh) {
      params.refresh = true
    }

    if (explicitOnly) {
      params.explicit_only = true
    }

    const profileKey = (profile ?? '').trim()

    if (profileKey) {
      params.profile = profileKey
    }

    let gatewayError: unknown
    let gatewayOptions: ModelOptionsResponse | undefined

    try {
      gatewayOptions = await dispatch<ModelOptionsResponse>('model.options', params)
    } catch (error) {
      gatewayError = error
    }

    if (gatewayOptions && hasSelectableModels(gatewayOptions)) {
      return gatewayOptions
    }

    // An owner-routed dispatcher can name a different registry connection than
    // the ambient REST client. Never recover that request through ambient REST:
    // profile names are not unique across sources, so doing so can cache B's
    // catalog under A's tile. Ambient gateway requests retain the compatibility
    // recovery used by older backends with incomplete model.options responses.
    if (!request) {
      try {
        const restOptions = await restModelOptions(explicitOnly, refresh, profile)

        if (hasSelectableModels(restOptions)) {
          return {
            ...restOptions,
            ...(gatewayOptions?.provider ? { provider: gatewayOptions.provider } : {}),
            ...(gatewayOptions?.model ? { model: gatewayOptions.model } : {})
          }
        }
      } catch {
        // Preserve the gateway result (or its original error) when the recovery
        // path is unavailable.
      }
    }

    if (gatewayOptions) {
      return gatewayOptions
    }

    throw gatewayError
  }

  return restModelOptions(explicitOnly, refresh, profile)
}
