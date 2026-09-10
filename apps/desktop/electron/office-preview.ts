// Office documents are rendered natively in the rail: Word by docx-preview,
// spreadsheets by an OOXML grid, decks by an SVG slide renderer. All three read
// OOXML, so the only thing the main process still owes them is a *converter*:
// the legacy and OpenDocument formats (.doc, .rtf, .odt, .xls, .ods, .ppt,
// .odp) become their OOXML sibling first, and the Word viewer asks for a PDF
// when the reader wants exact print pages instead of the reflowed document.
//
// LibreOffice does that conversion. Results are cached by the source's path,
// size and mtime, so re-opening a tab is a file read, not a second launch.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { pathToFileUrl } from '../../shared/src/file-url'
import { type OfficeFamily, officeFamilyForPath } from '../../shared/src/office-format'

/** What a converted file can be asked to become: an OOXML family a viewer
 *  parses, or the PDF the Word viewer's exact-pages mode shows. */
export type OfficeConvertTarget = 'pdf' | OfficeFamily

const MIME_BY_TARGET: Record<OfficeConvertTarget, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export function isOfficePreviewPath(filePath: string): boolean {
  return officeFamilyForPath(filePath) !== null
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

export interface OfficeConvertDeps {
  /** Path hardening: the same resolver every other fs door uses. */
  resolveReadableFile: (filePath: string) => Promise<{ resolvedPath: string; stat: fs.Stats }>
  /** Largest converted file the rail will take, in bytes; the preview cap. */
  maxBytes: number
  cacheDir?: string
  run?: RunConverter
  sofficePath?: string | null
}

/** The converted file as a data: URL, from cache when the source has not
 *  changed since. Throws a plain message when LibreOffice is not installed,
 *  when the source is not an Office file, or when the result exceeds the
 *  preview cap; the rail shows the message as its "Preview unavailable"
 *  reason, so it has to read as advice, not as a trace. */
export async function officeConvertForIpc(
  filePath: string,
  target: OfficeConvertTarget,
  deps: OfficeConvertDeps
): Promise<string> {
  const mimeType = MIME_BY_TARGET[target]

  if (!mimeType) {
    throw new Error('Unsupported conversion target')
  }

  const { resolvedPath, stat } = await deps.resolveReadableFile(filePath)

  if (!isOfficePreviewPath(resolvedPath)) {
    throw new Error('Not an Office document')
  }

  const soffice = deps.sofficePath === undefined ? findSoffice() : deps.sofficePath

  if (!soffice) {
    throw new Error('Install LibreOffice to open this document format here')
  }

  const cacheDir = deps.cacheDir ?? path.join(os.tmpdir(), 'hermes-office-preview')
  const key = createHash('sha1').update(`${resolvedPath}\n${stat.size}\n${stat.mtimeMs}`).digest('hex')
  const outDir = path.join(cacheDir, key)
  const outPath = path.join(outDir, `${path.basename(resolvedPath, path.extname(resolvedPath))}.${target}`)

  if (!fs.existsSync(outPath)) {
    await fs.promises.mkdir(outDir, { recursive: true })

    // A private profile dir per conversion: a soffice already running for the
    // user (or for another conversion) would otherwise hand the work to that
    // instance, and the headless call returns before the file exists. It is
    // keyed by target so two formats of one source can convert side by side.
    const profileDir = path.join(outDir, `profile-${target}`)

    const args = [
      `-env:UserInstallation=${pathToFileUrl(profileDir)}`,
      '--headless',
      '--norestore',
      '--convert-to',
      target,
      '--outdir',
      outDir,
      resolvedPath
    ]

    await (deps.run ?? runSoffice)(soffice, args, CONVERT_TIMEOUT_MS)
    await fs.promises.rm(profileDir, { force: true, recursive: true })

    if (!fs.existsSync(outPath)) {
      throw new Error(`LibreOffice produced no ${target.toUpperCase()} for this file`)
    }
  }

  const converted = await fs.promises.stat(outPath)

  if (converted.size > deps.maxBytes) {
    throw new Error(`The converted file is ${Math.round(converted.size / 1048576)} MB, above the preview limit`)
  }

  const data = await fs.promises.readFile(outPath)

  return `data:${mimeType};base64,${data.toString('base64')}`
}
