import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }
}))
vi.mock('./desktop-plugin-install', () => ({ installDesktopPluginFromGit: vi.fn(), probePluginRepo: vi.fn() }))
vi.mock('./fs-read-dir', () => ({ readDirForIpc: vi.fn() }))
vi.mock('./git-root', () => ({ gitRootForIpc: vi.fn() }))

import { registerFsIpc } from './fs-ipc'

let root: string

// An OS drop into a workspace chat lands in that workspace's own folder. The
// renderer holds a path, never the bytes, so this door is the copy.
function copyInto(source: string, dir: string): Promise<{ path: string }> {
  const handler = handlers.get('hermes:fs:copyInto')

  expect(handler).toBeDefined()

  return handler!(null, source, dir) as Promise<{ path: string }>
}

beforeEach(() => {
  handlers.clear()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-into-'))
  registerFsIpc({
    directoryExists: (value: string) => fs.existsSync(value) && fs.statSync(value).isDirectory(),
    expandUserPath: (value: string) => value,
    hermesHome: root,
    readActiveDesktopProfile: () => null,
    resolveGitBinary: () => 'git',
    resolveRequestedPathForIpc: (value: string) => value
  })
})

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
})

describe('copy a dropped file into a workspace folder', () => {
  it('copies the file under its own name and creates the folder', async () => {
    const source = path.join(root, 'brief.docx')

    fs.writeFileSync(source, 'bytes')

    const inbox = path.join(root, 'desk', 'inbox')
    const { path: copied } = await copyInto(source, inbox)

    expect(copied).toBe(path.join(inbox, 'brief.docx'))
    expect(fs.readFileSync(copied, 'utf8')).toBe('bytes')
    // The original is untouched: this is a copy, not a move.
    expect(fs.existsSync(source)).toBe(true)
  })

  it('numbers the copy when the name is taken, keeping the extension last', async () => {
    const inbox = path.join(root, 'inbox')

    fs.mkdirSync(inbox)
    fs.writeFileSync(path.join(inbox, 'brief.docx'), 'old')
    fs.writeFileSync(path.join(inbox, 'brief (2).docx'), 'older')

    const source = path.join(root, 'brief.docx')

    fs.writeFileSync(source, 'new')

    const { path: copied } = await copyInto(source, inbox)

    expect(path.basename(copied)).toBe('brief (3).docx')
    // Nothing that was there is overwritten.
    expect(fs.readFileSync(path.join(inbox, 'brief.docx'), 'utf8')).toBe('old')
  })

  it('refuses a directory as the source', async () => {
    const folder = path.join(root, 'a-folder')

    fs.mkdirSync(folder)

    await expect(copyInto(folder, path.join(root, 'inbox'))).rejects.toThrow('Only files')
  })

  it('refuses empty paths before touching the disk', async () => {
    await expect(copyInto('', path.join(root, 'inbox'))).rejects.toThrow('Invalid path')
    await expect(copyInto(path.join(root, 'x'), '   ')).rejects.toThrow('Invalid path')
  })
})
