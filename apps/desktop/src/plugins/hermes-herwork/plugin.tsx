/**
 * HerWork: a third workspace beside Sessions and Bots.
 *
 * While the HerWork tab is on screen the plugin publishes the workspace scope
 * with one fixed owner and a `+` route on the `herwork` profile, so a new chat
 * there is created on that profile. When the tab leaves the screen the scope
 * returns to Sessions, the same hand-back Bot Mode performs. The mode, the
 * owner key and the route live on the core workspace-scope primitive; this
 * plugin is only what gives them a tab and an empty state.
 *
 * It mirrors `hermes-bots` at a fraction of its size on purpose: no roster, no
 * group chats, no cron pane, no hidden canonical chat. HerWork sessions are
 * ordinary visible sessions that happen to live in a workspace.
 *
 * Design: docs/design/herwork-workspace.md.
 */

import type { ChatEmptyProps, HermesPlugin } from '@hermes/plugin-sdk'
import { CHAT_EMPTY_AREA, host } from '@hermes/plugin-sdk'

import { HerworkChatEmpty } from './chat-empty'
import { HERWORK_OWNER_KEY, herworkRoute, homeOf } from './desk'
import { HERWORK_LOCALES, HERWORK_PLUGIN_ID } from './i18n'
import { HerworkPane } from './pane'

export const HERWORK_PANE_ID = `${HERWORK_PLUGIN_ID}:pane`

/** Scope the workspace to the desk. A missing local connection publishes a
 *  blocked target rather than a dead `+`: a blocked target never disables the
 *  `+`, it falls back to an ordinary session (workspace-scope.ts). */
export function enterHerwork(): void {
  // The desk lives under the same home the ambient cwd does; `$HOME` itself
  // is not exposed to the renderer.
  const route = herworkRoute(host.activeConnectionId(), homeOf(host.state.cwd.get()))

  host.setWorkspaceScope(
    'herwork',
    HERWORK_OWNER_KEY,
    route ? { kind: 'route', route } : { kind: 'blocked', message: 'Connect a local gateway to start a desk chat.' }
  )
}

const plugin: HermesPlugin = {
  id: HERWORK_PLUGIN_ID,
  name: 'HerWork',
  description: 'A work desk beside Sessions and Bots: new chats open on the herwork profile.',
  defaultEnabled: true,
  register(ctx) {
    ctx.onDispose(ctx.i18n.register(HERWORK_LOCALES))
    host.setWorkspaceOwnerLabel(HERWORK_OWNER_KEY, ctx.i18n.t('pane.title'))

    // The tab: docked into the sessions zone as a center stack, the same
    // gesture Bots uses, so the sidebar reads SESSIONS | BOTS | HERWORK.
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: ctx.i18n.t('pane.title'),
      data: {
        placement: 'left',
        width: '260px',
        collapsible: true,
        hideOnly: true,
        dock: { pane: 'sessions', pos: 'center', enforce: true }
      },
      render: () => <HerworkPane />
    })

    // Own the workspace while the tab is showing; hand it back when it hides.
    // Guarded on the host capability like Bot Mode does for older desktops.
    if (typeof host.paneVisibility === 'function') {
      const stop = host.paneVisibility(HERWORK_PANE_ID).listen(visible => {
        if (visible) {
          enterHerwork()
        } else if (host.state.workspaceMode.get() === 'herwork') {
          host.setWorkspaceScope('sessions')
        }
      })

      ctx.onDispose(stop)
    }

    ctx.register({
      id: 'chat-empty',
      area: CHAT_EMPTY_AREA,
      data: {
        render: ({ sessionId }: ChatEmptyProps) => <HerworkChatEmpty sessionId={sessionId} />
      }
    })
  }
}

export default plugin
