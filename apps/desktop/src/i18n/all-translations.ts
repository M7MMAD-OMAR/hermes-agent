/**
 * Every locale's message tree, statically imported. FOR TESTS ONLY.
 *
 * Production code reads languages through `catalog.ts`, which loads each
 * non-English locale as its own chunk on demand. Importing this module from app
 * code would pull all of them back into one bundle, which is exactly what that
 * split exists to avoid. Tests that compare copy across locales use this
 * instead of awaiting `loadTranslations` for each one.
 */

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import { ru } from './ru'
import type { Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

export const TRANSLATIONS: Record<Locale, Translations> = { ar, en, ja, ru, zh, 'zh-hant': zhHant }
