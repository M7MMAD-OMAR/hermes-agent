import { type CompactIdentity, formatIdentityDetails, formatIdentityLine, formatRect } from './identity'
import type { AnnotatePin } from './stack'

export interface ComposerReadyAnnotation {
  identity?: CompactIdentity
  imageDataUrl: string
  note: string
  number: number
  /** The page this comment was placed on. Carried so the header can tell
   *  whether one URL describes the whole batch. */
  pageUrl: string
  prompt: string
}

export interface PackAnnotateOptions {
  /** Name the page on every comment. Set when the review walked across pages,
   *  so the single URL on the header line would be a lie for some of them. */
  includePage?: boolean
}

function identityBlock(pin: AnnotatePin): string {
  if (!pin.identity) {
    // An area pin has no element to name, but it still has a place — and the
    // place is the entire content of the comment, so it says where.
    return `area on the page (${formatRect(pin.rect)})`
  }

  return formatIdentityLine(pin.identity)
}

export function packageAnnotatePin(pin: AnnotatePin, options: PackAnnotateOptions = {}): ComposerReadyAnnotation {
  const target = identityBlock(pin)
  const note = pin.note.trim()

  const prompt = [
    `Comment ${pin.number}`,
    options.includePage && pin.pageUrl ? `Page: ${pin.pageUrl}` : '',
    `Target: ${target}`,
    // The address, geometry and look. Captured since comment mode shipped and
    // never rendered — see formatIdentityDetails.
    ...(pin.identity ? formatIdentityDetails(pin.identity, pin.rect) : []),
    note ? `Note: ${note}` : '',
    `Image ${pin.number} marks the target in blue.`
  ]
    .filter(Boolean)
    .join('\n')

  return {
    identity: pin.identity,
    imageDataUrl: pin.imageDataUrl,
    note,
    number: pin.number,
    pageUrl: pin.pageUrl || '',
    prompt
  }
}

/** True when these pins were not all placed on the same page. */
function spansPages(pins: readonly AnnotatePin[]): boolean {
  const urls = new Set(pins.map(pin => pin.pageUrl || ''))

  return urls.size > 1
}

export function packageAnnotateStack(pins: readonly AnnotatePin[]): ComposerReadyAnnotation[] {
  const includePage = spansPages(pins)

  return pins.map(pin => packageAnnotatePin(pin, { includePage }))
}

export function annotateFlushPrompt(items: readonly ComposerReadyAnnotation[], pageUrl?: string): string {
  // One URL on the header is only honest when every comment shares it. A review
  // that walked across pages names the page per comment instead (the pins block
  // groups by page for the same reason), and the header stays silent rather
  // than labelling all of them with whichever page happened to be open at
  // flush time.
  const mixed = new Set(items.map(item => item.pageUrl)).size > 1
  const where = pageUrl && !mixed ? ` on ${pageUrl}` : ''
  const count = items.length

  const header =
    count === 1
      ? `I left a comment${where} in the in-app browser. Address it and keep the scope narrow.`
      : `I left ${count} comments${where} in the in-app browser. Address them and keep the scope narrow.`

  // Blank line BETWEEN comments, now that each one is several lines: without
  // it `Image 1 marks…` and `Comment 2` sit flush and the block reads as one
  // run-on paragraph.
  return [header, '', items.map(item => item.prompt).join('\n\n')].join('\n')
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = comma >= 0 ? dataUrl.slice(0, comma) : 'data:image/png;base64'
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new Blob([bytes], { type: mime })
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const blob = dataUrlToBlob(dataUrl)

  return new File([blob], name, { type: blob.type })
}
