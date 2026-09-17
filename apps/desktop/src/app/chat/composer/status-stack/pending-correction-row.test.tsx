import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PendingCorrection } from '@/store/correction-delivery'

import { PendingCorrectionRow } from './pending-correction-row'

afterEach(cleanup)

const pending = (delivery: PendingCorrection['delivery'], text = 'also fix the padding'): PendingCorrection => ({
  delivery,
  text
})

describe('PendingCorrectionRow', () => {
  // Presentational only — whether the row appears at all is the stack's decision, covered in
  // pending-correction-section.test.tsx. These pin what it says once it is shown.

  it('says the message is waiting for the running command when it cannot yield', () => {
    // The reported symptom: a follow-up sent during a long command looked eaten because
    // nothing on screen said it had been accepted and was queued behind that command.
    render(<PendingCorrectionRow pending={pending('tool_boundary_blocked')} />)

    expect(screen.getByText('Waiting for the running command')).toBeTruthy()
    expect(screen.getByText('also fix the padding')).toBeTruthy()
  })

  it('says it arrives after the current step when the tool can yield', () => {
    render(<PendingCorrectionRow pending={pending('tool_boundary', 'use Postgres')} />)

    expect(screen.getByText('Arriving after the current step')).toBeTruthy()
    expect(screen.getByText('use Postgres')).toBeTruthy()
  })
})
