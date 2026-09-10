import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isOfficePreviewPath, officePreviewPdfForIpc } from './office-preview'

let root: string

const resolveReadableFile = async (filePath: string) => ({ resolvedPath: filePath, stat: fs.statSync(filePath) })

/** Stands in for LibreOffice: drops a small PDF where the real one would. */
const fakeSoffice = vi.fn(async (_binary: string, args: string[]) => {
  const outDir = args[args.indexOf('--outdir') + 1]!
  const source = args.at(-1)!

  fs.writeFileSync(path.join(outDir, `${path.basename(source, path.extname(source))}.pdf`), '%PDF-1.4 fake')
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-preview-'))
  fakeSoffice.mockClear()
})

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
})

describe('Office files preview as the PDF LibreOffice prints', () => {
  it('knows which extensions it can print', () => {
    expect(isOfficePreviewPath('/x/a.docx')).toBe(true)
    expect(isOfficePreviewPath('/x/A.XLSX')).toBe(true)
    expect(isOfficePreviewPath('/x/a.pdf')).toBe(false)
    expect(isOfficePreviewPath('/x/a.txt')).toBe(false)
  })

  it('converts once and serves the cache while the source is unchanged', async () => {
    const source = path.join(root, 'brief.docx')

    fs.writeFileSync(source, 'docx bytes')

    const deps = {
      cacheDir: path.join(root, 'cache'),
      maxBytes: 1_000_000,
      resolveReadableFile,
      run: fakeSoffice,
      sofficePath: '/usr/bin/soffice'
    }

    const first = await officePreviewPdfForIpc(source, deps)

    expect(first.startsWith('data:application/pdf;base64,')).toBe(true)
    expect(fakeSoffice).toHaveBeenCalledTimes(1)
    // The private profile dir is not left behind.
    expect(fs.readdirSync(deps.cacheDir).length).toBe(1)

    await officePreviewPdfForIpc(source, deps)
    expect(fakeSoffice).toHaveBeenCalledTimes(1)

    // A changed source (new size) is a new key, so it prints again.
    fs.writeFileSync(source, 'docx bytes, edited')
    await officePreviewPdfForIpc(source, deps)
    expect(fakeSoffice).toHaveBeenCalledTimes(2)
  })

  it('says how to fix it when LibreOffice is missing', async () => {
    const source = path.join(root, 'deck.pptx')

    fs.writeFileSync(source, 'x')

    await expect(
      officePreviewPdfForIpc(source, { maxBytes: 1, resolveReadableFile, run: fakeSoffice, sofficePath: null })
    ).rejects.toThrow('Install LibreOffice')
  })

  it('refuses a file that is not an Office document before launching anything', async () => {
    const source = path.join(root, 'notes.txt')

    fs.writeFileSync(source, 'x')

    await expect(
      officePreviewPdfForIpc(source, { maxBytes: 1, resolveReadableFile, run: fakeSoffice, sofficePath: '/usr/bin/soffice' })
    ).rejects.toThrow('Not an Office document')
    expect(fakeSoffice).not.toHaveBeenCalled()
  })

  it('reports a PDF above the preview cap as advice, not a trace', async () => {
    const source = path.join(root, 'big.xlsx')

    fs.writeFileSync(source, 'x')

    await expect(
      officePreviewPdfForIpc(source, {
        cacheDir: path.join(root, 'cache'),
        maxBytes: 4,
        resolveReadableFile,
        run: fakeSoffice,
        sofficePath: '/usr/bin/soffice'
      })
    ).rejects.toThrow('above the preview limit')
  })
})
