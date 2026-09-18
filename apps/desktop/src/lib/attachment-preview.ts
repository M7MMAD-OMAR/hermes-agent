import { readDesktopFileDataUrlLocalFirst } from '@/lib/desktop-fs'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { openPreview } from '@/store/preview'

// ── Opening an attachment ───────────────────────────────────────────────────
// One implementation for both surfaces that show attachments: the composer's
// pills (before sending) and the sent message's tiles. They hold different
// shapes, a ComposerAttachment object versus a bare `@file:` reference, so the
// shape is reduced to candidate paths at each edge and the act of opening one
// lives here. Copied instead of shared, the two would drift the first time
// either is fixed.

/** Strip the backticks a quoted reference carries into its raw value. */
export function attachmentTarget(raw: string): string {
  return raw.trim().replace(/^`|`$/g, '')
}

/**
 * First candidate path that yields image bytes, as a data URL.
 *
 * More than one path is tried because an upload can replace `path` with a
 * gateway-side staged path while the original host path lives on in `detail`:
 * on a split-filesystem setup only one of the two is readable, and which one
 * depends on where the turn got to. Throws the last read error when every
 * candidate fails, so the caller can report why rather than just "no".
 */
export async function attachmentImageDataUrl(candidates: (null | string | undefined)[]): Promise<string> {
  const paths = candidates.filter(
    (path, index, all): path is string => Boolean(path) && all.indexOf(path) === index
  )

  let lastError: unknown

  for (const path of paths) {
    try {
      const source = await readDesktopFileDataUrlLocalFirst(path)

      if (source) {
        return source
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return ''
}

/**
 * Open a file reference in the preview pane. `cwd` resolves a relative path
 * against the session's own root. Returns false when the target resolves to
 * nothing previewable, leaving the caller to phrase that in its own words.
 */
export async function openAttachmentPreview(raw: string, cwd?: string): Promise<boolean> {
  const target = attachmentTarget(raw)

  if (!target) {
    return false
  }

  const preview = await normalizeOrLocalPreviewTarget(target, cwd || undefined)

  if (!preview) {
    return false
  }

  openPreview(preview, 'manual')

  return true
}
