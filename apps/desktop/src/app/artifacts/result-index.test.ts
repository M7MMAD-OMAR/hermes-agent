import { expect, it } from 'vitest'

import { type IndexedResult, readResultIndex, refreshResultIndex, type ResultsRequest } from './result-index'

const row = (id: string) => ({ id, value: `/tmp/${id}.pdf` }) as IndexedResult

it('publishes saved results before indexing and retains them when a later batch fails', async () => {
  const published: IndexedResult[][] = []
  const calls: string[] = []

  const request: ResultsRequest = async <T>(method: string) => {
    calls.push(method)

    if (method === 'projects.results.refresh') {
      throw new Error('Index temporarily unavailable')
    }

    return { results: [row('saved')], next_cursor: null } as T
  }

  await expect(
    refreshResultIndex(
      request,
      new AbortController().signal,
      rows => published.push(rows),
      () => undefined
    )
  ).rejects.toThrow('temporarily unavailable')
  expect(published).toEqual([[row('saved')]])
  expect(calls).toEqual(['projects.results.list', 'projects.results.refresh'])
})

it('reads all metadata pages and deduplicates a result updated during paging', async () => {
  const cursors: unknown[] = []

  const request: ResultsRequest = async <T>(_method: string, params?: Record<string, unknown>) => {
    cursors.push(params?.before)

    return (
      params?.before
        ? { results: [row('a'), row('b')], next_cursor: null }
        : { results: [row('a')], next_cursor: [1, 'a'] }
    ) as T
  }

  expect((await readResultIndex(request, new AbortController().signal)).map(value => value.id)).toEqual(['a', 'b'])
  expect(cursors).toEqual([null, [1, 'a']])
})

it('does not publish an old owner response after cancellation', async () => {
  const controller = new AbortController()
  const published: IndexedResult[][] = []

  const request: ResultsRequest = async <T>() => {
    controller.abort()

    return { results: [row('wrong-owner')], next_cursor: null } as T
  }

  await expect(
    refreshResultIndex(
      request,
      controller.signal,
      rows => published.push(rows),
      () => undefined
    )
  ).rejects.toThrow()
  expect(published).toEqual([])
})
