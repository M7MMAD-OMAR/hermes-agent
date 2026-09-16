import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesReadDirResult } from '@/global'
import { $connection } from '@/store/session'
import { notifyWorkspaceChanged } from '@/store/workspace-events'

import { clearProjectDirCache, readProjectDir } from './ipc'
import { resetProjectTreeState, useProjectTree } from './use-project-tree'

const readDir = vi.fn<(path: string) => Promise<HermesReadDirResult>>()

beforeEach(() => {
  $connection.set(null)
  resetProjectTreeState()
  readDir.mockReset()
  ;(window as unknown as { hermesDesktop: { readDir: typeof readDir } }).hermesDesktop = { readDir }
})

afterEach(() => {
  cleanup()
  $connection.set(null)
  resetProjectTreeState()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

function ok(entries: { name: string; path: string; isDirectory: boolean }[]): HermesReadDirResult {
  return { entries }
}

describe('useProjectTree', () => {
  it('starts empty when cwd is blank and skips IPC', async () => {
    const { result } = renderHook(() => useProjectTree(''))

    await waitFor(() => expect(result.current.rootLoading).toBe(false))

    expect(result.current.data).toEqual([])
    expect(result.current.rootError).toBeNull()
    expect(readDir).not.toHaveBeenCalled()
  })

  it('loads root entries on mount and sorts folders before files', async () => {
    readDir.mockResolvedValueOnce(
      ok([
        { name: 'README.md', path: '/p/README.md', isDirectory: false },
        { name: 'src', path: '/p/src', isDirectory: true }
      ])
    )

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(2))

    expect(readDir).toHaveBeenCalledWith('/p')
    // Hook trusts main-process sort order; folders/files preserved as supplied.
    expect(result.current.data.map(n => n.name)).toEqual(['README.md', 'src'])
    // Folder children start undefined (lazy load on first expand).
    expect(result.current.data.find(n => n.name === 'src')?.children).toBeUndefined()
    expect(result.current.data.find(n => n.name === 'src')?.isDirectory).toBe(true)
    expect(result.current.data.find(n => n.name === 'README.md')?.isDirectory).toBe(false)
  })

  it('records rootError when readDir returns an error', async () => {
    readDir.mockResolvedValueOnce({ entries: [], error: 'EACCES' })

    const { result } = renderHook(() => useProjectTree('/locked'))

    await waitFor(() => expect(result.current.rootError).toBe('EACCES'))
    expect(result.current.data).toEqual([])
  })

  it('does not fall back after a failed root read from a superseded connection', async () => {
    let resolveRootFromA: ((result: HermesReadDirResult) => void) | undefined
    const sanitizeWorkspaceCwd = vi.fn(async () => ({ cwd: '/fallback', sanitized: true }))
    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          resolveRootFromA = resolve
        })
    )
    readDir.mockResolvedValueOnce(ok([{ name: 'from-b', path: '/shared/from-b', isDirectory: false }]))
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { readDir, sanitizeWorkspaceCwd }
    $connection.set({ baseUrl: 'local-a', connectionId: 'connection-a', mode: 'local', profile: 'default' } as never)

    const { result } = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(readDir).toHaveBeenCalledTimes(1))

    act(() => {
      $connection.set({ baseUrl: 'local-b', connectionId: 'connection-b', mode: 'local', profile: 'default' } as never)
    })
    await waitFor(() => expect(readDir).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveRootFromA?.({ entries: [], error: 'ENOENT' })
    })

    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-b']))
    expect(sanitizeWorkspaceCwd).not.toHaveBeenCalled()
  })

  it('clears root loading and recovers when a root read rejects', async () => {
    readDir.mockRejectedValueOnce(new Error('remote request aborted'))
    readDir.mockResolvedValueOnce(ok([{ name: 'IDEA.md', path: '/remote/IDEA.md', isDirectory: false }]))

    const { result } = renderHook(() => useProjectTree('/remote'))

    await waitFor(() => {
      expect(result.current.rootError).toBe('remote request aborted')
      expect(result.current.rootLoading).toBe(false)
    })

    await act(async () => {
      await result.current.refreshRoot()
    })

    expect(result.current.rootError).toBeNull()
    expect(result.current.data.map(node => node.name)).toEqual(['IDEA.md'])
  })

  it('lazy-loads children on loadChildren and replaces the placeholder', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))
    readDir.mockResolvedValueOnce(
      ok([
        { name: 'index.ts', path: '/p/src/index.ts', isDirectory: false },
        { name: 'lib', path: '/p/src/lib', isDirectory: true }
      ])
    )

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    await act(async () => {
      await result.current.loadChildren('/p/src')
    })

    const src = result.current.data[0]
    expect(src.children?.map(n => n.name)).toEqual(['index.ts', 'lib'])
    expect(src.loading).toBe(false)
    expect(src.error).toBeUndefined()
  })

  it('keeps loaded tree state across remounts for the same cwd', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))

    const { result, unmount } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    act(() => {
      result.current.setNodeOpen('/p/src', true)
    })

    unmount()

    const remounted = renderHook(() => useProjectTree('/p'))

    expect(remounted.result.current.data.map(n => n.name)).toEqual(['src'])
    expect(remounted.result.current.openState).toEqual({ '/p/src': true })
    expect(readDir).toHaveBeenCalledTimes(1)
  })

  it('reads gitignore from the real path while caching per connection', async () => {
    const readFileDataUrl = vi.fn(async () => `data:text/plain;base64,${btoa('ignored.log\n')}`)
    const gitRoot = vi.fn(async () => '/repo')
    readDir.mockImplementation(async path => {
      if (path === '/repo') {
        return ok([{ name: '.gitignore', path: '/repo/.gitignore', isDirectory: false }])
      }

      if (path === '/repo/src') {
        return ok([
          { name: 'app.ts', path: '/repo/src/app.ts', isDirectory: false },
          { name: 'ignored.log', path: '/repo/src/ignored.log', isDirectory: false }
        ])
      }

      throw new Error(`unexpected path ${path}`)
    })
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { gitRoot, readDir, readFileDataUrl }

    $connection.set({ baseUrl: 'local-a', mode: 'local' } as never)
    await expect(readProjectDir('/repo/src', '/repo')).resolves.toMatchObject({
      entries: [{ name: 'app.ts', path: '/repo/src/app.ts', isDirectory: false }]
    })
    expect(readDir).toHaveBeenCalledWith('/repo')
    expect(readDir).not.toHaveBeenCalledWith(expect.stringContaining('local-a'))

    $connection.set({ baseUrl: 'local-b', mode: 'local' } as never)
    clearProjectDirCache()
    await expect(readProjectDir('/repo/src', '/repo')).resolves.toMatchObject({
      entries: [{ name: 'app.ts', path: '/repo/src/app.ts', isDirectory: false }]
    })
    expect(readDir.mock.calls.filter(([path]) => path === '/repo')).toHaveLength(2)
  })

  it('captures per-folder error code and shows an error placeholder child', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'priv', path: '/p/priv', isDirectory: true }]))
    readDir.mockResolvedValueOnce({ entries: [], error: 'EACCES' })

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    await act(async () => {
      await result.current.loadChildren('/p/priv')
    })

    expect(result.current.data[0].error).toBe('EACCES')
    expect(result.current.data[0].children).toEqual([
      {
        id: '/p/priv::__error__',
        isDirectory: false,
        name: 'Unable to read (EACCES)',
        placeholder: 'error'
      }
    ])
  })

  it('clears child loading and allows retry when a child read rejects', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))
    readDir.mockRejectedValueOnce(new Error('child request aborted'))
    readDir.mockResolvedValueOnce(ok([{ name: 'index.ts', path: '/p/src/index.ts', isDirectory: false }]))

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    await act(async () => {
      await result.current.loadChildren('/p/src')
    })

    expect(result.current.data[0]).toMatchObject({ error: 'child request aborted', loading: false })

    await act(async () => {
      await result.current.loadChildren('/p/src')
    })

    expect(result.current.data[0]).toMatchObject({ error: undefined, loading: false })
    expect(result.current.data[0].children?.map(node => node.name)).toEqual(['index.ts'])
  })

  it('dedupes concurrent loadChildren calls for the same id', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))

    let resolveChildren: ((value: HermesReadDirResult) => void) | undefined
    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          resolveChildren = resolve
        })
    )

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    await act(async () => {
      // First call enters inflight, second short-circuits, third also short-circuits.
      void result.current.loadChildren('/p/src')
      void result.current.loadChildren('/p/src')
      void result.current.loadChildren('/p/src')
      resolveChildren?.(ok([{ name: 'a.ts', path: '/p/src/a.ts', isDirectory: false }]))
    })

    // Mount load + a single folder fetch — duplicates were dropped.
    expect(readDir).toHaveBeenCalledTimes(2)
  })

  it('refreshRoot reloads the root and clears prior error', async () => {
    readDir.mockResolvedValueOnce({ entries: [], error: 'EACCES' })
    readDir.mockResolvedValueOnce(ok([{ name: 'README.md', path: '/p/README.md', isDirectory: false }]))

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.rootError).toBe('EACCES'))

    await act(async () => {
      await result.current.refreshRoot()
    })

    expect(result.current.rootError).toBeNull()
    expect(result.current.data.map(n => n.name)).toEqual(['README.md'])
  })

  it('discards a stale live refresh after the active registered connection changes', async () => {
    let resolveRefreshFromA: ((result: HermesReadDirResult) => void) | undefined
    readDir.mockResolvedValueOnce(ok([{ name: 'from-a', path: '/shared/from-a', isDirectory: false }]))
    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          resolveRefreshFromA = resolve
        })
    )
    readDir.mockResolvedValueOnce(ok([{ name: 'from-b', path: '/shared/from-b', isDirectory: false }]))
    $connection.set({
      baseUrl: 'https://gateway.example',
      connectionId: 'connection-a',
      mode: 'local',
      profile: 'default'
    } as never)

    const { result } = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-a']))

    act(() => {
      notifyWorkspaceChanged()
    })
    await waitFor(() => expect(readDir).toHaveBeenCalledTimes(2))

    act(() => {
      $connection.set({
        baseUrl: 'https://gateway.example',
        connectionId: 'connection-b',
        mode: 'local',
        profile: 'default'
      } as never)
    })
    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-b']))

    await act(async () => {
      resolveRefreshFromA?.(ok([{ name: 'stale-a', path: '/shared/stale-a', isDirectory: false }]))
    })

    expect(result.current.data.map(node => node.name)).toEqual(['from-b'])
  })

  it('discards a stale child read after the active registered connection changes', async () => {
    let resolveChildFromA: ((result: HermesReadDirResult) => void) | undefined
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/shared/src', isDirectory: true }]))
    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          resolveChildFromA = resolve
        })
    )
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/shared/src', isDirectory: true }]))
    $connection.set({
      baseUrl: 'https://gateway.example',
      connectionId: 'connection-a',
      mode: 'local',
      profile: 'default'
    } as never)

    const { result } = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(result.current.data[0]?.name).toBe('src'))

    act(() => {
      void result.current.loadChildren('/shared/src')
    })
    await waitFor(() => expect(readDir).toHaveBeenCalledTimes(2))

    act(() => {
      $connection.set({
        baseUrl: 'https://gateway.example',
        connectionId: 'connection-b',
        mode: 'local',
        profile: 'default'
      } as never)
    })
    await waitFor(() => expect(result.current.data[0]?.name).toBe('src'))

    await act(async () => {
      resolveChildFromA?.(ok([{ name: 'from-a', path: '/shared/src/from-a', isDirectory: false }]))
    })

    expect(result.current.data[0]).not.toMatchObject({ children: [{ name: 'from-a' }] })
  })

  it('discards a stale root read after the active registered connection changes', async () => {
    let resolveFirst: ((result: HermesReadDirResult) => void) | undefined
    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          resolveFirst = resolve
        })
    )
    readDir.mockResolvedValueOnce(ok([{ name: 'from-b', path: '/shared/from-b', isDirectory: false }]))
    $connection.set({
      baseUrl: 'https://gateway.example',
      connectionId: 'connection-a',
      mode: 'local',
      profile: 'default'
    } as never)

    const { result } = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(readDir).toHaveBeenCalledTimes(1))

    act(() => {
      $connection.set({
        baseUrl: 'https://gateway.example',
        connectionId: 'connection-b',
        mode: 'local',
        profile: 'default'
      } as never)
      resolveFirst?.(ok([{ name: 'from-a', path: '/shared/from-a', isDirectory: false }]))
    })

    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-b']))
    expect(readDir).toHaveBeenCalledTimes(2)
  })

  it('reloads when cwd changes', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'one', path: '/a/one', isDirectory: false }]))
    readDir.mockResolvedValueOnce(ok([{ name: 'two', path: '/b/two', isDirectory: false }]))

    const { rerender, result } = renderHook(({ cwd }) => useProjectTree(cwd), { initialProps: { cwd: '/a' } })

    await waitFor(() => expect(result.current.data[0]?.name).toBe('one'))

    rerender({ cwd: '/b' })

    await waitFor(() => expect(result.current.data[0]?.name).toBe('two'))
    expect(readDir).toHaveBeenLastCalledWith('/b')
  })

  it('falls back to the sanitized workspace dir when the session cwd is gone', async () => {
    const sanitizeWorkspaceCwd = vi.fn(async () => ({ cwd: '/home/me/projects', sanitized: true }))
    readDir.mockImplementation(async path => {
      if (path === '/deleted/worktree') {
        return { entries: [], error: 'ENOENT' }
      }

      if (path === '/home/me/projects') {
        return ok([{ name: 'repo', path: '/home/me/projects/repo', isDirectory: true }])
      }

      throw new Error(`unexpected path ${path}`)
    })
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { readDir, sanitizeWorkspaceCwd }

    const { result } = renderHook(() => useProjectTree('/deleted/worktree'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    expect(sanitizeWorkspaceCwd).toHaveBeenCalledWith('/deleted/worktree')
    expect(result.current.rootError).toBeNull()
    expect(result.current.effectiveCwd).toBe('/home/me/projects')
    expect(result.current.data[0]?.name).toBe('repo')
  })

  it('keeps the root error when sanitize offers no usable fallback', async () => {
    const sanitizeWorkspaceCwd = vi.fn(async () => ({ cwd: '/deleted/worktree', sanitized: false }))
    readDir.mockResolvedValue({ entries: [], error: 'ENOENT' })
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { readDir, sanitizeWorkspaceCwd }

    const { result } = renderHook(() => useProjectTree('/deleted/worktree'))

    await waitFor(() => expect(result.current.rootError).toBe('ENOENT'))
    expect(result.current.effectiveCwd).toBe('/deleted/worktree')
  })

  it('returns no-bridge gracefully when window.hermesDesktop is missing', async () => {
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.rootError).toBe('no-bridge'))
    expect(result.current.data).toEqual([])
  })

  // An unreadable root self-heals on a 3s timer, so this probe runs forever
  // while the pane just sits there. Blanking the error first made every one of
  // those a visible "unreadable" → blank → "unreadable" strobe.
  it('keeps an unreadable root on screen while it re-probes', async () => {
    readDir.mockResolvedValue({ entries: [], error: 'ENOENT' })

    const { result } = renderHook(() => useProjectTree('/gone'))

    await waitFor(() => expect(result.current.rootError).toBe('ENOENT'))

    let releaseProbe: ((value: HermesReadDirResult) => void) | undefined

    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          releaseProbe = resolve
        })
    )

    act(() => {
      void result.current.refreshRoot()
    })

    expect(result.current.rootLoading).toBe(true)
    expect(result.current.rootError).toBe('ENOENT')

    await act(async () => {
      releaseProbe?.({ entries: [], error: 'ENOENT' })
    })

    expect(result.current.rootError).toBe('ENOENT')
  })

  it('keeps loaded rows on screen while the root refreshes', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))

    const { result } = renderHook(() => useProjectTree('/p'))

    await waitFor(() => expect(result.current.data.length).toBe(1))

    let releaseRefresh: ((value: HermesReadDirResult) => void) | undefined

    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          releaseRefresh = resolve
        })
    )

    act(() => {
      void result.current.refreshRoot()
    })

    expect(result.current.rootLoading).toBe(true)
    expect(result.current.data.map(node => node.name)).toEqual(['src'])

    await act(async () => {
      releaseRefresh?.(ok([{ name: 'src', path: '/p/src', isDirectory: true }]))
    })
  })

  it('clears the rows when the same path is re-read from another backend', async () => {
    readDir.mockResolvedValueOnce(ok([{ name: 'from-a', path: '/shared/from-a', isDirectory: false }]))
    $connection.set({ baseUrl: 'local-a', connectionId: 'connection-a', mode: 'local', profile: 'default' } as never)

    const { result } = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-a']))

    let releaseFromB: ((value: HermesReadDirResult) => void) | undefined

    readDir.mockImplementationOnce(
      () =>
        new Promise<HermesReadDirResult>(resolve => {
          releaseFromB = resolve
        })
    )

    act(() => {
      $connection.set({ baseUrl: 'local-b', connectionId: 'connection-b', mode: 'local', profile: 'default' } as never)
    })

    // The path is unchanged but the machine is not, so the old machine's
    // listing must not sit there while the new one loads.
    expect(result.current.data).toEqual([])

    await act(async () => {
      releaseFromB?.(ok([{ name: 'from-b', path: '/shared/from-b', isDirectory: false }]))
    })

    await waitFor(() => expect(result.current.data.map(node => node.name)).toEqual(['from-b']))
  })
})

describe('useProjectTree root cache', () => {
  it('repaints a revisited root synchronously and reconciles it in the background', async () => {
    readDir.mockImplementation(async (path: string) => {
      if (path === '/a') {
        return ok([{ name: 'src', path: '/a/src', isDirectory: true }])
      }

      return ok([{ name: 'other', path: '/b/other', isDirectory: false }])
    })

    const first = renderHook(({ cwd }) => useProjectTree(cwd), { initialProps: { cwd: '/a' } })

    await waitFor(() => expect(first.result.current.data.map(n => n.name)).toEqual(['src']))

    // Expansion state is part of what a switch used to destroy.
    act(() => first.result.current.setNodeOpen('/a/src', true))
    await waitFor(() => expect(first.result.current.openState['/a/src']).toBe(true))

    first.rerender({ cwd: '/b' })
    await waitFor(() => expect(first.result.current.data.map(n => n.name)).toEqual(['other']))

    const readsBeforeReturn = readDir.mock.calls.length

    first.rerender({ cwd: '/a' })

    // No await: the banked tree is on screen on the very tick the root changes,
    // with its expansion intact, and no blank/loading frame in between. A cold
    // root would read `[]` with `rootLoading` true right here.
    expect(first.result.current.data.map(n => n.name)).toEqual(['src'])
    expect(first.result.current.openState['/a/src']).toBe(true)
    expect(first.result.current.rootLoading).toBe(false)

    // The reconcile still runs, it just no longer gates the paint.
    await waitFor(() => expect(readDir.mock.calls.length).toBeGreaterThan(readsBeforeReturn))
    expect(first.result.current.data.map(n => n.name)).toEqual(['src'])
    expect(first.result.current.openState['/a/src']).toBe(true)
  })

  it('costs one root read on return, not one per expanded folder', async () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `d${i}`)
    readDir.mockImplementation(async (path: string) => {
      if (path === '/a') {
        return ok(dirs.map(name => ({ name, path: `/a/${name}`, isDirectory: true })))
      }

      if (path.startsWith('/a/')) {
        return ok([{ name: 'leaf.txt', path: `${path}/leaf.txt`, isDirectory: false }])
      }

      return ok([{ name: 'other', path: '/b/other', isDirectory: false }])
    })

    const view = renderHook(({ cwd }) => useProjectTree(cwd), { initialProps: { cwd: '/a' } })

    await waitFor(() => expect(view.result.current.data.length).toBe(10))

    for (const name of dirs) {
      await act(async () => {
        await view.result.current.loadChildren(`/a/${name}`)
      })
    }

    await waitFor(() =>
      expect(view.result.current.data.every(node => node.children?.[0]?.name === 'leaf.txt')).toBe(true)
    )

    view.rerender({ cwd: '/b' })
    await waitFor(() => expect(view.result.current.data.map(n => n.name)).toEqual(['other']))

    const before = readDir.mock.calls.length

    view.rerender({ cwd: '/a' })
    await waitFor(() => expect(readDir.mock.calls.length).toBeGreaterThan(before))
    // Settle any further reads the reconcile might queue.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // The reconcile re-reads the ROOT only. Fanning out over every expanded
    // folder would make returning to a well-explored project more expensive
    // than the cold read it replaced, which is the opposite of the point.
    expect(readDir.mock.calls.length - before).toBe(1)
    expect(readDir.mock.calls[before][0]).toBe('/a')
    // Loaded subtrees survive the targeted merge, so nothing has to re-expand.
    expect(view.result.current.data.every(node => node.children?.[0]?.name === 'leaf.txt')).toBe(true)
  })

  it('drops a failed root rather than banking it', async () => {
    readDir.mockImplementation(async (path: string) =>
      path === '/broken' ? { entries: [], error: 'EACCES' } : ok([{ name: 'x', path: '/ok/x', isDirectory: false }])
    )

    const view = renderHook(({ cwd }) => useProjectTree(cwd), { initialProps: { cwd: '/broken' } })

    await waitFor(() => expect(view.result.current.rootError).toBe('EACCES'))

    view.rerender({ cwd: '/ok' })
    await waitFor(() => expect(view.result.current.data.map(n => n.name)).toEqual(['x']))

    view.rerender({ cwd: '/broken' })

    // Nothing banked, so it re-probes instead of repainting a stale failure as
    // an authoritative empty tree.
    expect(view.result.current.rootLoading).toBe(true)
    await waitFor(() => expect(view.result.current.rootError).toBe('EACCES'))
  })

  it('never paints a banked tree for the same path on another backend', async () => {
    readDir.mockImplementation(async () => ok([{ name: 'box-a-only', path: '/shared/box-a-only', isDirectory: false }]))

    const view = renderHook(() => useProjectTree('/shared'))

    await waitFor(() => expect(view.result.current.data.map(n => n.name)).toEqual(['box-a-only']))

    readDir.mockImplementation(async () => ok([{ name: 'box-b-only', path: '/shared/box-b-only', isDirectory: false }]))

    // Same path string, different machine. The banked tree must not survive it.
    act(() => {
      $connection.set({ connectionId: 'box-b', mode: 'local' } as never)
    })

    await waitFor(() => expect(view.result.current.data.map(n => n.name)).toEqual(['box-b-only']))
  })
})
