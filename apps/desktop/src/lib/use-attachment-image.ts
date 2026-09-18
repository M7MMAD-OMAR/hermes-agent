import { useEffect, useState } from 'react'

import { gatewayMediaDataUrl, isRemoteGateway } from '@/lib/media'

export type AttachmentImageState = { src: null | string; status: 'failed' | 'loaded' | 'loading' }

/**
 * Bytes for an image reference, as a data URL.
 *
 * A `https:` or `data:` id is already the source and loads nothing. Anything
 * else is a path: on a remote gateway the file lives on the gateway's disk and
 * comes over the authenticated media API, locally it is read straight off this
 * disk. A failure is reported rather than retried, so the caller can fall back
 * to a plain tile instead of holding a spinner forever.
 */
export function useAttachmentImage(id: string): AttachmentImageState {
  const isUrl = /^(?:https?|data):/i.test(id)

  const [state, setState] = useState<AttachmentImageState>(
    isUrl ? { src: id, status: 'loaded' } : { src: null, status: 'loading' }
  )

  useEffect(() => {
    if (isUrl) {
      setState({ src: id, status: 'loaded' })

      return
    }

    if (!id) {
      setState({ src: null, status: 'failed' })

      return
    }

    let alive = true

    setState({ src: null, status: 'loading' })

    const load =
      window.hermesDesktop && isRemoteGateway() ? gatewayMediaDataUrl(id) : window.hermesDesktop?.readFileDataUrl(id)

    void Promise.resolve(load)
      .then(url => {
        if (alive) {
          setState(url ? { src: url, status: 'loaded' } : { src: null, status: 'failed' })
        }
      })
      .catch(() => alive && setState({ src: null, status: 'failed' }))

    return () => {
      alive = false
    }
  }, [id, isUrl])

  return state
}
