// IPC surface for local filesystem operations the renderer's project/file
// surfaces use: directory reads, reveal/open in the OS file manager, plugin
// roots + git installs, rename/write/trash. Extracted from main.ts; path
// hardening, HERMES_HOME resolution, and the git binary stay injected.
import fs from 'node:fs'
import path from 'node:path'

import { ipcMain, shell } from 'electron'

import { installDesktopPluginFromGit, probePluginRepo } from './desktop-plugin-install'
import { readDirForIpc } from './fs-read-dir'
import { gitRootForIpc } from './git-root'

export interface FsIpcDeps {
  hermesHome: string
  readActiveDesktopProfile: () => null | string
  expandUserPath: (value: string) => string
  resolveRequestedPathForIpc: (value: string, options: { purpose: string }) => string
  directoryExists: (value: string) => boolean
  resolveGitBinary: () => string
}

export function registerFsIpc({
  hermesHome,
  readActiveDesktopProfile,
  expandUserPath,
  resolveRequestedPathForIpc,
  directoryExists,
  resolveGitBinary
}: FsIpcDeps) {
  ipcMain.handle('hermes:fs:readDir', async (_event, dirPath) => readDirForIpc(dirPath))

  ipcMain.handle('hermes:fs:gitRoot', async (_event, startPath) => gitRootForIpc(startPath))

  // Does a delivered media file still exist on disk?
  //
  // The transcript keeps a path forever; the file does not. Without this the
  // renderer cannot tell a deleted result from a transient read failure, so a
  // result whose file is gone renders as an audio player stuck at 0:00 with an
  // "Open file" link that also fails, which reads as a bug in the app rather
  // than as what actually happened. Read-only and hardened through the same
  // path resolver as every other fs handler.
  ipcMain.handle('hermes:fs:mediaExists', async (_event, targetPath) => {
    try {
      const resolved = resolveRequestedPathForIpc(expandUserPath(String(targetPath ?? '')), {
        purpose: 'media-exists'
      })

      return fs.statSync(resolved).isFile()
    } catch {
      return false
    }
  })

  // Reveal a path in the OS file manager (Finder / Explorer / Files).
  ipcMain.handle('hermes:fs:reveal', async (_event, targetPath) => {
    const target = String(targetPath || '').trim()

    if (!target) {
      return false
    }

    try {
      shell.showItemInFolder(target)

      return true
    } catch {
      return false
    }
  })

  // Open a DIRECTORY in the OS file manager, creating it first if needed. Unlike
  // `reveal` (which selects an existing item and silently no-ops on a missing
  // path — the "Open plugins folder" Windows bug), this is for the plugins door,
  // which often doesn't exist on first use. `shell.openPath` returns '' on
  // success or an error string; both mkdir + openPath failures are surfaced.
  ipcMain.handle('hermes:fs:openDir', async (_event, dirPath) => {
    const dir = String(dirPath || '').trim()

    if (!dir) {
      return { ok: false, error: 'no path' }
    }

    try {
      await fs.promises.mkdir(dir, { recursive: true })
      const error = await shell.openPath(path.normalize(dir))

      return error ? { ok: false, error } : { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // The LOCAL Desktop runtime-plugin root: `<HERMES_HOME>/desktop-plugins`,
  // resolved from the main-process HERMES_HOME (see resolveHermesHome) — NOT from
  // the connected backend. A remote backend reports its own `hermes_home` over
  // the gateway, which is a path on the REMOTE box; deriving the plugin dir from
  // it yields `undefined/desktop-plugins` (or a non-existent remote path) and the
  // on-disk plugin door silently breaks (#66899). Electron owns this resolution
  // so it stays valid in every connection mode. Created on demand, like openDir.
  async function localPluginsRoot(dirName: string): Promise<string> {
    // Profile-aware: a named Desktop profile gets its own plugin root under
    // profiles/<name>/, matching the profile-scoped hermes_home the backend
    // reported before this resolver existed. 'default'/unset pins the global root.
    const profile = readActiveDesktopProfile()
    const base = profile && profile !== 'default' ? path.join(hermesHome, 'profiles', profile) : hermesHome
    const dir = path.join(base, dirName)

    try {
      await fs.promises.mkdir(dir, { recursive: true })
    } catch {
      // Best-effort create; return the path regardless so the reveal action can
      // still surface a real openPath error and the scanner can retry later.
    }

    return dir
  }

  ipcMain.handle('hermes:fs:desktopPluginsRoot', async () => localPluginsRoot('desktop-plugins'))

  // The LOCAL logs root (`<HERMES_HOME>/logs`, profile-aware) — the error
  // card's "Open Logs" action reveals agent.log/gateway.log without the user
  // knowing where HERMES_HOME lives. Same Electron-local resolution as the
  // plugin roots: valid in every connection mode, created on demand.
  ipcMain.handle('hermes:fs:logsRoot', async () => localPluginsRoot('logs'))

  // The LOCAL agent-plugin root (`<HERMES_HOME>/plugins`), same Electron-local
  // resolution as above. This is the desktop half of a UNIFIED plugin package:
  // an agent plugin may ship `desktop/plugin.js` alongside its Python code (the
  // same shape as `dashboard/manifest.json`), and the renderer's disk door scans
  // this root for it — one installable folder serving both SDKs.
  ipcMain.handle('hermes:fs:agentPluginsRoot', async () => localPluginsRoot('plugins'))

  ipcMain.handle('hermes:plugin:probe', async (_event, payload) => {
    const identifier = String(payload?.identifier || payload?.repo || '').trim()

    if (!identifier) {
      return { ok: false, error: 'identifier is required', agent: false, desktop: false, warnings: [] }
    }

    return probePluginRepo(resolveGitBinary(), identifier)
  })

  ipcMain.handle('hermes:plugin:installDesktop', async (_event, payload) => {
    const identifier = String(payload?.identifier || payload?.repo || '').trim()

    if (!identifier) {
      return { ok: false, error: 'identifier is required' }
    }

    const desktopPluginsRoot = await localPluginsRoot('desktop-plugins')

    return installDesktopPluginFromGit(resolveGitBinary(), identifier, desktopPluginsRoot, Boolean(payload?.force))
  })

  // Rename a file/folder in place. The renderer passes the existing path + a new
  // base name; the destination is resolved in the SAME parent dir so a rename can
  // never move the item elsewhere or traverse out. Rejects on a name collision.
  ipcMain.handle('hermes:fs:rename', async (_event, targetPath, newName) => {
    const src = String(targetPath || '').trim()
    const name = String(newName || '').trim()

    if (!src || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid rename')
    }

    const dst = path.join(path.dirname(src), name)

    if (dst === src) {
      return { path: dst }
    }

    if (fs.existsSync(dst)) {
      throw new Error(`"${name}" already exists`)
    }

    await fs.promises.rename(src, dst)

    return { path: dst }
  })

  // Write a small UTF-8 text file (e.g. a project's IDEA.md at creation). The path
  // is hardened (resolveRequestedPathForIpc) and the parent must already exist —
  // this never creates directory trees or escapes the allowed roots, and content
  // is size-capped so it can't be abused as a bulk-write primitive.
  ipcMain.handle('hermes:fs:writeText', async (_event, filePath, content) => {
    const raw = String(filePath || '').trim()

    if (!raw) {
      throw new Error('Invalid path')
    }

    const text = String(content ?? '')

    if (text.length > 1_000_000) {
      throw new Error('Content too large')
    }

    const resolved = resolveRequestedPathForIpc(expandUserPath(raw), { purpose: 'Write text file' })

    if (!directoryExists(path.dirname(resolved))) {
      throw new Error('Parent directory does not exist')
    }

    await fs.promises.writeFile(resolved, text, 'utf8')

    return { path: resolved }
  })

  // Copy one file into a directory, keeping its name (a numbered suffix when
  // that name is taken). This is how an OS drop lands in a workspace's own
  // folder instead of being attached from wherever it sat: the renderer holds
  // only a path, never the bytes, so the copy has to happen here. Source and
  // destination both pass the same path hardening as every other fs door;
  // directories are refused because a workspace inbox takes files.
  ipcMain.handle('hermes:fs:copyInto', async (_event, sourcePath, destinationDir) => {
    const rawSource = String(sourcePath || '').trim()
    const rawDir = String(destinationDir || '').trim()

    if (!rawSource || !rawDir) {
      throw new Error('Invalid path')
    }

    const source = resolveRequestedPathForIpc(expandUserPath(rawSource), { purpose: 'Copy file' })
    const dir = resolveRequestedPathForIpc(expandUserPath(rawDir), { purpose: 'Copy file' })
    const stat = await fs.promises.stat(source)

    if (!stat.isFile()) {
      throw new Error('Only files can be copied')
    }

    await fs.promises.mkdir(dir, { recursive: true })

    const target = await freeNameIn(dir, path.basename(source))

    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL)

    return { path: target }
  })

  // Move a file/folder to the OS trash (recoverable) — the VS Code "Delete"
  // default. `shell.trashItem` routes to Finder/Explorer/Files trash per platform.
  ipcMain.handle('hermes:fs:trash', async (_event, targetPath) => {
    const target = String(targetPath || '').trim()

    if (!target) {
      throw new Error('Invalid delete')
    }

    await shell.trashItem(target)

    return true
  })
}

/** `name`, or `name (2)`, `name (3)`... whichever does not yet exist in `dir`.
 *  The extension stays at the end so the copy still opens with the right app. */
async function freeNameIn(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name

  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`)

    try {
      await fs.promises.access(candidate)
    } catch {
      return candidate
    }
  }

  throw new Error('Could not find a free file name')
}
