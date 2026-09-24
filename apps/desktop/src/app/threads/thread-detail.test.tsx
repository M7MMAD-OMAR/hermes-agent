import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ThreadStore from '@/store/threads'
import type { ThreadRow } from '@/store/threads'

import { ThreadDetail } from './thread-detail'

/**
 * Opening a thread and steering it.
 *
 * The case that matters most is the finished thread: it has no worker to
 * receive anything, and a composer that accepts a sentence and drops it is
 * worse than one that refuses it. The second is the failed send, where the
 * draft must survive so its author can try again.
 */

const fetchThreadTranscript = vi.hoisted(() => vi.fn())
const steerThread = vi.hoisted(() => vi.fn())

vi.mock('@/store/threads', async importOriginal => ({
  ...(await importOriginal<typeof ThreadStore>()),
  fetchThreadTranscript,
  steerThread
}))

function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    childCount: 0,
    coordinatorSessionId: 'coord-1',
    endedAt: null,
    label: 'History of the style',
    live: true,
    messageCount: 3,
    model: 'test-model',
    sessionId: 't-1',
    startedAt: Date.now() / 1000,
    state: 'working',
    subagentId: 'sub-1',
    toolCallCount: 1,
    ...overrides
  }
}

function renderDetail(overrides: Partial<ThreadRow> = {}) {
  return render(<ThreadDetail onBack={vi.fn()} ownerSessionId="coord-1" row={row(overrides)} />)
}

describe('ThreadDetail', () => {
  beforeEach(() => {
    fetchThreadTranscript.mockReset()
    steerThread.mockReset()
    fetchThreadTranscript.mockResolvedValue({ messages: [], thread: {}, truncated: false })
    steerThread.mockResolvedValue('sent')
  })

  it('reads the durable transcript for the thread', async () => {
    renderDetail()

    await waitFor(() => expect(fetchThreadTranscript).toHaveBeenCalledWith('t-1'))
  })

  it('renders the thread’s messages', async () => {
    fetchThreadTranscript.mockResolvedValue({
      messages: [
        { content: 'trace the cyanotype lineage', role: 'user' },
        { content: 'found three sources', role: 'assistant' }
      ],
      thread: {},
      truncated: false
    })

    renderDetail()

    expect(await screen.findByText('trace the cyanotype lineage')).toBeTruthy()
    expect(screen.getByText('found three sources')).toBeTruthy()
  })

  it('says so when it is showing only the tail', async () => {
    fetchThreadTranscript.mockResolvedValue({
      messages: [{ content: 'step 9', role: 'assistant' }],
      thread: {},
      truncated: true
    })

    renderDetail()

    expect(await screen.findByText(/latest messages/i)).toBeTruthy()
  })

  it('renders structured content rather than [object Object]', async () => {
    fetchThreadTranscript.mockResolvedValue({
      messages: [{ content: { ok: true }, role: 'tool' }],
      thread: {},
      truncated: false
    })

    renderDetail()

    expect(await screen.findByText('{"ok":true}')).toBeTruthy()
  })

  it('reports a transcript it could not read', async () => {
    fetchThreadTranscript.mockResolvedValue(null)

    renderDetail()

    expect(await screen.findByText(/Could not read this thread/i)).toBeTruthy()
  })

  it('says a thread with nothing in it is empty', async () => {
    renderDetail()

    expect(await screen.findByText(/has not written anything yet/i)).toBeTruthy()
  })
})

describe('steering', () => {
  beforeEach(() => {
    fetchThreadTranscript.mockReset()
    steerThread.mockReset()
    fetchThreadTranscript.mockResolvedValue({ messages: [], thread: {}, truncated: false })
    steerThread.mockResolvedValue('sent')
  })

  function typeAndSend(text: string) {
    const input = screen.getByLabelText(/Steer this thread/i)

    fireEvent.change(input, { target: { value: text } })
    fireEvent.click(screen.getByText(/Send to thread/i))

    return input as HTMLInputElement
  }

  it('sends the draft to the running thread', async () => {
    renderDetail()
    await screen.findByText(/has not written anything yet/i)

    typeAndSend('check the Japanese lineage too')

    await waitFor(() =>
      expect(steerThread).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 't-1' }),
        'check the Japanese lineage too',
        'coord-1'
      )
    )
  })

  it('clears the box and confirms once the steer lands', async () => {
    renderDetail()
    await screen.findByText(/has not written anything yet/i)

    const input = typeAndSend('one more thing')

    await waitFor(() => expect(screen.getByText(/Sent to the thread/i)).toBeTruthy())
    expect(input.value).toBe('')
  })

  it('keeps the draft when the steer could not be delivered', async () => {
    // A sentence that went nowhere stays where its author can see it.
    steerThread.mockResolvedValue('unreachable')
    renderDetail()
    await screen.findByText(/has not written anything yet/i)

    const input = typeAndSend('one more thing')

    await waitFor(() => expect(screen.getByText(/Could not reach this thread/i)).toBeTruthy())
    expect(input.value).toBe('one more thing')
  })

  it('refuses to accept a sentence for a finished thread', async () => {
    // The failure this guard exists to stop: typing into a dead thread and
    // having the words silently disappear.
    renderDetail({ live: false, state: 'resolved', subagentId: undefined })
    await screen.findByText(/has not written anything yet/i)

    const input = screen.getByLabelText(/there is nothing to steer/i) as HTMLInputElement

    expect(input.disabled).toBe(true)
    expect(steerThread).not.toHaveBeenCalled()
  })

  it('does not send an empty draft', async () => {
    renderDetail()
    await screen.findByText(/has not written anything yet/i)

    fireEvent.click(screen.getByText(/Send to thread/i))

    expect(steerThread).not.toHaveBeenCalled()
  })
})
