import { ANNOTATE_CSS_KEYS } from './tokens'

export interface ElementSnapshot {
  className?: string
  css: Record<string, string>
  id?: string
  role?: string
  selector: string
  tag: string
  text: string
}

export interface CompactIdentity {
  css: Record<string, string>
  selector: string
  tag: string
  text: string
}

const MAX_TEXT = 80
const MAX_SELECTOR = 180
const MAX_CSS_VALUE = 80

const SEMANTIC_TAGS = new Set([
  'a',
  'button',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'input',
  'label',
  'select',
  'textarea'
])

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()

  if (trimmed.length <= max) {
    return trimmed
  }

  return `${trimmed.slice(0, max - 1)}…`
}

/** Keep only the curated CSS snapshot, drop empties and the whole document. */
export function compactIdentity(snapshot: ElementSnapshot): CompactIdentity {
  const css: Record<string, string> = {}

  for (const key of ANNOTATE_CSS_KEYS) {
    const raw = snapshot.css[key] || snapshot.css[key.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())]

    if (!raw || raw === 'normal' || raw === 'none' || raw === 'auto' || raw === '0px') {
      continue
    }

    css[key] = clip(raw, MAX_CSS_VALUE)
  }

  const tag = (snapshot.tag || 'div').toLowerCase()
  const selector = clip(snapshot.selector || tag, MAX_SELECTOR)
  const text = clip(snapshot.text || '', MAX_TEXT)

  return { css, selector, tag, text }
}

/**
 * The one-line human label. Short on purpose — it is what a person reads to
 * recognise their own comment, not what an agent uses to FIND the element.
 * Everything needed for that is in formatIdentityDetails.
 */
export function formatIdentityLine(identity: CompactIdentity): string {
  if (!identity.text) {
    return identity.selector || identity.tag
  }

  const label = `"${identity.text}"`

  return SEMANTIC_TAGS.has(identity.tag) ? `${identity.tag} ${label}` : label
}

/**
 * The address, geometry and look of the commented element — the part that
 * makes a comment actionable.
 *
 * This existed and was thrown away. `identityOf` in the guest reads the CSS
 * path and a curated computed-style snapshot, `compactIdentity` clips and keeps
 * them, `AnnotatePin.identity` carries them all the way to the composer — and
 * the prompt said `Target: "تصميم."` and nothing else, because
 * formatIdentityLine drops the selector by construction and drops the tag too
 * for anything outside SEMANTIC_TAGS. So the model got a quoted string with no
 * page position, no address, and no way to tell an h2 from a div.
 *
 * Same failure as the pins payload (a correct, fully-tested pure function that
 * nothing rendered), which is why the guard for this lives on the flush path
 * and not only here.
 *
 * Deliberately plain lines, not JSON: a comment is a human sentence about a
 * place on a page, and the surrounding block is prose the model already reads
 * well. Same call the pin block makes.
 */
export function formatIdentityDetails(identity: CompactIdentity, rect?: IdentityRect): string[] {
  const lines: string[] = []

  // The selector is what an agent will actually grep for, so it is never
  // folded into the label line — it survives even when the label already
  // shows the tag.
  if (identity.selector && identity.selector !== identity.tag) {
    lines.push(`  Selector: ${identity.selector}`)
  }

  const box = formatRect(rect)

  if (box) {
    lines.push(`  Box: ${box}`)
  }

  const css = Object.entries(identity.css)

  if (css.length) {
    lines.push(`  Style: ${css.map(([key, value]) => `${key}: ${value}`).join('; ')}`)
  }

  return lines
}

export interface IdentityRect {
  height: number
  width: number
  x: number
  y: number
}

/** Size and document position, rounded — sub-pixel precision is noise in a
 *  prompt, and the numbers are here to be compared against a screenshot. */
export function formatRect(rect?: IdentityRect): string {
  if (!rect) {
    return ''
  }

  const round = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0)

  return `${round(rect.width)}×${round(rect.height)}px at ${round(rect.x)},${round(rect.y)}`
}
