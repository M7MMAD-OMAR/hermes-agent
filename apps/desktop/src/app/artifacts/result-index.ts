import { mediaExternalUrl } from '@/lib/media'

import type { ArtifactRecord } from './artifact-utils'

export interface IndexedResult {
  id: string
  project_id: string | null
  session_id: string
  session_title: string
  message_id: number
  value: string
  kind: ArtifactRecord['kind']
  label: string
  reported_at: number
  version_count: number
}

export interface ResultVersion {
  id: string
  result_id: string
  number: number
  sha256: string
  snapshot_path: string
  size_bytes: number
  captured_at: number
  review_state: 'unreviewed' | 'approved' | 'changes_requested'
}

export type ResultsRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export function resultArtifact(row: IndexedResult, profile: string): ArtifactRecord {
  return {
    id: `${profile}:${row.id}`,
    resultId: row.id,
    projectId: row.project_id,
    versionCount: row.version_count,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    profile,
    value: row.value,
    href: mediaExternalUrl(row.value),
    label: row.label,
    kind: row.kind,
    timestamp: row.reported_at * 1000
  }
}

export async function readResultIndex(request: ResultsRequest, signal: AbortSignal): Promise<IndexedResult[]> {
  const rows = new Map<string, IndexedResult>()
  let before: [number, string] | null = null

  do {
    signal.throwIfAborted()

    const page: { results: IndexedResult[]; next_cursor: [number, string] | null } = await request(
      'projects.results.list',
      { before, limit: 200 }
    )

    signal.throwIfAborted()

    for (const row of page.results) {
      rows.set(row.id, row)
    }

    before = page.next_cursor
  } while (before)

  return [...rows.values()]
}

export async function refreshResultIndex(
  request: ResultsRequest,
  signal: AbortSignal,
  publish: (rows: IndexedResult[]) => void,
  progress: (skipped: number) => void
): Promise<void> {
  // Saved metadata paints first. Transcript indexing runs in bounded backend
  // batches and never ships conversation bodies into the renderer.
  const saved = await readResultIndex(request, signal)
  signal.throwIfAborted()
  publish(saved)
  let batches = 0
  let more: boolean

  do {
    signal.throwIfAborted()
    const result = await request<{ has_more: boolean; skipped_oversized_total?: number }>('projects.results.refresh')
    signal.throwIfAborted()
    more = result.has_more
    progress(result.skipped_oversized_total ?? 0)

    if (++batches % 8 === 0 || !more) {
      const rows = await readResultIndex(request, signal)
      signal.throwIfAborted()
      publish(rows)
    }
  } while (more)
}
