import { describe, expect, it } from 'vitest'

import type { CellPrimitive } from './excel-format'
import { evaluateFormula, parseReference } from './excel-formula'

/** A tiny sheet: A1..A3 = 1,2,3 and B1 = "x". */
const sheet: Record<string, CellPrimitive> = { '1:1': 1, '1:2': 'x', '2:1': 2, '3:1': 3 }
const lookup = (row: number, col: number) => sheet[`${row}:${col}`] ?? null

const run = (formula: string) => evaluateFormula(formula, lookup)

describe('the sheet formula evaluator', () => {
  it('reads a reference in either absolute form', () => {
    expect(parseReference('B12')).toEqual({ col: 2, row: 12 })
    expect(parseReference('$AA$3')).toEqual({ col: 27, row: 3 })
  })

  it('computes arithmetic with the usual precedence', () => {
    expect(run('=1+2*3')).toBe(7)
    expect(run('=(1+2)*3')).toBe(9)
    expect(run('=2^3^2')).toBe(512)
    expect(run('=-4+1')).toBe(-3)
    expect(run('=50%')).toBe(0.5)
  })

  it('reads cells and ranges', () => {
    expect(run('=A1+A2')).toBe(3)
    expect(run('=SUM(A1:A3)')).toBe(6)
    expect(run('=AVERAGE(A1:A3)')).toBe(2)
    expect(run('=COUNT(A1:B3)')).toBe(3)
    expect(run('=MAX(A1:A3)*10')).toBe(30)
  })

  it('joins text and compares values', () => {
    expect(run('="a"&B1')).toBe('ax')
    expect(run('=A1<A2')).toBe(true)
    expect(run('=A1=1')).toBe(true)
    expect(run('=A1<>1')).toBe(false)
  })

  it('branches and rounds', () => {
    expect(run('=IF(A1>0,"yes","no")')).toBe('yes')
    expect(run('=ROUND(2.345,2)')).toBe(2.35)
    expect(run('=ROUNDDOWN(2.9,0)')).toBe(2)
    expect(run('=CONCATENATE("a","b")')).toBe('ab')
    expect(run('=UPPER(B1)')).toBe('X')
  })

  it('returns the error a sheet would show', () => {
    expect(run('=1/0')).toBe('#DIV/0!')
    expect(run('=NOSUCHFUNC(1)')).toBe('#NAME?')
    expect(run('=IFERROR(1/0,"safe")')).toBe('safe')
  })

  it('refuses to loop on a circular reference', () => {
    const cells: Record<string, string> = { '1:1': 'A2', '2:1': 'A1' }
    const visiting = new Set<string>()

    const circular = (row: number, col: number): CellPrimitive => {
      const key = `${row}:${col}`
      const formula = cells[key]

      if (!formula) {
        return null
      }

      if (visiting.has(key)) {
        return '#CIRCULAR!'
      }

      visiting.add(key)
      const value = evaluateFormula(formula, circular)
      visiting.delete(key)

      return value
    }

    expect(circular(1, 1)).toBe('#CIRCULAR!')
  })
})
