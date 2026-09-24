import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { fieldCopyForSchemaKey } from '@/app/settings/field-copy'

import { loadTranslations, translationsFor } from './catalog'
import { en } from './en'
import { setRuntimeI18nLocale, translateNow } from './runtime'
import { zh } from './zh'

describe('desktop i18n runtime translator', () => {
  // Non-English trees are separate chunks now (catalog.ts). The assertions
  // below are about translation content, so warm every locale first; the
  // not-yet-loaded path gets its own test at the bottom.
  beforeAll(async () => {
    await Promise.all([
      loadTranslations('ar'),
      loadTranslations('ja'),
      loadTranslations('zh'),
      loadTranslations('zh-hant')
    ])
  })

  beforeEach(() => {
    setRuntimeI18nLocale('en')
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('translates string paths for the active runtime locale', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('boot.ready')).toBe(zh.boot.ready)
    expect(translateNow('assistant.tool.statusRecovered')).toBe(zh.assistant.tool.statusRecovered)
    expect(translateNow('boot.ready')).not.toBe(en.boot.ready)
  })

  it('passes arguments to function translations', () => {
    expect(translateNow('notifications.updateReadyMessage', 2)).toBe(
      en.notifications.updateReadyMessage(2)
    )
    expect(translateNow('notifications.updateReadyMessage', 2)).toContain('2')
  })

  it('keeps translated settings field copy addressable from schema keys', () => {
    const field = ['display', 'show_reasoning'].join('.')

    expect(fieldCopyForSchemaKey(zh.settings.fieldLabels, field)).toBeTypeOf('string')
    expect(fieldCopyForSchemaKey(zh.settings.fieldDescriptions, field)).toBeTypeOf('string')
  })

  it('falls back to English when the active locale cannot resolve a key', () => {
    const boot = translationsFor('ja')!.boot as { ready?: string }
    const originalReady = boot.ready

    try {
      boot.ready = undefined
      setRuntimeI18nLocale('ja')

      expect(translateNow('boot.ready')).toBe(en.boot.ready)
    } finally {
      boot.ready = originalReady
    }
  })

  it('returns the key when no locale can resolve a path', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('missing.path')).toBe('missing.path')
  })
})

// Own module registry: the suite above warms every locale in `beforeAll`, and
// the whole point here is the window BEFORE a locale's chunk has landed.
describe('desktop i18n runtime translator, before a locale chunk loads', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders English rather than raw keys while the chunk is in flight', async () => {
    const runtime = await import('./runtime')

    runtime.setRuntimeI18nLocale('ja')

    // Japanese has not been fetched in this module registry, so the active
    // arm of translateFrom misses and the DEFAULT arm answers.
    expect(runtime.translateNow('boot.ready')).toBe(en.boot.ready)
  })

  it('serves the real translation once the chunk lands', async () => {
    const catalog = await import('./catalog')
    const runtime = await import('./runtime')

    runtime.setRuntimeI18nLocale('ja')
    await catalog.loadTranslations('ja')

    expect(runtime.translateNow('common.save')).toBe('保存')
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const catalog = await import('./catalog')

    const [first, second] = await Promise.all([catalog.loadTranslations('ar'), catalog.loadTranslations('ar')])

    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(catalog.translationsFor('ar')).toBe(first)
  })
})
