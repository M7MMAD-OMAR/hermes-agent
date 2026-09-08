import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import type { ResultsRequest } from './result-index'
import { ResultVersionPreview } from './result-version-preview'

afterEach(cleanup)

it('uses the existing opaque sandbox for saved generated HTML', async () => {
  const calls: unknown[] = []

  const request: ResultsRequest = async <T,>(method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params })

    return { kind: 'html', text: '<!doctype html><html><body><h1>Saved version</h1></body></html>' } as T
  }

  render(<ResultVersionPreview label="Proposal" request={request} versionId="saved-version" />)
  const frame = await screen.findByTitle('Proposal')
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.getAttribute('srcdoc')).toContain('Saved version')
  expect(calls).toEqual([{ method: 'projects.results.preview', params: { version_id: 'saved-version' } }])
})

it('discards a late preview after the selected version unmounts', async () => {
  let resolve: ((value: unknown) => void) | undefined
  const pending = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  const request: ResultsRequest = async <T,>() => (await pending) as T
  const view = render(<ResultVersionPreview label="Old preview" request={request} versionId="old-version" />)
  view.unmount()
  resolve?.({ kind: 'html', text: 'Old data' })
  await pending
  expect(screen.queryByTitle('Old preview')).toBeNull()
})
