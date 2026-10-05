import { useEffect, useState } from 'react'

import { isReadFileErrorResult } from '@/lib/desktop-fs'
import { downscaleDataUrlForPreview, FALLBACK_PLACEHOLDER } from '@/lib/image-resize'
import { gatewayMediaDataUrl, isRemoteGateway } from '@/lib/media'

export type AttachmentImageState = {
  src: null | string
  status: 'failed' | 'loaded' | 'loading'
  /** Full-resolution source for a lightbox or download; equals `src` unless a
   *  bounded thumbnail was requested. */
  zoomSrc: null | string
}

export interface AttachmentImageOptions {
  /** Paint a bounded thumbnail in `src` and keep the full image in `zoomSrc`,
   *  so a turn full of screenshots does not hand Chromium multi-MB paint
   *  sources (#93204). */
  thumbnail?: boolean
}

/**
 * Bytes for an image reference, as a data URL.
 *
 * A `https:`, `data:` or `blob:` id is already the source and loads nothing
 * (a `blob:` object URL is renderer-local, so painting it costs no IPC read). Anything
 * else is a path: on a remote gateway the file lives on the gateway's disk and
 * comes over the authenticated media API, locally it is read straight off this
 * disk. A failure is reported rather than retried, so the caller can fall back
 * to a plain tile instead of holding a spinner forever.
 */
export function useAttachmentImage(id: string, { thumbnail = false }: AttachmentImageOptions = {}): AttachmentImageState {
  const isUrl = /^(?:https?|data|blob):/i.test(id)

  const [state, setState] = useState<AttachmentImageState>(
    isUrl ? { src: id, status: 'loaded', zoomSrc: id } : { src: null, status: 'loading', zoomSrc: null }
  )

  useEffect(() => {
    if (isUrl) {
      setState({ src: id, status: 'loaded', zoomSrc: id })

      return
    }

    if (!id) {
      setState({ src: null, status: 'failed', zoomSrc: null })

      return
    }

    let alive = true

    setState({ src: null, status: 'loading', zoomSrc: null })

    const load =
      window.hermesDesktop && isRemoteGateway() ? gatewayMediaDataUrl(id) : window.hermesDesktop?.readFileDataUrl(id)

    void Promise.resolve(load)
      .then(async url => {
        if (!alive) {
          return
        }

        if (!url || isReadFileErrorResult(url)) {
          setState({ src: null, status: 'failed', zoomSrc: null })

          return
        }

        if (!thumbnail) {
          setState({ src: url, status: 'loaded', zoomSrc: url })

          return
        }

        // Full resolution powers click-to-zoom and Save; the inline <img> gets
        // a bounded thumbnail.
        const small = await downscaleDataUrlForPreview(url)

        if (alive) {
          setState({ src: small && small !== FALLBACK_PLACEHOLDER ? small : url, status: 'loaded', zoomSrc: url })
        }
      })
      .catch(() => alive && setState({ src: null, status: 'failed', zoomSrc: null }))

    return () => {
      alive = false
    }
  }, [id, isUrl, thumbnail])

  return state
}
