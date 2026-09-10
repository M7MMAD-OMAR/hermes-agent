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

export type CellPrimitive = boolean | Date | null | number | string

const DATE_TOKEN = /[ymdhs]/i
/** Excel's day 0. Serial 1 is 1900-01-01, and serial 60 is its phantom leap day. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Split a format code on its section separators, ignoring `;` inside quotes,
 *  brackets, or escaped by a backslash. */
export function splitFormatSections(code: string): string[] {
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

/** True when the section formats a date or time rather than a plain number. */
export function isDateFormatCode(section: string): boolean {
  let quoted = false

  for (let index = 0; index < section.length; index += 1) {
    const char = section[index]!

    if (char === '\\') {
      index += 1

      continue
    }

    if (char === '"') {
      quoted = !quoted

      continue
    }

    if (quoted) {
      continue
    }

    if (char === '[') {
      const close = section.indexOf(']', index)

      index = close < 0 ? section.length : close

      continue
    }

    if (DATE_TOKEN.test(char)) {
      return true
    }
  }

  return false
}

export function excelSerialToDate(serial: number): Date {
  // Serials below 61 sit before Excel's phantom 29 Feb 1900, so they are one
  // day ahead of the real calendar unless shifted back.
  const days = serial < 61 ? serial + 1 : serial

  return new Date(EXCEL_EPOCH_MS + Math.round(days * MS_PER_DAY))
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
  let before = ''
  let after = ''
  let digits = ''
  let seenDigit = false
  let percent = 0
  let index = 0

  while (index < section.length) {
    const char = section[index]!

    if (char === '\\') {
      const literal = section[index + 1] ?? ''

      if (seenDigit) {
        after += literal
      } else {
        before += literal
      }

      index += 2

      continue
    }

    if (char === '"') {
      const close = section.indexOf('"', index + 1)
      const literal = section.slice(index + 1, close < 0 ? section.length : close)

      if (seenDigit) {
        after += literal
      } else {
        before += literal
      }

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

        if (seenDigit) {
          after += symbol
        } else {
          before += symbol
        }
      }

      index = close < 0 ? section.length : close + 1

      continue
    }

    if (char === '%') {
      percent += 1

      if (seenDigit) {
        after += '%'
      } else {
        before += '%'
      }

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
      if (seenDigit) {
        after += ' '
      } else {
        before += ' '
      }

      index += 2

      continue
    }

    if (char === '*') {
      index += 2

      continue
    }

    if (seenDigit) {
      after += char
    } else {
      before += char
    }

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
  const numeric = asDate ? (value.getTime() - EXCEL_EPOCH_MS) / MS_PER_DAY : value

  const section =
    numeric < 0 && sections[1] ? sections[1]! : numeric === 0 && sections[2] ? sections[2]! : sections[0] || 'General'

  if (/^general$/i.test(section.trim())) {
    return asDate
      ? { align: 'right', text: formatDate(value, 'yyyy-mm-dd') }
      : { align: 'right', text: generalNumber(numeric) }
  }

  if (isDateFormatCode(section)) {
    const date = asDate ? value : excelSerialToDate(numeric)

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
