/**
 * Crop a preview webview via webContents.capturePage.
 *
 * Electron's rect argument is unreliable on guest webviews (empty NativeImage
 * on Windows, DPI-shifted crops). Capture the visible viewport, then crop in
 * bitmap space from CSS viewport coordinates.
 *
 * Missing/destroyed guests fail closed — never a blank PNG that would look
 * like a successful shot of nothing.
 */

export interface CaptureRect {
  height: number
  width: number
  x: number
  y: number
}

export interface CaptureViewport {
  height: number
  width: number
}

export interface CaptureGuest {
  capturePage: (rect?: CaptureRect) => Promise<CaptureImage>
  isDestroyed: () => boolean
}

export interface CaptureImage {
  crop?: (rect: CaptureRect) => CaptureImage
  getSize?: () => CaptureViewport
  isEmpty: () => boolean
  resize?: (options: { height?: number; quality?: string; width?: number }) => CaptureImage
  toJPEG?: (quality: number) => Buffer
  toPNG: () => Buffer
}

/** How the caller wants the picture back.
 *
 *  The agent's `look` asks for a capped JPEG because the picture crosses a
 *  websocket frame and then sits in a model's context: a full-resolution PNG
 *  of a modern page is several megabytes of base64 for text that stays legible
 *  at a fraction of it. Resizing here rather than in the renderer means one
 *  encode instead of an encode, a decode, and a second encode. */
export interface CaptureFormat {
  /** Longest edge in pixels; larger captures are scaled down to it. */
  maxEdge?: number
  /** JPEG quality 0-100. Absent: PNG, lossless, for a crop a person will read. */
  jpegQuality?: number
}

export function normalizeCaptureRect(rect?: CaptureRect): CaptureRect | undefined {
  if (!rect) {
    return undefined
  }

  return {
    height: Math.max(1, Math.ceil(rect.height)),
    width: Math.max(1, Math.ceil(rect.width)),
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y))
  }
}

/** Map a CSS-pixel viewport rect onto a (possibly DPR-scaled) bitmap. */
export function mapViewportRectToImage(
  rect: CaptureRect,
  viewport: CaptureViewport,
  image: CaptureViewport
): CaptureRect | null {
  const viewW = Math.max(1, viewport.width)
  const viewH = Math.max(1, viewport.height)
  const scaleX = image.width / viewW
  const scaleY = image.height / viewH
  const left = rect.x * scaleX
  const top = rect.y * scaleY
  const right = (rect.x + rect.width) * scaleX
  const bottom = (rect.y + rect.height) * scaleY
  const x = Math.max(0, Math.floor(left))
  const y = Math.max(0, Math.floor(top))
  const maxX = Math.min(image.width, Math.ceil(right))
  const maxY = Math.min(image.height, Math.ceil(bottom))
  const width = maxX - x
  const height = maxY - y

  if (width < 1 || height < 1) {
    return null
  }

  return { height, width, x, y }
}

function toDataUrl(image: CaptureImage, format?: CaptureFormat): string {
  if (!image || image.isEmpty()) {
    throw new Error('preview capture was empty')
  }

  const sized = fitted(image, format?.maxEdge)

  if (format?.jpegQuality && typeof sized.toJPEG === 'function') {
    return `data:image/jpeg;base64,${sized.toJPEG(format.jpegQuality).toString('base64')}`
  }

  return `data:image/png;base64,${sized.toPNG().toString('base64')}`
}

/** The image scaled to fit `maxEdge`, or the image itself when it already
 *  does, when no cap was asked for, or when this build cannot resize. */
export function fitted(image: CaptureImage, maxEdge?: number): CaptureImage {
  const size = image.getSize?.()

  if (!maxEdge || !size || typeof image.resize !== 'function') {
    return image
  }

  const longest = Math.max(size.width, size.height)

  if (longest <= maxEdge) {
    return image
  }

  const ratio = maxEdge / longest

  const resized = image.resize({
    height: Math.max(1, Math.round(size.height * ratio)),
    quality: 'good',
    width: Math.max(1, Math.round(size.width * ratio))
  })

  return resized && !resized.isEmpty() ? resized : image
}

export async function capturePreviewContents(
  guest: CaptureGuest | null | undefined,
  rect?: CaptureRect,
  viewport?: CaptureViewport,
  format?: CaptureFormat
): Promise<string> {
  if (!guest || guest.isDestroyed()) {
    throw new Error('preview guest is gone')
  }

  const image = await guest.capturePage()

  if (!image || image.isEmpty()) {
    throw new Error('preview capture was empty')
  }

  const crop = normalizeCaptureRect(rect)

  if (!crop) {
    return toDataUrl(image, format)
  }

  const size = image.getSize?.()
  const view = viewport && viewport.width > 0 && viewport.height > 0 ? viewport : size

  if (size && view && typeof image.crop === 'function') {
    const mapped = mapViewportRectToImage(crop, view, size)

    if (mapped) {
      const cropped = image.crop(mapped)

      if (cropped && !cropped.isEmpty()) {
        return toDataUrl(cropped, format)
      }
    }

    // Off-screen CSS rects (document Y after scroll, DPI mismatch) used to
    // throw here and the composer kept the stale pick-time crop. The visible
    // page is a better fallback than the wrong slice of the article.
    return toDataUrl(image, format)
  }

  try {
    return toDataUrl(await guest.capturePage(crop), format)
  } catch {
    return toDataUrl(image, format)
  }
}
