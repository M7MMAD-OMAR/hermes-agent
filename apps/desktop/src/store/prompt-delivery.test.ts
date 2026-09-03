/**
 * PROMPT DELIVERY — the seam where a pin's Send/Queue meets the conversation.
 *
 * These are the behaviours that exist only at this level: Queue queues and
 * never touches the composer, Send submits WITH its attachments, a busy turn
 * routes to the queue, and a popped-out Browser relays instead of delivering
 * into a void.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  browserWindow: vi.fn(() => false),
  relayDelivery: vi.fn(async (_payload: unknown) => true),
  submitted: vi.fn((_text: string, _options?: unknown) => true)
}))

const { browserWindow, relayDelivery, submitted } = h

vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBrowserWindow: () => h.browserWindow()
}))

vi.mock('@/store/composer-relay', () => ({
  relayPromptDelivery: (payload: unknown) => h.relayDelivery(payload)
}))

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerSubmit: (text: string, options?: unknown) => h.submitted(text, options)
}))

import { setPinBook } from '@/lib/preview-pins/pin-book-store'
import { $composerAttachments } from '@/store/composer'
import { $queuedPromptsBySession } from '@/store/composer-queue'
import { $activeSessionId, $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { deliverPrompt, deliverPromptLocally } from './prompt-delivery'

const chip = { detail: '[]', id: 'pins:x', kind: 'pins' as const, label: '1 comment', refText: '1 preview comment' }

beforeEach(() => {
  $composerAttachments.set([])
  $queuedPromptsBySession.set({})
  setPinBook({})
  $activeSessionId.set('sess-1')
  $sessions.set([{ _lineage_root_id: 'root-1', id: 'sess-1' } as never])
  $sessionStates.set({})
  submitted.mockClear()
  submitted.mockReturnValue(true)
  relayDelivery.mockClear()
  relayDelivery.mockResolvedValue(true)
  browserWindow.mockReturnValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('local delivery', () => {
  it('Queue parks the prompt WITH its attachments and never touches the composer', async () => {
    const result = await deliverPromptLocally({ attachments: [chip], mode: 'queue', text: 'fix the nav' })

    expect(result).toBe(true)
    // The queue entry carries the chip, so the drained send keeps the rich
    // preview-comments block — the whole point of the unified payload.
    const queuedEntry = $queuedPromptsBySession.get()['root-1']?.[0]

    expect(queuedEntry?.text).toBe('fix the nav')
    expect(queuedEntry?.attachments[0]?.kind).toBe('pins')
    // The reported bug: Queue spilling a chip into the input field.
    expect($composerAttachments.get()).toHaveLength(0)
  })

  it('Send submits the text WITH its attachments when a turn is not running', async () => {
    const result = await deliverPromptLocally({ attachments: [chip], mode: 'now', text: 'fix the nav' })

    expect(result).toBe(true)
    expect(submitted).toHaveBeenCalledTimes(1)
    expect(submitted.mock.calls[0][0]).toBe('fix the nav')

    const options = submitted.mock.calls[0][1] as { attachments?: { id: string }[] }

    expect(options.attachments?.[0]?.id).toBe('pins:x')
    expect($composerAttachments.get()).toHaveLength(0)
    expect($queuedPromptsBySession.get()['root-1']).toBeUndefined()
  })

  it('Send routes to the queue while the conversation is mid-turn', async () => {
    $sessionStates.set({ run1: { busy: true, storedSessionId: 'sess-1' } as never })

    const result = await deliverPromptLocally({ attachments: [chip], mode: 'now', text: 'fix the nav' })

    expect(result).toBe(true)
    expect(submitted).not.toHaveBeenCalled()
    expect($queuedPromptsBySession.get()['root-1']).toHaveLength(1)
  })

  it('Send falls back to the queue when no composer surface can take the submit', async () => {
    // requestComposerSubmit fails closed without a visible surface.
    submitted.mockReturnValue(false)

    const result = await deliverPromptLocally({ attachments: [chip], mode: 'now', text: 'fix the nav' })

    expect(result).toBe(true)
    expect($queuedPromptsBySession.get()['root-1']).toHaveLength(1)
  })
})

describe('cross-window delivery', () => {
  it('a popped-out Browser relays instead of delivering locally', async () => {
    browserWindow.mockReturnValue(true)

    const payload = { attachments: [chip], mode: 'now' as const, text: 'fix the nav' }
    const result = await deliverPrompt(payload)

    expect(result).toBe(true)
    expect(relayDelivery).toHaveBeenCalledWith(payload)
    expect(submitted).not.toHaveBeenCalled()
    expect($queuedPromptsBySession.get()).toEqual({})
  })

  it('a refused relay answers false, so the caller keeps the comment pending', async () => {
    browserWindow.mockReturnValue(true)
    relayDelivery.mockResolvedValue(false)

    const result = await deliverPrompt({ attachments: [chip], mode: 'queue', text: 'fix the nav' })

    expect(result).toBe(false)
    expect($queuedPromptsBySession.get()).toEqual({})
  })
})
