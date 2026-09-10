/**
 * The grid itself: what a reader sees, not what the model holds. The rail's
 * whole complaint was that a workbook did not look like a workbook, so the
 * checks here are the visible parts of one.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { SheetBook, SheetCellView, SheetView } from './sheet-model'
import { cellKey } from './sheet-model'
import { SheetPreview } from './sheet-view'

/** Queries scoped to the grid, so the formula bar's copy of the selected
 *  cell's text never stands in for the cell itself. */
function grid() {
  return within(document.querySelector('table') as HTMLElement)
}

function sheet(overrides: Partial<SheetView> = {}): SheetView {
  const cells = new Map<string, SheetCellView>([
    [cellKey(1, 1), { align: 'left' as const, css: { 'font-weight': 'bold' }, text: 'Product' }],
    [cellKey(1, 2), { align: 'left' as const, css: {}, text: 'Total' }],
    [cellKey(2, 1), { align: 'left' as const, css: {}, text: 'Widget' }],
    [cellKey(2, 2), { align: 'right' as const, css: {}, formula: 'A2*3', text: '70,942.50' }]
  ])

  return {
    cells,
    columns: 2,
    columnWidths: new Map(),
    frozenColumns: 0,
    frozenRows: 1,
    merges: [],
    name: 'Q3',
    rightToLeft: false,
    rowHeights: new Map(),
    rows: 2,
    ...overrides
  }
}

const book = (...sheets: SheetView[]): SheetBook => ({ sheets })

afterEach(cleanup)

describe('the spreadsheet grid', () => {
  it('draws column letters, row numbers and the cells between them', () => {
    render(<SheetPreview book={book(sheet())} />)

    expect(screen.getByRole('columnheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '1' })).toBeTruthy()
    expect(grid().getByText('70,942.50')).toBeTruthy()
  })

  it('keeps the styling the workbook gave the cell', () => {
    render(<SheetPreview book={book(sheet())} />)

    expect((grid().getByText('Product') as HTMLElement).style.fontWeight).toBe('bold')
  })

  it('shows the selected cell address and its formula in the formula bar', () => {
    render(<SheetPreview book={book(sheet())} />)

    fireEvent.click(grid().getByText('70,942.50'))

    expect(screen.getByText('B2')).toBeTruthy()
    expect(screen.getByText('=A2*3')).toBeTruthy()
  })

  it('gives every sheet a tab and switches between them', () => {
    const second = sheet({
      cells: new Map<string, SheetCellView>([[cellKey(1, 1), { align: 'left', css: {}, text: 'Second sheet' }]]),
      name: 'Notes'
    })

    render(<SheetPreview book={book(sheet(), second)} />)

    expect(grid().queryByText('Second sheet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(grid().getByText('Second sheet')).toBeTruthy()
  })

  it('lays an Arabic sheet out right to left', () => {
    const { container } = render(<SheetPreview book={book(sheet({ rightToLeft: true }))} />)

    expect(container.querySelector('table')?.getAttribute('dir')).toBe('rtl')
  })

  it('spans a merged range across the cells it covers', () => {
    const merged = sheet({ merges: [{ col: 1, colSpan: 2, row: 1, rowSpan: 1 }] })

    render(<SheetPreview book={book(merged)} />)

    const anchor = grid().getByText('Product').closest('td')

    expect(anchor?.getAttribute('colspan')).toBe('2')
    // The cell the merge swallowed is not drawn a second time.
    expect(grid().queryByText('Total')).toBeNull()
  })

  it('says so when the workbook has no sheets at all', () => {
    render(<SheetPreview book={book()} />)

    expect(screen.getByText('This workbook has no sheets.')).toBeTruthy()
  })
})
