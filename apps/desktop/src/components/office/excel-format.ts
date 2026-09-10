/**
 * Excel number formats, rendered the way the sheet shows them.
 *
 * A cell carries a raw value and a format code (`#,##0.00`, `0.0%`,
 * `yyyy-mm-dd`, `"SAR" #,##0`). Showing the raw value instead is what makes a
 * spreadsheet preview look nothing like the file: totals lose their separators,
 * rates lose their percent sign, and dates arrive as five-digit serials. This
 * covers the format grammar sheets actually use, and falls back to a readable
 * general rendering for the parts it does not model (conditions, colours,
 * fractions, scientific notation with custom exponents).
 */

import { isDateFormat } from '@office-kit/xlsx/styles'
import { excelToDate, WINDOWS_EPOCH_MS } from '@office-kit/xlsx/utils'

export type CellPrimitive = boolean | Date | null | number | string

const MS_PER_DAY = 86_400_000

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// A workbook has a handful of distinct format codes shared by every one of its
// cells, so both parses are cached by the code they read.
const sectionCache = new Map<string, string[]>()
const patternCache = new Map<string, NumberPattern>()

/** Split a format code on its section separators, ignoring `;` inside quotes,
 *  brackets, or escaped by a backslash. */
export function splitFormatSections(code: string): string[] {
  const cached = sectionCache.get(code)

  if (cached) {
    return cached
  }

  const sections = splitSections(code)

  sectionCache.set(code, sections)

  return sections
}

function splitSections(code: string): string[] {
  const sections: string[] = []
  let current = ''
  let quoted = false
  let bracketed = false

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!

    if (char === '\\') {
      current += char + (code[index + 1] ?? '')
      index += 1

      continue
    }

    if (char === '"') {
      quoted = !quoted
      current += char

      continue
    }

    if (!quoted && char === '[') {
      bracketed = true
    }

    if (!quoted && char === ']') {
      bracketed = false
    }

    if (char === ';' && !quoted && !bracketed) {
      sections.push(current)
      current = ''

      continue
    }

    current += char
  }

  sections.push(current)

  return sections
}

function pad(value: number, width: number): string {
  return String(Math.floor(Math.abs(value))).padStart(width, '0')
}

function formatDate(date: Date, section: string): string {
  let out = ''
  let index = 0
  const hasAmPm = /am\/pm|a\/p/i.test(section)
  const hours24 = date.getUTCHours()
  const hours = hasAmPm ? hours24 % 12 || 12 : hours24
  let elapsedMinutes = false

  while (index < section.length) {
    const char = section[index]!

    if (char === '\\') {
      out += section[index + 1] ?? ''
      index += 2

      continue
    }

    if (char === '"') {
      const close = section.indexOf('"', index + 1)

      out += section.slice(index + 1, close < 0 ? section.length : close)
      index = close < 0 ? section.length : close + 1

      continue
    }

    if (char === '[') {
      const close = section.indexOf(']', index)

      // [h]/[m]/[s] mean elapsed time; [$…] and [Red] are decoration we drop.
      elapsedMinutes = /^\[[hms]+\]$/i.test(section.slice(index, close + 1))
      index = close < 0 ? section.length : close + 1

      continue
    }

    const rest = section.slice(index)
    const ampm = /^(am\/pm|a\/p)/i.exec(rest)

    if (ampm) {
      out += hours24 < 12 ? 'AM' : 'PM'
      index += ampm[0].length

      continue
    }

    const run = /^(y+|m+|d+|h+|s+)/i.exec(rest)

    if (run) {
      const token = run[0].toLowerCase()
      const width = token.length

      if (token.startsWith('y')) {
        out += width <= 2 ? pad(date.getUTCFullYear() % 100, 2) : String(date.getUTCFullYear())
      } else if (token.startsWith('d')) {
        out += width >= 4 ? DAYS[date.getUTCDay()]! : width === 3 ? DAYS[date.getUTCDay()]!.slice(0, 3) : pad(date.getUTCDate(), width)
      } else if (token.startsWith('h')) {
        out += pad(hours, width)
      } else if (token.startsWith('s')) {
        out += pad(date.getUTCSeconds(), width)
      } else {
        // `m` is minutes right after an hour token or inside an elapsed block,
        // and the month everywhere else — the one genuinely ambiguous token.
        const before = section.slice(0, index)
        const minutes = elapsedMinutes || /[hH]+[^a-zA-Z]*$/.test(before)

        out += minutes
          ? pad(date.getUTCMinutes(), width)
          : width >= 4
            ? MONTHS[date.getUTCMonth()]!
            : width === 3
              ? MONTHS[date.getUTCMonth()]!.slice(0, 3)
              : pad(date.getUTCMonth() + 1, width)
      }

      index += run[0].length

      continue
    }

    out += char
    index += 1
  }

  return out
}

interface NumberPattern {
  decimals: number
  literalAfter: string
  literalBefore: string
  percent: number
  thousands: boolean
}

function parseNumberPattern(section: string): NumberPattern {
  const cached = patternCache.get(section)

  if (cached) {
    return cached
  }

  const parsed = readNumberPattern(section)

  patternCache.set(section, parsed)

  return parsed
}

function readNumberPattern(section: string): NumberPattern {
  let before = ''
  let after = ''
  let digits = ''
  let seenDigit = false
  let percent = 0
  let index = 0

  const emit = (text: string) => {
    if (seenDigit) {
      after += text
    } else {
      before += text
    }
  }

  while (index < section.length) {
    const char = section[index]!

    if (char === '\\') {
      const literal = section[index + 1] ?? ''

      emit(literal)

      index += 2

      continue
    }

    if (char === '"') {
      const close = section.indexOf('"', index + 1)
      const literal = section.slice(index + 1, close < 0 ? section.length : close)

      emit(literal)

      index = close < 0 ? section.length : close + 1

      continue
    }

    if (char === '[') {
      const close = section.indexOf(']', index)
      const inner = section.slice(index + 1, close < 0 ? section.length : close)
      // [$SAR-401] is a currency literal; the locale id after the dash is not shown.
      const currency = /^\$(.*)$/.exec(inner)

      if (currency) {
        const symbol = currency[1]!.split('-')[0]!

        emit(symbol)
      }

      index = close < 0 ? section.length : close + 1

      continue
    }

    if (char === '%') {
      percent += 1

      emit('%')

      index += 1

      continue
    }

    if (char === '0' || char === '#' || char === '?' || char === '.' || char === ',') {
      seenDigit = true
      digits += char
      index += 1

      continue
    }

    if (char === '_') {
      // `_x` reserves the width of x; a preview shows a space.
      emit(' ')

      index += 2

      continue
    }

    if (char === '*') {
      index += 2

      continue
    }

    emit(char)
    index += 1
  }

  const dot = digits.indexOf('.')
  const fraction = dot < 0 ? '' : digits.slice(dot + 1)
  const integer = dot < 0 ? digits : digits.slice(0, dot)

  return {
    decimals: fraction.replace(/[^0#?]/g, '').length,
    literalAfter: after,
    literalBefore: before,
    percent,
    thousands: integer.includes(',')
  }
}

/** Round the way a sheet does: on the decimal value, half away from zero.
 *  Plain `toFixed` rounds the binary double, so 23.45 at one decimal comes back
 *  as 23.4 and a percentage column reads one tick low all the way down. */
function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const scaled = Number((value * factor).toPrecision(15))

  return (value < 0 ? -Math.round(-scaled) : Math.round(scaled)) / factor
}

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A number the way a sheet shows it when the format is General: full
 *  precision, no separators, and no exponent until the value needs one. */
export function generalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }

  if (value !== 0 && (Math.abs(value) >= 1e11 || Math.abs(value) < 1e-9)) {
    return value.toExponential(4).replace('e', 'E')
  }

  return String(Math.round(value * 1e10) / 1e10)
}

export interface FormattedCell {
  /** Right for numbers and dates, left for text: the sheet's own default. */
  align: 'left' | 'right'
  text: string
}

/** Render one cell value through its format code. */
export function formatCellValue(value: CellPrimitive, code: string | undefined): FormattedCell {
  if (value === null || value === undefined || value === '') {
    return { align: 'left', text: '' }
  }

  if (typeof value === 'boolean') {
    return { align: 'right', text: value ? 'TRUE' : 'FALSE' }
  }

  const sections = splitFormatSections(code && code.trim() ? code : 'General')

  if (typeof value === 'string') {
    const textSection = sections[3]

    if (textSection && textSection.includes('@')) {
      return { align: 'left', text: textSection.replace(/"/g, '').replace('@', value) }
    }

    return { align: 'left', text: value }
  }

  const asDate = value instanceof Date
  const numeric = asDate ? (value.getTime() - WINDOWS_EPOCH_MS) / MS_PER_DAY : value

  const section =
    numeric < 0 && sections[1] ? sections[1]! : numeric === 0 && sections[2] ? sections[2]! : sections[0] || 'General'

  if (/^general$/i.test(section.trim())) {
    return asDate
      ? { align: 'right', text: formatDate(value, 'yyyy-mm-dd') }
      : { align: 'right', text: generalNumber(numeric) }
  }

  if (isDateFormat(section)) {
    const date = asDate ? value : excelToDate(numeric)

    return { align: 'right', text: formatDate(date, section) }
  }

  const pattern = parseNumberPattern(section)
  const scaled = numeric * 100 ** pattern.percent
  // A negative section carries its own sign, so the magnitude is what it formats.
  const magnitude = sections[1] && numeric < 0 ? Math.abs(scaled) : scaled
  const fixed = roundHalfUp(magnitude, pattern.decimals).toFixed(pattern.decimals)
  const [integer = '0', fraction] = fixed.split('.')
  const sign = integer.startsWith('-') ? '-' : ''
  const digits = sign ? integer.slice(1) : integer
  const grouped = pattern.thousands ? groupThousands(digits) : digits
  const body = fraction ? `${grouped}.${fraction}` : grouped

  return { align: 'right', text: `${pattern.literalBefore}${sign}${body}${pattern.literalAfter}` }
}
