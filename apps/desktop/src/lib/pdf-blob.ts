/**
 * A PDF data: URL as a blob, validated on the way through.
 *
 * Chromium's PDF viewer renders a blank frame for a large `data:` URL, so the
 * rail hands it a blob URL instead. The checks here are what keep a mistyped
 * or mislabelled payload from reaching the viewer as an empty page: the URL
 * has to declare a base64 PDF, and the decoded bytes have to start with a PDF
 * header.
 */

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

  let binary: string

  try {
    binary = atob(decodeURIComponent(payload))
  } catch {
    throw new Error('Invalid PDF data URL payload')
  }

  if (!binary.startsWith('%PDF-')) {
    throw new Error('Invalid PDF file header')
  }

  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: 'application/pdf' })
}

