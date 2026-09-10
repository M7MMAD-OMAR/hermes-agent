/**
 * A local path as a `file:` URL.
 *
 * Two callers need it and they sit on opposite sides of the filesystem module,
 * so it lives on its own rather than one importing the other: the preview
 * classifier builds a target's url, and the "open in another app" door hands
 * the same string to the main process.
 */

export function pathToFileUrl(path: string): string {
  const isWindowsUnc = path.startsWith('\\\\')
  const normalized = isWindowsUnc || /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, '/') : path

  const encoded = normalized
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')

  if (isWindowsUnc) {
    return `file://${encoded.slice(2)}`
  }

  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}
