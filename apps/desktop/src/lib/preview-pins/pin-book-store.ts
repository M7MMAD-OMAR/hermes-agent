/**
 * PIN BOOK STORE — the durable home of a review.
 *
 * The panel used to hold the book in a `useRef`: a remount, a conversation
 * switch, a window close — anything that unmounted the component — dropped the
 * whole review on the floor. This is the fix: the same book, in a persistent
 * atom (the `composer-queue` pattern), read at mount and written on every
 * merge, so a review survives everything short of Clear.
 *
 * Scope note: a review belongs to THIS APP's browser work, not to a session or
 * a profile — the book keys pages by url and has no other natural owner. The
 * key declares that global scope.
 */

import { Codecs, persistentAtom } from '@/lib/persisted'

import { normalizePageUrl, type PinBook } from './pin-book'

const PIN_BOOK_STORAGE_KEY = 'hermes.desktop.pinBook.v2'

/** Drop shapes storage could not have written: a corrupt entry must never take
 *  the rest of the book down with it. */
function sanitizeBook(value: unknown): PinBook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const book: PinBook = {}

  for (const [url, pins] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(pins)) {continue}

    book[normalizePageUrl(url)] = pins.filter(
      pin => Boolean(pin) && typeof pin === 'object' && typeof (pin as { id?: unknown }).id === 'string'
    )
  }

  return book
}

export const $pinBook = persistentAtom<PinBook>(PIN_BOOK_STORAGE_KEY, {}, Codecs.json(sanitizeBook))

/**
 * Write the book. Normalizes here rather than trusting every writer: the value
 * stored in the atom IS what readers will see this session (the codec only
 * guards the disk copy), so a raw key with a trailing `#` set through the atom
 * would otherwise split one page's comments in two until the next remount.
 */
export const setPinBook = (book: PinBook) => {
  $pinBook.set(sanitizeBook(book))
}

