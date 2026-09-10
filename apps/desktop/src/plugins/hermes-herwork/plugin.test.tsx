/**
 * S1 and S2 of docs/design/herwork-workspace.md, plugin half: selecting HerWork
 * scopes the workspace to the desk with a `+` route on the herwork profile, and
 * leaving hands the scope back to Sessions.
 *
 * The SDK is mocked at the boundary, as plugin tests do (the plugin fence keeps
 * `@/…` out of this tree): `host.setWorkspaceScope` records, `host.paneVisibility`
 * hands back a settable atom per pane id, and `host.state.workspaceMode` is the
 * value the last recorded scope call set.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import type { PluginContext } from '@hermes/plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  /** A minimal settable store with the `get/set/listen` shape the plugin reads,
   *  built inside the hoist so no module import is needed before mocks apply. */
  function makeStore<T>(initial: T) {
    let value = initial
    const listeners = new Set<(next: T) => void>()

    return {
      get: () => value,
      set: (next: T) => {
        value = next
        listeners.forEach(fn => fn(next))
      },
      listen: (fn: (next: T) => void) => {
        listeners.add(fn)

        return () => {
          listeners.delete(fn)
        }
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

  const workspaceMode = makeStore<string>('sessions')
  const panes = new Map<string, ReturnType<typeof makeStore<boolean>>>()

  return {
    activeConnectionId: vi.fn<() => null | string>(() => 'local-1'),
    panes,
    paneVisibility: vi.fn((id: string) => {
      if (!panes.has(id)) {
        panes.set(id, makeStore(false))
      }

      return panes.get(id)!
    }),
    setWorkspaceOwnerLabel: vi.fn(),
    setWorkspaceScope: vi.fn((mode: string) => {
      workspaceMode.set(mode)

      return true
    }),
    workspaceMode
  }
})

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof HermesSdk>()

  return {
    ...original,
    host: {
      ...original.host,
      activeConnectionId: mocks.activeConnectionId,
      paneVisibility: mocks.paneVisibility,
      setWorkspaceOwnerLabel: mocks.setWorkspaceOwnerLabel,
      setWorkspaceScope: mocks.setWorkspaceScope,
      state: { ...original.host.state, workspaceMode: mocks.workspaceMode }
    }
  }
})

vi.mock('./chat-empty', () => ({ HerworkChatEmpty: () => null }))
vi.mock('./pane', () => ({ HerworkPane: () => null }))

import { HERWORK_OWNER_KEY, herworkDeskCwd, herworkRoute, homeOf } from './desk'
import plugin, { enterHerwork, HERWORK_PANE_ID } from './plugin'

function recordingContext(): { ctx: PluginContext; dispose: () => void } {
  const disposers: Array<() => void> = []
  const registered: unknown[] = []

  const ctx = {
    source: `plugin:${plugin.id}`,
    register: (c: unknown) => {
      registered.push(c)

      return () => undefined
    },
    registerMany: (cs: unknown[]) => {
      registered.push(...cs)

      return () => undefined
    },
    onDispose: (fn: () => void) => {
      disposers.push(fn)
    },
    i18n: { register: () => () => undefined, t: (key: string) => key },
    storage: { get: () => undefined, set: () => undefined, remove: () => undefined }
  } as unknown as PluginContext

  return { ctx, dispose: () => disposers.forEach(fn => fn()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeConnectionId.mockReturnValue('local-1')
  mocks.workspaceMode.set('sessions')
  mocks.panes.clear()
})

afterEach(() => {
  mocks.workspaceMode.set('sessions')
})

describe('desk', () => {
  it('routes a desk chat to the herwork profile at the desk with the mode bundle', () => {
    expect(herworkRoute('local-1', '/home/sbarah')).toEqual({
      connectionId: 'local-1',
      mode: 'local',
      profile: 'herwork',
      targetProfile: 'herwork',
      cwd: '/home/sbarah/herwork',
      // Dropped files land in the desk inbox, not wherever they were dragged from.
      dropDir: '/home/sbarah/herwork/inbox',
      bundle: 'herwork'
    })
    // Unknown home: no cwd on the route (never `/herwork`), no drop folder
    // either (never `/inbox`), bundle still set.
    expect(herworkRoute('local-1')).toMatchObject({ bundle: 'herwork' })
    expect(herworkRoute('local-1')).not.toHaveProperty('cwd')
    expect(herworkRoute('local-1')).not.toHaveProperty('dropDir')
    expect(herworkRoute('')).toBeNull()
    expect(herworkRoute(null)).toBeNull()
  })

  it('derives an absolute desk path from the home the cwd lives in', () => {
    expect(homeOf('/home/sbarah/R/Projects/x')).toBe('/home/sbarah')
    expect(homeOf('/Users/sbarah/code')).toBe('/Users/sbarah')
    expect(homeOf('/tmp/elsewhere')).toBe('')
    expect(herworkDeskCwd('/home/sbarah')).toBe('/home/sbarah/herwork')
    expect(herworkDeskCwd('/home/sbarah/')).toBe('/home/sbarah/herwork')
    expect(herworkDeskCwd('')).toBe('')
  })
})

describe('entering HerWork', () => {
  it('scopes the workspace to the desk owner with the herwork route', () => {
    enterHerwork()

    expect(mocks.setWorkspaceScope).toHaveBeenCalledWith('herwork', HERWORK_OWNER_KEY, {
      kind: 'route',
      route: expect.objectContaining({ connectionId: 'local-1', profile: 'herwork', bundle: 'herwork' })
    })
  })

  it('publishes a blocked target, not a dead workspace, when no local connection is known', () => {
    mocks.activeConnectionId.mockReturnValue(null)

    enterHerwork()

    expect(mocks.setWorkspaceScope).toHaveBeenCalledWith(
      'herwork',
      HERWORK_OWNER_KEY,
      expect.objectContaining({ kind: 'blocked' })
    )
  })
})

describe('the pane owns the scope only while it is on screen', () => {
  it('enters on show, hands back to Sessions on hide, and stops after dispose', () => {
    const { ctx, dispose } = recordingContext()
    plugin.register(ctx)
    expect(mocks.setWorkspaceOwnerLabel).toHaveBeenCalledWith(HERWORK_OWNER_KEY, 'pane.title')
    const visible = mocks.paneVisibility(HERWORK_PANE_ID)

    visible.set(true)
    expect(mocks.setWorkspaceScope).toHaveBeenLastCalledWith('herwork', HERWORK_OWNER_KEY, expect.anything())
    expect(mocks.workspaceMode.get()).toBe('herwork')

    visible.set(false)
    expect(mocks.setWorkspaceScope).toHaveBeenLastCalledWith('sessions')
    expect(mocks.workspaceMode.get()).toBe('sessions')

    // Another workspace holds the scope while HerWork is hidden: hiding the
    // pane again must not stomp on it.
    mocks.workspaceMode.set('bots')
    const calls = mocks.setWorkspaceScope.mock.calls.length
    visible.set(false)
    expect(mocks.setWorkspaceScope.mock.calls.length).toBe(calls)

    dispose()
    visible.set(true)
    // Disposed: the listener is gone, so showing the pane changes nothing.
    expect(mocks.setWorkspaceScope.mock.calls.length).toBe(calls)
  })

  it('registers the tab docked beside Sessions with the enforced center stack', () => {
    const registered: Array<{ id: string; area: string; data?: Record<string, unknown> }> = []

    const ctx = {
      source: 'plugin:x',
      register: (c: (typeof registered)[number]) => {
        registered.push(c)

        return () => undefined
      },
      registerMany: () => () => undefined,
      onDispose: () => undefined,
      i18n: { register: () => () => undefined, t: (key: string) => key },
      storage: {}
    } as unknown as PluginContext

    plugin.register(ctx)

    const pane = registered.find(c => c.id === 'pane')
    expect(pane?.area).toBe('panes')
    expect(pane?.data).toMatchObject({ dock: { pane: 'sessions', pos: 'center', enforce: true } })
    expect(registered.some(c => c.area === 'chat.empty')).toBe(true)
  })
})
