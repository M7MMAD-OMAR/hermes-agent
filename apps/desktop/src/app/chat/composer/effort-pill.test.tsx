import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it } from 'vitest'

import { type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { $defaultReasoningEffort } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { EffortPill } from './effort-pill'

stubResizeObserver()
stubMenuDomApis()

type RequestFn = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/** The repo's plain recorded-request mock (see model-presets.test.ts). */
const recordedRequest = () => {
  const calls: { method: string; params?: Record<string, unknown> }[] = []

  const request = async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params })

    return {} as T
  }

  return { calls, request: request as RequestFn }
}

const tileView = (overrides: Partial<SessionView> = {}): SessionView => ({
  kind: 'tile',
  $awaitingResponse: atom(false),
  $busy: atom(false),
  $cwd: atom(''),
  $fast: atom(false),
  $lastVisibleIsUser: atom(false),
  $messages: atom([]),
  $messagesEmpty: atom(true),
  $model: atom('anthropic/claude-opus'),
  $provider: atom('anthropic'),
  $reasoningEffort: atom('high'),
  $runtimeId: atom('tile-runtime'),
  $storedId: atom('stored-tile'),
  $turnStartedAt: atom<number | null>(null),
  ...overrides
})

type PillCaps = Parameters<typeof EffortPill>[0]['caps']

const caps = (over: Partial<NonNullable<PillCaps>> = {}): PillCaps => ({
  canDisableReasoning: true,
  fast: false,
  providerModels: ['anthropic/claude-opus'],
  reasoning: true,
  ...over
})

function renderPill(
  { caps: capsOverride, request }: { caps?: PillCaps; request?: RequestFn } = {},
  view = tileView()
) {
  return render(
    <SessionViewProvider value={view}>
      <EffortPill caps={capsOverride ?? caps()} disabled={false} requestGateway={request} />
    </SessionViewProvider>
  )
}

afterEach(() => {
  cleanup()
  $defaultReasoningEffort.set('')
})

async function openPopover() {
  fireEvent.click(screen.getByLabelText('Effort'))

  await screen.findByRole('dialog')
}

describe('EffortPill label', () => {
  it('shows the live level of its own surface', () => {
    renderPill(undefined, tileView({ $reasoningEffort: atom('xhigh') }))

    expect(screen.getByText('XHigh')).toBeTruthy()
  })

  it('shows Off when thinking is disabled', () => {
    renderPill(undefined, tileView({ $reasoningEffort: atom('none') }))

    expect(screen.getByText('Off')).toBeTruthy()
  })

  it('hides entirely when the model can neither think nor go fast', () => {
    renderPill({ caps: { canDisableReasoning: false, fast: false, providerModels: [], reasoning: false } })

    expect(screen.queryByLabelText('Effort')).toBeNull()
  })
})

describe('EffortPill slider writes', () => {
  it('writes the clicked level through the session-scoped config.set', async () => {
    const { calls, request } = recordedRequest()

    renderPill(
      { caps: { canDisableReasoning: false, fast: false, providerModels: [], reasoning: true }, request },
      tileView({ $reasoningEffort: atom('low') })
    )
    await openPopover()

    // 'high' is index 3 in REASONING_EFFORTS.
    fireEvent.change(screen.getByRole('slider', { name: 'Effort' }), { target: { value: '3' } })

    await waitFor(() => {
      expect(calls).toEqual([
        { method: 'config.set', params: { key: 'reasoning', session_id: 'tile-runtime', value: 'high' } }
      ])
    })
  })

  it('turns thinking off through the toggle, not the scale', async () => {
    const { calls, request } = recordedRequest()

    renderPill({ request }, tileView({ $reasoningEffort: atom('medium') }))
    await openPopover()

    fireEvent.click(screen.getByRole('switch', { checked: true }))

    await waitFor(() => {
      expect(calls).toEqual([
        { method: 'config.set', params: { key: 'reasoning', session_id: 'tile-runtime', value: 'none' } }
      ])
    })
  })
})

describe('EffortPill fast toggle', () => {
  it('offers the fast switch when the model takes the speed parameter and writes it', async () => {
    const { calls, request } = recordedRequest()

    renderPill({ caps: caps({ fast: true }), request }, tileView({ $fast: atom(false) }))
    await openPopover()

    const fast = screen.getByRole('switch', { checked: false })
    fireEvent.click(fast)

    await waitFor(() => {
      expect(calls).toEqual([
        { method: 'config.set', params: { key: 'fast', session_id: 'tile-runtime', value: 'fast' } }
      ])
    })
  })

  it('offers no fast switch when fast is a variant model swap, not a parameter', async () => {
    renderPill({ caps: caps({ fast: false, providerModels: ['anthropic/claude-opus-fast'] }) })

    fireEvent.click(screen.getByLabelText('Effort'))

    // The popover opens (effort slider present); the only switch is the
    // Thinking toggle — the variant swap stays a model-menu operation.
    await screen.findByRole('slider', { name: 'Effort' })
    expect(screen.queryByRole('switch', { checked: false })).toBeNull()
  })
})
