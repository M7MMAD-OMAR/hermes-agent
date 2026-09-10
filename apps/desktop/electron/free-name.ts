/**
 * `name`, or `name (2)`, `name (3)`... whichever is not taken yet.
 *
 * Two callers need the same rule and must produce the same names: copying a
 * dropped file into a workspace folder, and saving a browser download into
 * one. The extension stays at the end so the file still opens with the right
 * app, and the caller decides what "taken" means, which is what lets the
 * download path stay synchronous (Electron wants the save path back before
 * `will-download` returns) while the copy path stays async.
 */

import path from 'node:path'

const MAX_ATTEMPTS = 1000

export function numberedName(name: string, isTaken: (candidate: string) => boolean): string {
  const extension = path.extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name

  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? name : `${stem} (${attempt})${extension}`

    if (!isTaken(candidate)) {
      return candidate
    }
  }

  throw new Error('Could not find a free file name')
}

export async function numberedNameAsync(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const extension = path.extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name

  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? name : `${stem} (${attempt})${extension}`

    if (!(await isTaken(candidate))) {
      return candidate
    }
  }

  throw new Error('Could not find a free file name')
}
