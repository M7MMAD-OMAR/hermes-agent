import { describe, expect, it, vi } from 'vitest'

import { attachFilesToPreviewInput, DEFAULT_FILE_INPUT_SELECTOR, type DebuggerLike } from './preview-upload'

function fakeDebugger(overrides: { nodeId?: null | number } = {}) {
  const calls: { method: string; params?: Record<string, unknown> }[] = []
  let attached = false

  const target: DebuggerLike & { attached: () => boolean; calls: typeof calls } = {
    attach: () => {
      attached = true
    },
    attached: () => attached,
    calls,
    detach: () => {
      attached = false
    },
    isAttached: () => attached,
    sendCommand: async (method, params) => {
      calls.push({ method, params })

      if (method === 'DOM.getDocument') {
        return { root: { nodeId: 1 } }
      }

      if (method === 'DOM.querySelector') {
        const nodeId = overrides.nodeId === undefined ? 42 : overrides.nodeId

        return nodeId === null ? {} : { nodeId }
      }

      return {}
    }
  }

  return target
}

const resolveReadableFile = async (filePath: string) => ({ resolvedPath: `/resolved${filePath}` })

describe('uploading a workspace file into a page', () => {
  it('sets the resolved paths on the matched input and detaches again', async () => {
    const target = fakeDebugger()

    const result = await attachFilesToPreviewInput(['/work/report.pdf'], '', {
      debugger: target,
      resolveReadableFile
    })

    expect(result).toEqual({
      files: ['/resolved/work/report.pdf'],
      selector: DEFAULT_FILE_INPUT_SELECTOR,
      success: true
    })
    expect(target.calls.map(call => call.method)).toEqual([
      'DOM.enable',
      'DOM.getDocument',
      'DOM.querySelector',
      'DOM.setFileInputFiles'
    ])
    expect(target.attached()).toBe(false)
  })

  it('leaves an attachment it did not make in place', async () => {
    const target = fakeDebugger()

    target.attach()
    await attachFilesToPreviewInput(['/work/a.pdf'], 'input.upload', { debugger: target, resolveReadableFile })

    // A developer's devtools ride the same channel; detaching would close it.
    expect(target.attached()).toBe(true)
  })

  it('says so when nothing on the page matches', async () => {
    const target = fakeDebugger({ nodeId: null })

    const result = await attachFilesToPreviewInput(['/work/a.pdf'], '#nope', {
      debugger: target,
      resolveReadableFile
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('#nope')
    expect(target.attached()).toBe(false)
  })

  it('refuses a path the filesystem door will not resolve', async () => {
    const target = fakeDebugger()

    const result = await attachFilesToPreviewInput(['/etc/shadow'], '', {
      debugger: target,
      resolveReadableFile: vi.fn(async () => {
        throw new Error('Outside the allowed roots')
      })
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Outside the allowed roots')
    // Nothing was attached to the page at all.
    expect(target.calls).toEqual([])
  })

  it('refuses an empty list rather than clearing the input', async () => {
    const result = await attachFilesToPreviewInput([], '', { debugger: fakeDebugger(), resolveReadableFile })

    expect(result.success).toBe(false)
  })
})
