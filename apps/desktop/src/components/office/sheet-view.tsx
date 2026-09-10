/**
 * A spreadsheet, drawn as a spreadsheet.
 *
 * Column letters, row numbers, the workbook's own fills and fonts, frozen
 * panes, merged ranges, a formula bar, and one tab per sheet. Everything is
 * read from the file's OOXML by `sheet-model`, so what the grid shows is what
 * the workbook says rather than a picture of it: the text stays selectable and
 * the numbers stay numbers.
 */

import { columnLetterFromIndex } from '@office-kit/xlsx/utils'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { SheetBook, SheetView } from './sheet-model'
import { cellKey, columnWidthPx, rowHeightPx } from './sheet-model'
import { ZoomControl } from './zoom-control'

const HEADER_HEIGHT = 24

// Built once. The grid re-renders on every scroll frame and every selection,
// and a class-merge call per cell is the largest thing in that path.
const HEADER_CLASS =
  'sticky top-0 z-20 h-6 border-b border-e border-border bg-muted/70 px-1 text-center text-[0.625rem] font-medium text-muted-foreground backdrop-blur-sm'

const HEADER_CLASS_SELECTED = `${HEADER_CLASS} bg-primary/15 text-foreground`
const CORNER_CLASS = `${HEADER_CLASS} z-30 start-0`

const ROW_HEADER_CLASS =
  'sticky start-0 z-10 border-b border-e border-border bg-muted/70 px-1 text-center text-[0.625rem] font-medium tabular-nums text-muted-foreground'

const ROW_HEADER_CLASS_SELECTED = `${ROW_HEADER_CLASS} bg-primary/15 text-foreground`
const CELL_CLASS = 'overflow-hidden whitespace-pre border-b border-e border-border/50 px-1 align-middle'
const CELL_CLASS_SELECTED = `${CELL_CLASS} outline outline-2 -outline-offset-1 outline-primary`
const ROW_HEADER_WIDTH = 52
/** Below this a sheet renders whole, which keeps merges spanning rows exact. */
const WINDOW_THRESHOLD_ROWS = 300
const OVERSCAN_ROWS = 40
const MAX_COLUMNS = 256

interface Offsets {
  positions: number[]
  total: number
}

function cumulative(count: number, sizeOf: (index: number) => number): Offsets {
  const positions = new Array<number>(count + 1)
  let running = 0

  for (let index = 0; index < count; index += 1) {
    positions[index] = running
    running += sizeOf(index + 1)
  }

  positions[count] = running

  return { positions, total: running }
}

function indexAt(offsets: Offsets, position: number): number {
  const { positions } = offsets
  let low = 0
  let high = positions.length - 1

  while (low < high) {
    const middle = (low + high + 1) >> 1

    if (positions[middle]! <= position) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return low
}

interface GridProps {
  onSelect: (row: number, col: number) => void
  selection: { col: number; row: number }
  sheet: SheetView
  zoom: number
}

function SheetGrid({ onSelect, selection, sheet, zoom }: GridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  // The window is stored as the row range it covers, not as a pixel offset: a
  // scroll frame that does not change which rows are visible must not
  // re-render a grid of thousands of cells.
  const [visible, setVisible] = useState({ first: 1, last: WINDOW_THRESHOLD_ROWS })

  const columns = Math.min(sheet.columns, MAX_COLUMNS)
  const rowOffsets = useMemo(() => cumulative(sheet.rows, row => rowHeightPx(sheet, row)), [sheet])
  const windowed = sheet.rows > WINDOW_THRESHOLD_ROWS

  const remeasure = useCallback(() => {
    const element = scrollerRef.current

    if (!element || !windowed) {
      return
    }

    const top = element.scrollTop / zoom
    const bottom = (element.scrollTop + (element.clientHeight || 600)) / zoom
    const first = Math.max(1, indexAt(rowOffsets, top) + 1 - OVERSCAN_ROWS)
    const last = Math.min(sheet.rows, indexAt(rowOffsets, bottom) + 1 + OVERSCAN_ROWS)

    setVisible(current => (current.first === first && current.last === last ? current : { first, last }))
  }, [rowOffsets, sheet.rows, windowed, zoom])

  useResizeObserver(remeasure, scrollerRef)
  useEffect(remeasure, [remeasure])

  const firstRow = windowed ? visible.first : 1
  const lastRow = windowed ? visible.last : sheet.rows
  const topSpacer = rowOffsets.positions[firstRow - 1]!
  const bottomSpacer = rowOffsets.total - rowOffsets.positions[lastRow]!

  const rows: number[] = []

  for (let row = firstRow; row <= lastRow; row += 1) {
    rows.push(row)
  }

  // A merge whose anchor sits above the window still has to draw, so it is
  // clamped to the first visible row instead of disappearing with its anchor.
  // Rebuilt when the window moves, never on a selection click.
  const { covered, mergeAt } = useMemo(() => {
    const anchors = new Map<string, { colSpan: number; rowSpan: number }>()
    const hidden = new Set<string>()

    for (const merge of sheet.merges) {
      const startRow = Math.max(merge.row, firstRow)
      const endRow = Math.min(merge.row + merge.rowSpan - 1, lastRow)

      if (endRow < startRow) {
        continue
      }

      anchors.set(cellKey(startRow, merge.col), { colSpan: merge.colSpan, rowSpan: endRow - startRow + 1 })

      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = merge.col; col < merge.col + merge.colSpan; col += 1) {
          if (row !== startRow || col !== merge.col) {
            hidden.add(cellKey(row, col))
          }
        }
      }
    }

    return { covered: hidden, mergeAt: anchors }
  }, [firstRow, lastRow, sheet.merges])

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-white text-black dark:bg-neutral-950 dark:text-neutral-100"
      onScroll={windowed ? remeasure : undefined}
      ref={scrollerRef}
    >
      <table
        className="border-collapse"
        dir={sheet.rightToLeft ? 'rtl' : 'ltr'}
        style={{
          fontSize: `${11 * zoom}px`,
          transformOrigin: sheet.rightToLeft ? 'top right' : 'top left',
          width: 'max-content'
        }}
      >
        <colgroup>
          <col style={{ width: ROW_HEADER_WIDTH }} />
          {Array.from({ length: columns }, (_unused, index) => (
            <col key={index} style={{ width: Math.round(columnWidthPx(sheet, index + 1) * zoom) }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: HEADER_HEIGHT }}>
            <th className={CORNER_CLASS} scope="col" />
            {Array.from({ length: columns }, (_unused, index) => (
              <th
                aria-label={columnLetterFromIndex(index + 1)}
                className={selection.col === index + 1 ? HEADER_CLASS_SELECTED : HEADER_CLASS}
                key={index}
                scope="col"
              >
                {columnLetterFromIndex(index + 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topSpacer > 0 && (
            <tr aria-hidden style={{ height: topSpacer * zoom }}>
              <td colSpan={columns + 1} />
            </tr>
          )}
          {rows.map(row => (
            <tr key={row} style={{ height: Math.round(rowHeightPx(sheet, row) * zoom) }}>
              <th
                className={selection.row === row ? ROW_HEADER_CLASS_SELECTED : ROW_HEADER_CLASS}
                scope="row"
              >
                {row}
              </th>
              {Array.from({ length: columns }, (_unused, index) => {
                const col = index + 1
                const key = cellKey(row, col)

                if (covered.has(key)) {
                  return null
                }

                const span = mergeAt.get(key)
                const cell = sheet.cells.get(key)
                const selected = selection.row === row && selection.col === col

                return (
                  <td
                    className={selected ? CELL_CLASS_SELECTED : CELL_CLASS}
                    colSpan={span?.colSpan}
                    key={col}
                    onClick={() => onSelect(row, col)}
                    rowSpan={span?.rowSpan}
                    style={cell?.style}
                  >
                    {cell?.text ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
          {bottomSpacer > 0 && (
            <tr aria-hidden style={{ height: bottomSpacer * zoom }}>
              <td colSpan={columns + 1} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function SheetPreview({ book, trailing }: { book: SheetBook; trailing?: ReactNode }) {
  const { t } = useI18n()
  const [active, setActive] = useState(0)
  const [selection, setSelection] = useState({ col: 1, row: 1 })
  const [zoom, setZoom] = useState(1)
  const sheet = book.sheets[Math.min(active, book.sheets.length - 1)]

  const select = useCallback((row: number, col: number) => setSelection({ col, row }), [])

  useEffect(() => {
    setSelection({ col: 1, row: 1 })
  }, [active])

  if (!sheet) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">{t.preview.office.emptyBook}</div>
  }

  const current = sheet.cells.get(cellKey(selection.row, selection.col))
  const address = `${columnLetterFromIndex(selection.col)}${selection.row}`

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/40 px-2">
        <span className="w-14 shrink-0 rounded border border-border/60 bg-muted/40 px-1 text-center text-[0.625rem] font-medium tabular-nums text-muted-foreground">
          {address}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground" dir="auto">
          {current?.formula ? `=${current.formula}` : (current?.text ?? '')}
        </span>
        <ZoomControl onZoom={setZoom} trailing={trailing} zoom={zoom} />
      </div>
      {book.truncated && (
        <div className="shrink-0 border-b border-border/60 bg-muted/35 px-3 py-1 text-[0.68rem] text-muted-foreground">
          {t.preview.office.sheetTruncated}
        </div>
      )}
      <SheetGrid onSelect={select} selection={selection} sheet={sheet} zoom={zoom} />
      <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/40 px-2">
        {book.sheets.map((entry, index) => (
          <button
            aria-current={index === active ? 'true' : undefined}
            className={cn(
              'shrink-0 rounded-t px-2 py-0.5 text-[0.6875rem] transition-colors',
              index === active
                ? 'bg-background font-semibold text-foreground shadow-[inset_0_-2px_0_0_var(--color-primary)]'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            key={entry.name}
            onClick={() => setActive(index)}
            type="button"
          >
            {entry.name}
          </button>
        ))}
      </div>
    </div>
  )
}
