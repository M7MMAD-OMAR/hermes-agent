/**
 * The HerWork tab body. Deliberately small: the desk has one owner, so there is
 * no roster to pick from. What the pane does is state the desk (cwd, profile)
 * and, while it is on screen, own the workspace scope so the `+` opens desk
 * chats. The flip itself happens in plugin.tsx on the pane-visibility signal,
 * exactly where Bot Mode does it; this component only renders.
 */

import { Codicon, host, useValue } from '@hermes/plugin-sdk'

import { HERWORK_PROFILE, herworkDeskCwd, homeOf } from './desk'
import { useHerwork } from './i18n'

export function HerworkPane() {
  const { m } = useHerwork()
  const cwd = useValue(host.state.cwd)
  const desk = herworkDeskCwd(homeOf(cwd))

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 px-3 py-3 text-sm" data-slot="herwork_pane">
      <div className="flex items-center gap-2 text-(--ui-text-primary)">
        <Codicon aria-hidden name="folder-opened" size="0.95rem" />
        <span className="font-medium">{m.pane.title}</span>
      </div>
      <p className="m-0 text-xs leading-relaxed text-(--ui-text-secondary)">{m.empty.desk}</p>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-(--ui-text-tertiary)">cwd</dt>
        <dd className="m-0 truncate font-mono text-(--ui-text-secondary)" title={desk || undefined}>
          {desk || '~/herwork'}
        </dd>
        <dt className="text-(--ui-text-tertiary)">profile</dt>
        <dd className="m-0 font-mono text-(--ui-text-secondary)">{HERWORK_PROFILE}</dd>
      </dl>
      <p className="m-0 text-xs leading-relaxed text-(--ui-text-tertiary)">{m.empty.rule}</p>
    </div>
  )
}
