/**
 * A workbook, reduced to what a grid has to draw.
 *
 * The OOXML reader hands back a rich document model. The view needs one flat
 * thing per sheet: which cells hold what text, how each is styled, which ranges
 * are merged, where the panes freeze, and whether the sheet reads right to
 * left. Doing that reduction here keeps the component free of parser types and
 * makes the whole translation testable against real files.
 */

import type { Cell, CellValue } from '@office-kit/xlsx/cell'
import { cellValueAsPrimitive, getCachedFormulaValue, getFormulaText, isFormulaCell, isRichTextValue, richTextToString } from '@office-kit/xlsx/cell'
import { fromArrayBuffer, loadWorkbook } from '@office-kit/xlsx/io'
import { cellStyleToCss, getCellNumberFormat } from '@office-kit/xlsx/styles'
import { pointToPixel } from '@office-kit/xlsx/utils'
import type { Workbook } from '@office-kit/xlsx/workbook'
import { getSheet, sheetNames } from '@office-kit/xlsx/workbook'
import { getColumnDimension, getFreezePanes, getMaxCol, getMaxRow, getMergedCells, getRowDimension, iterRows } from '@office-kit/xlsx/worksheet'
import type { CSSProperties } from 'react'

import type { CellPrimitive } from './excel-format'
import { formatCellValue } from './excel-format'
import { evaluateFormula, parseReference } from './excel-formula'

/** Excel character units to CSS pixels, at the default 11pt Calibri. */
const PX_PER_CHAR_UNIT = 7
const DEFAULT_COLUMN_PX = 80
const DEFAULT_ROW_PX = 22
/** Beyond this the grid stops being a preview and starts being a memory leak. */
export const SHEET_MAX_CELLS = 400_000

/** Widest sheet the grid draws.
 *
 *  The cap belongs to the model, not to the view, because it is the model that
 *  can tell the reader about it: a sheet cut off at column 256 with nothing
 *  said is data quietly missing from a preview. */
export const SHEET_MAX_COLUMNS = 256

export interface SheetCell {
  /** Present when the cell holds a formula, for the formula bar. */
  formula?: string
  /** The workbook's own fill, font and borders, ready to hand to React. Built
   *  once here rather than per render: the grid re-renders on every scroll
   *  frame and every selection, and this is per visible cell. */
  style: CSSProperties
  text: string
}

export interface SheetMerge {
  col: number
  colSpan: number
  row: number
  rowSpan: number
}

export interface SheetGrid {
  /** Column widths in pixels, keyed by 1-based column. */
  columnWidths: Map<number, number>
  columns: number
  /** Cells keyed `row:col`, 1-based. Empty cells are simply absent. */
  cells: Map<string, SheetCell>
  /** How many leading rows and columns stay pinned. */
  frozenColumns: number
  frozenRows: number
  merges: SheetMerge[]
  name: string
  rightToLeft: boolean
  rowHeights: Map<number, number>
  rows: number
}

export interface SheetBook {
  sheets: SheetGrid[]
  /** Set when the workbook was too large to render whole. */
  truncated?: boolean
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

/** The reader keeps shared-string text as it appears in the XML, so numeric
 *  character references survive into the value. Arabic and every other
 *  non-Latin sheet is unreadable until they are decoded. */
export function decodeXmlText(value: string): string {
  if (!value.includes('&')) {
    return value
  }

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }

    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    }

    const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }

    return named[entity] ?? whole
  })
}

function primitiveOf(cell: Cell): CellPrimitive {
  const value: CellValue = cell.value

  // The rich-text variant wraps its runs: `{ kind: 'rich-text', runs }`. Handing
  // the wrapper to the joiner throws, and a workbook with one styled cell in it
  // took the whole grid down with "Preview unavailable".
  if (isRichTextValue(value)) {
    return decodeXmlText(richTextToString(value.runs))
  }

  const primitive = cellValueAsPrimitive(value)

  return typeof primitive === 'string' ? decodeXmlText(primitive) : (primitive as CellPrimitive)
}

/** The workbook's CSS for one cell, as a React style object. The sheet's own
 *  alignment wins when it declared one; otherwise the format decides, which is
 *  what puts numbers at the end of the line and text at the start. */
function cellStyleOf(css: Record<string, string>, fallbackAlign: 'end' | 'start'): CSSProperties {
  const style: Record<string, string> = {}

  for (const [property, value] of Object.entries(css)) {
    if (property !== 'text-align') {
      style[property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value
    }
  }

  const declared = css['text-align']

  style.textAlign = declared === 'center' || declared === 'left' || declared === 'right' ? declared : fallbackAlign

  return style as CSSProperties
}

const RTL_LETTERS = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0780-\u07bf\u08a0-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/
const LTR_LETTERS = /[A-Za-z\u00c0-\u024f\u0370-\u058f]/

/** True when the sheet's words are mostly written right to left. */
export function mostlyRightToLeft(cells: Map<string, SheetCell>): boolean {
  let rightToLeft = 0
  let leftToRight = 0

  for (const cell of cells.values()) {
    if (RTL_LETTERS.test(cell.text)) {
      rightToLeft += 1
    } else if (LTR_LETTERS.test(cell.text)) {
      leftToRight += 1
    }
  }

  return rightToLeft > leftToRight
}

function readSheet(workbook: Workbook, name: string, locale: string): null | SheetGrid {
  const sheet = getSheet(workbook, name)

  // `sheetNames` and `getSheet` disagree only on a malformed workbook, and a
  // missing sheet is one tab the reader does not get rather than a dead grid.
  if (!sheet) {
    return null
  }

  const rows = Math.max(getMaxRow(sheet), 1)
  const columns = Math.max(getMaxCol(sheet), 1)

  // Raw values first, so a formula anywhere can read any other cell without
  // depending on the order rows arrive in.
  const raw = new Map<string, { cell: Cell; col: number; formula?: string; row: number }>()

  for (const row of iterRows(sheet)) {
    // The iterator is rectangular, so an untouched cell arrives as a hole.
    for (const cell of row) {
      if (!cell) {
        continue
      }

      raw.set(cellKey(cell.row, cell.col), {
        cell,
        col: cell.col,
        formula: isFormulaCell(cell) ? (getFormulaText(cell) ?? undefined) : undefined,
        row: cell.row
      })
    }
  }

  const computed = new Map<string, CellPrimitive>()
  const visiting = new Set<string>()

  const resolve = (row: number, col: number): CellPrimitive => {
    const key = cellKey(row, col)
    const entry = raw.get(key)

    if (!entry) {
      return null
    }

    if (computed.has(key)) {
      return computed.get(key)!
    }

    if (!entry.formula) {
      const value = primitiveOf(entry.cell)

      computed.set(key, value)

      return value
    }

    // A workbook written by Excel caches each result; one written by a library
    // does not, so the preview computes it rather than showing a blank.
    const cached = getCachedFormulaValue(entry.cell)

    if (cached !== undefined && cached !== null) {
      const value = typeof cached === 'string' ? decodeXmlText(cached) : (cached as CellPrimitive)

      computed.set(key, value)

      return value
    }

    if (visiting.has(key)) {
      return '#CIRCULAR!'
    }

    visiting.add(key)
    const value = evaluateFormula(entry.formula, resolve)
    visiting.delete(key)
    computed.set(key, value)

    return value
  }

  const cells = new Map<string, SheetCell>()

  for (const [key, entry] of raw) {
    const value = resolve(entry.row, entry.col)

    if (value === null || value === '') {
      continue
    }

    const format = getCellNumberFormat(workbook, entry.cell)
    const formatted = formatCellValue(value, typeof format === 'string' ? format : undefined, locale)
    const css = cellStyleToCss(workbook, entry.cell) ?? {}

    cells.set(key, {
      ...(entry.formula ? { formula: entry.formula } : {}),
      style: cellStyleOf(css, formatted.align),
      text: formatted.text
    })
  }

  const merges: SheetMerge[] = []

  for (const area of getMergedCells(sheet)) {
    const startRow = Math.min(area.minRow, area.maxRow)
    const startCol = Math.min(area.minCol, area.maxCol)
    const rowSpan = Math.abs(area.maxRow - area.minRow) + 1
    const colSpan = Math.abs(area.maxCol - area.minCol) + 1

    merges.push({ col: startCol, colSpan, row: startRow, rowSpan })
  }

  const columnWidths = new Map<number, number>()

  for (let col = 1; col <= columns; col += 1) {
    const dimension = getColumnDimension(sheet, col)

    if (dimension?.hidden) {
      columnWidths.set(col, 0)
    } else if (typeof dimension?.width === 'number') {
      columnWidths.set(col, Math.round(dimension.width * PX_PER_CHAR_UNIT))
    }
  }

  const rowHeights = new Map<number, number>()

  for (let row = 1; row <= rows; row += 1) {
    const dimension = getRowDimension(sheet, row)

    if (dimension?.hidden) {
      rowHeights.set(row, 0)
    } else if (typeof dimension?.height === 'number') {
      rowHeights.set(row, Math.round(pointToPixel(dimension.height)))
    }
  }

  const view = sheet.views[0]
  const freeze = getFreezePanes(sheet)
  let frozenRows = 0
  let frozenColumns = 0

  if (typeof freeze === 'string' && freeze) {
    try {
      const anchor = parseReference(freeze)

      frozenRows = Math.max(0, anchor.row - 1)
      frozenColumns = Math.max(0, anchor.col - 1)
    } catch {
      // An unparseable anchor just means nothing is pinned.
    }
  }

  return {
    cells,
    columnWidths,
    columns,
    frozenColumns,
    frozenRows,
    merges,
    name,
    // A sheet Excel saved records its own direction. One written by a library
    // usually does not, so a sheet whose words are Arabic or Hebrew is read
    // right to left anyway: column A on the right, as its author sees it.
    rightToLeft: view?.rightToLeft ?? mostlyRightToLeft(cells),
    rowHeights,
    rows
  }
}

export function columnWidthPx(sheet: SheetGrid, col: number): number {
  return sheet.columnWidths.get(col) ?? DEFAULT_COLUMN_PX
}

export function rowHeightPx(sheet: SheetGrid, row: number): number {
  return sheet.rowHeights.get(row) ?? DEFAULT_ROW_PX
}

/** Read a workbook's OOXML bytes into the grid's model.
 *
 *  `locale` names the month and weekday names a date format renders in, so a
 *  `dddd, mmmm d` column reads in the app's language rather than always in
 *  English. It changes nothing else: values, formats and layout come from the
 *  file. */
export async function readSheetBook(bytes: Uint8Array, locale?: string): Promise<SheetBook> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const workbook = await loadWorkbook(fromArrayBuffer(buffer))
  const sheets: SheetGrid[] = []
  let truncated = false

  for (const name of sheetNames(workbook)) {
    const sheet = readSheet(workbook, name, locale ?? 'en')

    if (!sheet) {
      continue
    }

    if (sheet.columns > SHEET_MAX_COLUMNS) {
      truncated = true
      sheet.columns = SHEET_MAX_COLUMNS
    }

    if (sheet.rows * sheet.columns > SHEET_MAX_CELLS) {
      truncated = true
      sheet.rows = Math.min(sheet.rows, Math.max(1, Math.floor(SHEET_MAX_CELLS / Math.max(sheet.columns, 1))))
    }

    sheets.push(sheet)
  }

  return truncated ? { sheets, truncated } : { sheets }
}
