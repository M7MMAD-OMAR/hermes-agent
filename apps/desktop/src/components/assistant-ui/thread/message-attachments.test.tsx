import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $previewTabs, closeRightRail } from '@/store/preview'

import { MessageAttachments } from './message-attachments'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }

function installDesktopBridge() {
  const openExternal = vi.fn().mockResolvedValue(undefined)

  desktopWindow.hermesDesktop = {
    openExternal,
    readFileDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAA')
  } as unknown as Window['hermesDesktop']

  return openExternal
}

afterEach(() => {
  closeRightRail()
  vi.restoreAllMocks()
  cleanup()
  delete desktopWindow.hermesDesktop
  document.body.replaceChildren()
})

// The complaint this replaced: a sent attachment rendered as an inert line of
// raw absolute path, with nothing saying what kind of file it was and no way to
// look at it.
describe('attachments on a sent message', () => {
  // A quoted value is the wire form for a path with spaces; an unquoted one
  // still arrives from older messages and must not shatter into three tiles.
  it.each([
    '@file:`/home/me/.hermes/profiles/dn/attachments/Website Review V2-2.pdf`',
    '@file:/home/me/.hermes/profiles/dn/attachments/Website Review V2-2.pdf'
  ])('keeps a name with spaces whole: %s', ref => {
    render(<MessageAttachments refs={[ref]} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('Website Review V2-2.pdf')).toBeTruthy()
  })

  it('names the file rather than the path it came from', () => {
    render(<MessageAttachments refs={['@file:/home/me/.hermes/profiles/dn/attachments/Website Review V2-2.pdf']} />)

    expect(screen.getByText('Website Review V2-2.pdf')).toBeTruthy()
    expect(screen.queryByText(/\/home\/me\/\.hermes/)).toBeNull()
  })

  it('shows the format on the tile so two attachments are told apart at a glance', () => {
    render(<MessageAttachments refs={['@file:/tmp/report.pdf', '@file:/tmp/data.csv']} />)

    expect(screen.getByText('PDF')).toBeTruthy()
    expect(screen.getByText('CSV')).toBeTruthy()
  })

  it('opens a file in the preview pane when its tile is clicked', async () => {
    installDesktopBridge()
    render(<MessageAttachments refs={['@file:/tmp/report.pdf']} />)

    fireEvent.click(screen.getByRole('button', { name: /report\.pdf/ }))

    await waitFor(() => expect($previewTabs.get().length).toBeGreaterThan(0))
  })

  it('renders one tile per reference, whatever the mix of kinds', () => {
    installDesktopBridge()
    render(<MessageAttachments refs={['@file:/tmp/a.pdf', '@image:/tmp/b.png', '@url:https://example.com/docs']} />)

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText('URL')).toBeTruthy()
  })

  it('holds a long list behind one expander, and lets it back out', () => {
    const refs = Array.from({ length: 14 }, (_, index) => `@file:/tmp/file-${index}.txt`)

    render(<MessageAttachments refs={refs} />)

    // Eight tiles plus the expander: a folder's worth of files must not bury
    // the message it belongs to.
    expect(screen.getAllByRole('button')).toHaveLength(9)

    fireEvent.click(screen.getByText('Show all 14'))
    expect(screen.getAllByRole('button')).toHaveLength(15)

    fireEvent.click(screen.getByText('Show fewer'))
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })

  it('does not offer an expander for a handful', () => {
    render(<MessageAttachments refs={['@file:/tmp/a.txt', '@file:/tmp/b.txt']} />)

    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByText(/Show all/)).toBeNull()
  })

  it('renders nothing at all when a message carries no attachments', () => {
    const { container } = render(<MessageAttachments refs={[]} />)

    expect(container.textContent).toBe('')
  })
})
