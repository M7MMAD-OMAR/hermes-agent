/** `preview.act.request` — the drive_preview bridge.
 *
 *  Two shipped bugs had no coverage here at all, and both were invisible from
 *  the agent's side because the tool answered with a plausible sentence rather
 *  than failing loudly:
 *
 *  1. The gate compared the requesting session against the PRIMARY view's
 *     runtime. This bridge mounts once (wiring.tsx), so every tile — including
 *     every ⌘T tab — was refused permanently while the user was looking
 *     straight at it, and told "the session the user is looking at".
 *  2. `url` and `full` were on the wire but missing from the forwarded field
 *     list, so `navigate` reported "navigate needs a url" for a url it had
 *     been given, and `elements full=true` quietly answered with a delta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { group } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

/** The pane's navigate arm, at the far end of the real engine. Mocking here
 *  rather than mocking the engine itself keeps the whole relay under test —
 *  the handler loads the engine through a cache-busted dynamic import that a
 *  module mock on the engine's own specifier would not intercept. */
const navigate = vi.fn()

vi.mock('@/app/chat/right-rail/preview-nav', () => ({
  agentPreviewNav: () => ({ back: vi.fn(), forward: vi.fn(), navigate, reload: vi.fn() })
}))

const request = vi.fn(async () => undefined)

vi.mock('@/store/gateway', () => ({
  // `subscribe` is unused here but other store modules pulled in by the import
  // graph attach listeners at module scope.
  $gateway: { get: () => ({ request }), listen: () => () => undefined, subscribe: () => () => undefined }
}))

const { handleServerRequest, previewActionFromPayload } = await import('./server-requests')
const { createClientSessionState } = await import('@/lib/chat-runtime')

const deps = {
  activeSessionIdRef: { current: null },
  sessionInterrupted: () => false,
  updateSessionState: (_sessionId: string, update: (s: never) => never) =>
    update(createClientSessionState('stored-session') as never),
  upsertToolCall: () => undefined
} as never

const PRIMARY = 'runtime-primary'
const TILE = 'runtime-tile'

/** The act request now rides the JSON-RPC server-request rail rather than an
 *  event notification; `isActiveSession` is what the old gate trusted alone. */
const respond = vi.fn()

function act(sessionId: string, params: Record<string, unknown>) {
  respond.mockClear()

  return handleServerRequest(
    {
      fail: vi.fn(),
      id: 'srq-1',
      method: 'preview.act',
      params: { session_id: sessionId, ...params },
      profile: 'default',
      respond
    } as never,
    deps,
    $activeSessionId.get()
  )
}

/** The single answer this handler sends back. */
async function answered() {
  await vi.waitFor(() => expect(respond).toHaveBeenCalled())

  const [payload] = respond.mock.calls.at(-1) as unknown as [{ value: string }]

  return JSON.parse(payload.value) as { error?: string; success: boolean }
}

beforeEach(() => {
  vi.clearAllMocks()
  $activeSessionId.set(PRIMARY)
  $selectedStoredSessionId.set('stored-primary')
  $sessionTiles.set([])
  $layoutTree.set(null)
})

describe('preview.act.request gate', () => {
  it('acts for the primary view when it holds focus', async () => {
    act(PRIMARY, { action: 'navigate', url: 'https://example.com' })

    expect(await answered()).toMatchObject({ success: true })
    expect(navigate).toHaveBeenCalledWith('https://example.com')
  })

  it('acts for a focused tile, whose runtime is never the primary ref', async () => {
    // What the user hit: a ⌘T tab is a tile with a runtime of its own, and the
    // bridge's activeSessionIdRef still points at the primary. The tile holds
    // the active pane while the primary selection stays put — that gap is what
    // makes $focusedRuntimeId answer with the tile rather than the primary.
    $sessionTiles.set([{ runtimeId: TILE, storedSessionId: 'stored-tile' }] as never)
    $layoutTree.set(
      group(['workspace', 'session-tile:stored-tile'], { active: 'session-tile:stored-tile', id: 'grp-main' })
    )
    noteActiveTreeGroup('grp-main')

    // The old gate's whole input, and it says no.
    expect(TILE === $activeSessionId.get()).toBe(false)

    act(TILE, { action: 'navigate', url: 'https://example.com' })

    expect(await answered()).toMatchObject({ success: true })
    expect(navigate).toHaveBeenCalledWith('https://example.com')
  })

  it('keeps acting for the tile while the user clicks the preview pane itself', async () => {
    // The tool's own main scenario, and what rules focus out as the predicate:
    // the preview pane is a pane in the layout tree, so a pointerdown in it
    // takes the interaction tracker. $focusedRuntimeId then falls back off the
    // tile to the primary — the user clicking the page the agent is driving
    // would revoke the agent's permission to drive it.
    $sessionTiles.set([{ runtimeId: TILE, storedSessionId: 'stored-tile' }] as never)
    $layoutTree.set(group(['workspace', 'session-tile:stored-tile', 'preview'], { active: 'preview', id: 'grp-main' }))
    noteActiveTreeGroup('grp-main')

    act(TILE, { action: 'navigate', url: 'https://example.com' })

    expect(await answered()).toMatchObject({ success: true })
    expect(navigate).toHaveBeenCalledWith('https://example.com')
  })

  it('leaves a session with no surface on screen to the window that owns it', async () => {
    // This used to answer with a named refusal. On the server-request rail every
    // mounted window sees the same request, so a refusal from a window that has
    // nowhere to run it can beat the owning window's real result onto the wire.
    // Silence is the answer; the named message below is still what an UNSCOPED
    // request with nothing in view gets (see server-requests.test.ts).
    expect(act('runtime-background', { action: 'navigate', url: 'https://example.com' })).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(respond).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('refuses a tile that has been closed, even as the last thing on screen', async () => {
    // Closing the tile takes the surface away; a turn still running in it must
    // not keep driving the pane.
    $sessionTiles.set([])

    act(TILE, { action: 'navigate', url: 'https://example.com' })

    await new Promise(resolve => setTimeout(resolve, 10))

    // Same rule as above: no surface here means this window does not answer.
    // What matters for the hijack property is that it does not ACT.
    expect(respond).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('previewActionFromPayload', () => {
  // Every optional field tools/drive_preview_tool.py can put on the wire. A
  // name dropped from the mapping is a feature that fails with a wrong reason.
  it('relays every field drive_preview sends', () => {
    expect(
      previewActionFromPayload({
        action: 'type',
        amount: 400,
        full: true,
        key: 'Enter',
        max: 50,
        ref: 'e7',
        request_id: 'req-1',
        selector: '#name',
        submit: true,
        text: 'محمد',
        to: 'bottom',
        url: 'https://example.com'
      } as never)
    ).toEqual({
      amount: 400,
      full: true,
      key: 'Enter',
      kind: 'type',
      max: 50,
      ref: 'e7',
      selector: '#name',
      submit: true,
      text: 'محمد',
      to: 'bottom',
      url: 'https://example.com'
    })
  })

  it('leaves absent fields undefined rather than inventing defaults', () => {
    expect(previewActionFromPayload({ action: 'reload' } as never)).toMatchObject({
      kind: 'reload',
      url: undefined
    })
  })
})
