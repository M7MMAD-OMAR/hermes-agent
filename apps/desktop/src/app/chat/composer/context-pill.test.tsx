import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { $activeSessionId } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { ContextPill } from './context-pill'

stubResizeObserver()
stubMenuDomApis()

// The pill is a composition over the two status-bar panels; their internals are
// covered by their own tests. Recording stand-ins prove the reuse contract.
vi.mock('@/app/shell/context-usage-panel', () => ({
  ContextUsagePanel: () => <div data-testid="context-usage-panel" />
}))
vi.mock('@/app/shell/account-usage-panel', () => ({
  AccountUsagePanel: () => <div data-testid="account-usage-panel" />
}))

const breakdownFixture = {
  context_max: 1_000_000,
  context_percent: 63,
  context_used: 630_000
}

vi.mock('@/app/shell/hooks/use-context-breakdown', () => ({
  useContextBreakdown: ({ enabled }: { enabled: boolean }) =>
    enabled
      ? { breakdown: breakdownFixture, loading: false }
      : { breakdown: null, loading: false }
}))

const primaryView: SessionView = {
  kind: 'primary',
  $awaitingResponse: atom(false),
  $busy: atom(false),
  $cwd: atom(''),
  $fast: atom(false),
  $lastVisibleIsUser: atom(false),
  $messages: atom([]),
  $messagesEmpty: atom(true),
  $model: atom(''),
  $provider: atom(''),
  $reasoningEffort: atom(''),
  $runtimeId: atom(null),
  $storedId: atom(null),
  $turnStartedAt: atom<number | null>(null)
}

const okRequest = async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
  void method
  void params

  return {} as T
}

function renderPill({ request, view = primaryView, sessionId = null }: {
  request?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  sessionId?: null | string
  view?: SessionView
} = {}) {
  return render(
    <SessionViewProvider value={view}>
      <ContextPill busy={false} disabled={false} requestGateway={request} sessionId={sessionId} />
    </SessionViewProvider>
  )
}

afterEach(() => {
  cleanup()
  $activeSessionId.set(null)
})

describe('ContextPill gauge', () => {
  it('shows the occupancy percent from the session breakdown', () => {
    renderPill({ request: okRequest, sessionId: 'runtime-1' })

    expect(screen.getByText('63%')).toBeTruthy()
  })

  it('shows the waiting state while no dispatcher or breakdown exists', () => {
    renderPill()

    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('ContextPill popover', () => {
  it('shows the context breakdown alone — plan usage has its own statusbar item', async () => {
    renderPill({ request: okRequest, sessionId: 'runtime-1' })

    fireEvent.click(screen.getByLabelText('Context meter'))

    expect(await screen.findByTestId('context-usage-panel')).toBeTruthy()
    // Rendering it here too made the popover tall enough to scroll, for a
    // breakdown that is at most nine bounded rows.
    expect(screen.queryByTestId('account-usage-panel')).toBeNull()
  })

  it('does not put the breakdown in a scroll container', async () => {
    renderPill({ request: okRequest, sessionId: 'runtime-1' })

    fireEvent.click(screen.getByLabelText('Context meter'))

    await screen.findByTestId('context-usage-panel')
    const popover = document.querySelector('[data-slot="context-popover"]')
    expect(popover).toBeTruthy()
    expect(popover!.className).not.toMatch(/overflow-y-auto|max-h-/)
  })
})
