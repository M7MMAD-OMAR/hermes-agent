import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { type IndexedResult, resultArtifact, type ResultsRequest, type ResultVersion } from './result-index'
import { ResultVersionsDialog } from './result-versions-dialog'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup()

  if (originalScroll) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

it('opens captured bytes and rolls back a failed review update', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => undefined })
  const artifact = resultArtifact(
    {
      id: 'r',
      value: '/tmp/report.pdf',
      label: 'report.pdf',
      kind: 'file',
      session_id: 'source',
      session_title: 'Source task',
      reported_at: 100,
      message_id: 1,
      project_id: null,
      version_count: 0
    } satisfies IndexedResult,
    'default'
  )
  const version: ResultVersion = {
    id: 'v',
    result_id: 'r',
    number: 1,
    sha256: 'hash',
    snapshot_path: '/tmp/snapshots/hash.pdf',
    size_bytes: 500,
    captured_at: 200,
    review_state: 'unreviewed'
  }
  let captured = false
  const opened: string[] = []

  const request: ResultsRequest = async <T,>(method: string) => {
    if (method.endsWith('.review')) {
      throw Error('Review could not be saved')
    }

    if (method.endsWith('.capture')) {
      captured = true

      return { version } as T
    }

    return { versions: captured ? [version] : [] } as T
  }

  render(
    <ResultVersionsDialog
      artifact={artifact}
      onClose={() => undefined}
      onOpen={value => {
        opened.push(value.value)
      }}
      request={request}
    />
  )
  await screen.findByText('No saved versions yet.')
  fireEvent.click(screen.getByRole('button', { name: 'Save current file as a version' }))
  await screen.findByText('Version 1')
  fireEvent.click(screen.getByRole('button', { name: 'Open saved file' }))
  expect(opened).toEqual(['/tmp/snapshots/hash.pdf'])
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: 'Approved' }))
  await screen.findByRole('alert')
  await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Not reviewed'))
})
