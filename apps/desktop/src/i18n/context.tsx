import { applyDocumentLocale, isRecord } from '@hermes/shared/i18n'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { getHermesConfigRecord, type HermesConfigRecord, saveHermesConfig } from '@/hermes'

import { DEFAULT_TRANSLATIONS, loadTranslations, translationsFor } from './catalog'
import {
  DEFAULT_LOCALE,
  type Direction,
  isSupportedLocaleValue,
  localeConfigValue,
  localeDirection,
  normalizeLocale,
  resolveInitialLocale
} from './languages'
import { setRuntimeI18nLocale } from './runtime'
import type { Locale, Translations } from './types'

export { LOCALE_META } from './languages'

export interface I18nConfigClient {
  getConfig: () => Promise<HermesConfigRecord>
  saveConfig: (config: HermesConfigRecord) => Promise<{ ok: boolean }>
}

const defaultConfigClient: I18nConfigClient = {
  getConfig: () => {
    if (typeof window === 'undefined' || !window.hermesDesktop?.api) {
      return Promise.resolve({})
    }

    // Merged defaults make an unset language indistinguishable from saved English.
    // Older backends ignore the option and keep returning English as before.
    return getHermesConfigRecord(undefined, { includeDefaults: false })
  },
  saveConfig: config => {
    if (typeof window === 'undefined' || !window.hermesDesktop?.api) {
      return Promise.resolve({ ok: true })
    }

    return saveHermesConfig(config, undefined, { preserveLanguage: true })
  }
}

export function getConfigDisplayLanguage(config: HermesConfigRecord): unknown {
  return isRecord(config.display) ? config.display.language : undefined
}

export function withConfigDisplayLanguage(config: HermesConfigRecord, locale: Locale): HermesConfigRecord {
  const display = isRecord(config.display) ? config.display : {}

  return {
    ...config,
    display: {
      ...display,
      language: localeConfigValue(locale)
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export interface I18nContextValue {
  configLoadError: Error | null
  isLoadingConfig: boolean
  isSavingLocale: boolean
  locale: Locale
  saveError: Error | null
  setLocale: (next: Locale) => Promise<void>
  t: Translations
}

const I18nContext = createContext<I18nContextValue>({
  configLoadError: null,
  isLoadingConfig: false,
  isSavingLocale: false,
  locale: DEFAULT_LOCALE,
  saveError: null,
  setLocale: async () => {},
  t: DEFAULT_TRANSLATIONS
})

export interface I18nProviderProps {
  children: ReactNode
  configClient?: I18nConfigClient | null
  initialLocale?: unknown
}

export function I18nProvider({ children, configClient = defaultConfigClient, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale))
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSavingLocale, setIsSavingLocale] = useState(false)
  const [configLoadError, setConfigLoadError] = useState<Error | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const localeRef = useRef(locale)
  // Set once the user picks a language through setLocale: a startup read that
  // resolves (or fails) after that must never overwrite an explicit choice.
  const userLocaleRef = useRef(false)

  // Non-English message trees are separate chunks (see catalog.ts), so the
  // tree for a locale can arrive an import after the locale itself is chosen.
  // Locale and messages are therefore held TOGETHER: `dir`/`lang` and the copy
  // on screen must never disagree.
  //
  // Splitting them is a real bug in RTL, not a cosmetic one. `ar` sets
  // `dir="rtl"`; if direction followed `locale` while the copy waited on the
  // chunk, the whole layout would mirror around English text and then swap
  // again — a visible flip, not the invisible late-text swap LTR locales get.
  //
  // `applied` therefore only advances once a tree is in hand. Until then the
  // previous locale keeps rendering, so a switch reads as one transition
  // rather than a bounce through English.
  // An already-loaded tree resolves DURING render, not in an effect. English
  // is always loaded, so falling back to it (a failed config read, an
  // unsupported `display.language`) stays a single synchronous commit — going
  // through state there would leave one frame of the previous language on
  // screen after the app had already decided on English.
  //
  // State only carries trees that arrive asynchronously; once `loadTranslations`
  // caches one, `translationsFor` sees it on the very next render and this
  // fallback stops being consulted.
  const [asyncLoaded, setAsyncLoaded] = useState<{ locale: Locale; messages: Translations }>(() => ({
    locale: DEFAULT_LOCALE,
    messages: DEFAULT_TRANSLATIONS
  }))

  const readyMessages = translationsFor(locale)
  const applied = readyMessages ? { locale, messages: readyMessages } : asyncLoaded

  useEffect(() => {
    if (translationsFor(locale)) {
      return
    }

    let cancelled = false

    void loadTranslations(locale).then(loadedMessages => {
      if (!cancelled && loadedMessages) {
        setAsyncLoaded({ locale, messages: loadedMessages })
      }
    })

    return () => {
      cancelled = true
    }
  }, [locale])

  // Document direction follows `applied`, not `locale`, for the reason above.
  // `runtimeLocale` too: translateNow resolves against the loaded catalog, so
  // pointing it at a locale whose chunk has not landed would just return
  // English while the surrounding UI already claimed that locale.
  useEffect(() => {
    setRuntimeI18nLocale(applied.locale)
    applyDocumentLocale(applied.locale)
  }, [applied.locale])

  // The rollback target in `setLocale` is the user's SELECTION, so this ref
  // tracks `locale` — not `applied.locale`, which may still be a tick behind.
  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    if (!configClient) {
      return
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0

    // The desktop races its own backend at startup: the renderer mounts before
    // the backend is ready, so the first /api/config call can time out. We keep
    // the established permanent-failure contract — a rejected config load
    // settles on English so the UI stays usable — but bounded retries recover
    // transient startup failures, applying the persisted display.language once
    // the backend comes up.
    const MAX_LOCALE_RETRIES = 10
    const LOCALE_RETRY_DELAY_MS = 3_000

    const loadLocale = () => {
      setIsLoadingConfig(true)
      setConfigLoadError(null)

      return configClient
        .getConfig()
        .then(async config => {
          if (cancelled || userLocaleRef.current) {
            return
          }

          const saved = getConfigDisplayLanguage(config)

          // A saved choice needs no machine probe and always takes precedence.
          if (isSupportedLocaleValue(saved)) {
            setLocaleState(normalizeLocale(saved))

            return
          }

          // Keep inference unsaved so OS language changes apply on the next boot
          // until the user explicitly picks a language.
          const machineProfile = await window.hermesDesktop?.getMachineProfile?.().catch(() => null)

          if (!cancelled && !userLocaleRef.current) {
            setLocaleState(resolveInitialLocale(undefined, machineProfile?.locale))
          }
        })
        .catch(error => {
          if (cancelled || userLocaleRef.current) {
            return
          }

          setConfigLoadError(toError(error))
          setLocaleState(DEFAULT_LOCALE)

          if (retryCount < MAX_LOCALE_RETRIES) {
            retryCount += 1
            retryTimer = setTimeout(() => {
              loadLocale()
            }, LOCALE_RETRY_DELAY_MS)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoadingConfig(false)
          }
        })
    }

    loadLocale()

    return () => {
      cancelled = true

      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [configClient, initialLocale])

  const setLocale = useCallback(
    async (next: Locale) => {
      const previousLocale = localeRef.current

      userLocaleRef.current = true
      setSaveError(null)
      setLocaleState(next)

      if (!configClient) {
        return
      }

      setIsSavingLocale(true)

      try {
        const latestConfig = await configClient.getConfig()
        const result = await configClient.saveConfig(withConfigDisplayLanguage(latestConfig, next))

        if (!result.ok) {
          throw new Error('Failed to save language')
        }
      } catch (error) {
        const nextError = toError(error)

        setLocaleState(previousLocale)
        setSaveError(nextError)

        throw nextError
      } finally {
        setIsSavingLocale(false)
      }
    },
    [configClient]
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      configLoadError,
      isLoadingConfig,
      isSavingLocale,
      locale,
      saveError,
      setLocale,
      t: applied.messages
    }),
    [applied.messages, configLoadError, isLoadingConfig, isSavingLocale, locale, saveError, setLocale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

/** The direction the interface reads in.
 *
 *  Chrome only. A viewer showing a document has two directions to keep apart:
 *  this one, which belongs to the app's language, and the document's own,
 *  which belongs to whoever wrote the file. Asking this hook for a document's
 *  direction is the bug it exists to prevent. */
export function useDirection(): Direction {
  return localeDirection(useContext(I18nContext).locale)
}
