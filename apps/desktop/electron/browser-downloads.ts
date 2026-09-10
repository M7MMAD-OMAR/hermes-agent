/**
 * Downloads started inside the conversation's browser.
 *
 * The docked browser is a `<webview>` on its own partition, so the
 * `defaultSession` download handler never saw its downloads: a page that
 * offered a file opened the OS save dialog with the process working directory
 * as its default, and whatever the file landed as, the conversation never
 * learned about it. That is the wrong shape for the job the browser is there
 * to do. A file fetched while working on a task belongs in the workspace the
 * task is running in, and the agent should be told it arrived.
 *
 * So when the renderer has named a destination folder, the download goes
 * straight there under a free name and a record is published. With no folder
 * named, the OS prompt stays: a browser the user opened for themselves should
 * not quietly write files into a project.
 */

import fs from 'node:fs'
import path from 'node:path'

import { numberedName } from './free-name'

/** The two partitions the docked browser's guests run on. Human tabs and
 *  agent tabs are separated so a login made in one is not silently reused by
 *  the other; both need the same download treatment. */
export const BROWSER_PARTITIONS = ['persist:hermes-agent', 'persist:hermes-preview'] as const

export interface BrowserDownloadRecord {
  bytes: number
  mimeType: string
  name: string
  path: string
  url: string
}

/** The part of Electron's DownloadItem this module uses. */
export interface DownloadItemLike {
  getFilename: () => string
  getMimeType: () => string
  getReceivedBytes: () => number
  getURL: () => string
  once: (event: 'done', listener: (event: unknown, state: string) => void) => void
  setSavePath: (savePath: string) => void
}

export interface BrowserDownloadDeps {
  /** Where downloads should land right now; null keeps Chromium's own prompt. */
  destinationDir: () => null | string
  /** A file name's missing extension, derived from its MIME type. */
  extensionForMimeType: (mimeType: string) => string
  fs?: Pick<typeof fs, 'existsSync' | 'mkdirSync'>
  /** Published once the bytes are on disk, and only on a completed download. */
  onSaved: (record: BrowserDownloadRecord) => void
}

/** The name to save under: whatever the page offered, with an extension when
 *  it offered none, and never blank. */
export function downloadFileName(suggested: string, mimeType: string, extensionFor: (mime: string) => string): string {
  const offered = suggested.trim() || 'download'
  // A separator in a suggested name is a traversal attempt, not a folder the
  // download gets to create: keep the last segment and nothing else.
  const last = offered.split(/[\\/]+/).filter(Boolean).pop() || 'download'
  const flat = last === '.' || last === '..' ? 'download' : last

  return path.extname(flat) ? flat : `${flat}${extensionFor(mimeType) || ''}`
}

/** Take one download. Returns false when it was left to the OS prompt. */
export function handleBrowserDownload(item: DownloadItemLike, deps: BrowserDownloadDeps): boolean {
  const directory = deps.destinationDir()

  if (!directory) {
    return false
  }

  const fsImpl = deps.fs ?? fs
  const name = downloadFileName(item.getFilename(), item.getMimeType(), deps.extensionForMimeType)

  let savePath: string

  try {
    fsImpl.mkdirSync(directory, { recursive: true })
    // Synchronous on purpose: Electron reads the save path back as soon as
    // this handler returns, so there is no await to spend here.
    savePath = path.join(directory, numberedName(name, candidate => fsImpl.existsSync(path.join(directory, candidate))))
    item.setSavePath(savePath)
  } catch {
    // The folder is gone or unwritable. The prompt is a worse experience than
    // a silent save, and a better one than a failed download.
    return false
  }

  item.once('done', (_event, state) => {
    if (state !== 'completed') {
      return
    }

    deps.onSaved({
      bytes: item.getReceivedBytes(),
      mimeType: item.getMimeType() || '',
      name: path.basename(savePath),
      path: savePath,
      url: item.getURL()
    })
  })

  return true
}
