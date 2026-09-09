import { useState } from 'react'

import { SubagentRow } from '@/app/agents'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { StatusSection } from '@/components/chat/status-section'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useViewedInterval } from '@/hooks/use-viewed-interval'
import { useI18n } from '@/i18n'
import { useEnterAnimation } from '@/lib/use-enter-animation'
import { useSessionSlice } from '@/lib/use-session-slice'
import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

import { SubagentControls } from './subagent-controls'
import { SubagentTranscript } from './subagent-transcript'

interface SubagentSectionProps {
  sessionId: string
}

/**
 * One worker in the composer roster. A component rather than an inline render
 * so each row owns a one-shot enter animation, keyed by worker id: a fan-out
 * settles in instead of snapping into place, and a row already on screen never
 * replays when a sibling's progress re-renders the list.
 */
function RosterRow({
  expanded,
  fallbackText,
  item,
  nowMs,
  onToggle,
  statusLabel
}: {
  expanded: boolean
  fallbackText: string
  item: SubagentProgress
  nowMs: number
  onToggle: () => void
  statusLabel: string
}) {
  const enterRef = useEnterAnimation(true, `composer-subagent:${item.id}`)

  return (
    <button
      aria-expanded={expanded}
      className="flex w-full min-w-0 items-start gap-2 px-2 py-1 text-left"
      onClick={onToggle}
      ref={enterRef}
      type="button"
    >
      <GlyphSpinner ariaLabel={statusLabel} className="mt-0.5 shrink-0 text-(--ui-purple)" spinner="braille" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-(--ui-text-primary)">{item.goal}</span>
        <span className="block truncate text-[0.68rem] text-(--ui-text-tertiary)">
          {item.stream.at(-1)?.text || fallbackText}
        </span>
      </span>
      <ActivityTimerText
        className="shrink-0 text-[0.65rem]"
        seconds={Math.max(0, Math.floor((nowMs - item.startedAt) / 1000))}
      />
    </button>
  )
}

/** A composer-local roster: never borrow the global Agents panel's scope. */
export function SubagentSection({ sessionId }: SubagentSectionProps) {
  const { t } = useI18n()
  const items = useSessionSlice($subagentsBySession, sessionId)
  const live = items.filter(item => item.status === 'running' || item.status === 'queued')
  const [nowMs, setNowMs] = useState(Date.now)
  const [selected, setSelected] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const hasLive = live.length > 0

  useViewedInterval(() => setNowMs(Date.now()), 1000, hasLive)

  if (!hasLive) {
    return null
  }

  const row = (item: SubagentProgress) => (
    <RosterRow
      expanded={selected === item.id}
      fallbackText={item.status === 'queued' ? t.agents.queued : t.agents.waitingActivity}
      item={item}
      key={item.id}
      nowMs={nowMs}
      onToggle={() => setSelected(selected === item.id ? null : item.id)}
      statusLabel={item.status === 'queued' ? t.agents.queued : t.agents.running}
    />
  )

  const detail = live.find(item => item.id === selected)

  return (
    <div className="composer-no-drag min-w-0" data-slot="composer-subagents">
      <StatusSection
        icon={<Codicon className="text-(--ui-purple)" name="agent" size="0.8rem" />}
        label={t.statusStack.subagents(live.length)}
        preview={
          <>
            {live.slice(0, 3).map(row)}
            {live.length > 3 && (
              <p className="px-2 text-[0.68rem] text-(--ui-text-tertiary)">{t.agents.moreAgents(live.length - 3)}</p>
            )}
          </>
        }
      >
        <div className="max-h-[25vh] overflow-y-auto overscroll-contain">{live.map(row)}</div>
      </StatusSection>
      {detail && (
        <div className="max-h-[25vh] overflow-y-auto overscroll-contain px-3 py-2" data-slot="composer-subagent-detail">
          <SubagentControls
            key={`${sessionId}:${detail.id}`}
            sessionId={sessionId}
            setText={text => setDrafts(previous => ({ ...previous, [detail.id]: text }))}
            subagentId={detail.id}
            text={drafts[detail.id] ?? ''}
          />
          <SubagentRow node={{ ...detail, children: [] }} nowMs={nowMs} />
          <SubagentTranscript key={`tail:${sessionId}:${detail.id}`} sessionId={sessionId} subagentId={detail.id} />
        </div>
      )}
    </div>
  )
}
