import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import type * as ProjectsStore from '@/store/projects'

import type * as Model from './model'
import { isCodiconName, projectIcon, ProjectOverviewRow } from './overview-row'
import type { SidebarProjectTree } from './workspace-groups'

afterEach(cleanup)

const workspaceOpen = vi.hoisted(() => ({ value: false }))

const projectsStore = vi.hoisted(() => ({
  fetchProjectSessions: vi.fn<(id: string) => Promise<{ error: unknown; status: 'failed' } | { project: null | SidebarProjectTree; status: 'ok' } | { status: 'superseded' }>>(),
  projectProfile: vi.fn<() => null | string>(() => 'default')
}))

vi.mock('@/i18n', () => ({
  useDirection: () => 'ltr',
  useI18n: () => ({
    t: {
      sidebar: {
        newSessionIn: (label: string) => `New session in ${label}`,
        projects: {
          enter: (label: string) => `Enter ${label}`,
          reorder: (label: string) => `Reorder ${label}`,
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`,
          showAllCount: (count: number) => `Show all ${count} sessions`,
          autoDiscovered: 'Auto-discovered'
        }
      }
    }
  })
}))

vi.mock('@/store/projects', async importOriginal => ({
  ...(await importOriginal<typeof ProjectsStore>()),
  ...projectsStore
}))

// Keep the pure helpers real (they are the logic under test); stub only the
// persisted open/collapse hook and the in-memory fallback preview.
vi.mock('./model', async () => ({
  ...(await vi.importActual<typeof Model>('./model')),
  latestProjectSessions: () => [],
  useWorkspaceNodeOpen: () => [workspaceOpen.value, vi.fn()]
}))

// ProjectMenu (the kebab) has its own dedicated test file — stub it here so
// this file only exercises overview-row's own Tip usage (the disclosure
// toggle) plus the WorkspaceAddButton wiring. ProjectContextMenu (the row's
// right-click wrapper) is stubbed as a pass-through so the row still renders.
vi.mock('./project-menu', () => ({
  ProjectContextMenu: ({ children }: { children: ReactNode }) => children,
  ProjectMenu: () => null
}))

const project = { id: 'p1', label: 'Test D' } as unknown as SidebarProjectTree

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

const session = (id: string, updated: number): SessionInfo => ({ id, updated_at: updated }) as unknown as SessionInfo

describe('ProjectOverviewRow', () => {
  afterEach(() => {
    workspaceOpen.value = false
    projectsStore.fetchProjectSessions.mockReset()
    projectsStore.projectProfile.mockReset().mockReturnValue('default')
  })

  it('wraps the "new session" add button in a Tip with the project-scoped label', () => {
    render(<ProjectOverviewRow onNewSession={vi.fn()} project={project} />)

    const button = screen.getByRole('button', { name: 'New session in Test D' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('wraps the disclosure toggle in a Tip when there are preview sessions', () => {
    render(
      <ProjectOverviewRow
        previewSessions={[{ id: 's1' } as unknown as SessionInfo]}
        project={project}
        renderRows={() => null}
      />
    )

    // Collapsed by default, so the disclosure offers to show the sessions.
    const button = screen.getByRole('button', { name: 'Show Test D sessions' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('does not render the disclosure toggle when there is nothing to preview', () => {
    render(<ProjectOverviewRow project={project} />)

    expect(screen.queryByRole('button', { name: 'Show Test D sessions' })).toBeNull()
  })

  // Group by → Projects previews only the 3 most-recent sessions per project;
  // sessions 4+ need a visible, in-place way to be reached (#112406).
  it('offers "Show all N sessions" past the preview cap and reveals the rest of the project inline', async () => {
    workspaceOpen.value = true
    const five = Array.from({ length: 5 }, (_, index) => session(`s${index + 1}`, 500 - index))
    const busy = { ...project, sessionCount: 5 } as SidebarProjectTree
    projectsStore.fetchProjectSessions.mockResolvedValue({
      project: { ...busy, repos: [{ groups: [{ sessions: five }] }] } as unknown as SidebarProjectTree,
      status: 'ok'
    })

    render(
      <ProjectOverviewRow
        previewSessions={five.slice(0, 3)}
        project={busy}
        renderRows={items => <div data-testid="rows">{items.map(item => item.id).join(',')}</div>}
      />
    )

    expect(screen.getByTestId('rows').textContent).toBe('s1,s2,s3')

    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 sessions' }))

    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('s1,s2,s3,s4,s5'))
    expect(projectsStore.fetchProjectSessions).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('button', { name: 'Show all 5 sessions' })).toBeNull()
  })

  // The hydrated lanes are the raw backend payload: pinned, filtered-out and
  // just-deleted sessions must go through the same exclusion the previews did,
  // and N must not promise rows the view hides.
  it('"Show all" runs the hydrated lanes through the tree exclusion and counts only what it will render', async () => {
    workspaceOpen.value = true
    const five = Array.from({ length: 5 }, (_, index) => session(`s${index + 1}`, 500 - index))
    const busy = { ...project, sessionCount: 5 } as SidebarProjectTree
    projectsStore.fetchProjectSessions.mockResolvedValue({
      project: { ...busy, repos: [{ groups: [{ sessions: five }] }] } as unknown as SidebarProjectTree,
      status: 'ok'
    })
    // s2 is pinned (renders in Pinned), s5 was just deleted.
    const hidden = new Set(['s2', 's5'])

    render(
      <ProjectOverviewRow
        hiddenSessionCount={hidden.size}
        isSessionHidden={item => hidden.has(item.id)}
        previewSessions={[five[0], five[2]]}
        project={busy}
        renderRows={items => <div data-testid="rows">{items.map(item => item.id).join(',')}</div>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show all 3 sessions' }))

    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('s1,s3,s4'))
  })

  it('offers the "new session" add button on Home, which starts one with no folder', () => {
    const home = {
      id: '__no_project__',
      isNoProject: true,
      label: 'Home',
      path: null
    } as unknown as SidebarProjectTree

    const onNewSession = vi.fn()

    render(<ProjectOverviewRow onNewSession={onNewSession} project={home} />)
    fireEvent.click(screen.getByRole('button', { name: 'New session in Home' }))

    expect(onNewSession).toHaveBeenCalledWith(null)
  })

  it('tags the row with data-sessions-project so a skin can target one project', () => {
    const { container } = render(<ProjectOverviewRow project={project} />)

    expect(container.querySelector('[data-sessions-project="p1"]')).toBeTruthy()
  })

  it('explicit projects keep the folder-library glyph and a plain accessible name', () => {
    const explicit = { id: 'p1', label: 'Explicit' } as unknown as SidebarProjectTree

    const { container } = render(<ProjectOverviewRow project={explicit} />)

    expect(container.querySelector('.codicon-folder-library')).toBeTruthy()
    expect(container.querySelector('.codicon-repo')).toBeNull()
    expect(screen.getByRole('button', { name: 'Enter Explicit' })).toBeTruthy()
  })

  it('auto-discovered repos get the repo glyph, an "Auto-discovered" tooltip, and an accessible name that says so', () => {
    const auto = { id: '/Users/dev/my-repo', label: 'my-repo', isAuto: true } as unknown as SidebarProjectTree

    const { container } = render(<ProjectOverviewRow project={auto} />)

    expect(container.querySelector('.codicon-repo')).toBeTruthy()
    expect(container.querySelector('.codicon-folder-library')).toBeNull()

    const link = screen.getByRole('button', { name: 'Enter my-repo (Auto-discovered)' })
    expect(tipTrigger(link)).toBeTruthy()
  })
})

describe('projectIcon', () => {
  const iconOf = (project: Partial<SidebarProjectTree>) =>
    render(<>{projectIcon(project as SidebarProjectTree)}</>).container

  it('leads every project with a folder, whatever is in the icon column', () => {
    // Real rows from a live projects.db. These carry emoji because anything
    // creating a project outside the appearance picker reaches for one, and
    // they used to render as `codicon-📈` — a class the font does not ship —
    // so the row drew nothing and looked blanker than an undecorated one.
    for (const emoji of ['📈', '🎮', '🧩', '🏛️', '🎙️', '🛒']) {
      const el = iconOf({ color: '#16a34a', icon: emoji })

      expect(el.querySelector('.codicon-folder-library')).toBeTruthy()
      expect(el.textContent).toBe('')
      cleanup()
    }
  })

  it('gives a folder to a project with a colour and no icon, not a bare dot', () => {
    const el = iconOf({ color: '#22c55e', icon: null })

    expect(el.querySelector('.codicon-folder-library')).toBeTruthy()
  })

  it('gives a folder to a project with nothing set at all', () => {
    expect(iconOf({ color: null, icon: null }).querySelector('.codicon-folder-library')).toBeTruthy()
  })

  it('keeps the colour as the tint, which is what still tells them apart', () => {
    const el = iconOf({ color: '#e11d48', icon: '🛒' })

    expect((el.firstElementChild as HTMLElement).style.color).toBeTruthy()
  })

  it('honours an icon the appearance picker actually set', () => {
    // The picker only writes codicon names, so this is a deliberate choice by
    // the user and outranks the default.
    expect(iconOf({ color: '#b45309', icon: 'briefcase' }).querySelector('.codicon-briefcase')).toBeTruthy()
  })

  it('keeps Home on its house rather than folding it into the folders', () => {
    const el = iconOf({ icon: null, isNoProject: true })

    expect(el.querySelector('.codicon-home')).toBeTruthy()
  })
})

describe('isCodiconName', () => {
  it('accepts the lowercase dashed names the icon font actually ships', () => {
    for (const name of ['home', 'folder-library', 'briefcase', 'git-branch', 'symbol-misc']) {
      expect(isCodiconName(name)).toBe(true)
    }
  })

  it('rejects anything that could not be one', () => {
    for (const name of ['📈', '🏛️', 'Folder', 'two words', '', '-lead', 'trail-']) {
      expect(isCodiconName(name)).toBe(false)
    }
  })
})
