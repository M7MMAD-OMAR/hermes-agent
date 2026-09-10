/**
 * How much of the interface each locale actually speaks.
 *
 * Every locale but English is a partial override merged onto English by
 * `defineLocale`, so a key nobody translated does not fail: it silently renders
 * in English inside an otherwise Arabic window. That is invisible to every
 * other test in this suite, which is how 784 strings sat untranslated.
 *
 * The thresholds are ratchets, not targets. Lower one only when a string is
 * genuinely not translatable (a brand name, a URL, a format token).
 */

import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import { ru } from './ru'
import type { Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

function stringLeaves(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, leaf] of stringLeaves(child, prefix ? `${prefix}.${key}` : key)) {
        out.set(path, leaf)
      }
    }

    return out
  }

  if (typeof value === 'string') {
    out.set(prefix, value)
  }

  return out
}

/** Keys whose value is the English one, ignoring strings with no letters to
 *  translate (numbers, symbols, punctuation-only labels). */
function untranslated(locale: Translations): string[] {
  const base = stringLeaves(en)
  const other = stringLeaves(locale)

  return [...base]
    .filter(([path, value]) => /[A-Za-z]/.test(value) && other.get(path) === value)
    .map(([path]) => path)
}

describe('locale coverage', () => {
  it('speaks Arabic almost everywhere', () => {
    // What is left is brand names, URLs and format tokens that stay Latin.
    expect(untranslated(ar).length).toBeLessThanOrEqual(40)
  })

  it.each([
    ['ja', ja],
    ['ru', ru],
    ['zh', zh],
    ['zh-hant', zhHant]
  ])('has not regressed in %s', (_name, locale) => {
    expect(untranslated(locale).length).toBeLessThanOrEqual(600)
  })

  it('leaves no long dash in Arabic, which the house style forbids', () => {
    const offenders = [...stringLeaves(ar)].filter(([, value]) => /[–—]/.test(value))

    expect(offenders.map(([path]) => path)).toEqual([])
  })
})
