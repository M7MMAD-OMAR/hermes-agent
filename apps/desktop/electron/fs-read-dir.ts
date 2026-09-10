import fs from 'node:fs'
import path from 'node:path'

import { resolveDirectoryForIpc } from './hardening'
import { resolveLocalReadPath } from './wsl-path-bridge'

const FS_READDIR_STAT_CONCURRENCY = 16

// Always-hidden noise (covers non-git projects too; gitignore catches many of
// these, but the project tree should keep the same hygiene without one).
const FS_READDIR_HIDDEN = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
  'venv'
])

function direntIsDirectory(dirent) {
  return typeof dirent.isDirectory === 'function' && dirent.isDirectory()
}

async function entryForDirent(dirent, resolved, fsImpl) {
  const fullPath = path.join(resolved, dirent.name)
  let isDirectory = direntIsDirectory(dirent)
  let mtimeMs: number | undefined
  let size: number | undefined

  // Files are stat'ed for their size and modification time so a listing can
  // say "newest first" and "2.1 MB" without a second round trip per entry
  // (the desk panel sorts deliverables by recency). Directories keep the
  // dirent-only fast path: their mtime says nothing useful to a reader, and a
  // tree walk over node_modules-sized folders must stay cheap.
  if (!isDirectory) {
    try {
      const stat = await fsImpl.promises.stat(fullPath)

      isDirectory = stat.isDirectory()

      if (!isDirectory) {
        mtimeMs = stat.mtimeMs
        size = stat.size
      }
    } catch {
      isDirectory = false
    }
  }

  return { name: dirent.name, path: fullPath, isDirectory, ...(mtimeMs === undefined ? {} : { mtimeMs, size }) }
}

async function mapWithStatConcurrency(items, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }

  const workerCount = Math.min(FS_READDIR_STAT_CONCURRENCY, items.length)
  const workers = Array.from({ length: workerCount } as any, () => runWorker())
  await Promise.all(workers)

  return results
}

async function readDirForIpc(dirPath, options: any = {}) {
  const fsImpl = options.fs || fs
  let resolved

  // On a Windows host with a WSL backend, a WSL/POSIX cwd (`/home/...`,
  // `/mnt/c/...`) isn't readable as-is; bridge it to a UNC/drive form first.
  const readPath = resolveLocalReadPath(String(dirPath ?? ''))

  try {
    ;({ resolvedPath: resolved } = await resolveDirectoryForIpc(readPath, {
      fs: fsImpl,
      purpose: 'Directory read'
    }))
  } catch (error) {
    return { entries: [], error: error?.code || 'read-error' }
  }

  try {
    const dirents = await fsImpl.promises.readdir(resolved, { withFileTypes: true })
    const visibleDirents = dirents.filter(dirent => !FS_READDIR_HIDDEN.has(dirent.name))
    const entries = await mapWithStatConcurrency(visibleDirents, dirent => entryForDirent(dirent, resolved, fsImpl))

    entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))

    return { entries }
  } catch (error) {
    return { entries: [], error: error?.code || 'read-error' }
  }
}

export { readDirForIpc }
