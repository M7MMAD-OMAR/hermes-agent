import { describe, expect, it } from 'vitest'

import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'

import { workspaceFolderTargets } from './workspace-folder-targets'

function project(overrides: Partial<SidebarProjectTree> & { id: string }): SidebarProjectTree {
  return {
    label: overrides.id,
    path: `/home/u/${overrides.id}`,
    repos: [],
    sessionCount: 0,
    ...overrides
  }
}

const ids = (tree: SidebarProjectTree[], cwd: string) => workspaceFolderTargets(tree, cwd).map(t => t.id)

describe('which folders the picker offers', () => {
  it('leaves out the folder the chat is already in', () => {
    const tree = [project({ id: 'here' }), project({ id: 'there' })]
    expect(ids(tree, '/home/u/here')).toEqual(['there'])
  })

  it('matches the current folder after trimming, not by identity', () => {
    // The statusbar trims the cwd it reads off the session row; a stray space
    // must not make the picker offer a move into the folder already open.
    expect(ids([project({ id: 'here' })], '  /home/u/here  ')).toEqual([])
  })

  it('drops the Home bucket, which has no folder to move into', () => {
    const tree = [project({ id: 'home', isNoProject: true, path: null }), project({ id: 'real' })]
    expect(ids(tree, '/elsewhere')).toEqual(['real'])
  })

  it('drops a project with no path at all', () => {
    const tree = [project({ id: 'pathless', path: null }), project({ id: 'real' })]
    expect(ids(tree, '/elsewhere')).toEqual(['real'])
  })

  it('drops archived projects', () => {
    const tree = [project({ archived: true, id: 'old' }), project({ id: 'real' })]
    expect(ids(tree, '/elsewhere')).toEqual(['real'])
  })

  it('keeps auto projects, which are real folders the user works in', () => {
    // A git root promoted without a projects.db row still labels sessions in
    // the statusbar. Excluding it would make the picker unable to offer the
    // folder the user is looking at right now.
    expect(ids([project({ id: 'auto', isAuto: true })], '/elsewhere')).toEqual(['auto'])
  })

  it('falls back to the first repo path when the project itself has none', () => {
    const tree = [
      project({
        id: 'repo-only',
        path: null,
        repos: [{ groups: [], id: 'r', label: 'r', path: '/home/u/checkout', sessionCount: 0 }]
      })
    ]

    expect(workspaceFolderTargets(tree, '/elsewhere')[0]?.cwd).toBe('/home/u/checkout')
  })
})

describe('the order they appear in', () => {
  it('puts the most recently worked in folder first', () => {
    const tree = [
      project({ id: 'stale', lastActive: 10 }),
      project({ id: 'fresh', lastActive: 900 }),
      project({ id: 'middle', lastActive: 100 })
    ]

    expect(ids(tree, '/elsewhere')).toEqual(['fresh', 'middle', 'stale'])
  })

  it('breaks ties by label so the list does not reshuffle between renders', () => {
    // Every project shares a timestamp on a cold start (the tree reports none),
    // and an unstable sort would reorder the menu under the user's cursor.
    const tree = [project({ id: 'c', label: 'c' }), project({ id: 'a', label: 'a' }), project({ id: 'b', label: 'b' })]
    expect(ids(tree, '/elsewhere')).toEqual(['a', 'b', 'c'])
  })

  it('treats a missing lastActive as oldest rather than dropping the row', () => {
    const tree = [project({ id: 'unknown' }), project({ id: 'known', lastActive: 5 })]
    expect(ids(tree, '/elsewhere')).toEqual(['known', 'unknown'])
  })
})
