import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $paneStates, setPaneWidthOverride } from '@/store/panes'
import { $embeddedBrowserExpanded, $embeddedBrowserSessions, $previewTabs } from '@/store/preview'

import { EmbeddedBrowserPanel } from './embedded-browser-panel'

// These tests pin what the panel IS, not what it contains: a full-height pane
// BESIDE the transcript, sized on the width axis, with one seam and no card
// chrome. The stacked-band version it replaced looked fine in isolation — the
// regression to catch is a height/margin/border creeping back in, which no
// screenshot-free test would notice unless it asserts on the axis itself.

// A real atom, not a hand-rolled stub: `useStore` subscribes through `listen`,
// which every shorthand mock of a nanostore forgets to provide.
vi.mock('@/app/contrib/panes', async () => {
  const { atom } = await import('nanostores')

  return { $restartPreviewServer: atom(null) }
})

// The pane mounts a real <webview>; the panel's own layout is the subject here.
vi.mock('./right-rail/preview-pane', () => ({ PreviewPane: () => <div data-testid="pane" /> }))

const SESSION = 'sess-1'

beforeEach(() => {
  $embeddedBrowserSessions.set(new Set([SESSION]))
  $embeddedBrowserExpanded.set(new Set([SESSION]))
  $previewTabs.set([])
  $paneStates.set({})
})

afterEach(() => {
  cleanup()
  $embeddedBrowserSessions.set(new Set())
  $embeddedBrowserExpanded.set(new Set())
  $paneStates.set({})
})

function renderPanel() {
  const { container } = render(
    <div style={{ width: '1000px' }}>
      <EmbeddedBrowserPanel sessionId={SESSION} />
    </div>
  )

  const panel = container.querySelector('[data-embedded-browser]') as HTMLElement

  return { panel }
}

describe('EmbeddedBrowserPanel', () => {
  it('docks beside the transcript: sized on width, full height, no card chrome', () => {
    const { panel } = renderPanel()

    // The width axis is the negotiable one — a height here is the old band.
    expect(panel.style.width).toBe('45%')
    expect(panel.style.height).toBe('')
    expect(panel.className).toContain('h-full')

    // "No white edges": no outer margin, no radius, no box border. The only
    // stroke the pane owns is the seam, which is a child.
    expect(panel.className).not.toMatch(/\bm[xytblrse]?-\d/)
    expect(panel.className).not.toMatch(/\brounded/)
    expect(panel.className).not.toMatch(/\bborder\b/)
  })

  it('keeps the seam on the physical left, the edge that faces the transcript', () => {
    const { panel } = renderPanel()
    const sash = panel.querySelector('[data-embedded-browser-sash]') as HTMLElement

    expect(sash.className).toContain('left-0')
    // `start-0` would follow the reading direction and land on the window's
    // outer edge under RTL, where there is nothing to resize against.
    expect(sash.className).not.toContain('start-0')
  })

  it('honours a stored width over the default fraction', () => {
    setPaneWidthOverride('chat.embedded-browser', 640)

    const { panel } = renderPanel()

    expect(panel.style.width).toBe('640px')
  })

  it('double-clicking the seam restores the default split', () => {
    setPaneWidthOverride('chat.embedded-browser', 640)

    const { panel } = renderPanel()
    const sash = panel.querySelector('[data-embedded-browser-sash]') as HTMLElement

    fireEvent.doubleClick(sash)

    expect(panel.style.width).toBe('45%')
  })

  it('collapses to nothing rather than a sliver when parked', () => {
    $embeddedBrowserExpanded.set(new Set())

    const { panel } = renderPanel()

    expect(panel.className).toContain('hidden')
  })
})
