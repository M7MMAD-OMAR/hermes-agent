import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { isCodiconName, projectIcon, ProjectOverviewRow } from './overview-row'
import type { SidebarProjectTree } from './workspace-groups'

afterEach(cleanup)

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        newSessionIn: (label: string) => `New session in ${label}`,
        projects: {
          enter: (label: string) => `Enter ${label}`,
          reorder: (label: string) => `Reorder ${label}`,
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`
        }
      }
    }
  })
}))

vi.mock('./model', () => ({
  PROJECT_PREVIEW_COUNT: 3,
  latestProjectSessions: () => [],
  useWorkspaceNodeOpen: () => [false, vi.fn()]
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

describe('ProjectOverviewRow', () => {
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
