/**
 * A spreadsheet, drawn as a spreadsheet.
 *
 * Column letters, row numbers, the workbook's own fills and fonts, frozen
 * panes, merged ranges, a formula bar, and one tab per sheet. Everything is
 * read from the file's OOXML by `sheet-model`, so what the grid shows is what
 * the workbook says rather than a picture of it: the text stays selectable and
 * the numbers stay numbers.
 */

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { SheetBook, SheetCellView, SheetView } from './sheet-model'
import { cellKey, columnLabel, columnWidthPx, rowHeightPx } from './sheet-model'

const HEADER_HEIGHT = 24
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

function cellStyle(cell: SheetCellView | undefined, align: 'center' | 'left' | 'right'): CSSProperties {
  if (!cell) {
    return { textAlign: align }
  }

  const style: Record<string, string> = { ...cell.css }

  delete style['text-align']

  return { ...(style as CSSProperties), textAlign: cell.align }
}

interface GridProps {
  onSelect: (row: number, col: number) => void
  selection: { col: number; row: number }
  sheet: SheetView
  zoom: number
}

function SheetGrid({ onSelect, selection, sheet, zoom }: GridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const columns = Math.min(sheet.columns, MAX_COLUMNS)

  const rowOffsets = useMemo(
    () => cumulative(sheet.rows, row => rowHeightPx(sheet, row)),
    [sheet]
  )

  useEffect(() => {
    const element = scrollerRef.current

    if (!element || typeof ResizeObserver !== 'function') {
      return
    }

    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight || 600))

    observer.observe(element)
    setViewportHeight(element.clientHeight || 600)

    return () => observer.disconnect()
  }, [])

  const windowed = sheet.rows > WINDOW_THRESHOLD_ROWS
  const firstRow = windowed ? Math.max(1, indexAt(rowOffsets, scrollTop / zoom) + 1 - OVERSCAN_ROWS) : 1

  const lastRow = windowed
    ? Math.min(sheet.rows, indexAt(rowOffsets, (scrollTop + viewportHeight) / zoom) + 1 + OVERSCAN_ROWS)
    : sheet.rows

  const topSpacer = rowOffsets.positions[firstRow - 1]!
  const bottomSpacer = rowOffsets.total - rowOffsets.positions[lastRow]!

  const rows: number[] = []

  for (let row = firstRow; row <= lastRow; row += 1) {
    rows.push(row)
  }

  // A merge whose anchor sits above the window still has to draw, so it is
  // clamped to the first visible row instead of disappearing with its anchor.
  const mergeAt = new Map<string, { colSpan: number; rowSpan: number }>()
  const covered = new Set<string>()

  for (const merge of sheet.merges) {
    const startRow = Math.max(merge.row, firstRow)
    const endRow = Math.min(merge.row + merge.rowSpan - 1, lastRow)

    if (endRow < startRow) {
      continue
    }

    mergeAt.set(cellKey(startRow, merge.col), { colSpan: merge.colSpan, rowSpan: endRow - startRow + 1 })

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = merge.col; col < merge.col + merge.colSpan; col += 1) {
        if (row !== startRow || col !== merge.col) {
          covered.add(cellKey(row, col))
        }
      }
    }
  }

  const headerClass =
    'sticky top-0 z-20 h-6 border-b border-e border-border bg-muted/70 px-1 text-center text-[0.625rem] font-medium text-muted-foreground backdrop-blur-sm'

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-white text-black dark:bg-neutral-950 dark:text-neutral-100"
      onScroll={event => setScrollTop((event.target as HTMLDivElement).scrollTop)}
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
            <th className={cn(headerClass, 'sticky z-30 start-0')} scope="col" />
            {Array.from({ length: columns }, (_unused, index) => (
              <th
                aria-label={columnLabel(index + 1)}
                className={cn(headerClass, selection.col === index + 1 && 'bg-primary/15 text-foreground')}
                key={index}
                scope="col"
              >
                {columnLabel(index + 1)}
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
                className={cn(
                  'sticky start-0 z-10 border-b border-e border-border bg-muted/70 px-1 text-center text-[0.625rem] font-medium tabular-nums text-muted-foreground',
                  selection.row === row && 'bg-primary/15 text-foreground'
                )}
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
                    className={cn(
                      'overflow-hidden whitespace-pre border-b border-e border-border/50 px-1 align-middle',
                      selected && 'outline outline-2 -outline-offset-1 outline-primary'
                    )}
                    colSpan={span?.colSpan}
                    key={col}
                    onClick={() => onSelect(row, col)}
                    rowSpan={span?.rowSpan}
                    style={cellStyle(cell, sheet.rightToLeft ? 'right' : 'left')}
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
  const address = `${columnLabel(selection.col)}${selection.row}`

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/40 px-2">
        <span className="w-14 shrink-0 rounded border border-border/60 bg-muted/40 px-1 text-center text-[0.625rem] font-medium tabular-nums text-muted-foreground">
          {address}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground" dir="auto">
          {current?.formula ? `=${current.formula}` : (current?.text ?? '')}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {trailing}
          <button
            aria-label={t.preview.office.zoomOut}
            className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom(value => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
            type="button"
          >
            −
          </button>
          <button
            className="min-w-10 rounded px-1 text-[0.625rem] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom(1)}
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label={t.preview.office.zoomIn}
            className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.1) * 10) / 10))}
            type="button"
          >
            +
          </button>
        </div>
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
