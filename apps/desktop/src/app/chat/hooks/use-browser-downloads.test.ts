import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $workspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'

import { workspaceDownloadDir } from './use-browser-downloads'

const route = (downloadDir?: string) =>
  ({
    kind: 'route' as const,
    route: { connectionId: 'local-1', profile: 'herwork', ...(downloadDir ? { downloadDir } : {}) }
  })

beforeEach(() => {
  $workspaceNewSessionTarget.set(null)
})

afterEach(() => {
  $workspaceNewSessionTarget.set(null)
  vi.restoreAllMocks()
})

describe('where a browser download belongs', () => {
  it('is the folder the workspace on screen names', () => {
    expect(workspaceDownloadDir(route('/home/ada/herwork/work'))).toBe('/home/ada/herwork/work')
  })

  it('is nowhere outside a workspace, so the OS prompt stays', () => {
    expect(workspaceDownloadDir(null)).toBeNull()
    expect(workspaceDownloadDir(route())).toBeNull()
    // A workspace that cannot route a new session names no folder either.
    expect(workspaceDownloadDir({ kind: 'blocked', message: 'no route' })).toBeNull()
  })
})
