import { describe, expect, it } from 'vitest'

import {
  currentPickerSelection,
  displayModelName,
  formatModelPillLabel,
  modelDisplayParts,
  modelVendorLabel,
  modelVendorSlug,
  providerRoutesModels
} from './model-status-label'
import { reasoningEffortLabel } from './reasoning-effort'

describe('model-status-label', () => {
  it('formats display names consistently', () => {
    expect(displayModelName('anthropic/claude-opus-4.8-fast')).toBe('Opus 4.8')
    expect(displayModelName('openai/gpt-5.5-fast')).toBe('GPT-5.5')
    expect(displayModelName('deepseek/deepseek-v4-pro-thinking')).toBe('Deepseek V4 Pro')
    expect(displayModelName('openai/gpt-5.5')).toBe('GPT-5.5')
  })

  it('strips trailing date-pin snapshots from the display name', () => {
    expect(displayModelName('claude-opus-4-5-20251101')).toBe('Opus 4 5')
    expect(displayModelName('anthropic/claude-haiku-4-5-20251001')).toBe('Haiku 4 5')
  })

  it('renders local GGUF ids as a clean name with a quant tag', () => {
    expect(modelDisplayParts('Qwen3.6-27B-UD-Q4_K_XL')).toEqual({ name: 'Qwen3.6 27B', tag: 'Q4' })
    expect(modelDisplayParts('Nemotron-3-Nano-30B-A3B-UD-Q4_K_XL')).toEqual({
      name: 'Nemotron 3 Nano 30B A3B',
      tag: 'Q4'
    })
    expect(modelDisplayParts('Qwen3-4B-Instruct-2507-UD-Q8_K_XL')).toEqual({ name: 'Qwen3 4B', tag: 'Q8' })
    expect(modelDisplayParts('some-model-Q6_K')).toEqual({ name: 'Some Model', tag: 'Q6' })
    // Cloud ids keep their existing behavior.
    expect(modelDisplayParts('anthropic/claude-opus-4.8-fast').tag).toBe('Fast')
  })

  it('maps reasoning effort to compact labels', () => {
    expect(reasoningEffortLabel('high')).toBe('High')
    expect(reasoningEffortLabel('xhigh')).toBe('XHigh')
    expect(reasoningEffortLabel('max')).toBe('Max')
    expect(reasoningEffortLabel('ultra')).toBe('Ultra')
    expect(reasoningEffortLabel('')).toBe('')
  })

  it('keeps the model pill to name + Fast; the effort lives on its own pill', () => {
    expect(formatModelPillLabel('openai/gpt-5.5', { fastMode: true })).toBe('GPT-5.5 · Fast')
    expect(formatModelPillLabel('anthropic/claude-opus-4.8-fast')).toBe('Opus 4.8 · Fast')
    expect(formatModelPillLabel('openai/gpt-5.5')).toBe('GPT-5.5')
    expect(formatModelPillLabel('')).toBe('No model')
  })

  describe('currentPickerSelection', () => {
    const store = { model: 'opus', provider: 'anthropic' }
    const options = { model: 'hermes-4', provider: 'nous' }

    it('prefers the sticky composer pick over the profile default pre-session', () => {
      expect(currentPickerSelection(store, options)).toEqual(store)
    })

    it('keeps the SessionView selection when a stale options response disagrees', () => {
      expect(currentPickerSelection(store, options)).toEqual(store)
    })

    it('falls back to options when the store is empty', () => {
      expect(currentPickerSelection({ model: '', provider: '' }, options)).toEqual(options)
    })

    it('uses the complete options pair instead of mixing a partial store selection', () => {
      expect(currentPickerSelection({ model: 'opus', provider: '' }, options)).toEqual(options)
    })

    it('falls back to the store while options are still loading', () => {
      expect(currentPickerSelection(store, undefined)).toEqual(store)
    })
  })
})

describe('vendor namespaces of a routed catalog', () => {
  it('reads the lab out of an aggregator model id', () => {
    expect(modelVendorLabel('anthropic/claude-opus-5')).toBe('Anthropic')
    expect(modelVendorLabel('z-ai/glm-5.3-flash')).toBe('Z.AI')
    // The Hugging Face catalog spells the same labs differently.
    expect(modelVendorLabel('zai-org/GLM-5')).toBe('Z.AI')
    expect(modelVendorLabel('deepseek-ai/DeepSeek-V3.2')).toBe('DeepSeek')
    expect(modelVendorLabel('x-ai/grok-4.6')).toBe('xAI')
    expect(modelVendorLabel('~anthropic/claude-fable-latest')).toBe('Anthropic')
    expect(modelVendorLabel('some-new-lab/model-1')).toBe('Some New Lab')
  })

  it('has no lab for a first-party id', () => {
    expect(modelVendorLabel('claude-opus-5')).toBe('')
    expect(modelVendorLabel('gpt-5.5')).toBe('')
    // A local GGUF path is not a vendor namespace we can name; the local
    // provider is not routed either, so its rows stay unqualified.
    expect(modelVendorSlug('/models/qwen.gguf')).toBe('')
  })

  it('takes the backend routing flag over the model ids', () => {
    // A routed catalog listing one lab is still routed, which no id scan can see.
    expect(providerRoutesModels({ models: ['anthropic/claude-opus-5'], routes_models: true })).toBe(true)
    // And a first-party catalog is not routed even when its ids carry namespaces.
    expect(providerRoutesModels({ models: ['a/one', 'b/two'], routes_models: false })).toBe(false)
  })

  it('falls back to the ids for a row from a gateway that sends no flag', () => {
    expect(providerRoutesModels({ models: ['anthropic/claude-opus-5', 'deepseek/deepseek-v4.1-flash'] })).toBe(true)
    expect(providerRoutesModels({ models: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'] })).toBe(false)
    expect(providerRoutesModels({ models: ['claude-opus-5', 'claude-sonnet-5'] })).toBe(false)
    expect(providerRoutesModels({})).toBe(false)
  })
})
