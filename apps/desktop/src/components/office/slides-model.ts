/**
 * A presentation, reduced to what the deck viewer draws: one SVG per slide,
 * its title, its speaker notes, and the deck's aspect ratio.
 *
 * The SVG is generated in this process from the file's own OOXML, but it
 * carries the document's text, so it is sanitised before it is ever inserted:
 * a deck is a file from outside, and markup that arrives inside a run of text
 * must not become markup on the page.
 */

import { getSlideNotes, getSlides, getSlideSize, getSlideTitle, loadPresentation } from '@office-kit/pptx'
import { renderSlideToSvg } from '@office-kit/pptx-preview'


const DEFAULT_ASPECT = 16 / 9
/** A deck longer than this previews its first slides; the rest open in the app. */

export interface DeckSlide {
  /** Rendered SVG markup for the slide, or null while it is still rendering. */
  svg: null | string
  notes: string
  title: string
}

export interface Deck {
  /** Slide aspect ratio, width over height. */
  aspect: number
  slides: DeckSlide[]
}

export const DECK_MAX_SLIDES = 200

const UNSAFE_ELEMENTS = new Set(['embed', 'iframe', 'object', 'script'])

/** Scrub the rendered markup before it is inserted.
 *
 *  The renderer escapes every run of document text (a slide reading
 *  `<script>alert(1)</script>` comes back as escaped characters, not as a
 *  tag), so this is a second line rather than the first: it drops executable
 *  elements, event-handler attributes, and any link that is not an inline
 *  image or an in-document reference. A general HTML sanitiser is the wrong
 *  tool here, it strips the positioned `foreignObject` content the slide is
 *  made of and leaves an empty frame. */
function sanitizeSvg(markup: string): string {
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = document.documentElement

  if (!root || root.nodeName === 'parsererror' || root.getElementsByTagName('parsererror').length) {
    return ''
  }

  const walk = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (UNSAFE_ELEMENTS.has(child.nodeName.toLowerCase())) {
        child.remove()

        continue
      }

      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase()

        if (name.startsWith('on')) {
          child.removeAttribute(attribute.name)

          continue
        }

        if (name === 'href' || name === 'xlink:href') {
          const value = attribute.value.trim().toLowerCase()

          if (!value.startsWith('data:image/') && !value.startsWith('#')) {
            child.removeAttribute(attribute.name)
          }
        }
      }

      walk(child)
    }
  }

  walk(root)

  return new XMLSerializer().serializeToString(root)
}

export interface DeckSource {
  aspect: number
  render: (index: number) => Promise<string>
  slides: { notes: string; title: string }[]
}

/** Parse the deck and hand back a renderer per slide, so a long deck can draw
 *  the slide in view first instead of blocking on all of them. */
export async function readDeck(bytes: Uint8Array): Promise<DeckSource> {
  const presentation = await loadPresentation(bytes)
  const slides = getSlides(presentation).slice(0, DECK_MAX_SLIDES)
  const size = getSlideSize(presentation) as { height?: number; width?: number } | undefined
  const aspect = size?.width && size?.height ? size.width / size.height : DEFAULT_ASPECT

  return {
    aspect,
    render: async (index: number) => {
      const slide = slides[index]

      if (!slide) {
        return ''
      }

      return sanitizeSvg(String(await renderSlideToSvg(presentation, slide, {})))
    },
    slides: slides.map((slide, index) => ({
      notes: String(getSlideNotes(slide) ?? ''),
      title: String(getSlideTitle(slide) ?? '') || `${index + 1}`
    }))
  }
}

/** The empty deck the viewer starts from, before any slide has rendered. */
export function pendingDeck(source: DeckSource): Deck {
  return {
    aspect: source.aspect,
    slides: source.slides.map<DeckSlide>(slide => ({ notes: slide.notes, svg: null, title: slide.title }))
  }
}
