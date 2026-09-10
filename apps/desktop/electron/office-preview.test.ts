import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { officeFamilyForPath } from '../../shared/src/office-format'

import { isOfficePreviewPath, officeConvertForIpc } from './office-preview'

let root: string

const resolveReadableFile = async (filePath: string) => ({ resolvedPath: filePath, stat: fs.statSync(filePath) })

/** Stands in for LibreOffice: drops a small file where the real one would,
 *  named for whichever target the caller asked for. */
const fakeSoffice = vi.fn(async (_binary: string, args: string[]) => {
  const outDir = args[args.indexOf('--outdir') + 1]!
  const target = args[args.indexOf('--convert-to') + 1]!
  const source = args.at(-1)!

  fs.writeFileSync(path.join(outDir, `${path.basename(source, path.extname(source))}.${target}`), 'converted bytes')
})

const deps = () => ({
  cacheDir: path.join(root, 'cache'),
  maxBytes: 1_000_000,
  resolveReadableFile,
  run: fakeSoffice,
  sofficePath: '/usr/bin/soffice'
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-preview-'))
  fakeSoffice.mockClear()
})

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
})

describe('the Office conversion door', () => {
  it('knows which extensions it can convert', () => {
    expect(isOfficePreviewPath('/x/a.docx')).toBe(true)
    expect(isOfficePreviewPath('/x/A.XLSX')).toBe(true)
    expect(isOfficePreviewPath('/x/a.pdf')).toBe(false)
    expect(isOfficePreviewPath('/x/a.txt')).toBe(false)
  })

  it('reads the same family table the renderer classifies with', () => {
    // One table, imported by both processes: when they were two, adding a
    // format to one gave a viewer a file nothing had converted.
    expect(officeFamilyForPath('/x/a.docx')).toBe('docx')
    expect(officeFamilyForPath('/x/a.odt')).toBe('docx')
    expect(officeFamilyForPath('/x/a.ods')).toBe('xlsx')
    expect(officeFamilyForPath('/x/a.PPT')).toBe('pptx')
    expect(officeFamilyForPath('/x/a.txt')).toBeNull()
    // And the conversion door agrees with it.
    expect(isOfficePreviewPath('/x/a.odt')).toBe(true)
  })

  it('converts once and serves the cache while the source is unchanged', async () => {
    const source = path.join(root, 'brief.doc')

    fs.writeFileSync(source, 'doc bytes')

    const first = await officeConvertForIpc(source, 'docx', deps())

    expect(first.startsWith('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,')).toBe(
      true
    )
    expect(fakeSoffice).toHaveBeenCalledTimes(1)
    // The private profile dir is not left behind.
    expect(fs.readdirSync(deps().cacheDir).length).toBe(1)

    await officeConvertForIpc(source, 'docx', deps())
    expect(fakeSoffice).toHaveBeenCalledTimes(1)

    // A changed source (new size) is a new key, so it converts again.
    fs.writeFileSync(source, 'doc bytes, edited')
    await officeConvertForIpc(source, 'docx', deps())
    expect(fakeSoffice).toHaveBeenCalledTimes(2)
  })

  it('keeps two targets of one source apart in the same cache entry', async () => {
    const source = path.join(root, 'brief.docx')

    fs.writeFileSync(source, 'docx bytes')

    const pdf = await officeConvertForIpc(source, 'pdf', deps())
    const docx = await officeConvertForIpc(source, 'docx', deps())

    expect(pdf.startsWith('data:application/pdf;base64,')).toBe(true)
    expect(docx.startsWith('data:application/vnd.openxmlformats')).toBe(true)
    expect(fakeSoffice).toHaveBeenCalledTimes(2)
  })

  it('says how to fix it when LibreOffice is missing', async () => {
    const source = path.join(root, 'deck.ppt')

    fs.writeFileSync(source, 'x')

    await expect(
      officeConvertForIpc(source, 'pptx', { maxBytes: 1, resolveReadableFile, run: fakeSoffice, sofficePath: null })
    ).rejects.toThrow('Install LibreOffice')
  })

  it('refuses a file that is not an Office document before launching anything', async () => {
    const source = path.join(root, 'notes.txt')

    fs.writeFileSync(source, 'x')

    await expect(
      officeConvertForIpc(source, 'pdf', {
        maxBytes: 1,
        resolveReadableFile,
        run: fakeSoffice,
        sofficePath: '/usr/bin/soffice'
      })
    ).rejects.toThrow('Not an Office document')
    expect(fakeSoffice).not.toHaveBeenCalled()
  })

  it('reports a result above the preview cap as advice, not a trace', async () => {
    const source = path.join(root, 'big.xls')

    fs.writeFileSync(source, 'x')

    await expect(officeConvertForIpc(source, 'xlsx', { ...deps(), maxBytes: 4 })).rejects.toThrow(
      'above the preview limit'
    )
  })
})
