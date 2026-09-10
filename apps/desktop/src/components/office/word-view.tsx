/**
 * A Word document, rendered as a document.
 *
 * docx-preview lays the file's own styles, tables, images, numbering and
 * section geometry onto page-sized sheets, and it honours `w:bidi`, so an
 * Arabic document reads right to left the way its author wrote it. The text
 * stays selectable, which is the whole point of not showing a picture of a
 * page instead.
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useResizeObserver } from '@/hooks/use-resize-observer'
import { useI18n } from '@/i18n'

import { ZoomControl } from './zoom-control'

export function WordPreview({ bytes, trailing }: { bytes: Uint8Array; trailing?: ReactNode }) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  // Until the reader picks a zoom, the page is scaled to the rail's width. A
  // 8.5in sheet is wider than the rail at 100%, and a document whose right
  // margin is off-screen is exactly what a preview must not be.
  const [autoFit, setAutoFit] = useState(true)
  const [error, setError] = useState<null | string>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let active = true

    async function render() {
      const content = contentRef.current
      const styles = styleRef.current

      if (!content || !styles) {
        return
      }

      setRendering(true)
      setError(null)

      try {
        const { renderAsync } = await import('docx-preview')

        if (!active) {
          return
        }

        content.replaceChildren()
        styles.replaceChildren()

        await renderAsync(bytes, content, styles, {
          breakPages: true,
          className: 'hermes-docx',
          experimental: true,
          ignoreLastRenderedPageBreak: false,
          inWrapper: true,
          renderEndnotes: true,
          renderFooters: true,
          renderFootnotes: true,
          renderHeaders: true,
          useBase64URL: true
        })
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (active) {
          setRendering(false)
        }
      }
    }

    void render()

    return () => {
      active = false
    }
  }, [bytes])

  // Fit to the rail's width until the reader picks a zoom, and re-fit whenever
  // the rail changes width.
  const fit = useCallback(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current

    if (!autoFit || !scroller || !content || rendering) {
      return
    }

    const page = content.querySelector('section') as HTMLElement | null
    const pageWidth = page?.offsetWidth ?? 0

    if (!pageWidth || !scroller.clientWidth) {
      return
    }

    setZoom(Math.min(1, Math.max(0.35, Math.round(((scroller.clientWidth - 24) / pageWidth) * 100) / 100)))
  }, [autoFit, rendering])

  useResizeObserver(fit, scrollerRef)
  useEffect(fit, [fit])

  const setManualZoom = (next: number) => {
    setAutoFit(false)
    setZoom(next)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center justify-end gap-2 border-b border-border/40 px-2">
        <ZoomControl onZoom={setManualZoom} trailing={trailing} zoom={zoom} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-800" ref={scrollerRef}>
        {rendering && (
          <div className="absolute inset-0 z-10 bg-background/70">
            <PageLoader label={t.preview.loading} />
          </div>
        )}
        {error && (
          <div className="p-6 text-center text-xs text-destructive" dir="auto">
            {error}
          </div>
        )}
        <div ref={styleRef} />
        <div
          className="hermes-docx-host"
          data-selectable-text="true"
          ref={contentRef}
          style={{ zoom } as { zoom: number }}
        />
      </div>
    </div>
  )
}
