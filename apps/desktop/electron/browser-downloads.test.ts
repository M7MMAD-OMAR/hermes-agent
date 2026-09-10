import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadFileName, type DownloadItemLike, handleBrowserDownload } from './browser-downloads'

let root: string

const extensionForMimeType = (mimeType: string) =>
  ({ 'application/pdf': '.pdf', 'image/png': '.png' })[mimeType] ?? ''

function fakeItem(overrides: Partial<Record<'filename' | 'mimeType' | 'url', string>> = {}) {
  const listeners: ((event: unknown, state: string) => void)[] = []
  let savePath = ''

  const item: DownloadItemLike & { finish: (state: string) => void; savedTo: () => string } = {
    finish: state => listeners.forEach(listener => listener({}, state)),
    getFilename: () => overrides.filename ?? 'report.xlsx',
    getMimeType: () => overrides.mimeType ?? 'application/vnd.ms-excel',
    getReceivedBytes: () => 2048,
    getURL: () => overrides.url ?? 'https://example.test/report.xlsx',
    once: (_event, listener) => listeners.push(listener),
    savedTo: () => savePath,
    setSavePath: value => {
      savePath = value
      fs.writeFileSync(value, 'bytes')
    }
  }

  return item
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-downloads-'))
})

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
})

describe('downloads from the conversation browser', () => {
  it('names a file the page offered without an extension', () => {
    expect(downloadFileName('report', 'application/pdf', extensionForMimeType)).toBe('report.pdf')
    expect(downloadFileName('report.xlsx', 'application/pdf', extensionForMimeType)).toBe('report.xlsx')
    expect(downloadFileName('  ', 'image/png', extensionForMimeType)).toBe('download.png')
  })

  it('refuses to let a suggested name climb out of the folder', () => {
    expect(downloadFileName('../../etc/passwd', '', extensionForMimeType)).toBe('passwd')
    expect(downloadFileName('a/b/c.txt', '', extensionForMimeType)).toBe('c.txt')
  })

  it('saves into the folder the workspace named and publishes the record', () => {
    const onSaved = vi.fn()
    const item = fakeItem()
    const directory = path.join(root, 'work')

    expect(handleBrowserDownload(item, { destinationDir: () => directory, extensionForMimeType, onSaved })).toBe(true)
    expect(item.savedTo()).toBe(path.join(directory, 'report.xlsx'))
    expect(onSaved).not.toHaveBeenCalled()

    item.finish('completed')
    expect(onSaved).toHaveBeenCalledWith({
      bytes: 2048,
      mimeType: 'application/vnd.ms-excel',
      name: 'report.xlsx',
      path: path.join(directory, 'report.xlsx'),
      url: 'https://example.test/report.xlsx'
    })
  })

  it('numbers a second copy instead of overwriting the first', () => {
    const directory = path.join(root, 'work')
    const deps = { destinationDir: () => directory, extensionForMimeType, onSaved: vi.fn() }

    handleBrowserDownload(fakeItem(), deps)
    const second = fakeItem()

    handleBrowserDownload(second, deps)
    expect(second.savedTo()).toBe(path.join(directory, 'report (2).xlsx'))
  })

  it('publishes nothing when the download was cancelled or failed', () => {
    const onSaved = vi.fn()
    const item = fakeItem()

    handleBrowserDownload(item, { destinationDir: () => path.join(root, 'work'), extensionForMimeType, onSaved })
    item.finish('cancelled')

    expect(onSaved).not.toHaveBeenCalled()
  })

  it('leaves a download alone when no workspace folder is named', () => {
    const item = fakeItem()
    const onSaved = vi.fn()

    expect(handleBrowserDownload(item, { destinationDir: () => null, extensionForMimeType, onSaved })).toBe(false)
    expect(item.savedTo()).toBe('')
  })
})
