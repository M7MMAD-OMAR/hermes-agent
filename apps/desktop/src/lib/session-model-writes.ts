import { setModelPreset } from '@/store/model-presets'
import { notifyError } from '@/store/notifications'
import { markComposerSelectionManual, setCurrentFastMode, setCurrentReasoningEffort } from '@/store/session'
import { sessionTileDelegate } from '@/store/session-states'

type RequestGateway = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

const markManual = markComposerSelectionManual

/**
 * THE reasoning-effort write for a live session's surface — optimistic store
 * first, session-scoped `config.set` behind it, visible rollback on failure.
 * The composer's effort pill and the model menu's row edits both route through
 * here so they can never drift apart on what a change means.
 *
 * The change is also recorded as the model's remembered preset, exactly like
 * editing the active row in the model menu does.
 */
export async function writeSessionReasoning(options: {
  next: string
  previous: string
  request: RequestGateway
  sessionId: null | string
  surface: { model: string; primary: boolean; provider: string }
  updateFailedMessage: string
}): Promise<void> {
  const { next, previous, request, sessionId, surface, updateFailedMessage } = options

  applyReasoning(next)
  setModelPreset(surface.provider, surface.model, { effort: next })

  if (!sessionId) {
    return
  }

  try {
    await request('config.set', { key: 'reasoning', session_id: sessionId, value: next })
  } catch (err) {
    applyReasoning(previous)
    setModelPreset(surface.provider, surface.model, { effort: previous })
    notifyError(err, updateFailedMessage)
  }

  function applyReasoning(value: string) {
    if (surface.primary) {
      markManual()
      setCurrentReasoningEffort(value)

      return
    }

    if (sessionId) {
      sessionTileDelegate()?.updateSession(sessionId, state => ({ ...state, reasoningEffort: value }))
    }
  }
}

/** Same contract as `writeSessionReasoning`, for the fast-mode toggle. */
export async function writeSessionFast(options: {
  next: boolean
  previous: boolean
  request: RequestGateway
  sessionId: null | string
  surface: { model: string; primary: boolean; provider: string }
  updateFailedMessage: string
}): Promise<void> {
  const { next, previous, request, sessionId, surface, updateFailedMessage } = options

  applyFast(next)
  setModelPreset(surface.provider, surface.model, { fast: next })

  if (!sessionId) {
    return
  }

  try {
    await request('config.set', { key: 'fast', session_id: sessionId, value: next ? 'fast' : 'normal' })
  } catch (err) {
    applyFast(previous)
    setModelPreset(surface.provider, surface.model, { fast: previous })
    notifyError(err, updateFailedMessage)
  }

  function applyFast(value: boolean) {
    if (surface.primary) {
      markManual()
      setCurrentFastMode(value)

      return
    }

    if (sessionId) {
      sessionTileDelegate()?.updateSession(sessionId, state => ({ ...state, fast: value }))
    }
  }
}
