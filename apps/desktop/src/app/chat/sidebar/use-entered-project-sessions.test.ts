import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { fetchProjectSessions } from '@/store/projects'

import { useEnteredProjectSessions } from './use-entered-project-sessions'

vi.mock('@/store/projects', () => ({ fetchProjectSessions: vi.fn() }))
afterEach(cleanup)

it('ignores departed drill-ins and clears failure on retry', async () => {
  let failOld!: (error: Error) => void
  vi.mocked(fetchProjectSessions)
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failOld = reject
        })
    )
    .mockResolvedValueOnce({ project: null, status: 'ok' })
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce({ project: null, status: 'ok' })
  const tree: never[] = []

  const { result, rerender } = renderHook(({ id }) => useEnteredProjectSessions(id, true, tree, 'default'), {
    initialProps: { id: 'old' }
  })

  rerender({ id: 'current' })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => failOld(new Error('late error')))
  expect(result.current.failed).toBe(false)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.failed).toBe(true))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.failed).toBe(false)
})
