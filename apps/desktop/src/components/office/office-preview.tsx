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

import type { ReactNode } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useI18n } from '@/i18n'
import { convertDesktopOffice, openDesktopFileExternally, readDesktopOfficeBytes } from '@/lib/desktop-fs'
import type { OfficeFamily } from '@/lib/office-format'
import { dataUrlToBlob } from '@/lib/pdf-blob'
import { cn } from '@/lib/utils'

import type { SheetBook } from './sheet-model'
import type { Deck } from './slides-view'

// Module-scope lazy imports: the parsers and renderers are the heavy part of
// this feature and no chunk of it loads until a document is actually opened.
const SheetPreview = lazy(async () => ({ default: (await import('./sheet-view')).SheetPreview }))
const SlidesPreview = lazy(async () => ({ default: (await import('./slides-view')).SlidesPreview }))
const WordPreview = lazy(async () => ({ default: (await import('./word-view')).WordPreview }))

type WordMode = 'document' | 'pages'

interface Loaded {
  book?: SheetBook
  bytes?: Uint8Array
  deck?: Deck
}

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
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [mode, setMode] = useState<WordMode>('document')
  const [pagesUrl, setPagesUrl] = useState<string>()
  const [pagesError, setPagesError] = useState<null | string>(null)

  useEffect(() => {
    setLoaded(null)
    setError(null)
    setMode('document')
  }, [filePath, reloadKey])

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
          const book = await readSheetBook(bytes)

          if (active) {
            setLoaded({ book })
          }

          return
        }

        if (family === 'pptx') {
          const { pendingDeck, readDeck } = await import('./deck-model')
          const source = await readDeck(bytes)

          if (!active) {
            return
          }

          const deck = pendingDeck(source)

          setLoaded({ deck })

          // Slides render one at a time so the first one appears immediately
          // and a long deck never blocks the frame.
          for (let index = 0; index < deck.slides.length; index += 1) {
            const svg = await source.render(index)

            if (!active) {
              return
            }

            setLoaded(current => {
              if (!current?.deck) {
                return current
              }

              const slides = current.deck.slides.slice()
              const slide = slides[index]

              if (!slide) {
                return current
              }

              slides[index] = { ...slide, svg }

              return { deck: { ...current.deck, slides } }
            })
          }

          return
        }

        setLoaded({ bytes })
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [family, filePath, reloadKey])

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
    void openDesktopFileExternally(filePath).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause))
    )
  }, [filePath])

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
        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground" dir="auto">
          <div className="mb-1 text-sm font-medium text-foreground">{t.preview.unavailable}</div>
          {error}
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
        label={label}
        loadingLabel={t.preview.office.converting}
        trailing={trailing}
        url={pagesUrl}
      />
    )
  }

  return (
    <Suspense fallback={<PageLoader label={t.preview.loading} />}>
      {family === 'xlsx' && loaded.book ? (
        <SheetPreview book={loaded.book} trailing={trailing} />
      ) : family === 'pptx' && loaded.deck ? (
        <SlidesPreview deck={loaded.deck} trailing={trailing} />
      ) : loaded.bytes ? (
        <WordPreview bytes={loaded.bytes} trailing={trailing} />
      ) : null}
    </Suspense>
  )
}

function PagesView({
  error,
  label,
  loadingLabel,
  trailing,
  url
}: {
  error: null | string
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
          <div className="grid h-full place-items-center px-8 text-center text-xs text-muted-foreground" dir="auto">
            {error}
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
