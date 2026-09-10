/**
 * Which viewer a file opens in, decided from its name alone.
 *
 * Two callers need the same answer and must never disagree: the classifier
 * that builds a preview target when a file is opened, and the restore-time
 * migration that repairs a tab persisted by an older build. When they drifted,
 * a repaired path kept the kind it was misclassified under and a Word document
 * opened in the source viewer.
 */

import { fileExtensionOf, OFFICE_PREVIEW_KIND_BY_FAMILY, officeFamilyForPath } from '@hermes/shared/office-format'

import type { PreviewTarget } from '@/store/preview'

export type PreviewKind = NonNullable<PreviewTarget['previewKind']>

const HTML_EXTENSIONS = new Set(['.htm', '.html'])
const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])

/** The rail's viewer for a path or URL. Nothing here reads the file, so a
 *  binary that happens to end in `.txt` still resolves to text; the loader
 *  guards that once it has the bytes. */
export function previewKindForPath(value: string): PreviewKind {
  const extension = fileExtensionOf(value)

  if (HTML_EXTENSIONS.has(extension)) {
    return 'html'
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (extension === '.pdf') {
    return 'pdf'
  }

  const family = officeFamilyForPath(value)

  return family ? OFFICE_PREVIEW_KIND_BY_FAMILY[family] : 'text'
}
