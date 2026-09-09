import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { stubThreadEnvironment, ThreadRuntime } from '../test-utils'

import { deliveryTargetFromCommand, replyTextFromResult } from './agent-delivery'

import { Thread } from '.'

stubThreadEnvironment()

// Sender-side inter-agent deliveries render as "Messaged X" / "Message from
// X" notices instead of terminal transcript rows. This pins the detection
// (the canonical Bot Mode command shape) and the reply extraction.
describe('delivery command detection', () => {
  it('matches the canonical delivery command', () => {
    const cmd = 'hermes -p turqoise chat --in ~ -c "Bot Chat" -Q -q "Message from 🤖 Hermes (@hermes): hi there"'

    expect(deliveryTargetFromCommand(cmd)).toBe('turqoise')
  })

  it('matches with a cd prefix and timeout wrapper', () => {
    const cmd = 'cd ~ && timeout 240 hermes -p mr-tester chat --in "~" -Q -q "Message from 🤖 Hermes: hello"'

    expect(deliveryTargetFromCommand(cmd)).toBe('mr-tester')
  })

  it('ignores ordinary terminal commands', () => {
    expect(deliveryTargetFromCommand('ls -la')).toBeNull()
    expect(deliveryTargetFromCommand('hermes -p turqoise chat -q "plain question"')).toBeNull()
    expect(deliveryTargetFromCommand('hermes sessions list')).toBeNull()
  })
})

describe('reply extraction', () => {
  it('strips session_id bookkeeping and keeps the reply', () => {
    const output = 'session_id: 20260813_220347_f69ac6\nHi Hermes! Good to hear from you.'

    expect(replyTextFromResult({ output })).toBe('Hi Hermes! Good to hear from you.')
  })

  it('unwraps JSON-shaped terminal results', () => {
    const result = JSON.stringify({ exit_code: 0, output: 'session_id: abc\nack' })

    expect(replyTextFromResult(result)).toBe('ack')
  })

  it('returns empty for empty results', () => {
    expect(replyTextFromResult(undefined)).toBe('')
    expect(replyTextFromResult({ output: '' })).toBe('')
  })
})

// The notice is a message arriving from another conversation, so it settles in
// under the transcript's one motion rule: animate what mounts while its message
// is streaming, and let a rehydrated history paint statically.
describe('delivery notice entry', () => {
  const createdAt = new Date('2026-05-01T00:00:00.000Z')
  const command = 'hermes -p turqoise chat --in ~ -Q -q "Message from 🤖 Hermes: hi"'
  const animated: Element[] = []
  const original = Element.prototype.animate

  // Scoped to this block, and restored even if a test throws. Patching at
  // describe-body time instead would replace the shared stub from collection
  // onward, and restoring inside the last test would leak it whenever that
  // test is filtered out or fails early.
  beforeAll(() => {
    Element.prototype.animate = function record(this: Element) {
      animated.push(this)

      return { cancel() {}, finished: Promise.resolve() } as unknown as Animation
    }
  })

  afterAll(() => {
    Element.prototype.animate = original
  })

  const delivery = (toolCallId: string) => ({ type: 'tool-call', toolCallId, toolName: 'terminal', args: { command } })

  const message = (id: string, toolCallId: string, running: boolean): ThreadMessage =>
    ({
      id,
      role: 'assistant',
      content: [delivery(toolCallId)],
      status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    }) as unknown as ThreadMessage

  // The notice's own wrapper, not any animated ancestor: the assistant message
  // root also animates while streaming and contains the notice, so a
  // `querySelector` here would pass with no notice animation at all.
  const animatedNotices = () =>
    animated.filter(element => element.firstElementChild?.getAttribute('data-slot') === 'aui_agent-delivery-notice')
      .length

  afterEach(() => {
    cleanup()
    animated.length = 0
  })

  it('animates a notice that arrives while the turn is streaming', () => {
    render(
      <ThreadRuntime messages={[message('live', 'tc-live', true)]}>
        <Thread />
      </ThreadRuntime>
    )

    expect(animatedNotices()).toBeGreaterThan(0)
  })

  it('leaves a rehydrated notice alone', () => {
    render(
      <ThreadRuntime messages={[message('history', 'tc-history', false)]}>
        <Thread />
      </ThreadRuntime>
    )

    expect(animatedNotices()).toBe(0)
  })
})
