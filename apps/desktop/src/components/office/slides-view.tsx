/**
 * A deck, shown as slides.
 *
 * Each slide is rendered straight from the presentation's own OOXML into SVG:
 * real shape positions, real fills, real fonts, and text that stays text. A
 * rail of thumbnails picks the slide, the arrow keys walk the deck, and the
 * speaker notes sit under it.
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDirection, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { Deck, DeckSlide } from './slides-model'

function SlideFrame({ aspect, className, slide }: { aspect: number; className?: string; slide: DeckSlide }) {
  const ref = useRef<HTMLDivElement>(null)

  // The SVG is markup we generated from the file in this process, not remote
  // content, and it has to be inserted as markup for the shapes to draw.
  useEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    element.innerHTML = slide.svg ?? ''
  }, [slide.svg])

  return (
    <div
      className={cn('overflow-hidden bg-white shadow-sm ring-1 ring-border/60 [&>svg]:h-full [&>svg]:w-full', className)}
      ref={ref}
      style={{ aspectRatio: String(aspect) }}
    />
  )
}

export function SlidesView({
  deck,
  onNeedSlide,
  trailing
}: {
  deck: Deck
  /** Asked for a slide that has not been drawn yet. */
  onNeedSlide?: (index: number) => void
  trailing?: ReactNode
}) {
  const { t } = useI18n()
  const direction = useDirection()
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const total = deck.slides.length
  const slide = deck.slides[Math.min(active, total - 1)]

  const step = useCallback(
    (delta: number) => setActive(current => Math.min(total - 1, Math.max(0, current + delta))),
    [total]
  )

  // Ask for the slides around the one in view first, then for the rest of the
  // rail. The order is the whole point: the reader sees this slide now, and
  // the thumbnails fill in behind it instead of staying blank.
  useEffect(() => {
    if (!onNeedSlide) {
      return
    }

    const near: number[] = []
    const rest: number[] = []

    for (let index = 0; index < total; index += 1) {
      if (deck.slides[index]?.svg === null) {
        ;(Math.abs(index - active) <= 2 ? near : rest).push(index)
      }
    }

    for (const index of [...near, ...rest]) {
      onNeedSlide(index)
    }
  }, [active, deck.slides, onNeedSlide, total])

  useEffect(() => {
    const element = containerRef.current

    if (!element) {
      return
    }

    // The horizontal keys follow the reading direction, because the controls
    // do: the flex row reverses under RTL and the chevrons mirror with it, so
    // in Arabic the arrow the reader presses to go forward is the left one.
    // The vertical keys and Page keys do not flip; the rail is a column.
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === forward || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        step(1)
      }

      if (event.key === backward || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        step(-1)
      }
    }

    element.addEventListener('keydown', onKeyDown)

    return () => element.removeEventListener('keydown', onKeyDown)
  }, [direction, step])

  if (!slide) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">{t.preview.office.emptyDeck}</div>
  }

  return (
    <div className="flex h-full min-h-0 outline-none" ref={containerRef} tabIndex={0}>
      <div className="w-40 shrink-0 space-y-2 overflow-y-auto border-e border-border/40 bg-muted/20 p-2">
        {deck.slides.map((entry, index) => (
          <button
            aria-current={index === active ? 'true' : undefined}
            aria-label={t.preview.office.slideNumber(index + 1)}
            className={cn(
              'block w-full rounded text-start transition-opacity',
              index === active ? 'opacity-100' : 'opacity-70 hover:opacity-100'
            )}
            key={index}
            onClick={() => setActive(index)}
            type="button"
          >
            <div className="flex items-start gap-1.5">
              <span className="w-4 shrink-0 pt-1 text-end text-[0.625rem] tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <SlideFrame
                aspect={deck.aspect}
                className={cn('min-w-0 flex-1 rounded-sm', index === active && 'ring-2 ring-primary')}
                slide={entry}
              />
            </div>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2">
          <span className="truncate text-[0.6875rem] text-muted-foreground" dir="auto">
            {slide.title}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {trailing}
            <button
              aria-label={t.preview.office.previousSlide}
              className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              disabled={active === 0}
              onClick={() => step(-1)}
              type="button"
            >
              ‹
            </button>
            <span className="text-[0.625rem] tabular-nums text-muted-foreground" dir="ltr">
              {active + 1} / {total}
            </span>
            <button
              aria-label={t.preview.office.nextSlide}
              className="rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              disabled={active >= total - 1}
              onClick={() => step(1)}
              type="button"
            >
              ›
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
          <SlideFrame aspect={deck.aspect} className="mx-auto w-full max-w-4xl rounded" slide={slide} />
        </div>
        {slide.notes.trim() && (
          <div className="max-h-32 shrink-0 overflow-y-auto border-t border-border/40 px-3 py-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-[0.5625rem] font-semibold uppercase tracking-wide">{t.preview.office.notes}</div>
            {/* The label is the app's language and the notes are the author's.
                `dir="auto"` on a wrapper holding both reads the label first and
                lays the notes out in the interface's direction. */}
            <div dir="auto">{slide.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}
