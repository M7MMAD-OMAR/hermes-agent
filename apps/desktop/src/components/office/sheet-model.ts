/**
 * A workbook, reduced to what a grid has to draw.
 *
 * The OOXML reader hands back a rich document model. The view needs one flat
 * thing per sheet: which cells hold what text, how each is styled, which ranges
 * are merged, where the panes freeze, and whether the sheet reads right to
 * left. Doing that reduction here keeps the component free of parser types and
 * makes the whole translation testable against real files.
 */

import { cellValueAsPrimitive, getCachedFormulaValue, getFormulaText, isFormulaCell, isRichTextCell, richTextToString } from '@office-kit/xlsx/cell'
import { fromArrayBuffer, loadWorkbook } from '@office-kit/xlsx/io'
import { cellStyleToCss, getCellNumberFormat } from '@office-kit/xlsx/styles'
import { getSheet, sheetNames } from '@office-kit/xlsx/workbook'
import { getColumnDimension, getFreezePanes, getMaxCol, getMaxRow, getMergedCells, getRowDimension, iterRows } from '@office-kit/xlsx/worksheet'

import type { CellPrimitive } from './excel-format'
import { formatCellValue } from './excel-format'
import { evaluateFormula, parseReference } from './excel-formula'

/** Excel character units to CSS pixels, at the default 11pt Calibri. */
const PX_PER_CHAR_UNIT = 7
const DEFAULT_COLUMN_PX = 80
const DEFAULT_ROW_PX = 22
const PX_PER_POINT = 96 / 72
/** Beyond this the grid stops being a preview and starts being a memory leak. */
export const SHEET_MAX_CELLS = 400_000

export interface SheetCellView {
  align: 'center' | 'left' | 'right'
  /** Inline style straight from the workbook's own fills, fonts and borders. */
  css: Record<string, string>
  /** Present when the cell holds a formula, for the formula bar. */
  formula?: string
  text: string
}

export interface SheetMerge {
  col: number
  colSpan: number
  row: number
  rowSpan: number
}

export interface SheetView {
  /** Column widths in pixels, keyed by 1-based column. */
  columnWidths: Map<number, number>
  columns: number
  /** Cells keyed `row:col`, 1-based. Empty cells are simply absent. */
  cells: Map<string, SheetCellView>
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
  sheets: SheetView[]
  /** Set when the workbook was too large to render whole. */
  truncated?: boolean
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

/** `1` → A, `27` → AA. The grid's column headers. */
export function columnLabel(col: number): string {
  let label = ''
  let value = col

  while (value > 0) {
    const remainder = (value - 1) % 26

    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }

  return label
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

function primitiveOf(cell: unknown): CellPrimitive {
  if (isRichTextCell(cell as never)) {
    return decodeXmlText(richTextToString((cell as { value: never }).value))
  }

  const value = cellValueAsPrimitive((cell as { value: never }).value)

  return typeof value === 'string' ? decodeXmlText(value) : (value as CellPrimitive)
}

/** Where the sheet's own alignment lands once the format has had its say. */
function alignmentOf(css: Record<string, string>, fallback: 'left' | 'right'): 'center' | 'left' | 'right' {
  const declared = css['text-align']

  if (declared === 'center' || declared === 'left' || declared === 'right') {
    return declared
  }

  return fallback
}

const RTL_LETTERS = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0780-\u07bf\u08a0-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/
const LTR_LETTERS = /[A-Za-z\u00c0-\u024f\u0370-\u058f]/

/** True when the sheet's words are mostly written right to left. */
export function mostlyRightToLeft(cells: Map<string, SheetCellView>): boolean {
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

function readSheet(workbook: unknown, name: string): SheetView {
  const sheet = getSheet(workbook as never, name) as never
  const rows = Math.max(getMaxRow(sheet), 1)
  const columns = Math.max(getMaxCol(sheet), 1)

  // Raw values first, so a formula anywhere can read any other cell without
  // depending on the order rows arrive in.
  const raw = new Map<string, { cell: unknown; formula?: string }>()

  for (const row of iterRows(sheet)) {
    // The iterator is rectangular, so an untouched cell arrives as a hole.
    for (const cell of row) {
      if (!cell) {
        continue
      }

      const entry = cell as { col: number; row: number }

      raw.set(cellKey(entry.row, entry.col), {
        cell,
        formula: isFormulaCell(cell as never) ? (getFormulaText(cell as never) ?? undefined) : undefined
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
    const cached = getCachedFormulaValue(entry.cell as never)

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

  const cells = new Map<string, SheetCellView>()

  for (const [key, entry] of raw) {
    const position = key.split(':')
    const row = Number(position[0])
    const col = Number(position[1])
    const value = resolve(row, col)

    if (value === null || value === '') {
      continue
    }

    const format = getCellNumberFormat(workbook as never, entry.cell as never)
    const formatted = formatCellValue(value, typeof format === 'string' ? format : undefined)
    const css = (cellStyleToCss(workbook as never, entry.cell as never) ?? {}) as Record<string, string>

    cells.set(key, {
      align: alignmentOf(css, formatted.align),
      css,
      ...(entry.formula ? { formula: entry.formula } : {}),
      text: formatted.text
    })
  }

  const merges: SheetMerge[] = []

  for (const range of getMergedCells(sheet) ?? []) {
    const area = range as { maxCol: number; maxRow: number; minCol: number; minRow: number }
    const startRow = Math.min(area.minRow, area.maxRow)
    const startCol = Math.min(area.minCol, area.maxCol)
    const rowSpan = Math.abs(area.maxRow - area.minRow) + 1
    const colSpan = Math.abs(area.maxCol - area.minCol) + 1

    merges.push({ col: startCol, colSpan, row: startRow, rowSpan })
  }

  const columnWidths = new Map<number, number>()

  for (let col = 1; col <= columns; col += 1) {
    const dimension = getColumnDimension(sheet, col) as { hidden?: boolean; width?: number } | undefined

    if (dimension?.hidden) {
      columnWidths.set(col, 0)
    } else if (typeof dimension?.width === 'number') {
      columnWidths.set(col, Math.round(dimension.width * PX_PER_CHAR_UNIT))
    }
  }

  const rowHeights = new Map<number, number>()

  for (let row = 1; row <= rows; row += 1) {
    const dimension = getRowDimension(sheet, row) as { height?: number; hidden?: boolean } | undefined

    if (dimension?.hidden) {
      rowHeights.set(row, 0)
    } else if (typeof dimension?.height === 'number') {
      rowHeights.set(row, Math.round(dimension.height * PX_PER_POINT))
    }
  }

  const view = ((sheet as { views?: { rightToLeft?: boolean }[] }).views ?? [])[0]
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

export function columnWidthPx(sheet: SheetView, col: number): number {
  return sheet.columnWidths.get(col) ?? DEFAULT_COLUMN_PX
}

export function rowHeightPx(sheet: SheetView, row: number): number {
  return sheet.rowHeights.get(row) ?? DEFAULT_ROW_PX
}

/** Read a workbook's OOXML bytes into the grid's model. */
export async function readSheetBook(bytes: Uint8Array): Promise<SheetBook> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const workbook = await loadWorkbook(fromArrayBuffer(buffer))
  const sheets: SheetView[] = []
  let truncated = false

  for (const name of sheetNames(workbook)) {
    const sheet = readSheet(workbook, name)

    if (sheet.rows * sheet.columns > SHEET_MAX_CELLS) {
      truncated = true
      sheet.rows = Math.min(sheet.rows, Math.max(1, Math.floor(SHEET_MAX_CELLS / Math.max(sheet.columns, 1))))
    }

    sheets.push(sheet)
  }

  return truncated ? { sheets, truncated } : { sheets }
}
