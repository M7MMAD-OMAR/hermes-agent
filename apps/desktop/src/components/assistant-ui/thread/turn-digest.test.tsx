import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $toolDisclosureStates } from '@/store/tool-view'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime, userMessage } from '../test-utils'
import { Thread } from '../thread'

import { computeTurnDigest } from './turn-digest'

stubThreadEnvironment()
stubThreadViewportSize()

const createdAt = new Date('2026-06-03T00:00:00.000Z')
const meta = { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }

function tool(toolCallId: string, toolName: string, args: Record<string, unknown>, settled = true) {
  return {
    type: 'tool-call',
    toolCallId,
    toolName,
    args,
    argsText: JSON.stringify(args),
    ...(settled ? { result: { ok: true } } : {})
  }
}

function assistant(
  id: string,
  content: unknown[],
  status: ThreadMessage['status'] = { type: 'complete', reason: 'stop' }
): ThreadMessage {
  return { id, role: 'assistant', content, status, createdAt, metadata: meta } as unknown as ThreadMessage
}

const interimOne = () =>
  assistant('interim-1', [
    { type: 'text', text: 'Now the navigation block.' },
    tool('read-1', 'read_file', { path: '/repo/nav.tsx' })
  ])

const interimTwo = () =>
  assistant('interim-2', [
    { type: 'text', text: 'Now the assistant dock CSS.' },
    tool('term-1', 'terminal', { command: 'bun test' })
  ])

const reply = () => assistant('reply-1', [{ type: 'text', text: 'All done, both files updated.' }])

function Harness({ messages }: { messages: ThreadMessage[] }) {
  return (
    <ThreadRuntime messages={messages}>
      <Thread />
    </ThreadRuntime>
  )
}

describe('turn digest', () => {
  beforeEach(() => {
    $toolDisclosureStates.set({})
  })

  afterEach(cleanup)

  it('folds the settled working under one header and keeps the reply in view', async () => {
    const { container } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), reply()]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-digest]')).not.toBeNull())

    const header = container.querySelector('[data-turn-digest]')!
    expect(header.textContent).toContain('Explored nav.tsx, ran 1 command')
    expect(container.textContent).toContain('All done, both files updated.')
    expect(container.textContent).not.toContain('Now the navigation block.')
    expect(container.textContent).not.toContain('Now the assistant dock CSS.')
  })

  it('opens the working on request and remembers it for the turn', async () => {
    const { container } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), reply()]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-digest] button')).not.toBeNull())

    fireEvent.click(container.querySelector('[data-turn-digest] button')!)

    await waitFor(() => expect(container.textContent).toContain('Now the navigation block.'))
    expect(container.textContent).toContain('Now the assistant dock CSS.')
    expect($toolDisclosureStates.get()['turn-digest:user-1']).toBe(true)
  })

  it('keeps live history expandable through new activity and completion', async () => {
    const running = assistant(
      'tail-live',
      [{ type: 'text', text: 'Typecheck next.' }, tool('term-2', 'terminal', { command: 'bun run typecheck' }, false)],
      { type: 'running' }
    )

    const { container, rerender } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), running]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-digest-live]')).not.toBeNull())

    const header = container.querySelector('[data-turn-digest]')!
    expect(header.textContent).toContain('Explored nav.tsx, ran 1 command')
    expect(header.querySelector('.shimmer')).not.toBeNull()
    expect(header.querySelector('button')?.hasAttribute('disabled')).toBe(false)
    expect(container.textContent).toContain('Typecheck next.')
    expect(container.textContent).not.toContain('Now the navigation block.')
    fireEvent.click(header.querySelector('button')!)
    await waitFor(() => expect(container.textContent).toContain('Now the navigation block.'))

    const next = assistant('next-live', [tool('read-2', 'read_file', { path: '/repo/result.ts' }, false)], {
      type: 'running'
    })

    const sealed = { ...running, status: { type: 'complete', reason: 'stop' } } as ThreadMessage
    rerender(<Harness messages={[userMessage(), interimOne(), interimTwo(), sealed, next]} />)
    await waitFor(() =>
      expect(container.querySelector('[data-turn-digest-body]')?.textContent).toContain('Typecheck next.')
    )
    expect(container.textContent).toContain('Now the navigation block.')

    rerender(<Harness messages={[userMessage(), interimOne(), interimTwo(), sealed, reply()]} />)
    await waitFor(() => expect(container.textContent).toContain('All done, both files updated.'))
    expect(container.querySelector('[data-turn-digest-body]')?.textContent).toContain('Now the navigation block.')
    fireEvent.click(container.querySelector('[data-turn-digest] button')!)
    await waitFor(() => expect(container.querySelector('[data-turn-digest-body]')).toBeNull())
  })

  it('opens earlier tool results while a later call runs and preserves task receipts', async () => {
    const todos = [{ id: 'repair', content: 'Repair conversation history', status: 'completed' }]
    const task = { ...tool('todo-1', 'todo_list', { todos }), result: { todos } }

    const calls = [
      { ...tool('first-read', 'read_file', { path: '/repo/first.ts' }), result: { content: 'Earlier saved result' } },
      task,
      tool('second-read', 'read_file', { path: '/repo/second.ts' }, false)
    ]

    const { container, rerender } = render(
      <Harness messages={[userMessage(), assistant('live-tools', calls, { type: 'running' })]} />
    )

    const header = container.querySelector('[data-tool-summary] button')!
    expect(header.hasAttribute('disabled')).toBe(false)
    fireEvent.click(header)
    await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('true'))
    expect(container.querySelector('[data-tool-ticker]')).toBeNull()

    const taskButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Updated todos')
    )!

    expect(taskButton, container.textContent ?? '').toBeTruthy()
    fireEvent.click(taskButton)
    await waitFor(() => expect(container.textContent).toContain('Repair conversation history'))
    rerender(
      <Harness
        messages={[
          userMessage(),
          assistant('live-tools', [...calls, tool('third-read', 'read_file', { path: '/repo/third.ts' }, false)], {
            type: 'running'
          })
        ]}
      />
    )
    await waitFor(() =>
      expect(container.querySelector('[data-tool-summary] button')?.getAttribute('aria-expanded')).toBe('true')
    )
    expect(container.textContent).toContain('Repair conversation history')
  })

  it('leaves a single-message turn alone', async () => {
    const { container } = render(<Harness messages={[userMessage(), reply()]} />)

    await waitFor(() => expect(container.textContent).toContain('All done, both files updated.'))
    expect(container.querySelector('[data-turn-digest]')).toBeNull()
  })

  it('never hides an errored message and stops the fold at it', () => {
    const errored = assistant('interim-error', [{ type: 'text', text: 'Boom' }], {
      type: 'incomplete',
      reason: 'error',
      error: 'provider down'
    })

    const messages = [userMessage(), interimOne(), errored, interimTwo(), reply()]
    const digest = computeTurnDigest({ thread: { isRunning: false, messages } }, [1, 2, 3, 4], count => `${count}`)

    expect(digest.folded).toEqual([1])
    expect(digest.visible).toEqual([2, 3, 4])
  })

  it('counts sealed notes when the working used no tools', () => {
    const notes = [
      userMessage(),
      assistant('n1', [{ type: 'text', text: 'first' }]),
      assistant('n2', [{ type: 'text', text: 'second' }]),
      reply()
    ]

    const digest = computeTurnDigest(
      { thread: { isRunning: false, messages: notes } },
      [1, 2, 3],
      count => `${count} notes`
    )

    expect(digest.summary).toBe('2 notes')
    expect(digest.folded).toEqual([1, 2])
  })
})

/**
 * S6 of docs/design/herwork-workspace.md: the outcome row is the one thing in a
 * settled turn that never folds. It answers "what did I get, what broke, what
 * is left"; the header keeps answering "how many tools ran", and the two stay
 * visually distinct.
 */
describe('turn outcome row', () => {
  const RULES = { delivered: ['Edited 2 files: nav.tsx, dock.css'], failed: ['terminal reported an error'], open: [], source: 'rules' }

  const MODEL = {
    delivered: ['The navigation and dock styles are updated'],
    failed: [],
    open: ['تحقق من العناوين العربية في الشريحة 4'],
    source: 'model'
  }

  // The outcome rides `metadata.custom.turnOutcome` on the turn's final
  // assistant message, stamped there by `handleOutcomeEvent` (live) or
  // hydrated from `display_metadata` (resume). The digest reads that one
  // source, so the tests hand it a tail message already carrying the field.
  const withOutcome = (message: ThreadMessage, outcome: unknown): ThreadMessage =>
    ({ ...message, metadata: { ...meta, custom: { turnOutcome: outcome } } }) as unknown as ThreadMessage

  const replyWith = (outcome: unknown) => withOutcome(reply(), outcome)

  beforeEach(() => {
    $toolDisclosureStates.set({})
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the three lines outside the fold and keeps them when the fold is collapsed', async () => {
    const { container } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), replyWith(RULES)]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-outcome]')).not.toBeNull())

    const row = container.querySelector('[data-turn-outcome]')!
    expect(row.textContent).toContain('Edited 2 files: nav.tsx, dock.css')
    expect(row.textContent).toContain('terminal reported an error')
    expect(row.getAttribute('data-turn-outcome-source')).toBe('rules')
    // Outside the body: the fold is collapsed and the row is still there.
    expect(container.querySelector('[data-turn-digest-body]')).toBeNull()
    expect(row.closest('[data-turn-digest]')).toBeNull()
    // The header still says the tally, so the two are not confused.
    expect(container.querySelector('[data-turn-digest]')!.textContent).toContain('Explored nav.tsx, ran 1 command')

    fireEvent.click(container.querySelector('[data-turn-digest] button')!)
    await waitFor(() => expect(container.querySelector('[data-turn-digest-body]')).not.toBeNull())
    expect(container.querySelector('[data-turn-outcome]')).not.toBeNull()
  })

  it('renders model text inside a bidi-isolated element', async () => {
    const { container } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), replyWith(MODEL)]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-outcome-source="model"]')).not.toBeNull())
    const row = container.querySelector('[data-turn-outcome]')!
    expect(row.textContent).not.toContain('Edited 2 files')
    const isolated = Array.from(row.querySelectorAll('bdi')).map(node => node.textContent)
    expect(isolated).toContain('تحقق من العناوين العربية في الشريحة 4')
  })

  it('shows a rehydrated outcome from the tail message', async () => {
    const { container } = render(<Harness messages={[userMessage(), interimOne(), replyWith(MODEL)]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-outcome]')).not.toBeNull())
    expect(container.querySelector('[data-turn-outcome]')!.textContent).toContain('The navigation and dock styles are updated')
  })

  it('renders under the tail when nothing folded, and nothing at all without an outcome', async () => {
    const { container, unmount } = render(<Harness messages={[userMessage(), replyWith(RULES)]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-outcome]')).not.toBeNull())
    expect(container.querySelector('[data-turn-digest]')).toBeNull()
    unmount()

    const bare = render(<Harness messages={[userMessage('user-2', 'another'), reply()]} />)
    await waitFor(() => expect(bare.container.textContent).toContain('All done, both files updated.'))
    expect(bare.container.querySelector('[data-turn-outcome]')).toBeNull()
  })

  it('does not re-render the outcome row on a text delta to the tail', async () => {
    // Same outcome object across rerenders: the row must not rebuild just
    // because the tail text grew.
    const running = withOutcome(
      assistant('tail-live', [{ type: 'text', text: 'Working' }], { type: 'running' }),
      RULES
    )

    const { container, rerender } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), running]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-outcome]')).not.toBeNull())
    const row = container.querySelector('[data-turn-outcome]')!
    const item = row.querySelector('bdi')!

    const longer = withOutcome(
      assistant('tail-live', [{ type: 'text', text: 'Working on it, nearly there' }], { type: 'running' }),
      RULES
    )

    rerender(<Harness messages={[userMessage(), interimOne(), interimTwo(), longer]} />)

    await waitFor(() => expect(container.textContent).toContain('nearly there'))
    // The ROW node itself, not just its contents: a remount is the regression
    // worth catching here, and it is what message-id churn used to cause.
    expect(container.querySelector('[data-turn-outcome]')).toBe(row)
    expect(row.querySelector('bdi')).toBe(item)
  })
})
