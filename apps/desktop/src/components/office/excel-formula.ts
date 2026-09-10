/**
 * A small formula evaluator for the sheet preview.
 *
 * Workbooks written by Excel or LibreOffice cache each formula's last result,
 * and the preview shows that. Workbooks written by a library (openpyxl, and so
 * every sheet this app generates) carry the formula and no result at all, which
 * is why a total column arrived blank. Rather than show blanks, the preview
 * computes what it can: arithmetic, comparisons, ranges, and the functions that
 * actually appear in generated sheets. Anything outside that returns an error
 * value, and the grid falls back to showing the formula text.
 */

import { coordinateToTuple } from '@office-kit/xlsx/utils'

import type { CellPrimitive } from './excel-format'

export type CellLookup = (row: number, col: number) => CellPrimitive

export class FormulaError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'FormulaError'
  }
}

type Value = CellPrimitive | Value[]

interface Token {
  kind: 'name' | 'number' | 'op' | 'ref' | 'text'
  value: string
}

const OPERATORS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', ',', ':', '%']

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]!

    if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
      index += 1

      continue
    }

    if (char === '"') {
      let text = ''
      index += 1

      while (index < input.length) {
        if (input[index] === '"') {
          if (input[index + 1] === '"') {
            text += '"'
            index += 2

            continue
          }

          index += 1

          break
        }

        text += input[index]
        index += 1
      }

      tokens.push({ kind: 'text', value: text })

      continue
    }

    const rest = input.slice(index)
    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest)

    if (number && /\d/.test(char)) {
      tokens.push({ kind: 'number', value: number[0] })
      index += number[0].length

      continue
    }

    if (char === '.' && /^\.\d/.test(rest)) {
      const decimal = /^\.\d+/.exec(rest)!

      tokens.push({ kind: 'number', value: decimal[0] })
      index += decimal[0].length

      continue
    }

    const reference = /^\$?[A-Za-z]{1,3}\$?\d{1,7}(?![A-Za-z0-9_.])/.exec(rest)

    if (reference) {
      tokens.push({ kind: 'ref', value: reference[0] })
      index += reference[0].length

      continue
    }

    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)

    if (name) {
      tokens.push({ kind: 'name', value: name[0].toUpperCase() })
      index += name[0].length

      continue
    }

    const operator = OPERATORS.find(candidate => rest.startsWith(candidate))

    if (operator) {
      tokens.push({ kind: 'op', value: operator })
      index += operator.length

      continue
    }

    throw new FormulaError('#NAME?')
  }

  return tokens
}

/** `$B$12` → row 12, column 2, as the workbook reader reads it. */
export function parseReference(reference: string): { col: number; row: number } {
  try {
    return coordinateToTuple(reference)
  } catch {
    throw new FormulaError('#REF!')
  }
}

function toNumber(value: Value): number {
  if (value === null || value === undefined || value === '') {
    return 0
  }

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (Array.isArray(value)) {
    return toNumber(value[0] ?? 0)
  }

  const parsed = Number(String(value).replace(/,/g, '').trim())

  if (Number.isNaN(parsed)) {
    throw new FormulaError('#VALUE!')
  }

  return parsed
}

function toText(value: Value): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }

  if (Array.isArray(value)) {
    return toText(value[0] ?? '')
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  return String(value)
}

function flatten(values: Value[]): CellPrimitive[] {
  const out: CellPrimitive[] = []

  for (const value of values) {
    if (Array.isArray(value)) {
      out.push(...flatten(value))
    } else {
      out.push(value)
    }
  }

  return out
}

function numbersIn(values: Value[]): number[] {
  return flatten(values)
    .filter(value => typeof value === 'number' || typeof value === 'boolean')
    .map(value => (typeof value === 'boolean' ? (value ? 1 : 0) : (value as number)))
}

function compare(left: Value, right: Value): number {
  const leftScalar = Array.isArray(left) ? (left[0] ?? null) : left
  const rightScalar = Array.isArray(right) ? (right[0] ?? null) : right

  if (typeof leftScalar === 'string' || typeof rightScalar === 'string') {
    const a = toText(leftScalar).toLowerCase()
    const b = toText(rightScalar).toLowerCase()

    return a < b ? -1 : a > b ? 1 : 0
  }

  const a = toNumber(leftScalar)
  const b = toNumber(rightScalar)

  return a < b ? -1 : a > b ? 1 : 0
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits

  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor
}

const FUNCTIONS: Record<string, (args: Value[]) => Value> = {
  ABS: args => Math.abs(toNumber(args[0] ?? 0)),
  AND: args => flatten(args).every(value => Boolean(value)),
  AVERAGE: args => {
    const numbers = numbersIn(args)

    if (!numbers.length) {
      throw new FormulaError('#DIV/0!')
    }

    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
  },
  CEILING: args => Math.ceil(toNumber(args[0] ?? 0)),
  CONCAT: args => flatten(args).map(toText).join(''),
  CONCATENATE: args => flatten(args).map(toText).join(''),
  COUNT: args => numbersIn(args).length,
  COUNTA: args => flatten(args).filter(value => value !== null && value !== undefined && value !== '').length,
  FLOOR: args => Math.floor(toNumber(args[0] ?? 0)),
  IF: args => ((Array.isArray(args[0]) ? args[0]![0] : args[0]) ? (args[1] ?? true) : (args[2] ?? false)),
  INT: args => Math.floor(toNumber(args[0] ?? 0)),
  LEFT: args => toText(args[0] ?? '').slice(0, args.length > 1 ? toNumber(args[1]!) : 1),
  LEN: args => toText(args[0] ?? '').length,
  LOWER: args => toText(args[0] ?? '').toLowerCase(),
  MAX: args => {
    const numbers = numbersIn(args)

    return numbers.length ? Math.max(...numbers) : 0
  },
  MEDIAN: args => {
    const numbers = numbersIn(args).sort((a, b) => a - b)

    if (!numbers.length) {
      throw new FormulaError('#NUM!')
    }

    const middle = Math.floor(numbers.length / 2)

    return numbers.length % 2 ? numbers[middle]! : (numbers[middle - 1]! + numbers[middle]!) / 2
  },
  MID: args => {
    const start = Math.max(1, toNumber(args[1] ?? 1))

    return toText(args[0] ?? '').slice(start - 1, start - 1 + toNumber(args[2] ?? 0))
  },
  MIN: args => {
    const numbers = numbersIn(args)

    return numbers.length ? Math.min(...numbers) : 0
  },
  MOD: args => {
    const divisor = toNumber(args[1] ?? 0)

    if (!divisor) {
      throw new FormulaError('#DIV/0!')
    }

    return toNumber(args[0] ?? 0) % divisor
  },
  NOT: args => !args[0],
  OR: args => flatten(args).some(value => Boolean(value)),
  POWER: args => toNumber(args[0] ?? 0) ** toNumber(args[1] ?? 0),
  PRODUCT: args => numbersIn(args).reduce((product, value) => product * value, 1),
  RIGHT: args => {
    const count = args.length > 1 ? toNumber(args[1]!) : 1

    return count <= 0 ? '' : toText(args[0] ?? '').slice(-count)
  },
  ROUND: args => round(toNumber(args[0] ?? 0), toNumber(args[1] ?? 0)),
  ROUNDDOWN: args => {
    const factor = 10 ** toNumber(args[1] ?? 0)
    const value = toNumber(args[0] ?? 0)

    return (value < 0 ? Math.ceil(value * factor) : Math.floor(value * factor)) / factor
  },
  ROUNDUP: args => {
    const factor = 10 ** toNumber(args[1] ?? 0)
    const value = toNumber(args[0] ?? 0)

    return (value < 0 ? Math.floor(value * factor) : Math.ceil(value * factor)) / factor
  },
  SQRT: args => Math.sqrt(toNumber(args[0] ?? 0)),
  SUM: args => numbersIn(args).reduce((sum, value) => sum + value, 0),
  TRIM: args => toText(args[0] ?? '').trim(),
  UPPER: args => toText(args[0] ?? '').toUpperCase()
}

/** IFERROR and IFS need the raw argument thunks, not evaluated values, so they
 *  are handled by the parser rather than the table above. */
const LAZY_FUNCTIONS = new Set(['IFERROR', 'IFNA'])

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly lookup: CellLookup
  ) {}

  parse(): Value {
    const value = this.parseComparison()

    if (this.index < this.tokens.length) {
      throw new FormulaError('#NAME?')
    }

    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private eat(value: string): boolean {
    const token = this.peek()

    if (token && token.kind === 'op' && token.value === value) {
      this.index += 1

      return true
    }

    return false
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new FormulaError('#NAME?')
    }
  }

  private parseComparison(): Value {
    let left = this.parseConcat()

    for (;;) {
      const token = this.peek()

      if (!token || token.kind !== 'op' || !['<', '<=', '<>', '=', '>', '>='].includes(token.value)) {
        return left
      }

      this.index += 1
      const right = this.parseConcat()
      const order = compare(left, right)

      left =
        token.value === '='
          ? order === 0
          : token.value === '<>'
            ? order !== 0
            : token.value === '<'
              ? order < 0
              : token.value === '<='
                ? order <= 0
                : token.value === '>'
                  ? order > 0
                  : order >= 0
    }
  }

  private parseConcat(): Value {
    let left = this.parseSum()

    while (this.eat('&')) {
      left = toText(left) + toText(this.parseSum())
    }

    return left
  }

  private parseSum(): Value {
    let left = this.parseProduct()

    for (;;) {
      if (this.eat('+')) {
        left = toNumber(left) + toNumber(this.parseProduct())
      } else if (this.eat('-')) {
        left = toNumber(left) - toNumber(this.parseProduct())
      } else {
        return left
      }
    }
  }

  private parseProduct(): Value {
    let left = this.parsePower()

    for (;;) {
      if (this.eat('*')) {
        left = toNumber(left) * toNumber(this.parsePower())
      } else if (this.eat('/')) {
        const divisor = toNumber(this.parsePower())

        if (divisor === 0) {
          throw new FormulaError('#DIV/0!')
        }

        left = toNumber(left) / divisor
      } else {
        return left
      }
    }
  }

  private parsePower(): Value {
    const left = this.parseUnary()

    if (this.eat('^')) {
      return toNumber(left) ** toNumber(this.parsePower())
    }

    return left
  }

  private parseUnary(): Value {
    if (this.eat('-')) {
      return -toNumber(this.parseUnary())
    }

    if (this.eat('+')) {
      return this.parseUnary()
    }

    let value = this.parsePrimary()

    while (this.eat('%')) {
      value = toNumber(value) / 100
    }

    return value
  }

  private parsePrimary(): Value {
    const token = this.peek()

    if (!token) {
      throw new FormulaError('#NAME?')
    }

    if (token.kind === 'number') {
      this.index += 1

      return Number(token.value)
    }

    if (token.kind === 'text') {
      this.index += 1

      return token.value
    }

    if (token.kind === 'op' && token.value === '(') {
      this.index += 1
      const value = this.parseComparison()

      this.expect(')')

      return value
    }

    if (token.kind === 'ref') {
      this.index += 1
      const start = parseReference(token.value)

      if (this.eat(':')) {
        const endToken = this.peek()

        if (!endToken || endToken.kind !== 'ref') {
          throw new FormulaError('#REF!')
        }

        this.index += 1

        return this.readRange(start, parseReference(endToken.value))
      }

      return this.lookup(start.row, start.col)
    }

    if (token.kind === 'name') {
      this.index += 1

      if (token.value === 'TRUE') {
        return true
      }

      if (token.value === 'FALSE') {
        return false
      }

      return this.parseCall(token.value)
    }

    throw new FormulaError('#NAME?')
  }

  private parseCall(name: string): Value {
    this.expect('(')

    if (LAZY_FUNCTIONS.has(name)) {
      let value: Value

      try {
        value = this.parseComparison()
      } catch {
        value = null
        this.skipToComma()
      }

      const fallback = this.eat(',') ? this.parseComparison() : null

      this.expect(')')

      return value === null ? fallback : value
    }

    const args: Value[] = []

    if (!this.eat(')')) {
      do {
        args.push(this.parseComparison())
      } while (this.eat(','))

      this.expect(')')
    }

    const fn = FUNCTIONS[name]

    if (!fn) {
      throw new FormulaError('#NAME?')
    }

    return fn(args)
  }

  /** After a failed lazy argument, walk to this call's own comma or close. */
  private skipToComma(): void {
    let depth = 0

    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index]!

      if (token.kind === 'op' && token.value === '(') {
        depth += 1
      }

      if (token.kind === 'op' && token.value === ')') {
        if (depth === 0) {
          return
        }

        depth -= 1
      }

      if (token.kind === 'op' && token.value === ',' && depth === 0) {
        return
      }

      this.index += 1
    }
  }

  private readRange(start: { col: number; row: number }, end: { col: number; row: number }): Value[] {
    const values: Value[] = []
    const rowFrom = Math.min(start.row, end.row)
    const rowTo = Math.max(start.row, end.row)
    const colFrom = Math.min(start.col, end.col)
    const colTo = Math.max(start.col, end.col)

    for (let row = rowFrom; row <= rowTo; row += 1) {
      for (let col = colFrom; col <= colTo; col += 1) {
        values.push(this.lookup(row, col))
      }
    }

    return values
  }
}

/** Evaluate one formula. Returns the error code as a string (`#VALUE!`) when
 *  the formula cannot be computed, which is what a sheet itself would show. */
export function evaluateFormula(formula: string, lookup: CellLookup): CellPrimitive {
  const body = formula.startsWith('=') ? formula.slice(1) : formula

  try {
    const value = new Parser(tokenize(body), lookup).parse()

    if (Array.isArray(value)) {
      return (value[0] ?? null) as CellPrimitive
    }

    return value
  } catch (error) {
    return error instanceof FormulaError ? error.code : '#VALUE!'
  }
}
