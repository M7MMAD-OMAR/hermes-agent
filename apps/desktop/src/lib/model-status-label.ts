
/** Which model/provider pair a picker should mark "current". SessionView state
 *  also drives the composer label, so a complete pair there wins over an older
 *  `model.options` response. During initial hydration (or pre-session startup),
 *  options remain the fallback. Pick one complete pair before mixing fields so
 *  a model is never shown under a different provider. */
export function currentPickerSelection(
  store: { model: string; provider: string },
  options?: { model?: string; provider?: string }
): { model: string; provider: string } {
  const storeSelection = {
    model: String(store.model || ''),
    provider: String(store.provider || '')
  }

  const optionsSelection = {
    model: String(options?.model || ''),
    provider: String(options?.provider || '')
  }

  if (storeSelection.model && storeSelection.provider) {
    return storeSelection
  }

  if (optionsSelection.model && optionsSelection.provider) {
    return optionsSelection
  }

  return {
    model: storeSelection.model || optionsSelection.model,
    provider: storeSelection.provider || optionsSelection.provider
  }
}

/** Canonical provider labels shared by onboarding and the model pill. OAuth
 * provider ids stay distinct from their direct-API counterparts so a session on
 * `xai-oauth` never reads as the plain `xai` key path, and internal route names
 * never reach user-facing copy. */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic API Key',
  'claude-code': 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription',
  'minimax-oauth': 'MiniMax',
  nous: 'Nous Portal',
  'openai-codex': 'ChatGPT or Codex Subscription',
  'qwen-oauth': 'Qwen Code',
  xai: 'xAI',
  'xai-oauth': 'xAI Grok'
}

export function providerDisplayName(provider: string): string {
  const normalized = provider.trim().toLowerCase()

  return PROVIDER_DISPLAY_NAMES[normalized] ?? provider.trim()
}

/** Strip provider prefix and normalize for display. */
export function modelBaseId(model: string): string {
  const trimmed = model.trim()
  const slash = trimmed.lastIndexOf('/')

  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

// Trailing model-id variants that should render as a grayed tag beside the
// name (e.g. "Opus 4.8" + "Fast") rather than collapsing two distinct ids to
// the same display name.
const VARIANT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-fast$/i, 'Fast'],
  [/-thinking$/i, 'Thinking'],
  [/-preview$/i, 'Preview'],
  [/-latest$/i, 'Latest']
]

const titleCase = (text: string): string => text.replace(/\b\w/g, char => char.toUpperCase()).trim()

function prettifyBase(base: string): string {
  if (/^deepseek-flash$/i.test(base)) {
    return 'DeepSeek V4.1 Flash'
  }

  if (/^claude-/i.test(base)) {
    // Anthropic ids spell the version with hyphens (`haiku-4-5`, `fable-5-1`);
    // the human name is dotted ("Haiku 4.5"), not "Haiku 4 5".
    return titleCase(
      base
        .replace(/^claude-/i, '')
        .replace(/(\d)-(?=\d)/g, '$1.')
        .replace(/-/g, ' ')
    )
  }

  if (/^gpt-/i.test(base)) {
    return base.replace(/^gpt-/i, 'GPT-')
  }

  if (/^gemini-/i.test(base)) {
    return base.replace(/^gemini-/i, 'Gemini ').replace(/-/g, ' ')
  }

  return titleCase(base.replace(/-/g, ' '))
}

/** Split a model id into a clean display name plus an optional grayed variant
 *  tag, so distinct ids (e.g. `…-4.8` vs `…-4.8-fast`) don't collapse. */
export function modelDisplayParts(model: string): { name: string; tag: string } {
  let base = modelBaseId(model)
  let tag = ''

  // Local GGUF ids carry a quant suffix (`…-UD-Q4_K_XL`, `…-Q8_0`). Render it
  // as a quiet tag — "Qwen3.6 27B · Q4" — never as part of the name. Without
  // this the composer pill reads raw quant soup ("Qwen3.6 27B UD Q4 K XL").
  const quant = base.match(/-(?:UD-)?(Q\d(?:_[A-Z0-9]+)*|IQ\d(?:_[A-Z0-9]+)*|F16|BF16)$/i)

  if (quant) {
    tag = quant[1].split('_')[0].toUpperCase()
    base = base.slice(0, -quant[0].length)
    // Instruct/chat markers are noise once the quant confirmed a local build.
    base = base.replace(/-(?:Instruct|Chat)(?:-\d{4})?$/i, '')
  }

  if (!tag) {
    for (const [pattern, label] of VARIANT_TAGS) {
      if (pattern.test(base)) {
        tag = label
        base = base.replace(pattern, '')

        break
      }
    }
  }

  // Anthropic's `[1m]` route suffix selects the 1M-context window. It is a
  // variant of the same model, so it renders as a tag ("Sonnet 5 · 1M") rather
  // than raw brackets that read like an ANSI escape ("Sonnet 5[1m]").
  const contextWindow = base.match(/\[(\d+[mk])\]$/i)

  if (contextWindow) {
    tag = tag ? `${tag} ${contextWindow[1].toUpperCase()}` : contextWindow[1].toUpperCase()
    base = base.slice(0, -contextWindow[0].length)
  }

  // Drop a trailing date-pin (`…-20251101`) — snapshot noise, not a name.
  base = base.replace(/-\d{8}$/, '')

  return { name: prettifyBase(base) || model.trim() || 'No model', tag }
}

/** Friendly one-line model name for menus and the status bar. */
export function displayModelName(model: string): string {
  return modelDisplayParts(model).name
}

/** Composer model-pill label — model name plus Fast when it applies. The
 *  reasoning level is NOT here: it has its own pill (`ReasoningPill`), so a
 *  long model name can no longer push the effort out of the truncating span. */
export function formatModelPillLabel(model: string, options?: { fastMode?: boolean }): string {
  const name = displayModelName(model)

  // Fast is shown when the speed=fast param is on (options.fastMode) OR the
  // active model is a `…-fast` variant (fast via a separate model id).
  if (model.trim() && (options?.fastMode || /-fast$/i.test(modelBaseId(model)))) {
    return `${name} · Fast`
  }

  return name
}

// Vendor namespaces an aggregator catalog uses (`anthropic/claude-opus-5`).
// `modelBaseId` drops them for display, which is right for a first-party
// provider and wrong for a router: "Opus 5" under OpenRouter then reads
// exactly like the Anthropic-subscription row two groups above it.
const VENDOR_LABELS: Readonly<Record<string, string>> = {
  'ai21': 'AI21',
  'ai-sweden': 'AI Sweden',
  'alibaba': 'Alibaba',
  'amazon': 'Amazon',
  'anthracite-org': 'Anthracite',
  'anthropic': 'Anthropic',
  'cohere': 'Cohere',
  'deepseek': 'DeepSeek',
  'deepseek-ai': 'DeepSeek',
  'google': 'Google',
  'inflection': 'Inflection',
  'meta': 'Meta',
  'meta-llama': 'Meta',
  'microsoft': 'Microsoft',
  'minimax': 'MiniMax',
  'minimaxai': 'MiniMax',
  'mistralai': 'Mistral',
  'moonshotai': 'Moonshot',
  'nousresearch': 'Nous Research',
  'nvidia': 'NVIDIA',
  'openai': 'OpenAI',
  'perplexity': 'Perplexity',
  'poolside': 'Poolside',
  'qwen': 'Qwen',
  'sakana': 'Sakana',
  'stepfun': 'StepFun',
  'tencent': 'Tencent',
  'thinkingmachines': 'Thinking Machines',
  'x-ai': 'xAI',
  'xiaomi': 'Xiaomi',
  'xiaomimimo': 'Xiaomi',
  'z-ai': 'Z.AI',
  'zai-org': 'Z.AI'
}

/** The vendor namespace of a model id (`anthropic/claude-opus-5` → `anthropic`),
 *  '' when the id carries none. A `~` routing marker and a `:free` / `:batch`
 *  variant suffix are not part of the namespace. */
export function modelVendorSlug(model: string): string {
  const trimmed = model.trim().replace(/^~+/, '')
  const slash = trimmed.indexOf('/')

  return slash > 0 ? trimmed.slice(0, slash).toLowerCase() : ''
}

/** Display form of a model id's vendor namespace, '' when it has none. Used to
 *  qualify rows of a multi-vendor (routing) provider so an OpenRouter-served
 *  Claude never renders identically to the Anthropic-subscription one. */
export function modelVendorLabel(model: string): string {
  const slug = modelVendorSlug(model)

  if (!slug) {
    return ''
  }

  return VENDOR_LABELS[slug] ?? titleCase(slug.replace(/[-_]/g, ' '))
}

/** True when a provider ROUTES other labs' models rather than serving its own,
 *  so its rows must name the lab that made each model.
 *
 *  The backend owns the definition (`is_routing_aggregator`) and ships it as
 *  `routes_models`: it knows carve-outs no client can infer from model ids, and
 *  it stays right for a routed catalog that happens to list one lab. The id
 *  scan below is only the fallback for a row from a gateway too old to send the
 *  field, where an unqualified name is the pre-existing behaviour anyway. */
export function providerRoutesModels(provider: {
  models?: null | readonly string[]
  routes_models?: boolean | null
}): boolean {
  if (typeof provider.routes_models === 'boolean') {
    return provider.routes_models
  }

  const vendors = new Set<string>()

  for (const model of provider.models ?? []) {
    const vendor = modelVendorSlug(model)

    if (vendor) {
      vendors.add(vendor)

      if (vendors.size > 1) {
        return true
      }
    }
  }

  return false
}
