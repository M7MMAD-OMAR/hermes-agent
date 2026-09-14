import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { ar } from '@/i18n/ar'
import { en } from '@/i18n/en'
import { ja } from '@/i18n/ja'
import { ru } from '@/i18n/ru'
import type { Locale, Translations } from '@/i18n/types'
import { zh } from '@/i18n/zh'
import { zhHant } from '@/i18n/zh-hant'

import { ComboboxInput } from './combobox-input'

// The app catalog loads every non-English locale as its own chunk, so there is
// no static map to read here. This suite compares locales side by side, so it
// imports the trees directly.
const TRANSLATIONS: Record<Locale, Translations> = { ar, en, ja, ru, zh, 'zh-hant': zhHant }

afterEach(cleanup)

const SHARED_LABEL_GAPS = [
  'browser.useRealProfile',
  'stt.echoTranscripts',
  'tts.deepinfra.model',
  'tts.deepinfra.voice'
]

const SHARED_DESCRIPTION_GAPS = [
  'browser.useRealProfile',
  'terminal.dockerImage',
  'terminal.singularityImage',
  'terminal.modalImage',
  'terminal.daytonaImage',
  'tts.xai.voiceId',
  'tts.xai.language',
  'tts.xai.speed',
  'tts.xai.autoSpeechTags',
  'tts.xai.optimizeStreamingLatency',
  'tts.xai.sampleRate',
  'tts.xai.bitRate',
  'tts.neutts.device',
  'stt.echoTranscripts'
]

const ZH_HANT_ONLY_GAPS = ['voice.voiceChatMode', 'voice.gptLive.voice', 'voice.gptLive.instructions']

describe('Settings i18n', () => {
  it.each([
    ['en', 'Show options'],
    ['zh', '显示选项'],
    ['zh-hant', '顯示選項']
  ] satisfies [Locale, string][])('renders combobox affordances in %s', async (locale, expectedLabel) => {
    render(
      <I18nProvider configClient={null} initialLocale={locale}>
        <ComboboxInput onChange={() => {}} options={[]} value="" />
      </I18nProvider>
    )

    // Every locale but English is its own chunk (i18n/catalog.ts), so the first
    // paint is the English fallback by design and the translated label lands an
    // import later.
    expect(await screen.findByRole('button', { name: expectedLabel })).toBeTruthy()
  })

  it('provides reported Chinese field copy without falling through to English', () => {
    const enSettings = TRANSLATIONS.en.settings

    const cases = [
      { locale: 'zh' as const, labels: SHARED_LABEL_GAPS, descriptions: SHARED_DESCRIPTION_GAPS },
      {
        locale: 'zh-hant' as const,
        labels: [...SHARED_LABEL_GAPS, ...ZH_HANT_ONLY_GAPS],
        descriptions: [...SHARED_DESCRIPTION_GAPS, ...ZH_HANT_ONLY_GAPS]
      }
    ]

    for (const { locale, labels, descriptions } of cases) {
      const settings = TRANSLATIONS[locale].settings

      for (const key of labels) {
        expect(settings.fieldLabels[key], `${locale} field label ${key}`).not.toBe(enSettings.fieldLabels[key])
      }

      for (const key of descriptions) {
        expect(settings.fieldDescriptions[key], `${locale} field description ${key}`).not.toBe(
          enSettings.fieldDescriptions[key]
        )
      }
    }

    expect(TRANSLATIONS.ja.settings.config.showOptions).toBe(enSettings.config.showOptions)
  })
})
