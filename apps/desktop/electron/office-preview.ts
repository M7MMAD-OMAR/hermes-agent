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

/** How long a converted copy is allowed to sit in the temp directory.
 *
 *  The cache holds full copies of documents the reader opened, so it is not
 *  only disk: it is their content, in a world-readable-by-the-user directory,
 *  for as long as the machine keeps its temp files. A day covers re-opening a
 *  tab across a work session, which is the only thing the cache is for. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Drop cache entries older than `CACHE_MAX_AGE_MS`. Best effort: a sweep that
 *  fails must never stop the conversion the reader is waiting for. */
async function sweepCache(cacheDir: string, now = Date.now()): Promise<void> {
  let entries: string[]

  try {
    entries = await fs.promises.readdir(cacheDir)
  } catch {
    return
  }

  await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(cacheDir, entry)

      try {
        const stat = await fs.promises.stat(entryPath)

        if (now - stat.mtimeMs > CACHE_MAX_AGE_MS) {
          await fs.promises.rm(entryPath, { force: true, recursive: true })
        }
      } catch {
        // Raced with another sweep, or not ours to remove.
      }
    })
  )
}

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

/** Where a LibreOffice install puts its binary when PATH does not have it.
 *
 *  PATH covers a distribution package. It does not cover the upstream tarball,
 *  which unpacks under `/opt`, nor a distribution that keeps the program
 *  directory off PATH, nor the app bundles on macOS and Windows. A user with
 *  LibreOffice installed being told to install LibreOffice is the worst error
 *  message this feature can produce, so the search looks in all of them. */
function sofficeSearchDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean)

  if (process.platform === 'darwin') {
    dirs.push('/Applications/LibreOffice.app/Contents/MacOS', path.join(os.homedir(), 'Applications/LibreOffice.app/Contents/MacOS'))
  } else if (process.platform === 'win32') {
    dirs.push('C:\\Program Files\\LibreOffice\\program', 'C:\\Program Files (x86)\\LibreOffice\\program')
  } else {
    dirs.push('/usr/lib/libreoffice/program', '/usr/lib64/libreoffice/program', '/usr/local/lib/libreoffice/program')

    // The upstream tarball unpacks as `/opt/libreoffice<version>`, so the
    // directory name carries a version this code cannot know in advance.
    try {
      for (const entry of fs.readdirSync('/opt')) {
        if (entry.toLowerCase().startsWith('libreoffice')) {
          dirs.push(path.join('/opt', entry, 'program'))
        }
      }
    } catch {
      // No /opt, or not readable. The other candidates still stand.
    }
  }

  return dirs
}

function findSoffice(env = process.env): string | null {
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice']

  for (const dir of sofficeSearchDirs(env)) {
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
    throw new Error(
      'Install LibreOffice to open this document format here. A Flatpak install is not visible to this app; the distribution package or the upstream tarball is.'
    )
  }

  const cacheDir = deps.cacheDir ?? path.join(os.tmpdir(), 'hermes-office-preview')
  const key = createHash('sha1').update(`${resolvedPath}\n${stat.size}\n${stat.mtimeMs}`).digest('hex')
  const outDir = path.join(cacheDir, key)
  const outPath = path.join(outDir, `${path.basename(resolvedPath, path.extname(resolvedPath))}.${target}`)

  await sweepCache(cacheDir)

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

    try {
      await (deps.run ?? runSoffice)(soffice, args, CONVERT_TIMEOUT_MS)
    } finally {
      // A failed conversion leaks a whole LibreOffice profile otherwise, and
      // the next attempt on the same file makes another one.
      await fs.promises.rm(profileDir, { force: true, recursive: true }).catch(() => {})
    }

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
