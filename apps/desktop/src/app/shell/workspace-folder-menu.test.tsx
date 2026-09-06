import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.hoisted` runs before the module's own imports, so nanostores is pulled in
// here rather than at the top of the file.
const mocks = await vi.hoisted(async () => ({
  copyFilePath: vi.fn(),
  moveSessionToCwd: vi.fn<(id: string, cwd: string, profile?: null | string) => Promise<void>>(),
  notify: vi.fn(),
  notifyError: vi.fn(),
  projectTree: (await import('nanostores')).atom<unknown[]>([]),
  revealFile: vi.fn(),
  revealFileInTree: vi.fn()
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      fileMenu: {
        copyPath: 'Copy path',
        revealFileManager: 'Open containing folder',
        revealInSidebar: 'Reveal in filetree'
      },
      rightSidebar: { openFolder: 'Open folder' },
      sidebar: {
        projects: {
          moveFailed: 'Could not move session',
          movedTo: (name: string) => `Moved to ${name}`,
          moveToProject: 'Move to project'
        }
      }
    }
  })
}))

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))

vi.mock('@/store/file-actions', () => ({ copyFilePath: mocks.copyFilePath, revealFile: mocks.revealFile }))
vi.mock('@/store/layout', () => ({ revealFileInTree: mocks.revealFileInTree }))
vi.mock('@/store/notifications', () => ({ notify: mocks.notify, notifyError: mocks.notifyError }))
vi.mock('@/store/projects', () => ({
  $projectTree: mocks.projectTree,
  moveSessionToCwd: mocks.moveSessionToCwd,
  // The target builder reads this off the same module; the real rule is
  // "project path, else the first repo path".
  projectRootCwd: (node?: { path?: null | string; repos?: { path?: null | string }[] }) =>
    (node?.path || node?.repos?.find(repo => repo.path)?.path || '').trim(),
  projectNameForCwd: (cwd: string) => (cwd === '/home/u/here' ? 'Here' : null)
}))

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

import { WorkspaceFolderMenu } from './workspace-folder-menu'

const TREE = [
  { id: 'here', label: 'Here', lastActive: 5, path: '/home/u/here', repos: [], sessionCount: 0 },
  { id: 'other', label: 'Other', lastActive: 9, path: '/home/u/other', repos: [], sessionCount: 0 }
]

// Real Radix wired the way production wires it: the menu owns its open state
// and UNMOUNTS on close. A permanently-open `<DropdownMenu open>` would hide
// the fact that every row's work outlives this component, which is the thing
// most likely to break here.
function Harness({ onClose, ...props }: Partial<Parameters<typeof WorkspaceFolderMenu>[0]> & { onClose: () => void }) {
  const [open, setOpen] = useState(true)

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuContent>
        <WorkspaceFolderMenu
          cwd="/home/u/here"
          profile="default"
          sessionId="s1"
          {...props}
          onClose={() => {
            setOpen(false)
            onClose()
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function open(props: Partial<Parameters<typeof WorkspaceFolderMenu>[0]> = {}) {
  const onClose = vi.fn()

  render(<Harness {...props} onClose={onClose} />)

  return { onClose }
}

function bridge(paths: string[] | undefined) {
  const selectPaths = vi.fn().mockResolvedValue(paths)

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = { selectPaths }

  return selectPaths
}

describe('moving the chat to another folder', () => {
  beforeEach(() => {
    mocks.projectTree.set(TREE)
    mocks.moveSessionToCwd.mockReset().mockResolvedValue(undefined)
    mocks.notify.mockReset()
    mocks.notifyError.mockReset()
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  afterEach(() => cleanup())

  it('names the current folder and offers the others', () => {
    open()
    expect(screen.getByText('Here')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('sends the target folder and the profile, not a project id', () => {
    // The backend takes a cwd. Passing an id here moved nothing and reported
    // success, which is exactly the failure this asserts against.
    open()
    fireEvent.click(screen.getByText('Other'))
    expect(mocks.moveSessionToCwd).toHaveBeenCalledWith('s1', '/home/u/other', 'default')
  })

  it('reports the failure instead of claiming a move that did not happen', async () => {
    mocks.moveSessionToCwd.mockRejectedValue(new Error('nope'))
    open()
    fireEvent.click(screen.getByText('Other'))
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled())
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does nothing for a draft that has no stored row yet', () => {
    // A draft has no session to re-home; firing the move would relocate
    // whatever row the gateway happened to resolve instead.
    open({ sessionId: null })
    fireEvent.click(screen.getByText('Other'))
    expect(mocks.moveSessionToCwd).not.toHaveBeenCalled()
  })
})

describe('choosing a folder that is not a project', () => {
  beforeEach(() => {
    mocks.projectTree.set(TREE)
    mocks.moveSessionToCwd.mockReset().mockResolvedValue(undefined)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  afterEach(() => cleanup())

  it('opens the dialog at the folder the chat is already in', async () => {
    const selectPaths = bridge(['/tmp/picked'])
    open()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(selectPaths).toHaveBeenCalled())
    expect(selectPaths.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: '/home/u/here',
      directories: true,
      multiple: false
    })
  })

  it('moves to the picked path', async () => {
    bridge(['/tmp/picked'])
    open()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(mocks.moveSessionToCwd).toHaveBeenCalledWith('s1', '/tmp/picked', 'default'))
  })

  it('moves nothing when the dialog is cancelled', async () => {
    const selectPaths = bridge([])
    open()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(selectPaths).toHaveBeenCalled())
    expect(mocks.moveSessionToCwd).not.toHaveBeenCalled()
  })

  it('moves nothing when the picked path is the folder already open', async () => {
    const selectPaths = bridge(['/home/u/here'])
    open()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(selectPaths).toHaveBeenCalled())
    expect(mocks.moveSessionToCwd).not.toHaveBeenCalled()
  })

  it('survives a browser with no desktop bridge', async () => {
    open()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(mocks.moveSessionToCwd).not.toHaveBeenCalled())
  })
})

describe('the path actions the panel replaced', () => {
  beforeEach(() => {
    mocks.projectTree.set(TREE)
    mocks.copyFilePath.mockReset()
    mocks.revealFile.mockReset()
    mocks.revealFileInTree.mockReset()
  })

  afterEach(() => cleanup())

  // The chip used to be a flat list of exactly these three. A panel that drops
  // one is a regression, however good the new folder list is.
  // One render each: selecting any row closes the menu, so a single render
  // could only ever reach the first of the three.
  it('still copies the path', () => {
    open()
    fireEvent.click(screen.getByText('Copy path'))
    expect(mocks.copyFilePath).toHaveBeenCalledWith('/home/u/here')
  })

  it('still opens the containing folder', () => {
    open()
    fireEvent.click(screen.getByText('Open containing folder'))
    expect(mocks.revealFile).toHaveBeenCalledWith('/home/u/here')
  })

  it('still reveals in the filetree', () => {
    open()
    fireEvent.click(screen.getByText('Reveal in filetree'))
    expect(mocks.revealFileInTree).toHaveBeenCalledWith('/home/u/here')
  })
})
