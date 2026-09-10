/**
 * Shrinking the browser's photograph before it leaves the renderer.
 *
 * A full-viewport PNG of a modern page is a few megabytes, and this one
 * travels as base64 inside a JSON gateway frame and then sits in the model's
 * context for the rest of the turn. Neither survives that at full size. A
 * long-edge cap plus JPEG is what makes the picture affordable, and text on a
 * web page stays legible well below the resolution it was captured at.
 */

/** Long edge, in pixels, of the picture the model receives. */
export const LOOK_MAX_EDGE = 1400
const LOOK_QUALITY = 0.82
/** A decode that has not finished by now is not going to. An image element
 *  that fires neither `load` nor `error` would otherwise hold the tool open
 *  for its whole bridge deadline over what is only a size optimisation. */
const DECODE_TIMEOUT_MS = 2_000

export interface CanvasFactory {
  (width: number, height: number): {
    context: null | { drawImage: (image: CanvasImageSource, x: number, y: number, w: number, h: number) => void }
    toDataURL: (type: string, quality: number) => string
  }
}

export function scaleToFit(width: number, height: number, maxEdge = LOOK_MAX_EDGE): { height: number; width: number } {
  const longest = Math.max(width, height)

  if (!longest || longest <= maxEdge) {
    return { height: Math.max(1, height), width: Math.max(1, width) }
  }

  const ratio = maxEdge / longest

  return { height: Math.max(1, Math.round(height * ratio)), width: Math.max(1, Math.round(width * ratio)) }
}

/** Re-encode a captured data URL smaller. Returns the original untouched when
 *  the browser cannot decode or draw it: a large picture beats none. */
export async function shrinkLook(dataUrl: string, maxEdge = LOOK_MAX_EDGE): Promise<string> {
  if (typeof Image !== 'function' || typeof document === 'undefined') {
    return dataUrl
  }

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      const timer = setTimeout(() => reject(new Error('capture decode timed out')), DECODE_TIMEOUT_MS)

      const settle = (done: () => void) => () => {
        clearTimeout(timer)
        done()
      }

      element.onload = settle(() => resolve(element))
      element.onerror = settle(() => reject(new Error('undecodable capture')))
      element.src = dataUrl
    })

    const size = scaleToFit(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge)
    const canvas = document.createElement('canvas')

    canvas.width = size.width
    canvas.height = size.height

    const context = canvas.getContext('2d')

    if (!context) {
      return dataUrl
    }

    context.drawImage(image, 0, 0, size.width, size.height)

    const encoded = canvas.toDataURL('image/jpeg', LOOK_QUALITY)

    return encoded.startsWith('data:image/') && encoded.length < dataUrl.length ? encoded : dataUrl
  } catch {
    return dataUrl
  }
}
