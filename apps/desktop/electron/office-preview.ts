// Office files (Word, Excel, PowerPoint, OpenDocument, RTF) have no renderer in
// the preview rail. LibreOffice does, and it is on most desks that produce such
// files, so the rail previews them as the PDF LibreOffice prints: one viewer
// for every document format, and the PDF is what the reader would have been
// sent anyway. Conversions are cached by the source's path, size and mtime, so
// re-opening a tab is a file read, not a second LibreOffice launch.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const OFFICE_PREVIEW_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.odp',
  '.ods',
  '.odt',
  '.ppt',
  '.pptx',
  '.rtf',
  '.xls',
  '.xlsx'
])

export function isOfficePreviewPath(filePath: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

const CONVERT_TIMEOUT_MS = 90_000

type RunConverter = (binary: string, args: string[], timeoutMs: number) => Promise<void>

const runSoffice: RunConverter = (binary, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`LibreOffice conversion failed: ${String(stderr || error.message).trim().slice(0, 400)}`))

        return
      }

      resolve()
    })
  })

function findSoffice(env = process.env): string | null {
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice']
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean)

  if (process.platform === 'darwin') {
    dirs.push('/Applications/LibreOffice.app/Contents/MacOS')
  }

  if (process.platform === 'win32') {
    dirs.push('C:\\Program Files\\LibreOffice\\program', 'C:\\Program Files (x86)\\LibreOffice\\program')
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)

      try {
        fs.accessSync(candidate, fs.constants.X_OK)

        return candidate
      } catch {
        // keep looking
      }
    }
  }

  return null
}

export interface OfficePreviewDeps {
  /** Path hardening: the same resolver every other fs door uses. */
  resolveReadableFile: (filePath: string) => Promise<{ resolvedPath: string; stat: fs.Stats }>
  /** Largest PDF the rail will take, in bytes; the preview cap. */
  maxBytes: number
  cacheDir?: string
  run?: RunConverter
  sofficePath?: string | null
}

/** The PDF LibreOffice prints for an Office file, as a data: URL, from cache
 *  when the source has not changed since. Throws a plain message when
 *  LibreOffice is not installed, when the source is not an Office file, or when
 *  the PDF exceeds the preview cap; the rail shows the message as its
 *  "Preview unavailable" reason, so it has to read as advice, not as a trace. */
export async function officePreviewPdfForIpc(filePath: string, deps: OfficePreviewDeps): Promise<string> {
  const { resolvedPath, stat } = await deps.resolveReadableFile(filePath)

  if (!isOfficePreviewPath(resolvedPath)) {
    throw new Error('Not an Office document')
  }

  const soffice = deps.sofficePath === undefined ? findSoffice() : deps.sofficePath

  if (!soffice) {
    throw new Error('Install LibreOffice to preview Word, Excel and PowerPoint files here')
  }

  const cacheDir = deps.cacheDir ?? path.join(os.tmpdir(), 'hermes-office-preview')
  const key = createHash('sha1').update(`${resolvedPath}\n${stat.size}\n${stat.mtimeMs}`).digest('hex')
  const outDir = path.join(cacheDir, key)
  const pdfName = `${path.basename(resolvedPath, path.extname(resolvedPath))}.pdf`
  const pdfPath = path.join(outDir, pdfName)

  if (!fs.existsSync(pdfPath)) {
    await fs.promises.mkdir(outDir, { recursive: true })

    // A private profile dir per conversion: a soffice already running for the
    // user (or for another conversion) would otherwise hand the work to that
    // instance, and the headless call returns before the file exists.
    const profileDir = path.join(outDir, 'profile')

    const args = [
      `-env:UserInstallation=${pathToFileUrl(profileDir)}`,
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      resolvedPath
    ]

    await (deps.run ?? runSoffice)(soffice, args, CONVERT_TIMEOUT_MS)
    await fs.promises.rm(profileDir, { force: true, recursive: true })

    if (!fs.existsSync(pdfPath)) {
      throw new Error('LibreOffice produced no PDF for this file')
    }
  }

  const pdf = await fs.promises.stat(pdfPath)

  if (pdf.size > deps.maxBytes) {
    throw new Error(`The converted PDF is ${Math.round(pdf.size / 1048576)} MB, above the preview limit`)
  }

  const data = await fs.promises.readFile(pdfPath)

  return `data:application/pdf;base64,${data.toString('base64')}`
}

function pathToFileUrl(target: string): string {
  const normalized = target.replace(/\\/g, '/')

  return `file://${normalized.startsWith('/') ? '' : '/'}${encodeURI(normalized)}`
}
