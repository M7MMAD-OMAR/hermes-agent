import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { ja } from './ja'
import { ru } from './ru'
import type { BundledLocale, Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

/** The catalogs compiled into the app. Runtime-registered languages (plugin
 *  packs, backend `.desktop.yaml` packs) are NOT here — resolve through
 *  `resolveTranslations()` in `./registry`, which layers them over these. */
export const TRANSLATIONS: Record<BundledLocale, Translations> = {
  en,
  zh,
  'zh-hant': zhHant,
  ja,
  ar,
  ru,
  fr,
  de,
  es
}

export const BUNDLED_LOCALES = Object.keys(TRANSLATIONS) as readonly BundledLocale[]

export function isBundledLocale(value: unknown): value is BundledLocale {
  return typeof value === 'string' && Object.hasOwn(TRANSLATIONS, value)
}

/** English, the fallback every other locale resolves through. */
export const DEFAULT_TRANSLATIONS: Translations = en

/** The bundled message tree for `locale`, or `undefined` for an id with no
 *  bundled catalog. Every bundled locale is statically imported, so there is
 *  nothing to wait for; runtime packs resolve through `resolveTranslations()`
 *  in `./registry`. */
export function translationsFor(locale: Locale): Translations | undefined {
  return isBundledLocale(locale) ? TRANSLATIONS[locale] : undefined
}

/** Kept for callers written when locales were separate chunks. Resolves at once. */
export function loadTranslations(locale: Locale): Promise<Translations | undefined> {
  return Promise.resolve(translationsFor(locale))
}
