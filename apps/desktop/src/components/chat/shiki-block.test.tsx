import { StrictMode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ShikiBlock from './shiki-block'
import { SHIKI_THEME } from './shiki-highlighter'

declare global {
   
  namespace JSX {
    interface IntrinsicElements {
      'shiki-stub': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

vi.mock('react-shiki', () => ({
  default: (props: { children?: unknown }) => <code data-stub="1">{String(props.children ?? '')}</code>
}))

// The mock highlighter renders `code[data-stub]`; plain pre-admission blocks
// are `code` without the marker.
const pairs = (host: HTMLElement) => ({
  stubs: host.querySelectorAll('code[data-stub]').length,
  plain: host.querySelectorAll('code:not([data-stub])').length
})

describe('ShikiBlock mount queue', () => {
  let host: HTMLElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  const renderNodes = (nodes: React.ReactNode) => {
    act(() => {
      root.render(<StrictMode>{nodes}</StrictMode>)
    })
  }

  const block = (key: string, code: string) => (
    <ShikiBlock className="x" key={key} language="ts" theme={SHIKI_THEME}>
      {code}
    </ShikiBlock>
  )

  it('admits a lone block immediately (queue empty, slot free)', () => {
    renderNodes(block('a', 'first block'))

    expect(host.querySelectorAll('code[data-stub]')).toHaveLength(1)
    expect(host.querySelectorAll('code[data-stub]')[0]?.textContent).toBe('first block')
  })

  it('staggered admission: the second of a same-commit pair waits for the slot', () => {
    // Two blocks mount together — the open-a-session herd.
    renderNodes([block('a', 'block a'), block('b', 'block b')])

    // At most one real highlighter may be up; the other shows plain code.
    const { stubs, plain } = pairs(host)
    expect(stubs).toBeLessThanOrEqual(1)
    expect(plain).toBeGreaterThanOrEqual(1)

    // Advance past the release gap — the queued block must admit.
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(host.querySelectorAll('code[data-stub]')).toHaveLength(2)
  })

  it('releases the slot when a queued block unmounts before admission', () => {
    renderNodes(block('a', 'stays'))
    expect(host.querySelectorAll('code[data-stub]')).toHaveLength(1)

    // Queue a second block, then take it away before its turn.
    renderNodes([block('a', 'stays'), block('b', 'leaving')])
    renderNodes(block('a', 'stays'))

    // The first block still holds the slot.
    expect(host.querySelectorAll('code[data-stub]')).toHaveLength(1)

    // Release gap elapses → the unmount released nothing extra, the slot
    // cycles once, and a fresh block admits without a second wait.
    act(() => {
      vi.advanceTimersByTime(150)
    })

    renderNodes([block('a', 'stays'), block('c', 'newcomer')])

    // The newcomer admits immediately: the leaked-ticket regression would
    // leave it as plain code here.
    expect(host.querySelectorAll('code[data-stub]')).toHaveLength(2)
    expect(pairs(host).plain).toBe(0)
  })
})
