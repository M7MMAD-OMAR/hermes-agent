/**
 * Putting a file from the workspace into a web page's file input.
 *
 * A guest page cannot be handed a local file by any script running inside it:
 * the browser will not build a `File` from a path, and that restriction is the
 * whole point of the file picker. The host can, through Chromium's own
 * protocol: attach the debugger to the guest, find the input, and set its
 * files directly. The page then sees exactly what it would have seen had a
 * person picked the file, `change` event included.
 *
 * Every path is resolved by the same hardening every other filesystem door
 * uses before it goes anywhere near the page.
 */

/** The subset of Electron's debugger this module drives. */
export interface DebuggerLike {
  attach: (protocolVersion?: string) => void
  detach: () => void
  isAttached: () => boolean
  sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

export interface PreviewUploadDeps {
  debugger: DebuggerLike
  /** Path hardening: the same resolver every other fs door uses. */
  resolveReadableFile: (filePath: string) => Promise<{ resolvedPath: string }>
}

const DEFAULT_FILE_INPUT_SELECTOR = 'input[type=file]'

export interface PreviewUploadResult {
  /** How many files were set, for the caller's note. */
  count?: number
  error?: string
  /** The selector actually used, which the caller may have left to default. */
  selector?: string
  success: boolean
}

/** Set `paths` on the first element matching `selector` in the guest page. */
export async function attachFilesToPreviewInput(
  paths: string[],
  selector: string,
  deps: PreviewUploadDeps
): Promise<PreviewUploadResult> {
  const target = selector.trim() || DEFAULT_FILE_INPUT_SELECTOR

  if (!paths.length) {
    return { error: 'No file to upload.', success: false }
  }

  let files: string[]

  try {
    const resolved = await Promise.all(paths.map(path => deps.resolveReadableFile(path)))

    files = resolved.map(entry => entry.resolvedPath)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), success: false }
  }

  // Attaching is only ours to undo when it was not already attached: the
  // devtools a developer has open on this guest use the same channel, and
  // detaching underneath them would close it.
  const ownsAttachment = !deps.debugger.isAttached()

  try {
    if (ownsAttachment) {
      deps.debugger.attach('1.3')
    }

    await deps.debugger.sendCommand('DOM.enable')

    const document = (await deps.debugger.sendCommand('DOM.getDocument', { depth: -1 })) as {
      root?: { nodeId?: number }
    }

    const rootId = document?.root?.nodeId

    if (typeof rootId !== 'number') {
      return { error: 'The page has no document to upload into.', success: false }
    }

    const found = (await deps.debugger.sendCommand('DOM.querySelector', { nodeId: rootId, selector: target })) as {
      nodeId?: number
    }

    if (!found?.nodeId) {
      return { error: `No element matches ${target} on this page.`, success: false }
    }

    await deps.debugger.sendCommand('DOM.setFileInputFiles', { files, nodeId: found.nodeId })

    return { count: files.length, selector: target, success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), success: false }
  } finally {
    if (ownsAttachment && deps.debugger.isAttached()) {
      try {
        deps.debugger.detach()
      } catch {
        // Already gone with the page.
      }
    }
  }
}
