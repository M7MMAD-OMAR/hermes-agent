import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as openSessionModule from '@/app/open-session'
import * as gateway from '@/store/gateway'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
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
  _resetSessionOwnerHintsForTests()
  vi.restoreAllMocks()
})

it('sends steer and stop to the child parent owner, never the active gateway or child transcript', async () => {
  const request = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'queued', found: true })
  setSessionOwnerHint('parent', { connectionId: 'remote-owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'worker', child_session_id: 'child-transcript', goal: 'Owned work' })
  render(<SubagentSection navigate={() => {}} sessionId="parent" />)
  fireEvent.click(screen.getByRole('button', { name: /Owned work/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Check the negative control' } })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('remote-owner', 'research', 'subagent.steer', {
      session_id: 'parent',
      subagent_id: 'worker',
      text: 'Check the negative control'
    })
  )
  expect(screen.getByText('Queued for the next checkpoint')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('remote-owner', 'research', 'subagent.interrupt', {
      session_id: 'parent',
      subagent_id: 'worker'
    })
  )
  expect($subagentsBySession.get().parent?.[0]?.status).toBe('running')
})

it('surfaces a delivered instruction in the worker roster instead of only a queued toast', async () => {
  vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'queued', found: true })
  setSessionOwnerHint('parent', { connectionId: 'remote-owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'worker', goal: 'Owned work' })
  const view = render(<SubagentSection navigate={() => {}} sessionId="parent" />)
  fireEvent.click(screen.getByRole('button', { name: /Owned work/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Skip the flaky fixture' } })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

  // The instruction outlives the cleared input: it is the only record of what
  // this worker was told, so it has to be readable in the detail afterwards.
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-slot="composer-subagent-detail"]')?.textContent
    ).toContain('Skip the flaky fixture')
  )
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
})

it('navigates to the child conversation through openSession, honouring row modifiers', () => {
  const open = vi.spyOn(openSessionModule, 'openSession').mockImplementation(() => {})
  const navigate = vi.fn()
  upsertSubagent('parent', { subagent_id: 'anonymous', goal: 'No transcript yet' })
  upsertSubagent('parent', { subagent_id: 'worker', child_session_id: 'child-1', goal: 'Has a transcript' })
  render(<SubagentSection navigate={navigate} sessionId="parent" />)

  // A worker that never reported a session has nowhere to go.
  fireEvent.click(screen.getByRole('button', { name: /No transcript yet/ }))
  expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Has a transcript/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  expect(open).toHaveBeenLastCalledWith('child-1', navigate, 'stack')

  // Same modifiers as a sidebar session row: mod for a tab, mod+shift for a window.
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }), { ctrlKey: true })
  expect(open).toHaveBeenLastCalledWith('child-1', navigate, 'tab')
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }), { ctrlKey: true, shiftKey: true })
  expect(open).toHaveBeenLastCalledWith('child-1', navigate, 'window')
})

it('records nothing when the gateway refuses the steer', async () => {
  vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'rejected' })
  setSessionOwnerHint('parent', { connectionId: 'remote-owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'worker', goal: 'Owned work' })
  render(<SubagentSection navigate={() => {}} sessionId="parent" />)
  fireEvent.click(screen.getByRole('button', { name: /Owned work/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Never delivered' } })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect($subagentsBySession.get().parent?.[0]?.stream.some(entry => entry.kind === 'steer')).toBe(false)
})

it('keeps rejected steer text and does not retarget when the owner is unknown', async () => {
  const request = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'rejected' })
  upsertSubagent('unknown', { subagent_id: 'worker', goal: 'Unbound work' })
  render(<SubagentSection navigate={() => {}} sessionId="unknown" />)
  fireEvent.click(screen.getByRole('button', { name: /Unbound work/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this instruction' } })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(request).not.toHaveBeenCalled()
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep this instruction')
})
