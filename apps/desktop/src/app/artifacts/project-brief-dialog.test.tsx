import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { ProjectBriefDialog } from './project-brief-dialog'
import type { ResultsRequest } from './result-index'

afterEach(cleanup)

it('retries a failed load and preserves the edited summary when saving fails', async () => {
  let attempts = 0

  const request: ResultsRequest = async <T,>(method: string) => {
    if (method === 'projects.actions.list') {
      return { actions: [], next_before: null } as T
    }

    if (method === 'projects.brief') {
      attempts++

      if (attempts === 1) {
        throw Error('Connection unavailable')
      }

      return {
        project: { name: 'Client', description: 'Original summary', folders: [] },
        files: [],
        approved_results: []
      } as T
    }

    if (method === 'projects.update') {
      throw Error('Save failed')
    }

    throw Error('Unexpected call')
  }

  render(
    <ProjectBriefDialog
      onClose={() => undefined}
      onOpenChat={() => undefined}
      onOpenSource={() => undefined}
      projectId="client"
      request={request}
    />
  )
  await screen.findByText('Error: Connection unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  const input = await screen.findByLabelText('Project summary')
  fireEvent.change(input, { target: { value: 'Unsaved new summary' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save summary' }))
  await screen.findByText('Error: Save failed')
  expect((input as HTMLTextAreaElement).value).toBe('Unsaved new summary')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save summary' }).hasAttribute('disabled')).toBe(false))
})

it('ignores an older search response after a newer query finishes', async () => {
  let resolveOld: ((value: unknown) => void) | undefined

  const request: ResultsRequest = async <T,>(method: string, params?: Record<string, unknown>) => {
    if (method === 'projects.actions.list') {
      return { actions: [], next_before: null } as T
    }

    if (method === 'projects.brief') {
      return { project: { name: 'Client', description: '', folders: [] }, files: [], approved_results: [] } as T
    }

    if (params?.query === 'older') {
      return (await new Promise<unknown>(resolve => {
        resolveOld = resolve
      })) as T
    }

    return {
      matches: [
        {
          citation_id: 2,
          text: 'New query evidence',
          path: '/source.txt',
          locator: 'line',
          start: 1,
          end: 1,
          sha256: 'abcd',
          indexed_at: 1,
          is_current: 1
        }
      ]
    } as T
  }

  render(
    <ProjectBriefDialog
      onClose={() => undefined}
      onOpenChat={() => undefined}
      onOpenSource={() => undefined}
      projectId="client"
      request={request}
    />
  )
  const input = await screen.findByRole('textbox', { name: 'Search Arabic or English references' })
  fireEvent.change(input, { target: { value: 'older' } })
  await waitFor(() => expect(resolveOld).toBeDefined())
  fireEvent.change(input, { target: { value: 'newer' } })
  await screen.findByText('New query evidence')
  resolveOld?.({ matches: [] })
  await waitFor(() => expect(screen.queryByText('New query evidence')).not.toBeNull())
})
