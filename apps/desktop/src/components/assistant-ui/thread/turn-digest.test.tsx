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

  it('narrates a live turn in the present tense and cannot be opened yet', async () => {
    const running = assistant(
      'tail-live',
      [{ type: 'text', text: 'Typecheck next.' }, tool('term-2', 'terminal', { command: 'bun run typecheck' }, false)],
      { type: 'running' }
    )

    const { container } = render(<Harness messages={[userMessage(), interimOne(), interimTwo(), running]} />)

    await waitFor(() => expect(container.querySelector('[data-turn-digest-live]')).not.toBeNull())

    const header = container.querySelector('[data-turn-digest]')!
    expect(header.textContent).toContain('Explored nav.tsx, ran 1 command')
    expect(header.querySelector('.shimmer')).not.toBeNull()
    expect(header.querySelector('button')?.hasAttribute('disabled')).toBe(true)
    expect(container.textContent).toContain('Typecheck next.')
    expect(container.textContent).not.toContain('Now the navigation block.')
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

    const digest = computeTurnDigest({ thread: { isRunning: false, messages: notes } }, [1, 2, 3], count => `${count} notes`)

    expect(digest.summary).toBe('2 notes')
    expect(digest.folded).toEqual([1, 2])
  })
})
