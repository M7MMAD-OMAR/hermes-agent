import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearAllPendingCorrections, setPendingCorrection } from '@/store/correction-delivery'

import { ComposerStatusStack } from './index'

// The stack measures itself into a surface var — jsdom has no ResizeObserver.
class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const SID = 'sess-correction-1'

function renderStack(busy: boolean) {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <ComposerStatusStack busy={busy} queue={null} sessionId={SID} />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ComposerStatusStack pending-correction section', () => {
  beforeEach(clearAllPendingCorrections)

  afterEach(() => {
    cleanup()
    clearAllPendingCorrections()
  })

  it('shows the waiting correction while the turn is live', () => {
    setPendingCorrection(SID, 'also fix the padding', 'tool_boundary_blocked')

    renderStack(true)

    expect(screen.getByText('Waiting for the running command')).toBeTruthy()
  })

  it('does not summon the whole card for a correction with nothing to say', () => {
    // The stack renders its surface whenever ANY section is pushed. A section pushed
    // unconditionally (whose own body happens to render null) puts an empty card over an
    // idle composer — caught by the goal-indicator suite the first time, pinned here.
    setPendingCorrection(SID, 'already delivered', 'model_cancelled')

    const view = renderStack(true)

    expect(view.container.firstChild).toBeNull()
  })

  it('does not summon the card once the turn has settled', () => {
    setPendingCorrection(SID, 'too late', 'tool_boundary_blocked')

    const view = renderStack(false)

    expect(view.container.firstChild).toBeNull()
  })

  it('renders nothing at all with no correction pending', () => {
    const view = renderStack(true)

    expect(view.container.firstChild).toBeNull()
  })

  it("never shows another session's correction", () => {
    setPendingCorrection('some-other-session', 'not yours', 'tool_boundary_blocked')

    const view = renderStack(true)

    expect(view.container.firstChild).toBeNull()
  })

  it('shows the newest correction when several were sent in a row', () => {
    setPendingCorrection(SID, 'first thing', 'tool_boundary_blocked')
    setPendingCorrection(SID, 'second thing', 'tool_boundary_blocked')

    renderStack(true)

    expect(screen.queryByText('first thing')).toBeNull()
    expect(screen.getByText('second thing')).toBeTruthy()
  })
})
