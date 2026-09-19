/**
 * Hover-peek: resting on a titlebar sidebar toggle shows that side without
 * docking it.
 *
 * The whole point of the feature is that NOTHING MOVES. The collapsed side
 * comes back as a floated layer over the row, so the panes beside it keep the
 * exact geometry they had while the side was hidden, and the pane itself is
 * the same mounted instance it always was rather than a second copy with its
 * own subscriptions and its own idea of which chats are pinned.
 *
 * These tests pin both halves of that: the floated wrapper leaves the flow
 * (no flex track, no `display: none`), and its siblings' inline sizing is
 * byte-identical to the un-peeked collapsed layout.
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { $paneStates } from '@/store/panes'

import { group, split } from '../model'
import { $collapsedTreeSides, $hiddenTreePanes, $layoutTree, $peekedTreeSide, setPeekedTreeSide } from '../store'

import { TreeSplit } from './tree-split'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const disposers: (() => void)[] = []

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

beforeEach(() => {
  window.localStorage.clear()
  $hiddenTreePanes.set(new Set())
  $collapsedTreeSides.set(new Set())
  $peekedTreeSide.set(null)
  $paneStates.set({})

  disposers.push(
    registry.register({
      area: 'panes',
      data: { placement: 'left', width: '237px' },
      id: 'sessions',
      render: () => null,
      title: 'Sessions'
    }),
    registry.register({ area: 'panes', data: { placement: 'main' }, id: 'chat', render: () => null, title: 'Chat' })
  )
})

afterEach(() => {
  cleanup()
  $layoutTree.set(null)
  $collapsedTreeSides.set(new Set())
  $peekedTreeSide.set(null)
  $paneStates.set({})
  disposers.splice(0).forEach(dispose => dispose())
})

function renderRow() {
  const tree = split('row', [group(['sessions'], { id: 'rail' }), group(['chat'], { id: 'main' })], [0, 1], 'root-row')

  $layoutTree.set(tree)
  render(<TreeSplit node={tree} root rootRow />)

  const container = document.querySelector<HTMLElement>('[data-tree-split="root-row"]')!
  const [rail, main] = [...container.children] as HTMLElement[]

  return { main, rail }
}

describe('peeking a collapsed side', () => {
  it('hides the side when it is collapsed and nothing is peeked', () => {
    $collapsedTreeSides.set(new Set(['left']))

    const { rail } = renderRow()

    expect(rail.style.display).toBe('none')
    expect(rail.className).not.toMatch(/\babsolute\b/)
  })

  it('floats the collapsed side out of the flow while it is peeked', () => {
    $collapsedTreeSides.set(new Set(['left']))
    $peekedTreeSide.set('left')

    const { rail } = renderRow()

    // Out of flow: shown, absolutely placed on its own edge, no flex track.
    expect(rail.style.display).not.toBe('none')
    expect(rail.className).toMatch(/\babsolute\b/)
    expect(rail.className).toMatch(/\bleft-0\b/)
    expect(rail.style.flex).toBe('')
    // Sized to the pane's own docked width, not a fat fixed default.
    expect(rail.style.width).toBe('237px')
    expect(rail.dataset.peekedSide).toBe('left')
  })

  it('leaves every sibling exactly where the collapsed layout put it', () => {
    $collapsedTreeSides.set(new Set(['left']))

    const collapsed = renderRow()
    const before = collapsed.main.getAttribute('style')

    cleanup()
    $peekedTreeSide.set('left')

    const peeked = renderRow()

    expect(peeked.main.getAttribute('style')).toBe(before)
  })

  it('does not float a side that is not collapsed', () => {
    $peekedTreeSide.set('left')

    const { rail } = renderRow()

    expect(rail.className).not.toMatch(/\babsolute\b/)
  })

  it('ends the peek when the pointer leaves the floated side', () => {
    $collapsedTreeSides.set(new Set(['left']))
    setPeekedTreeSide('left')

    const { rail } = renderRow()

    fireEvent.mouseLeave(rail)

    expect($peekedTreeSide.get()).toBeNull()
  })
})
