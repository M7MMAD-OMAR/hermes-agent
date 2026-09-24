import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { refChipLabel, unwrapRefValue } from '@/components/assistant-ui/directive-text'
import { WIRE_REFERENCE_KINDS } from '@/components/assistant-ui/reference-kinds'
import { ImageLightbox } from '@/components/chat/zoomable-image'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { Tip } from '@/components/ui/tooltip'
import { useImageDownload } from '@/hooks/use-image-download'
import { useI18n } from '@/i18n'
import { attachmentImageDataUrl, openAttachmentPreview } from '@/lib/attachment-preview'
import { openLink } from '@/lib/external-link'
import { useAttachmentImage } from '@/lib/use-attachment-image'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'

// How many tiles a message shows before the rest go behind one expander. A
// turn that carries a folder's worth of files still has to leave the message
// it belongs to readable, and a chat attachment count is tens at the very most,
// so a fixed cut plus wrapping is enough; nothing here needs virtualizing.
const VISIBLE_LIMIT = 8

interface Attachment {
  /** The reference's raw value: a path, a URL for `url` refs, or the bytes
   *  themselves when a picture arrived inline. */
  id: string
  /** Uppercase format for the corner. Read from the extension for a path, and
   *  from the media type for inline bytes, which have no extension to read. */
  badge: string
  /** Basename for a path, host and path for a URL, and '' for inline bytes,
   *  which carry no name of their own. */
  label: string
  type: string
}

/** Last path segment, which is what a tile can actually show. Falls back to the
 *  whole label for a URL or anything without separators. */
function basename(label: string): string {
  const parts = label.replace(/[/\\]+$/, '').split(/[/\\]/)

  return parts[parts.length - 1] || label
}

/** A format word for the tile's corner, '' when it is not one. Capped so a
 *  pathological "file.somethingverylong" cannot widen the tile, and rejected
 *  outright when it is not plain alphanumeric ("x-icon", "svg+xml"). */
function formatBadge(format: string): string {
  return format && format.length <= 5 && /^[a-z0-9]+$/i.test(format) ? format.toUpperCase() : ''
}

/** Uppercase extension for the tile's corner badge, '' when there is none. */
function extensionBadge(label: string): string {
  const name = basename(label)
  const dot = name.lastIndexOf('.')

  return formatBadge(dot > 0 ? name.slice(dot + 1) : '')
}

// Each entry of `attachmentRefs` is ONE whole reference, so the value is
// everything after the kind. Parsed here rather than through the directive
// formatter, whose job is finding references inside prose: it stops a bare
// value at the first space, which shatters "Website Review V2-2.pdf" into three
// attachments when an older message carries it unquoted.
const WHOLE_REFERENCE_RE = /^@([a-z]+):([\s\S]+)$/i

// A picture the user just attached is NOT an `@image:` reference. It arrives as
// the bounded `data:` thumbnail the composer already holds, deliberately: a
// path would route through `/api/media` and 403 on a remote gateway, and
// painting the full source is what froze the send (see
// `optimisticAttachmentRef` in lib/chat-runtime). Refusing that form here is
// how every sent picture lost its tile. Once the turn persists, the gateway
// rewrites it to `@image:<path>` and the tile picks up the real filename.
const INLINE_IMAGE_RE = /^data:image\/([a-z0-9][a-z0-9.+-]*)[;,]/i

function parseAttachments(refs: string[]): Attachment[] {
  const out: Attachment[] = []

  for (const ref of refs) {
    const value = ref.trim()
    const inline = INLINE_IMAGE_RE.exec(value)

    if (inline) {
      // "svg+xml" is one format wearing a suffix; the badge is the format.
      out.push({ badge: formatBadge(inline[1].split('+')[0]), id: value, label: '', type: 'image' })

      continue
    }

    const match = WHOLE_REFERENCE_RE.exec(value)
    const type = match?.[1]?.toLowerCase() ?? ''

    if (!match || !(WIRE_REFERENCE_KINDS as readonly string[]).includes(type)) {
      continue
    }

    const id = unwrapRefValue(match[2].trim())

    if (id) {
      const label = refChipLabel(type, id)

      out.push({ badge: extensionBadge(label), id, label, type })
    }
  }

  return out
}

/**
 * The attachments a sent message carries, as a grid of tiles.
 *
 * Deliberately NOT `DirectiveContent`: that renders references inline, which is
 * right for an `@file:` the user wrote mid-sentence and wrong for the block of
 * things they attached. Here each one is its own square, carrying the glyph for
 * its format, its extension, and its name, and opening on click. Images show
 * their own bytes rather than a glyph, so a picture is recognisable at a glance
 * instead of reading as a generic file.
 */
export function MessageAttachments({ refs }: { refs: string[] }) {
  const { t } = useI18n()
  const c = t.composer
  const attachments = useMemo(() => parseAttachments(refs), [refs])
  const [expanded, setExpanded] = useState(false)

  if (attachments.length === 0) {
    return null
  }

  const overflow = attachments.length - VISIBLE_LIMIT
  const shown = expanded || overflow <= 0 ? attachments : attachments.slice(0, VISIBLE_LIMIT)

  return (
    <div className="flex flex-col gap-1.5" data-slot="aui_message-attachments">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((attachment, index) => (
          <AttachmentTile attachment={attachment} key={`${index}-${attachment.type}:${attachment.id}`} />
        ))}
      </div>
      {overflow > 0 ? (
        <button
          className="self-start rounded-md px-1 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:text-foreground"
          onClick={() => setExpanded(open => !open)}
          type="button"
        >
          {expanded ? c.attachmentsShowFewer : c.attachmentsShowAll(attachments.length)}
        </button>
      ) : null}
    </div>
  )
}

function AttachmentTile({ attachment }: { attachment: Attachment }) {
  const { t } = useI18n()
  const c = t.composer
  // A relative path resolves against the session's own root, the same way the
  // composer's pills resolve theirs.
  const cwd = useStore(useSessionView().$cwd)
  const isImage = attachment.type === 'image'
  const isUrl = attachment.type === 'url'
  // Bytes that arrived inline with no name of their own (see INLINE_IMAGE_RE).
  const inline = attachment.label === ''
  const [lightboxSrc, setLightboxSrc] = useState('')
  // Same save affordance the composer's image pill offers, so a picture opened
  // from the transcript can be kept without going back to the file it came from.
  const { download, saving } = useImageDownload(lightboxSrc)
  // Inline bytes have no filename, so the format stands in for one. Anything
  // else is named by its own last path segment.
  const name = inline ? c.attachmentImage : isUrl ? attachment.label : basename(attachment.label)
  const badge = isUrl ? 'URL' : attachment.badge

  async function open() {
    try {
      if (isUrl) {
        openLink(attachment.id)

        return
      }

      if (isImage) {
        // Inline bytes ARE the source; reading them as a path would fail and
        // put an error toast where a picture should be. They are the bounded
        // thumbnail, so this opens at thumbnail resolution until the turn
        // persists and the reference becomes the real file.
        const source = inline ? attachment.id : await attachmentImageDataUrl([attachment.id])

        if (!source) {
          throw new Error(c.couldNotPreview(name))
        }

        setLightboxSrc(source)

        return
      }

      if (!(await openAttachmentPreview(attachment.id, cwd || undefined))) {
        throw new Error(c.couldNotPreview(name))
      }
    } catch (error) {
      notifyError(error, c.previewUnavailable)
    }
  }

  return (
    <>
      {/* The raw value is the useful hover for a path or a URL, and a
          multi-kilobyte base64 blob for inline bytes. Those get the name. */}
      <Tip label={inline ? name : attachment.id}>
        <button
          aria-label={c.previewLabel(name)}
          className={cn(
            'group/tile flex w-[5.5rem] flex-col gap-1 rounded-xl border border-border/60 bg-background/50 p-1.5 text-start',
            'transition-colors hover:border-primary/35 hover:bg-accent/45'
          )}
          onClick={() => void open()}
          type="button"
        >
          <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg border border-border/55 bg-muted/35 text-muted-foreground">
            {isImage ? (
              <AttachmentThumbnail id={attachment.id} label={name} />
            ) : (
              <FileTypeIcon className="text-lg" path={isUrl || inline ? undefined : attachment.label} />
            )}
            {badge ? (
              <span className="absolute bottom-0.5 end-0.5 rounded bg-background/85 px-1 text-[0.5625rem] font-medium leading-4 text-(--ui-text-tertiary)">
                {badge}
              </span>
            ) : null}
          </span>
          <span className="w-full truncate text-[0.6875rem] leading-4" title={name}>
            {name}
          </span>
        </button>
      </Tip>
      {lightboxSrc ? (
        <ImageLightbox
          alt={name}
          copy={t.desktop}
          onClick={download}
          onOpenChange={next => !next && setLightboxSrc('')}
          open
          saving={saving}
          src={lightboxSrc}
        />
      ) : null}
    </>
  )
}

/** An image tile's own bytes. A file that cannot be read falls back to the
 *  format glyph rather than an empty square, so the row never has a hole. */
function AttachmentThumbnail({ id, label }: { id: string; label: string }) {
  const { src, status } = useAttachmentImage(id)

  if (status === 'failed') {
    return <FileTypeIcon className="text-lg" path={label} />
  }

  if (!src) {
    return <span aria-hidden className="size-full animate-pulse bg-[color-mix(in_srgb,currentColor_8%,transparent)]" />
  }

  return <img alt={label} className="size-full object-cover" draggable={false} src={src} />
}
