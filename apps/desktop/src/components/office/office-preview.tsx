/**
 * The rail's Office document viewer.
 *
 * One entry point for Word, spreadsheets and decks. It reads the file's OOXML
 * bytes (converting a legacy or OpenDocument file to its OOXML sibling first),
 * lazily loads the viewer that format needs, and gives all three the same
 * trailing controls: the Word document's exact-pages mode, and the door out to
 * whichever app the machine edits this format in.
 *
 * The parsers and renderers are imported on demand, so a session that never
 * opens a document never pays for them.
 */

import type { OfficeFamily } from '@hermes/shared/office-format'
import type { ReactNode } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useI18n } from '@/i18n'
import { convertDesktopOffice, openDesktopFileExternally, readDesktopOfficeBytes } from '@/lib/desktop-fs'
import { inlineErrorMessage } from '@/lib/error-message'
import { dataUrlToBlob } from '@/lib/pdf-blob'
import { cn } from '@/lib/utils'

import type { SheetBook } from './sheet-model'
import type { Deck, DeckSource } from './slides-model'

// Module-scope lazy imports: the parsers and renderers are the heavy part of
// this feature and no chunk of it loads until a document is actually opened.
const SheetView = lazy(async () => ({ default: (await import('./sheet-view')).SheetView }))
const SlidesView = lazy(async () => ({ default: (await import('./slides-view')).SlidesView }))
const WordView = lazy(async () => ({ default: (await import('./word-view')).WordView }))

type WordMode = 'document' | 'pages'

/** Exactly one of these, decided by the file's family. A record of three
 *  optionals let the reader represent five states that cannot happen. */
type Loaded =
  | { book: SheetBook; kind: 'book' }
  | { bytes: Uint8Array; kind: 'bytes' }
  | { deck: Deck; kind: 'slides' }

/** A button that reads as a link, for the toolbars the viewers already own. */
function ToolbarAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded px-1.5 text-[0.625rem] font-bold text-muted-foreground underline-offset-4 transition-colors hover:bg-accent hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        'text-[0.625rem] font-bold underline-offset-4 transition-colors',
        active ? 'text-foreground underline decoration-current/30' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

export function OfficePreview({
  family,
  filePath,
  label,
  reloadKey
}: {
  family: OfficeFamily
  filePath: string
  label: string
  reloadKey: number
}) {
  const { locale, t } = useI18n()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [deckSource, setDeckSource] = useState<DeckSource | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [mode, setMode] = useState<WordMode>('document')
  const [pagesUrl, setPagesUrl] = useState<string>()
  const [pagesError, setPagesError] = useState<null | string>(null)

  useEffect(() => {
    setLoaded(null)
    setDeckSource(null)
    setError(null)
    setMode('document')
  }, [filePath, reloadKey])

  // Slides are drawn in the order they are asked for, one at a time: the one
  // in view first, then the rest of the rail behind it. Rendering all of them
  // up front would block the first slide on a long deck; rendering only the
  // ones in view would leave the rail full of blank thumbnails.
  // A fresh queue per deck: indices belong to the deck they were asked for.
  const queue = useMemo<number[]>(() => [], [deckSource])
  const draining = useRef(false)

  const renderSlide = useCallback(
    (index: number) => {
      if (!deckSource || queue.includes(index)) {
        return
      }

      queue.push(index)

      if (draining.current) {
        return
      }

      draining.current = true

      void (async () => {
        try {
          for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
            const svg = await deckSource.render(next)
            const at = next

            setLoaded(current => {
              if (current?.kind !== 'slides') {
                return current
              }

              const slide = current.deck.slides[at]

              if (!slide || slide.svg !== null) {
                return current
              }

              const slides = current.deck.slides.slice()

              slides[at] = { ...slide, svg }

              return { deck: { ...current.deck, slides }, kind: 'slides' }
            })
          }
        } finally {
          draining.current = false
        }
      })()
    },
    [deckSource, queue]
  )

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const bytes = await readDesktopOfficeBytes(filePath)

        if (!active) {
          return
        }

        if (family === 'xlsx') {
          const { readSheetBook } = await import('./sheet-model')
          const book = await readSheetBook(bytes, locale)

          if (active) {
            setLoaded({ book, kind: 'book' })
          }

          return
        }

        if (family === 'pptx') {
          const { pendingDeck, readDeck } = await import('./slides-model')
          const source = await readDeck(bytes)

          if (!active) {
            return
          }

          setDeckSource(source)
          setLoaded({ deck: pendingDeck(source), kind: 'slides' })

          return
        }

        setLoaded({ bytes, kind: 'bytes' })
      } catch (cause) {
        if (active) {
          setError(inlineErrorMessage(cause, t.preview.unavailable))
        }
      }
    }

    void load()

    return () => {
      active = false
    }
    // `locale` is a real input, not a lint appeasement: a spreadsheet renders
    // its month and weekday names in the reader's language, so switching the
    // interface language re-reads the workbook.
  }, [family, filePath, locale, reloadKey, t.preview.unavailable])

  // The exact-pages view of a Word document is the PDF LibreOffice prints, and
  // it is only fetched when the reader asks for it.
  useEffect(() => {
    if (mode !== 'pages' || family !== 'docx') {
      return
    }

    let active = true
    let objectUrl: string | undefined

    async function loadPages() {
      try {
        const dataUrl = await convertDesktopOffice(filePath, 'pdf')

        if (!active) {
          return
        }

        objectUrl = URL.createObjectURL(dataUrlToBlob(dataUrl))
        setPagesUrl(objectUrl)
        setPagesError(null)
      } catch (cause) {
        if (active) {
          setPagesError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    }

    void loadPages()

    return () => {
      active = false
      setPagesUrl(undefined)

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [family, filePath, mode, reloadKey])

  const openExternally = useCallback(() => {
    void openDesktopFileExternally(filePath).catch((cause: unknown) => setError(inlineErrorMessage(cause, t.preview.unavailable)))
  }, [filePath, t.preview.unavailable])

  const trailing = useMemo(
    () => (
      <>
        {family === 'docx' && (
          <>
            <ModeButton active={mode === 'document'} label={t.preview.office.document} onClick={() => setMode('document')} />
            <ModeButton active={mode === 'pages'} label={t.preview.office.pages} onClick={() => setMode('pages')} />
          </>
        )}
        <ToolbarAction label={t.preview.office.openInApp} onClick={openExternally} />
      </>
    ),
    [family, mode, openExternally, t]
  )

  if (error) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 text-sm font-medium text-foreground">{t.preview.unavailable}</div>
          <span dir="auto">{error}</span>
        </div>
      </div>
    )
  }

  if (!loaded) {
    return <PageLoader label={t.preview.loading} />
  }

  if (family === 'docx' && mode === 'pages') {
    return (
      <PagesView
        error={pagesError}
        errorTitle={t.preview.unavailable}
        label={label}
        loadingLabel={t.preview.office.converting}
        trailing={trailing}
        url={pagesUrl}
      />
    )
  }

  return (
    <Suspense fallback={<PageLoader label={t.preview.loading} />}>
      {loaded.kind === 'book' ? (
        <SheetView book={loaded.book} trailing={trailing} />
      ) : loaded.kind === 'slides' ? (
        <SlidesView deck={loaded.deck} onNeedSlide={renderSlide} trailing={trailing} />
      ) : (
        <WordView bytes={loaded.bytes} trailing={trailing} />
      )}
    </Suspense>
  )
}

function PagesView({
  error,
  errorTitle,
  label,
  loadingLabel,
  trailing,
  url
}: {
  error: null | string
  errorTitle: string
  label: string
  loadingLabel: string
  trailing: ReactNode
  url?: string
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center justify-end gap-3 border-b border-border/40 px-3">{trailing}</div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="grid h-full place-items-center px-8 text-center text-xs leading-relaxed text-muted-foreground">
            <div className="max-w-sm">
              <div className="mb-1 text-sm font-medium text-foreground">{errorTitle}</div>
              <span dir="auto">{error}</span>
            </div>
          </div>
        ) : url ? (
          <iframe aria-label={label} className="h-full w-full border-0 bg-white" src={url} title={label} />
        ) : (
          <PageLoader label={loadingLabel} />
        )}
      </div>
    </div>
  )
}
