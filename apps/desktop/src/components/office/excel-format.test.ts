import { isDateFormat } from '@office-kit/xlsx/styles'
import { excelToDate } from '@office-kit/xlsx/utils'
import { describe, expect, it } from 'vitest'

import { formatCellValue, generalNumber, splitFormatSections } from './excel-format'

const text = (value: Parameters<typeof formatCellValue>[0], code?: string) => formatCellValue(value, code).text

describe('Excel number formats', () => {
  it('splits sections without cutting inside quotes or brackets', () => {
    expect(splitFormatSections('#,##0.00;[Red]-#,##0.00;"-";@')).toEqual(['#,##0.00', '[Red]-#,##0.00', '"-"', '@'])
    expect(splitFormatSections('"a;b"#')).toEqual(['"a;b"#'])
  })

  it('routes a date code to the date renderer and a number code to the number one', () => {
    // The library decides; these pin the cases the grid depends on, including
    // the letters that look like date tokens but are inert inside a literal.
    expect(isDateFormat('yyyy-mm-dd')).toBe(true)
    expect(isDateFormat('#,##0.00')).toBe(false)
    expect(isDateFormat('#,##0 "days"')).toBe(false)
    expect(isDateFormat('[$SAR-401]#,##0')).toBe(false)
  })

  it('groups thousands and keeps the format decimals', () => {
    expect(text(70942.5, '#,##0.00')).toBe('70,942.50')
    expect(text(1234, '#,##0')).toBe('1,234')
    expect(text(0.5, '0.000')).toBe('0.500')
    // Rounding happens on the decimal value, not on the binary double.
    expect(text(2.675, '0.00')).toBe('2.68')
  })

  it('shows percentages as percentages', () => {
    expect(text(0.2345, '0.0%')).toBe('23.5%')
    expect(text(1, '0%')).toBe('100%')
  })

  it('keeps a currency literal on the side the code puts it', () => {
    expect(text(12, '"SAR" #,##0.00')).toBe('SAR 12.00')
    expect(text(12, '#,##0.00 [$AED-1]')).toBe('12.00 AED')
  })

  it('uses the negative section when the workbook defines one', () => {
    expect(text(-5, '#,##0.00;(#,##0.00)')).toBe('(5.00)')
    // With no negative section the sign stays on the number itself.
    expect(text(-5, '#,##0.00')).toBe('-5.00')
  })

  it('renders serial dates and times', () => {
    expect(excelToDate(45900).toISOString().slice(0, 10)).toBe('2025-08-31')
    expect(text(45900, 'yyyy-mm-dd')).toBe('2025-08-31')
    expect(text(45900.5, 'yyyy-mm-dd hh:mm')).toBe('2025-08-31 12:00')
    expect(text(45900.5, 'd mmm yyyy')).toBe('31 Aug 2025')
  })

  it('reads m as minutes after an hour and as the month otherwise', () => {
    expect(text(45900.5, 'hh:mm')).toBe('12:00')
    expect(text(45900.5, 'mm/dd')).toBe('08/31')
  })

  it('leaves text alone and aligns it left', () => {
    expect(formatCellValue('Total', '#,##0.00')).toEqual({ align: 'left', text: 'Total' })
    expect(formatCellValue(null, 'General')).toEqual({ align: 'left', text: '' })
  })

  it('shows a general number at full precision without an exponent', () => {
    expect(generalNumber(0.1 + 0.2)).toBe('0.3')
    expect(generalNumber(1234.5)).toBe('1234.5')
    expect(text(true, 'General')).toBe('TRUE')
  })
})
