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
import { useEffect, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useI18n } from '@/i18n'

const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]

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

  // Re-fit whenever the rail changes width, and once the first render lands.
  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current

    if (!autoFit || !scroller || !content || rendering || typeof ResizeObserver !== 'function') {
      return
    }

    const fit = () => {
      const page = content.querySelector('section') as HTMLElement | null
      const pageWidth = page?.offsetWidth ?? 0

      if (!pageWidth || !scroller.clientWidth) {
        return
      }

      setZoom(Math.min(1, Math.max(0.35, Math.round(((scroller.clientWidth - 24) / pageWidth) * 100) / 100)))
    }

    const observer = new ResizeObserver(fit)

    observer.observe(scroller)
    fit()

    return () => observer.disconnect()
  }, [autoFit, rendering])

  const step = (delta: number) => {
    const index = ZOOM_STEPS.indexOf(zoom)
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index < 0 ? 4 : index) + delta))]

    setAutoFit(false)
    setZoom(next ?? 1)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center justify-end gap-2 border-b border-border/40 px-2">
        {trailing}
        <button
          aria-label={t.preview.office.zoomOut}
          className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => step(-1)}
          type="button"
        >
          −
        </button>
        <button
          className="min-w-10 rounded px-1 text-[0.625rem] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => {
            setAutoFit(false)
            setZoom(1)
          }}
          type="button"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label={t.preview.office.zoomIn}
          className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => step(1)}
          type="button"
        >
          +
        </button>
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
