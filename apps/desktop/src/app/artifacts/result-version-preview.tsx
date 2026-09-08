import { lazy, Suspense, useEffect, useState } from 'react'

import { ZoomableImage } from '@/components/chat/zoomable-image'
import { useI18n } from '@/i18n'

import type { ResultsRequest } from './result-index'

const ArtifactLiveView = lazy(() =>
  import('../chat/right-rail/preview-artifact').then(module => ({ default: module.ArtifactLiveView }))
)
const SourceView = lazy(() =>
  import('../chat/right-rail/preview-file').then(module => ({ default: module.SourceView }))
)

type VersionPreview = { kind: string; text?: string; extension?: string; data_url?: string }

export function ResultVersionPreview({
  request,
  versionId,
  label
}: {
  request: ResultsRequest
  versionId: string
  label: string
}) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<VersionPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setPreview(null)
    setError(null)
    void request<VersionPreview>('projects.results.preview', { version_id: versionId })
      .then(value => {
        if (active) {
          setPreview(value)
        }
      })
      .catch(err => {
        if (active) {
          setError(String(err))
        }
      })

    return () => {
      active = false
    }
  }, [request, versionId])

  if (error) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    )
  }

  if (!preview) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {t.artifacts.refreshing}
      </p>
    )
  }

  if (preview.kind === 'unsupported' || preview.kind === 'too_large') {
    return <p className="text-xs text-muted-foreground">{t.artifacts.previewUnavailable}</p>
  }

  return (
    <div className="h-72 min-w-0 overflow-auto rounded-md border border-border" data-testid="result-version-preview">
      <Suspense fallback={<p role="status">{t.artifacts.refreshing}</p>}>
        {preview.kind === 'html' || preview.kind === 'svg' ? (
          <ArtifactLiveView content={preview.text || ''} kind={preview.kind} title={label} />
        ) : preview.kind === 'text' ? (
          <SourceView filePath={label} language="text" text={preview.text || ''} />
        ) : preview.kind === 'image' ? (
          <ZoomableImage alt={label} className="max-h-full object-contain" src={preview.data_url || ''} />
        ) : preview.kind === 'pdf' ? (
          <iframe className="size-full border-0" src={preview.data_url} title={label} />
        ) : null}
      </Suspense>
    </div>
  )
}
