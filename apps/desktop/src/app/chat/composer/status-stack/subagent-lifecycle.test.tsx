import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import { SubagentSection } from './subagent-section'

vi.stubGlobal(
  'ResizeObserver',
  class {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
)
Element.prototype.animate = vi.fn(() => ({ cancel() {} }) as Animation)
afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  vi.restoreAllMocks()
})

it('keeps each worker draft while inspecting siblings and removes settled selection', () => {
  upsertSubagent('parent', { subagent_id: 'a', goal: 'Worker A' })
  upsertSubagent('parent', { subagent_id: 'b', goal: 'Worker B' })
  render(<SubagentSection sessionId="parent" />)
  fireEvent.click(screen.getByRole('button', { name: /2 Subagents/ }))
  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Preserve my instruction' } })
  fireEvent.click(screen.getByRole('button', { name: /Worker B/ }))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Preserve my instruction')
  act(() => upsertSubagent('parent', { subagent_id: 'a', status: 'completed' }, false, 'subagent.complete'))
  expect(screen.queryByText('Worker A')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('measures detail elapsed from worker start rather than first inspection', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100000)
  upsertSubagent('parent', { subagent_id: 'timed', goal: 'Timed worker' })
  now.mockReturnValue(117000)
  const { container } = render(<SubagentSection sessionId="parent" />)
  fireEvent.click(screen.getByRole('button', { name: /1 Subagent/ }))
  fireEvent.click(screen.getByRole('button', { name: /Timed worker/ }))
  expect(
    container.querySelector(
      '[data-slot="composer-subagent-detail"] [data-slot="tool-block"] > button > span:last-child'
    )?.textContent
  ).toBe('17s')
})

// Regression: the detail panel was unkeyed, so switching selection re-rendered
// one reused node instead of mounting a new one. That carried the previous
// worker's scroll offset into the next worker's panel, and the enter animation
// never replayed, because a callback ref only fires on a real mount.
it('mounts a fresh detail panel per worker instead of reusing one node', () => {
  const animated: Element[] = []
  Element.prototype.animate = function record(this: Element) {
    animated.push(this)

    return { cancel() {} } as unknown as Animation
  }

  const panels = () => animated.filter(el => el.getAttribute('data-slot') === 'composer-subagent-detail')

  upsertSubagent('parent', { subagent_id: 'a', goal: 'Worker A' })
  upsertSubagent('parent', { subagent_id: 'b', goal: 'Worker B' })
  render(<SubagentSection sessionId="parent" />)
  // Status groups start collapsed; open the roster before picking a worker.
  fireEvent.click(screen.getByRole('button', { name: /Subagent/ }))

  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  const first = panels()
  expect(first).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: /Worker B/ }))
  const second = panels()
  expect(second).toHaveLength(2)
  // A distinct DOM node, which is what resets the panel's own scroll offset.
  expect(second[1]).not.toBe(first[0])
})
