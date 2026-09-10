/**
 * A PDF data: URL as a blob, validated on the way through.
 *
 * Chromium's PDF viewer renders a blank frame for a large `data:` URL, so the
 * rail hands it a blob URL instead. The checks here are what keep a mistyped
 * or mislabelled payload from reaching the viewer as an empty page: the URL
 * has to declare a base64 PDF, and the decoded bytes have to start with a PDF
 * header.
 */

import { dataUrlBytes } from '@/lib/desktop-fs'

export function dataUrlToBlob(dataUrl: string) {
  const comma = dataUrl.indexOf(',')

  if (comma < 0 || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid PDF data URL')
  }

  const metadata = dataUrl
    .slice(5, comma)
    .split(';')
    .map(part => part.trim().toLowerCase())

  const payload = dataUrl.slice(comma + 1)

  if (metadata[0] !== 'application/pdf' || !metadata.slice(1).includes('base64')) {
    throw new Error('Invalid PDF data URL type')
  }

  let bytes: Uint8Array<ArrayBuffer>

  try {
    bytes = dataUrlBytes(dataUrl)
  } catch {
    throw new Error('Invalid PDF data URL payload')
  }

  // A payload that is not a PDF reaches Chromium's viewer as a blank frame, so
  // the header is checked here rather than diagnosed there.
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('Invalid PDF file header')
  }

  return new Blob([bytes], { type: 'application/pdf' })
}

