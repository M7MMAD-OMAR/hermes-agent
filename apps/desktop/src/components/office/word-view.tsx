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

/** The bullets Word writes as private-use codepoints, and what they are.
 *
 *  A bulleted list in a `.docx` does not carry a bullet character. It carries
 *  a codepoint in a private-use block plus the name of the font that draws it:
 *  Symbol, or Wingdings. Those fonts ship with Microsoft Office and with
 *  nothing else, so on a machine without them every bullet in the document
 *  renders as an empty box. The codepoints are stable and few, so each is
 *  mapped to the real character it has always meant. */
const WORD_BULLETS: Record<string, string> = {
  '\uf02d': '-',
  '\uf06e': '\u25aa',
  '\uf075': '\u25c6',
  '\uf0a7': '\u25aa',
  '\uf0a8': '\u25ab',
  '\uf0b7': '\u2022',
  '\uf0d8': '\u27a2',
  '\uf0fc': '\u2714'
}

const WORD_BULLET_RE = new RegExp(`[${Object.keys(WORD_BULLETS).join('')}]`, 'g')

/** docx-preview draws list markers through generated CSS `content:` rules, so
 *  the substitution happens in the stylesheet it just wrote, not in the DOM. */
export function replaceMissingBullets(styles: HTMLElement): void {
  for (const sheet of styles.querySelectorAll('style')) {
    const text = sheet.textContent ?? ''

    if (WORD_BULLET_RE.test(text)) {
      WORD_BULLET_RE.lastIndex = 0
      sheet.textContent = text.replace(WORD_BULLET_RE, match => WORD_BULLETS[match] ?? match)
    }

    WORD_BULLET_RE.lastIndex = 0
  }
}

export function WordView({ bytes, trailing }: { bytes: Uint8Array; trailing?: ReactNode }) {
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

        replaceMissingBullets(styles)
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
        {/* The document carries its own direction: docx-preview writes
            `direction: rtl` onto the sections and paragraphs that declared
            `w:bidi`, and nothing onto the ones that did not. Without an
            explicit `ltr` here, an English document opened in the Arabic
            interface inherits `dir="rtl"` from <html> and right-aligns
            everything, reverses its tables and flips its list markers. */}
        <div
          className="hermes-docx-host"
          data-selectable-text="true"
          dir="ltr"
          ref={contentRef}
          style={{ zoom } as { zoom: number }}
        />
      </div>
    </div>
  )
}
