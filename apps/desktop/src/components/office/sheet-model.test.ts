/**
 * @vitest-environment node
 *
 * The model is pure data work, and the OOXML writer this test builds its
 * fixture with checks `instanceof Uint8Array` across realms, which jsdom's
 * separate globals break. Nothing here touches the DOM.
 */
/**
 * The workbook reduction, exercised against a real .xlsx built here rather
 * than a fixture checked into the tree: the test writes the file, reads it
 * back through the same door the rail uses, and asserts on the grid.
 */

import { setFormula } from '@office-kit/xlsx/cell'
import { workbookToBytes } from '@office-kit/xlsx/io'
import { setBold, setCellBackgroundColor, setCellNumberFormat } from '@office-kit/xlsx/styles'
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook'
import { mergeCells, setCell, setFreezePanes } from '@office-kit/xlsx/worksheet'
import { describe, expect, it } from 'vitest'

import { cellKey, columnLabel, decodeXmlText, readSheetBook } from './sheet-model'

async function buildWorkbook(rows: (number | string)[][], options: { arabic?: boolean } = {}) {
  const workbook = createWorkbook()
  const sheet = addWorksheet(workbook, options.arabic ? 'التقرير' : 'Q3')

  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      setCell(sheet, rowIndex + 1, colIndex + 1, value)
    })
  })

  const header = setCell(sheet, 1, 1, rows[0]?.[0] ?? '')

  setBold(workbook, header, true)
  setCellBackgroundColor(workbook, header, '305496')
  setFreezePanes(sheet, 'A2')

  return { sheet, workbook }
}

describe('reading a workbook into the grid', () => {
  it('labels columns the way a sheet does', () => {
    expect(columnLabel(1)).toBe('A')
    expect(columnLabel(26)).toBe('Z')
    expect(columnLabel(27)).toBe('AA')
    expect(columnLabel(703)).toBe('AAA')
  })

  it('decodes the character references the reader leaves in shared strings', () => {
    expect(decodeXmlText('&#1575;&#1604;&#1605;&#1606;&#1578;&#1580;')).toBe('المنتج')
    expect(decodeXmlText('a &amp; b')).toBe('a & b')
    expect(decodeXmlText('plain')).toBe('plain')
  })

  it('carries values, styles and frozen panes across', async () => {
    const { workbook } = await buildWorkbook([
      ['Product', 'Units'],
      ['Widget', 10]
    ])

    const book = await readSheetBook(await workbookToBytes(workbook))
    const sheet = book.sheets[0]!

    expect(sheet.name).toBe('Q3')
    expect(sheet.cells.get(cellKey(1, 1))?.text).toBe('Product')
    expect(sheet.cells.get(cellKey(2, 2))?.text).toBe('10')
    expect(sheet.cells.get(cellKey(1, 1))?.css['font-weight']).toBe('bold')
    expect(sheet.cells.get(cellKey(1, 1))?.css['background-color']).toBe('#305496')
    expect(sheet.frozenRows).toBe(1)
    expect(sheet.frozenColumns).toBe(0)
  })

  it('computes a formula the writer left without a cached result', async () => {
    // openpyxl and every other pure library writes the formula and no value,
    // which is why a generated total column used to preview as blank.
    const { sheet, workbook } = await buildWorkbook([
      ['Units', 'Price', 'Total'],
      [10, 25.5, 0],
      [4, 2, 0]
    ])

    const total = setCell(sheet, 4, 3)

    setFormula(setCell(sheet, 2, 3), 'A2*B2')
    setFormula(setCell(sheet, 3, 3), 'A3*B3')
    setFormula(total, 'SUM(C2:C3)')
    setCellNumberFormat(workbook, total, '#,##0.00')

    const book = await readSheetBook(await workbookToBytes(workbook))
    const cells = book.sheets[0]!.cells

    expect(cells.get(cellKey(2, 3))?.text).toBe('255')
    expect(cells.get(cellKey(4, 3))?.text).toBe('263.00')
    // The formula itself stays available for the formula bar.
    expect(cells.get(cellKey(4, 3))?.formula).toBe('SUM(C2:C3)')
  })

  it('records a merged range once, anchored at its top-left cell', async () => {
    const { sheet, workbook } = await buildWorkbook([
      ['Title', '', ''],
      ['a', 'b', 'c']
    ])

    mergeCells(sheet, 'A1:C1')

    const book = await readSheetBook(await workbookToBytes(workbook))
    const view = book.sheets[0]!

    expect(view.merges).toEqual([{ col: 1, colSpan: 3, row: 1, rowSpan: 1 }])
  })

  it('reads an Arabic sheet right to left even when the file does not say so', async () => {
    // A sheet Excel saved records its own direction; one a library wrote does
    // not, and column A still belongs on the right.
    const { workbook } = await buildWorkbook(
      [
        ['المنتج', 'المنطقة'],
        ['قلم', 'شمال']
      ],
      { arabic: true }
    )

    const book = await readSheetBook(await workbookToBytes(workbook))

    expect(book.sheets[0]!.rightToLeft).toBe(true)
    expect(book.sheets[0]!.cells.get(cellKey(1, 1))?.text).toBe('المنتج')
  })

  it('leaves an English sheet reading left to right', async () => {
    const { workbook } = await buildWorkbook([
      ['Product', 'Region'],
      ['Pen', 'North']
    ])

    const book = await readSheetBook(await workbookToBytes(workbook))

    expect(book.sheets[0]!.rightToLeft).toBe(false)
  })
})
