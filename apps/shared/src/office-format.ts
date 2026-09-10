/**
 * Which native viewer an Office file opens in, and what it has to become first.
 *
 * Shared by both processes on purpose. The renderer picks the viewer from this
 * table and the main process picks the conversion target from it; when they
 * were two tables, adding a format to one gave you a tab that opened the sheet
 * viewer over a file LibreOffice had never been asked to convert.
 *
 * Every viewer in the rail reads OOXML: Word by docx-preview, the sheet grid
 * and the slide deck by their OOXML parsers. So a file is described by the
 * *family* it belongs to. A file already in its family's form is read straight
 * off disk; a legacy or OpenDocument one is converted to that family by
 * LibreOffice first (`electron/office-preview.ts`), and nothing else about the
 * viewer changes.
 */

export type OfficeFamily = 'docx' | 'pptx' | 'xlsx'

export const OFFICE_FAMILY_BY_EXTENSION: Readonly<Record<string, OfficeFamily>> = {
  '.doc': 'docx',
  '.docx': 'docx',
  '.odp': 'pptx',
  '.ods': 'xlsx',
  '.odt': 'docx',
  '.ppt': 'pptx',
  '.pptx': 'pptx',
  '.rtf': 'docx',
  '.xls': 'xlsx',
  '.xlsx': 'xlsx'
}

/** The lowercased extension of a path or URL, dot included. */
export function fileExtensionOf(value: string): string {
  const clean = value.split(/[?#]/, 1)[0] || value
  const name = clean.split(/[\\/]/).pop() || clean
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function officeFamilyForPath(value: string): null | OfficeFamily {
  return OFFICE_FAMILY_BY_EXTENSION[fileExtensionOf(value)] ?? null
}

/** True when the file must be converted before its viewer can parse it. */
export function officeNeedsConversion(value: string): boolean {
  const family = officeFamilyForPath(value)

  return family != null && fileExtensionOf(value) !== `.${family}`
}

/** The rail's preview kind for each family. Word, spreadsheets and decks each
 *  have their own viewer, so the family a file belongs to is what the tab
 *  records as its kind. */
export type OfficePreviewKind = 'sheet' | 'slides' | 'word'

export const OFFICE_PREVIEW_KIND_BY_FAMILY: Readonly<Record<OfficeFamily, OfficePreviewKind>> = {
  docx: 'word',
  pptx: 'slides',
  xlsx: 'sheet'
}

const OFFICE_FAMILY_BY_PREVIEW_KIND: Readonly<Record<OfficePreviewKind, OfficeFamily>> = {
  sheet: 'xlsx',
  slides: 'pptx',
  word: 'docx'
}

export function isOfficePreviewKind(kind: string | undefined): kind is OfficePreviewKind {
  return kind === 'sheet' || kind === 'slides' || kind === 'word'
}

export function officeFamilyForPreviewKind(kind: OfficePreviewKind): OfficeFamily {
  return OFFICE_FAMILY_BY_PREVIEW_KIND[kind]
}

/** True when the viewer for this kind reads the file's bytes itself.
 *
 *  These viewers never want a text prefetch: an image, a PDF, and each of the
 *  Office viewers parses the file directly, so fetching its text first is a
 *  download of a binary nobody reads. Naming the property keeps the list from
 *  being spelled out again wherever it matters. */
export function previewReadsOwnBytes(kind: string | undefined): boolean {
  return kind === 'image' || kind === 'pdf' || isOfficePreviewKind(kind)
}
