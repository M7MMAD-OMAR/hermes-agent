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

vi.mock('./desktop-plugin-install', () => ({
  installDesktopPluginFromGit: vi.fn(),
  probePluginRepo: vi.fn()
}))
vi.mock('./fs-read-dir', () => ({ readDirForIpc: vi.fn() }))
vi.mock('./git-root', () => ({ gitRootForIpc: vi.fn() }))

import { registerFsIpc } from './fs-ipc'

let root: string

// The renderer asks this to tell a DELETED result from one that merely failed to
// load. Answering wrongly in either direction is its own defect: a false "gone"
// sends the user hunting for a file sitting on their disk, and a false "here"
// leaves the dead player with no explanation, which is the bug this exists to
// end.
function mediaExists(target: string): unknown {
  const handler = handlers.get('hermes:fs:mediaExists')

  expect(handler).toBeDefined()

  return handler!(null, target)
}

beforeEach(() => {
  handlers.clear()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-exists-'))
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

describe('does a delivered file still exist', () => {
  it('says yes for a file that is there', async () => {
    const file = path.join(root, 'chart.png')

    fs.writeFileSync(file, 'bytes')

    expect(await mediaExists(file)).toBe(true)
  })

  it('says no for a file that was deleted', async () => {
    const file = path.join(root, 'chart.png')

    fs.writeFileSync(file, 'bytes')
    fs.unlinkSync(file)

    expect(await mediaExists(file)).toBe(false)
  })

  it('says no for a directory, which is not a deliverable', async () => {
    expect(await mediaExists(root)).toBe(false)
  })

  it('answers rather than throwing for junk input', async () => {
    // It is called from a render path; a throw there would take out the message.
    expect(await mediaExists('')).toBe(false)
    expect(await mediaExists(undefined as unknown as string)).toBe(false)
    expect(await mediaExists('\0/nope')).toBe(false)
  })

  it('says no when the path resolver refuses the path', async () => {
    // Refused is not the same as deleted, but the renderer is told the lesser
    // thing on purpose: this handler can only ever under-report.
    handlers.clear()
    registerFsIpc({
      directoryExists: () => false,
      expandUserPath: (value: string) => value,
      hermesHome: root,
      readActiveDesktopProfile: () => null,
      resolveGitBinary: () => 'git',
      resolveRequestedPathForIpc: () => {
        throw new Error('outside the allowed roots')
      }
    })

    const file = path.join(root, 'chart.png')

    fs.writeFileSync(file, 'bytes')

    expect(await mediaExists(file)).toBe(false)
  })
})
