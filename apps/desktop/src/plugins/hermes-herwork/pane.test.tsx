/**
 * The desk panel. Three sections over one fixed desk, each reading through the
 * SDK and owning no state of its own, so the whole surface is testable by
 * driving `host`.
 *
 * The SDK is mocked at the boundary, as the sibling plugin tests do (the plugin
 * fence keeps `@/…` out of this tree): `host.state.*` are settable stores,
 * `readDir` / `listPersistedSessions` are resolvable fakes, and the three
 * mutating doors record.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial
    const listeners = new Set<(next: T) => void>()

    return {
      get: () => value,
      listen: (fn: (next: T) => void) => {
        listeners.add(fn)

        return () => {
          listeners.delete(fn)
        }
      },
      set: (next: T) => {
        value = next
        listeners.forEach(fn => fn(next))
      },
      subscribe: (fn: (next: T) => void) => {
        fn(value)
        listeners.add(fn)

        return () => {
          listeners.delete(fn)
        }
      }
    }
  }

  return {
    connectionId: makeStore<null | string>('local-1'),
    cwd: makeStore<string>('/home/ada/projects/x'),
    focusedStoredSessionId: makeStore<null | string>(null),
    focusedTodos: makeStore<unknown[]>([]),
    listPersistedSessions: vi.fn(async (..._args: unknown[]) => ({ sessions: [] as unknown[] })),
    newChat: vi.fn(),
    notify: vi.fn(),
    notifyError: vi.fn(),
    openPreview: vi.fn((_path: string) => true),
    openSession: vi.fn(async () => undefined),
    readDir: vi.fn(async (_path: string): Promise<{ entries: unknown[]; error?: string }> => ({ entries: [] })),
    request: vi.fn(async (method: string): Promise<unknown> =>
      method === 'profiles.list' ? { profiles: [{ name: 'herwork' }] } : { ok: true }
    ),
    requestProfile: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ items: [{ text: '/herwork' }] })),
    revealPath: vi.fn(async () => undefined)
  }
})

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof HermesSdk>()

  return {
    ...original,
    host: {
      ...original.host,
      listPersistedSessions: mocks.listPersistedSessions,
      newChat: mocks.newChat,
      notify: mocks.notify,
      notifyError: mocks.notifyError,
      openPreview: mocks.openPreview,
      openSession: mocks.openSession,
      readDir: mocks.readDir,
      request: mocks.request,
      requestProfile: mocks.requestProfile,
      revealPath: mocks.revealPath,
      state: {
        ...original.host.state,
        connectionId: mocks.connectionId,
        cwd: mocks.cwd,
        focusedStoredSessionId: mocks.focusedStoredSessionId,
        focusedTodos: mocks.focusedTodos
      }
    }
  }
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { resetDeskBundleCheck, resetDeskHome, resetHerworkProfileFlight } from './desk'
import { HerworkPane } from './pane'

const DESK = '/home/ada/herwork'

/** The Electron doors the pane reaches for directly: the home the desk sits
 *  under, and the folder-opening door that creates before it opens. */
function withShell(shell: null | { home?: string; openDir?: ReturnType<typeof vi.fn> }) {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: shell
      ? {
          ...(shell.openDir ? { openDir: shell.openDir } : {}),
          ...(shell.home === undefined
            ? {}
            : { settings: { getDefaultProjectDir: async () => ({ defaultLabel: shell.home }) } })
        }
      : undefined,
    writable: true
  })
}

const job = (id: string, title: null | string, startedAt: number) => ({
  id,
  message_count: 2,
  started_at: startedAt,
  title
})

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <HerworkPane />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connectionId.set('local-1')
  mocks.cwd.set('/home/ada/projects/x')
  mocks.focusedStoredSessionId.set(null)
  mocks.focusedTodos.set([])
  mocks.listPersistedSessions.mockResolvedValue({ sessions: [] })
  mocks.readDir.mockResolvedValue({ entries: [] })
  mocks.request.mockImplementation(async (method: string) =>
    method === 'profiles.list' ? { profiles: [{ name: 'herwork' }] } : { ok: true }
  )
  mocks.requestProfile.mockResolvedValue({ items: [{ text: '/herwork' }] })
  // Module-level caches outlive a single pane in the app; each case says
  // which shell it is running against.
  resetDeskHome()
  resetHerworkProfileFlight()
  resetDeskBundleCheck()
  withShell(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the desk panel', () => {
  it('starts a new job on the desk route, in the desk workspace', async () => {
    renderPane()

    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.newChat).toHaveBeenCalledTimes(1))

    const [route, options] = mocks.newChat.mock.calls[0]!

    // The route decides which profile and which folder the job opens on; the
    // owner key is what keeps the new tab inside this workspace.
    expect(route).toMatchObject({ cwd: DESK, profile: 'herwork', targetProfile: 'herwork' })
    expect(options).toMatchObject({ workspaceMode: 'herwork', workspaceOwnerKey: 'herwork:desk' })
  })

  it('disables the new-job button while no local connection is known', () => {
    mocks.connectionId.set(null)
    renderPane()

    expect((screen.getByRole('button', { name: /desk\.newChat/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.newChat).not.toHaveBeenCalled()
  })

  it('lists the desk jobs newest first and opens the one clicked', async () => {
    mocks.listPersistedSessions.mockResolvedValue({
      sessions: [job('old', 'First job', 1_000), job('new', 'Latest job', 9_000)]
    })

    renderPane()

    const titles = await screen.findAllByText(/job$/)

    expect(titles.map(node => node.textContent)).toEqual(['Latest job', 'First job'])

    fireEvent.click(screen.getByText('Latest job'))
    expect(mocks.openSession).toHaveBeenCalledWith('new')
  })

  it('reads the desk profile, not whichever profile is active', async () => {
    renderPane()

    await waitFor(() => expect(mocks.listPersistedSessions).toHaveBeenCalled())
    expect(mocks.listPersistedSessions.mock.calls[0]![1]).toMatchObject({ profile: 'herwork' })
  })

  it('marks the open job as current', async () => {
    mocks.listPersistedSessions.mockResolvedValue({ sessions: [job('a', 'Open one', 2_000), job('b', 'Other', 1_000)] })
    mocks.focusedStoredSessionId.set('a')

    renderPane()

    const open = (await screen.findByText('Open one')).closest('button')
    const other = screen.getByText('Other').closest('button')

    expect(open?.getAttribute('aria-current')).toBe('true')
    expect(other?.getAttribute('aria-current')).toBeNull()
  })

  it('lists delivered files newest first, job folders included, and previews a PDF', async () => {
    const output = `${DESK}/output`

    mocks.readDir.mockImplementation(async (dir: string) => {
      if (dir === output) {
        return {
          entries: [
            { isDirectory: true, name: 'q3-deck', path: `${output}/q3-deck` },
            {
              isDirectory: false,
              mtimeMs: 1_000,
              name: 'old-brief.docx',
              path: `${output}/old-brief.docx`,
              size: 40_960
            }
          ]
        }
      }

      if (dir === `${output}/q3-deck`) {
        return {
          entries: [
            {
              isDirectory: false,
              mtimeMs: 9_000,
              name: 'deck.pdf',
              path: `${output}/q3-deck/deck.pdf`,
              size: 2_400_000
            }
          ]
        }
      }

      return { entries: [] }
    })

    renderPane()

    const names = await screen.findAllByText(/\.(pdf|docx)$/)

    // The newer file wins even though it sits one folder down.
    expect(names.map(node => node.textContent)).toEqual(['deck.pdf', 'old-brief.docx'])
    expect(screen.getByText('q3-deck')).toBeTruthy()
    expect(screen.getByText('2.3 MB')).toBeTruthy()

    fireEvent.click(screen.getByText('deck.pdf'))
    expect(mocks.openPreview).toHaveBeenCalledWith(`${output}/q3-deck/deck.pdf`)
    expect(mocks.revealPath).not.toHaveBeenCalled()
  })

  it('previews a Word file too, the rail prints it through LibreOffice', async () => {
    const output = `${DESK}/output`

    mocks.readDir.mockResolvedValue({
      entries: [{ isDirectory: false, mtimeMs: 1, name: 'report.docx', path: `${output}/report.docx`, size: 10 }]
    })

    renderPane()
    fireEvent.click(await screen.findByText('report.docx'))

    expect(mocks.openPreview).toHaveBeenCalledWith(`${output}/report.docx`)
  })

  it('reveals a file the preview rail cannot show at all', async () => {
    const output = `${DESK}/output`

    mocks.readDir.mockResolvedValue({
      entries: [{ isDirectory: false, mtimeMs: 1, name: 'bundle.zip', path: `${output}/bundle.zip`, size: 10 }]
    })

    renderPane()
    fireEvent.click(await screen.findByText('bundle.zip'))

    expect(mocks.openPreview).not.toHaveBeenCalled()
    expect(mocks.revealPath).toHaveBeenCalledWith(`${output}/bundle.zip`)
  })

  it('falls back to the file manager when the rail declines a previewable path', async () => {
    mocks.openPreview.mockReturnValue(false)
    mocks.readDir.mockResolvedValue({
      entries: [{ isDirectory: false, mtimeMs: 1, name: 'a.pdf', path: `${DESK}/output/a.pdf`, size: 10 }]
    })

    renderPane()
    fireEvent.click(await screen.findByText('a.pdf'))

    expect(mocks.revealPath).toHaveBeenCalledWith(`${DESK}/output/a.pdf`)
  })

  it('reads an output folder that does not exist yet as empty, not as broken', async () => {
    // The first delivered job creates the folder; until then ENOENT is the
    // ordinary state and must not present itself as a failure to act on.
    mocks.readDir.mockResolvedValue({ entries: [], error: 'ENOENT' })

    renderPane()

    expect(await screen.findByText(/desk\.noDeliverables/i)).toBeTruthy()
    expect(screen.queryByText(/desk\.filesUnavailable/i)).toBeNull()
  })

  it('offers a retry when the output folder genuinely cannot be read', async () => {
    mocks.readDir.mockResolvedValue({ entries: [], error: 'EACCES' })

    renderPane()

    expect(await screen.findByText(/desk\.filesUnavailable/i)).toBeTruthy()

    mocks.readDir.mockResolvedValue({
      entries: [{ isDirectory: false, mtimeMs: 1, name: 'ok.pdf', path: `${DESK}/output/ok.pdf`, size: 1 }]
    })
    fireEvent.click(screen.getByRole('button', { name: /desk\.retry/i }))

    expect(await screen.findByText('ok.pdf')).toBeTruthy()
  })

  it('opens each desk folder in the file manager', async () => {
    renderPane()

    fireEvent.click(screen.getByRole('button', { name: 'inbox' }))
    expect(mocks.revealPath).toHaveBeenCalledWith(`${DESK}/inbox`)
  })

  it('renders the open job steps, keeping a cancelled one visible', async () => {
    mocks.focusedTodos.set([
      { content: 'Read the brief', id: '1', status: 'completed' },
      { content: 'Draft the deck', id: '2', status: 'in_progress' },
      { content: 'Print it', id: '3', status: 'cancelled' }
    ])

    renderPane()

    expect(screen.getByText('Read the brief')).toBeTruthy()
    expect(screen.getByText('Draft the deck')).toBeTruthy()
    // Dropped work is part of the account of the turn, so it stays on screen.
    expect(screen.getByText('Print it').className).toContain('line-through')
  })

  it('says so when the open job wrote no steps', () => {
    renderPane()

    expect(screen.getByText(/desk\.noTasks/i)).toBeTruthy()
  })

  it('derives the desk from the ambient home, not from the ambient cwd', async () => {
    mocks.cwd.set('/home/ada/somewhere/else/entirely')
    renderPane()

    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledWith(`${DESK}/output`))
  })

  it('creates the desk profile before opening the first job on it', async () => {
    mocks.request.mockImplementation(async (method: string) =>
      method === 'profiles.list' ? { profiles: [{ name: 'default' }] } : { ok: true }
    )

    renderPane()
    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.newChat).toHaveBeenCalled())
    // Order matters: a chat routed to a profile that is not there dies in the
    // backend spawn with FileNotFoundError.
    expect(mocks.request.mock.calls.map(([method]) => method)).toContain('profiles.create')
  })

  it('says so instead of opening a chat that cannot start', async () => {
    mocks.request.mockRejectedValue(new Error('gateway unavailable'))

    renderPane()
    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled())
    expect(mocks.newChat).not.toHaveBeenCalled()
  })

  it('warns once when the desk skill bundle is not installed', async () => {
    // No completion for `/herwork`: the bundle the route names does not
    // resolve, so every desk chat would run without the desk mandate.
    mocks.requestProfile.mockResolvedValue({ items: [{ text: '/help' }] })

    renderPane()
    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1))
    expect(mocks.notify.mock.calls[0]![0]).toMatchObject({ kind: 'warning' })

    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))
    await waitFor(() => expect(mocks.newChat).toHaveBeenCalledTimes(2))
    expect(mocks.notify).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the bundle is there', async () => {
    renderPane()
    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.newChat).toHaveBeenCalled())
    await waitFor(() => expect(mocks.requestProfile).toHaveBeenCalled())
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('creates a desk folder that is not there yet rather than no-opping on it', async () => {
    const openDir = vi.fn(async () => ({ ok: true }))
    withShell({ openDir })

    renderPane()
    fireEvent.click(screen.getByRole('button', { name: 'work' }))

    // revealPath maps to showItemInFolder, which silently does nothing for a
    // path that does not exist, and on a fresh desk none of the three do.
    await waitFor(() => expect(openDir).toHaveBeenCalledWith(`${DESK}/work`))
    expect(mocks.revealPath).not.toHaveBeenCalled()
  })

  it('reports a folder that could not be opened', async () => {
    withShell({ openDir: vi.fn(async () => ({ ok: false, error: 'EACCES' })) })

    renderPane()
    fireEvent.click(screen.getByRole('button', { name: 'inbox' }))

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('EACCES', expect.any(String)))
  })
})

describe('the desk on Windows', () => {
  const WIN_DESK = 'C:\\Users\\ada\\herwork'
  const WIN_OUTPUT = `${WIN_DESK}\\output`

  beforeEach(() => {
    // A cwd that is not under any home at all, so only the shell's answer can
    // put the desk anywhere: the case a Linux author never sees.
    mocks.cwd.set('D:\\work\\site')
    withShell({ home: 'C:\\Users\\ada' })
  })

  it('reads deliverables from a backslash output folder', async () => {
    mocks.readDir.mockImplementation(async (dir: string) =>
      dir === WIN_OUTPUT
        ? {
            entries: [
              {
                isDirectory: false,
                mtimeMs: 1,
                name: 'deck.pdf',
                path: `${WIN_OUTPUT}\\q3-deck\\deck.pdf`,
                size: 10
              }
            ]
          }
        : { entries: [] }
    )

    renderPane()

    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledWith(WIN_OUTPUT))
    // The job prefix is the folder name, not the whole unsplit path.
    expect(await screen.findByText('q3-deck')).toBeTruthy()
  })

  it('opens the desk folders at their real Windows paths', async () => {
    const openDir = vi.fn(async () => ({ ok: true }))
    withShell({ home: 'C:\\Users\\ada', openDir })

    renderPane()
    await waitFor(() => expect(screen.getByRole('button', { name: 'output' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'output' }))

    await waitFor(() => expect(openDir).toHaveBeenCalledWith(`${WIN_DESK}\\output`))
  })

  it('routes a new job at the Windows desk', async () => {
    renderPane()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledWith(WIN_OUTPUT))
    fireEvent.click(screen.getByRole('button', { name: /desk\.newChat/i }))

    await waitFor(() => expect(mocks.newChat).toHaveBeenCalled())
    expect(mocks.newChat.mock.calls[0]![0]).toMatchObject({
      cwd: WIN_DESK,
      downloadDir: `${WIN_DESK}\\work`,
      dropDir: `${WIN_DESK}\\inbox`
    })
  })
})
