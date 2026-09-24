import { readActivePreview } from '@/app/chat/right-rail/preview-reader'
import { readActiveTerminal } from '@/app/right-sidebar/terminal/buffer'
import { pendingClarifyToolPayload } from '@/app/session/hooks/use-session-actions/restore-pending-clarify'
import { translateNow } from '@/i18n'
import { restorePendingClarifyToolCall } from '@/lib/chat-messages'
import type { PreviewActAction } from '@/lib/preview-act/act-in-page'
import type { TourAction, TourStep } from '@/lib/tour'
import { normalizeChoices, normalizeQuestions, setClarifyRequest, warnDroppedChoices } from '@/store/clarify'
import type { ScopedServerRequest } from '@/store/gateway'
import { dispatchNativeNotification } from '@/store/native-notifications'
import {
  receiveApprovalRequest,
  setSecretRequest,
  setSudoRequest,
  setVaultCodeRequest,
  setVaultSaveLoginRequest,
  setVaultUnlockRequest
} from '@/store/prompts'
import { rememberServerRequest } from '@/store/server-requests'
import { $sessionTiles, runtimeHasOpenSurface } from '@/store/session-states'
import { requestScrollToBottom } from '@/store/thread-scroll'
import { $toursEnabled } from '@/store/tours'

import type { GatewayEventDeps } from './types'

/** The preview engine, loaded on demand so ~25KB of page-injectable source stays
 *  off the boot path (dev: a fresh copy per action so edits reach the guest — see
 *  the previous home of this loader in desktop-bridge.ts for the full story). */
const loadPreviewEngine = () => {
  const stable = () => import('@/app/chat/right-rail/preview-act')

  if (!import.meta.hot) {
    return stable().then(mod => mod.actOnActivePreview)
  }

  return import(/* @vite-ignore */ '/src/app/chat/right-rail/preview-act.ts?hot=' + Date.now())
    .catch(stable)
    .then(mod => mod.actOnActivePreview as Awaited<ReturnType<typeof stable>>['actOnActivePreview'])
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/** Answer a string-valued request with a JSON-encoded result ('' = nothing / unavailable). */
const answerValue = (request: ScopedServerRequest, result: unknown) =>
  request.respond({ value: result ? JSON.stringify(result) : '' })

export interface ServerRequestContext {
  deps: Pick<GatewayEventDeps, 'activeSessionIdRef' | 'sessionInterrupted' | 'updateSessionState' | 'upsertToolCall'>
  request: ScopedServerRequest
  /** The session the request names ('' when unscoped). */
  sessionId: string
  /** The named session is the one on screen. */
  isActiveSession: boolean
}

type Handler = (ctx: ServerRequestContext) => void

type PreviewSessionRoute = 'ignore' | 'retry' | 'run'

/**
 * Bridges answered from THIS window's panes (preview tab, xterm buffer, the
 * native window below, the tour overlay). Every attached window sees the
 * request; one not hosting the session has no pane for it and its empty answer
 * would win the race, so the tool reports "no preview tab / no terminal" while
 * the owner's pane is open (#113348).
 */
const WINDOW_OWNED_REQUESTS = new Set(['preview.act', 'preview.read', 'terminal.read', 'window.read', 'tour'])

/** This window hosts the session: it is the primary view or an open session tile.
 *  `runtimeHasOpenSurface` also covers a tile mid-resume, which still references
 *  the session by its stored id before the runtime binding is patched in. */
export function windowHostsSession(sessionId: string, activeSessionId: null | string): boolean {
  return (
    sessionId === activeSessionId ||
    $sessionTiles.get().some(tile => tile.runtimeId === sessionId) ||
    runtimeHasOpenSurface(sessionId)
  )
}

/**
 * Panes are local to one desktop window, while gateway requests fan out
 * to every connected window. A scoped request may only be answered by the
 * window hosting its session (primary view or a tile). During reconnect,
 * however, an open request can replay one event-loop turn before the resumed
 * session becomes active; retry that one narrow race and otherwise leave the
 * request for its owner.
 */
export function previewSessionRoute({
  activeSessionId,
  replayed,
  sessionId
}: {
  activeSessionId: null | string
  replayed: boolean | undefined
  sessionId: string
}): PreviewSessionRoute {
  if (!sessionId || windowHostsSession(sessionId, activeSessionId)) {
    return 'run'
  }

  return replayed && !activeSessionId ? 'retry' : 'ignore'
}

const markNeedsInput = (ctx: ServerRequestContext) => {
  if (ctx.sessionId) {
    ctx.deps.updateSessionState(ctx.sessionId, state => ({ ...state, needsInput: true }))
  }
}

const notifyInput = (ctx: ServerRequestContext, body: string) => {
  if (!ctx.request.replayed) {
    dispatchNativeNotification({
      body,
      kind: 'input',
      sessionId: ctx.sessionId || null,
      title: translateNow('notifications.native.inputTitle')
    })
  }
}

// ── Blocking-input family (clarify / approval / sudo / secret / vault / MCP setup) ──
// Every one is parked per-session (like clarify) so a BACKGROUND session's turn can
// raise it and wait — the sidebar flags "needs input" and the card surfaces once the
// user focuses that chat. The Python side blocks on the response frame; without a
// handler the channel answers -32601 and the tool fails fast instead of stalling.

const clarify: Handler = ctx => {
  const { deps, request, sessionId } = ctx
  const p = request.params

  if (sessionId && deps.sessionInterrupted(sessionId)) {
    request.respond({ answer: '' })

    return
  }

  const question = str(p.question)
  const rawChoices = p.choices
  const choices = normalizeChoices(rawChoices)
  const multiSelect = p.multi_select === true
  // Batch (multi-question) clarify: `questions` replaces question/choices on the
  // wire. `answers` rides along only on a reconnect replay (locks the server
  // already accepted).
  const questions = normalizeQuestions(p.questions)

  const lockedAnswers =
    typeof p.answers === 'object' && p.answers !== null
      ? Object.fromEntries(
          Object.entries(p.answers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : undefined

  if (questions.length === 0 && !question) {
    request.respond({ answer: '' })

    return
  }

  if (questions.length === 0 && rawChoices != null && choices.length === 0) {
    warnDroppedChoices('gateway', question, rawChoices)
  }

  const clarifyRequest =
    questions.length > 0
      ? {
          choices: null,
          lockedAnswers,
          multiSelect: false,
          question: '',
          questions,
          receivedAt: Date.now() / 1000,
          requestId: request.id,
          sessionId: sessionId || null
        }
      : {
          choices: choices.length > 0 ? choices : null,
          multiSelect,
          question,
          receivedAt: Date.now() / 1000,
          requestId: request.id,
          sessionId: sessionId || null
        }

  rememberServerRequest(request)
  setClarifyRequest(clarifyRequest)

  if (sessionId) {
    // A resumed/hydrated transcript may already contain this provider's clarify
    // call while carrying no live streamId. Re-arm that exact row instead of
    // letting the generic stream mutator append a second card.
    const occurredAt = Date.now() / 1000

    deps.updateSessionState(sessionId, state => {
      const projection = restorePendingClarifyToolCall(
        state.messages,
        pendingClarifyToolPayload(clarifyRequest),
        occurredAt
      )

      return {
        ...state,
        messages: projection.messages,
        streamId: projection.streamId,
        sawAssistantPayload: true,
        awaitingResponse: false,
        needsInput: true
      }
    })

    if (sessionId === deps.activeSessionIdRef.current) {
      requestScrollToBottom(sessionId)
    }
  }

  notifyInput(ctx, questions.length > 0 ? questions.map(q => q.question).join(' · ') : question)
}

const approval: Handler = ctx => {
  const { request, sessionId } = ctx
  const p = request.params
  const command = str(p.command)
  const description = str(p.description) || 'dangerous command'

  rememberServerRequest(request)
  void receiveApprovalRequest(null, {
    // false only when a tirith warning forbids it; backend omits the field otherwise.
    allowPermanent: p.allow_permanent !== false,
    choices: Array.isArray(p.choices)
      ? p.choices.filter((choice): choice is string => typeof choice === 'string')
      : undefined,
    command,
    description,
    // The approval queue's own id — `approval.pending` / `approval.received` / `approval.respond` key on it.
    requestId: str(p.request_id) || undefined,
    serverRequestId: request.id,
    sessionId: sessionId || null,
    smartDenied: p.smart_denied === true
  }).catch(() => undefined)
  markNeedsInput(ctx)

  if (!request.replayed) {
    dispatchNativeNotification({
      actions: [
        {
          id: str(p.request_id) ? `approve:${str(p.request_id)}` : 'approve',
          text: translateNow('notifications.native.approveAction')
        },
        {
          id: str(p.request_id) ? `reject:${str(p.request_id)}` : 'reject',
          text: translateNow('notifications.native.rejectAction')
        }
      ],
      body: command || description,
      kind: 'approval',
      sessionId: sessionId || null,
      title: translateNow('notifications.native.approvalTitle')
    })
  }
}

const sudo: Handler = ctx => {
  rememberServerRequest(ctx.request)
  setSudoRequest({
    command: str(ctx.request.params.command),
    requestId: ctx.request.id,
    sessionId: ctx.sessionId || null
  })
  markNeedsInput(ctx)
  notifyInput(ctx, translateNow('notifications.native.inputBody'))
}

/** Bot Screen package install (`tui_gateway/methods_display.py`): the same masked card as `sudo`,
 *  but app-level. The gateway sends it sessionless — it belongs to the connection that clicked
 *  Install, not to a chat — so it is stored under the null session and survives a chat switch. */
const displayInstallSudo: Handler = ctx => {
  rememberServerRequest(ctx.request)
  setSudoRequest({
    description: translateNow('prompts.sudoInstallDesc'),
    requestId: ctx.request.id,
    sessionId: null
  })
  notifyInput(ctx, translateNow('prompts.sudoInstallDesc'))
}

const secret: Handler = ctx => {
  const p = ctx.request.params
  const envVar = str(p.env_var)
  const promptText = str(p.prompt)

  rememberServerRequest(ctx.request)
  setSecretRequest({ envVar, prompt: promptText, requestId: ctx.request.id, sessionId: ctx.sessionId || null })
  markNeedsInput(ctx)
  notifyInput(ctx, promptText || envVar || translateNow('notifications.native.inputBody'))
}

const vaultCode: Handler = ctx => {
  const p = ctx.request.params
  const site = str(p.site)

  rememberServerRequest(ctx.request)
  setVaultCodeRequest({ hint: str(p.hint), requestId: ctx.request.id, sessionId: ctx.sessionId || null, site })
  markNeedsInput(ctx)
  notifyInput(ctx, translateNow('prompts.vaultCodeTitle', site))
}

const vaultSaveLogin: Handler = ctx => {
  const p = ctx.request.params
  const origin = str(p.origin)
  const site = str(p.site) || origin

  rememberServerRequest(ctx.request)
  setVaultSaveLoginRequest({ origin, requestId: ctx.request.id, sessionId: ctx.sessionId || null, site })
  markNeedsInput(ctx)
  notifyInput(ctx, translateNow('prompts.vaultSaveTitle', site))
}

const vaultUnlockPrompt: Handler = ctx => {
  const p = ctx.request.params
  const backend = str(p.backend)
  const displayName = str(p.display_name) || backend

  rememberServerRequest(ctx.request)
  setVaultUnlockRequest({ backend, displayName, requestId: ctx.request.id, sessionId: ctx.sessionId || null })
  markNeedsInput(ctx)
  notifyInput(ctx, translateNow('prompts.vaultUnlockTitle', displayName))
}

// ── Desktop-surface bridges (answered immediately, no card) ─────────────────

const terminalRead: Handler = ({ request }) => {
  // read_terminal tool: serialize the renderer's xterm buffer. Empty = no live pane.
  answerValue(request, readActiveTerminal({ count: num(request.params.count), start: num(request.params.start) }))
}

const previewRead: Handler = ({ request, sessionId }) => {
  // read_preview tool: the active preview tab's page text is async. Empty = nothing open.
  //
  // Scoped to the asking session: the rail is one surface holding every
  // conversation's tabs, so an unscoped read answers from whichever agent tab
  // was newest, which is one chat reading, reasoning about and reporting a page
  // another chat opened.
  void readActivePreview({ count: num(request.params.count), sessionId, start: num(request.params.start) }).then(
    result => answerValue(request, result)
  )
}

/** Wire params from `drive_preview` (and `annotate_preview`, which rides the same
 *  channel) into the action the preview engine takes.
 *
 *  Split out and exported because it is a field list, and a field list drifts:
 *  `url` and `full` were both on the wire and both read downstream, but neither
 *  was relayed, so `navigate` answered "navigate needs a url" for a url it had
 *  been handed and `elements full=true` quietly returned a delta. Inline in the
 *  handler this could only be tested through a live preview pane, which is why it
 *  went unnoticed; as a function it is checked directly against what
 *  `tools/drive_preview_tool.py` puts on the wire. */
export function previewActionFromPayload(params: Record<string, unknown> | undefined): PreviewActAction {
  return {
    amount: params?.amount,
    full: params?.full,
    key: params?.key,
    kind: (str(params?.action) || '') as PreviewActAction['kind'],
    max: params?.max,
    ref: params?.ref,
    selector: params?.selector,
    submit: params?.submit,
    text: params?.text,
    to: params?.to as PreviewActAction['to'],
    url: params?.url
  } as PreviewActAction
}

const previewAct: Handler = ({ isActiveSession, request, sessionId }) => {
  // drive_preview tool: click/type/scroll/press inside the guest page, or drive
  // the pane's history. On-screen sessions only: a background turn must never
  // reach into the page the user is working in (desktop AGENTS.md: offer, don't
  // hijack).
  //
  // `isActiveSession` alone is the wrong test for "on screen". This mounts once,
  // in wiring, so its active id is the PRIMARY view's runtime, but a tile (and
  // every new-tab session, which `openNewSessionTile` creates unlisted) binds a
  // runtime id of its own. Gating on the primary refused every request from a
  // tile the user was looking at, permanently, while its siblings on the same
  // global pane went through ungated.
  //
  // Focus is the wrong test too, and fails on this tool's own main use: the
  // preview pane is a pane in the layout tree, so a pointerdown in it takes the
  // interaction tracker and the focused runtime falls back off the tile to the
  // primary. The user clicking the very page the agent is driving would revoke
  // the agent's permission to drive it.
  const onScreen = isActiveSession || runtimeHasOpenSurface(sessionId)

  // Window ownership is settled by WINDOW_OWNED_REQUESTS before this runs, so a
  // refusal here reaches the tool instead of stalling it.
  if (!onScreen) {
    // Name the session. The bare sentence sent the agent hunting for a window to
    // focus when the real answer is which chat asked, and it gave whoever reads a
    // bug report nothing to correlate against.
    answerValue(request, {
      error:
        'The in-app browser only takes actions for a session that is open on screen. ' +
        `Session ${sessionId || '(none)'} has no open surface in this window.`,
      success: false
    })

    return
  }

  void loadPreviewEngine()
    .then(run => run(previewActionFromPayload(request.params), sessionId))
    .then(
      result => answerValue(request, result),
      error => answerValue(request, { error: error instanceof Error ? error.message : String(error), success: false })
    )
}

const windowRead: Handler = ({ request }) => {
  // read_window_below tool: main owns native window enumeration. Empty =
  // unavailable (older shell without the handler, Wayland, …) — without an
  // answer the tool would stall its full 30s deadline.
  const read = window.hermesDesktop?.readWindowBelow

  void Promise.resolve(read ? read() : null).then(
    result => answerValue(request, result),
    () => answerValue(request, null)
  )
}

const tour: Handler = ({ isActiveSession, request }) => {
  // tour tool: one guided-tour action via driver.js, app DOM or preview guest
  // page. Active session only, same window-ownership rule as preview.act
  // (WINDOW_OWNED_REQUESTS).
  const p = request.params

  if (!$toursEnabled.get()) {
    // Refused in words, not silently dropped: a no-op would leave the agent
    // narrating a spotlight the user can't see.
    answerValue(request, { error: 'The user has turned guided tours off.', success: false })

    return
  }

  if (!isActiveSession) {
    answerValue(request, { error: 'Tours only run in the session the user is looking at.', success: false })

    return
  }

  void import('@/lib/tour')
    .then(({ runTour }) =>
      runTour(
        {
          kind: (str(p.action) || 'stop') as TourAction['kind'],
          selector: p.selector as never,
          side: p.side as TourStep['side'],
          startAt: p.step_index as never,
          steps: p.steps as TourStep[] | undefined,
          text: p.text as never,
          title: p.title as never
        },
        p.surface === 'preview' ? 'preview' : 'app'
      )
    )
    .then(
      result => answerValue(request, result),
      error => answerValue(request, { error: error instanceof Error ? error.message : String(error), success: false })
    )
}

/** Method → handler. Every `ServerRequestMap` key the desktop answers. */
export const SERVER_REQUEST_HANDLERS: Record<string, Handler> = {
  approval,
  clarify,
  'display.install.sudo': displayInstallSudo,
  'preview.act': previewAct,
  'preview.read': previewRead,
  secret,
  sudo,
  'terminal.read': terminalRead,
  tour,
  'vault.code': vaultCode,
  'vault.save_login': vaultSaveLogin,
  'vault.unlock_prompt': vaultUnlockPrompt,
  'window.read': windowRead
}

/** Dispatch one server→client request; false when the desktop has no handler for its method. */
export function handleServerRequest(
  request: ScopedServerRequest,
  deps: ServerRequestContext['deps'],
  activeSessionId: null | string
): boolean {
  const handler = SERVER_REQUEST_HANDLERS[request.method]

  if (!handler) {
    return false
  }

  const sessionId = str(request.params.session_id)

  if (WINDOW_OWNED_REQUESTS.has(request.method)) {
    const route = previewSessionRoute({ activeSessionId, replayed: request.replayed, sessionId })

    if (route === 'ignore') {
      return true
    }

    if (route === 'retry') {
      // Re-read the ref instead of capturing activeSessionId: session resume
      // publishes its binding synchronously between this replay and the next
      // turn. A second miss deliberately stays silent for another window.
      setTimeout(() => {
        if (
          previewSessionRoute({ activeSessionId: deps.activeSessionIdRef.current, replayed: false, sessionId }) ===
          'run'
        ) {
          handler({ deps, request, sessionId, isActiveSession: true })
        }
      }, 0)

      return true
    }
  }

  handler({ deps, request, sessionId, isActiveSession: Boolean(sessionId) && sessionId === activeSessionId })

  return true
}
