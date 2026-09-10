import { describe, expect, it } from 'vitest'

import { decodePreviewTabs } from './preview'

describe('persisted preview migration', () => {
  it('upgrades a pre-PDF remote tab from binary to pdf', () => {
    const source = '/remote/.hermes/desktop-attachments/spec.pdf'

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${source}`,
          target: {
            binary: true,
            kind: 'file',
            label: 'spec.pdf',
            large: true,
            path: source,
            previewKind: 'binary',
            source,
            url: `file://${source}`
          }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('pdf')
  })

  it.each([
    ['brief.docx', 'word'],
    ['sales.xlsx', 'sheet'],
    ['deck.pptx', 'slides'],
    ['legacy.ods', 'sheet']
  ])('re-points a tab persisted under the retired office kind: %s', (name, expected) => {
    const source = `/work/${name}`

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${source}`,
          target: { kind: 'file', label: name, path: source, previewKind: 'office', source, url: `file://${source}` }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe(expected)
  })

  it('falls back to binary when an office tab points at something else entirely', () => {
    const source = '/work/notes.txt'

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${source}`,
          target: { kind: 'file', label: 'notes.txt', path: source, previewKind: 'office', source, url: `file://${source}` }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('binary')
  })

  it('repairs a path that swallowed the bold marker it was written inside', () => {
    // `**MEDIA: /work/prd.pdf**` used to reach the rail with the asterisks
    // attached, and the tab could never open again.
    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: 'file:file:///work/prd.pdf**',
          target: {
            kind: 'file',
            label: 'prd.pdf**',
            path: '/work/prd.pdf**',
            previewKind: 'binary',
            source: '/work/prd.pdf**',
            url: 'file:///work/prd.pdf**'
          }
        }
      ])
    )

    expect(restored?.target.path).toBe('/work/prd.pdf')
    expect(restored?.target.label).toBe('prd.pdf')
    expect(restored?.target.url).toBe('file:///work/prd.pdf')
    expect(restored?.id).toBe('file:file:///work/prd.pdf')
    // And once the path is real again it classifies as the PDF it is.
    expect(restored?.target.previewKind).toBe('pdf')
  })

  it('drops the repaired duplicate when the working tab is already open', () => {
    // Both were open at once: the broken one the markdown produced, and the
    // one a later click opened correctly. Repairing the first makes them one.
    const restored = decodePreviewTabs(
      JSON.stringify([
        {
          id: 'file:file:///work/prd.docx',
          target: {
            kind: 'file',
            label: 'prd.docx',
            path: '/work/prd.docx',
            previewKind: 'word',
            source: '/work/prd.docx',
            url: 'file:///work/prd.docx'
          }
        },
        {
          id: 'file:file:///work/prd.docx**',
          target: {
            kind: 'file',
            label: 'prd.docx**',
            path: '/work/prd.docx**',
            previewKind: 'text',
            source: '/work/prd.docx**',
            url: 'file:///work/prd.docx**'
          }
        }
      ])
    )

    expect(restored).toHaveLength(1)
    expect(restored[0]?.target.previewKind).toBe('word')
  })

  it('re-asks what a repaired path is, not just whether it is a PDF', () => {
    // The tab was classified while its name ended in `.docx**`, so it was
    // stored as text and would have opened a Word file in the source viewer.
    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: 'file:file:///work/brief.docx**',
          target: {
            kind: 'file',
            label: 'brief.docx**',
            path: '/work/brief.docx**',
            previewKind: 'text',
            source: '/work/brief.docx**',
            url: 'file:///work/brief.docx**'
          }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('word')
  })

  it('leaves a persisted non-PDF binary tab unchanged', () => {
    const source = '/work/archive.zip'

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${source}`,
          target: {
            binary: true,
            kind: 'file',
            label: 'archive.zip',
            path: source,
            previewKind: 'binary',
            source,
            url: `file://${source}`
          }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('binary')
  })

  it.each(['report.pdf#notes', 'report.pdf?draft'])('treats %s as a literal filesystem path', sourceName => {
    const source = `/work/${sourceName}`

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${encodeURI(source)}`,
          target: {
            binary: true,
            kind: 'file',
            label: sourceName,
            path: source,
            previewKind: 'binary',
            source,
            url: `file:///work/${encodeURIComponent(sourceName)}`
          }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('binary')
  })

  it('does not overwrite a non-binary PDF preview kind', () => {
    const source = '/work/spec.pdf'

    const [restored] = decodePreviewTabs(
      JSON.stringify([
        {
          id: `file:file://${source}`,
          target: {
            kind: 'file',
            label: 'spec.pdf',
            path: source,
            previewKind: 'text',
            source,
            url: `file://${source}`
          }
        }
      ])
    )

    expect(restored?.target.previewKind).toBe('text')
  })
})
