import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { AccountUsagePanel } from '@/app/shell/account-usage-panel'
import { ContextUsagePanel } from '@/app/shell/context-usage-panel'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { Button } from '@/components/ui/button'
import { releaseTypingFocus } from '@/components/ui/keyboard-first'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $currentUsage } from '@/store/session'
import type { UsageStats } from '@/types/hermes'

/** The pill sits on the composer toolbar next to the model pill; same size
 *  contract, so the two read as one family of controls. */
const PILL = cn(
  'h-(--composer-control-size) min-w-0 shrink-0 gap-1.5 rounded-md px-2 text-xs font-normal tabular-nums',
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
  'data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground'
)

// Same urgency ladder the usage panels paint: amber as the window fills, red
// as it nears the edge. The pill is the glanceable form of those panels.
function loadTone(percent: null | number): string {
  if (percent === null) {
    return 'bg-(--ui-stroke-secondary)'
  }

  if (percent >= 90) {
    return 'bg-(--ui-red)'
  }

  if (percent >= 70) {
    return 'bg-(--ui-orange)'
  }

  return 'bg-(--ui-blue)'
}

/** Never called: `enabled` is false whenever this stand-in is passed, but the
 *  shared hook requires a dispatcher. Module-level so the reference is stable. */
const NO_REQUEST: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T> = () =>
  Promise.reject(new Error('no gateway'))

/**
 * The composer's CONTEXT control — the glanceable "how full is this
 * conversation" gauge, always on the toolbar instead of living only in the
 * status bar. The pill shows the occupancy percent with a tone that tracks
 * urgency; the popover reuses the status bar's two usage panels verbatim
 * (context breakdown + every connected plan's windows) so the numbers can
 * never disagree between the two surfaces.
 *
 * Data comes from the shared per-session breakdown store (`useContextBreakdown`
 * fetches into it; the status bar gauge reads the same answer), falling back to
 * the live streamed usage for the primary surface mid-turn.
 */
export function ContextPill({
  busy,
  compact = false,
  disabled,
  requestGateway,
  sessionId
}: {
  busy: boolean
  compact?: boolean
  disabled: boolean
  requestGateway?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  sessionId?: null | string
}) {
  const { t } = useI18n()
  const copy = t.shell.statusbar
  const view = useSessionView()
  const [open, setOpen] = useState(false)
  const primary = view.kind === 'primary'
  const liveUsage = useStore($currentUsage)

  const request = requestGateway

  const { breakdown, loading } = useContextBreakdown({
    busy,
    // No dispatcher (detached surface) → no fetch; the pill then renders the
    // waiting state honestly instead of pretending to measure.
    enabled: Boolean(request),
    requestGateway: request ?? NO_REQUEST,
    sessionId: sessionId ?? null
  })

  // The breakdown wins whenever it exists (measured occupancy, keyed to the
  // session it describes) — the same merge the status bar gauge performs.
  const usage = useMemo<UsageStats>(
    () =>
      breakdown
        ? {
            ...liveUsage,
            context_max: breakdown.context_max,
            context_percent: breakdown.context_percent,
            context_used: breakdown.context_used
          }
        : liveUsage,
    [breakdown, liveUsage]
  )

  const percent = usage.context_percent ?? null
  const clamped = percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)))
  const known = primary || Boolean(breakdown)

  // Closing the popover ends its claim on the keyboard: Radix restores focus
  // to this pill (a toolbar button), so without the release the Enter that
  // dismissed it also swallows whatever you type next.
  const setPopoverOpen = (next: boolean) => {
    setOpen(next)

    if (!next) {
      releaseTypingFocus()
    }
  }

  const title = known && clamped !== null ? copy.contextUsagePanel.percentFull(clamped) : copy.toggleContextUsage

  return (
    <Popover onOpenChange={setPopoverOpen} open={open}>
      <Tip label={title} side="top">
        <PopoverTrigger asChild>
          <Button
            aria-label={copy.toggleContextUsage}
            className={PILL}
            data-slot="composer-context-pill"
            disabled={disabled}
            type="button"
            variant="ghost"
          >
            <span aria-hidden className="flex h-1 w-6 shrink-0 overflow-hidden rounded-full bg-(--ui-stroke-secondary)">
              <span
                className={cn('h-full rounded-full transition-[width] duration-300', loadTone(clamped))}
                style={{ width: `${clamped === null ? 0 : Math.max(4, clamped)}%` }}
              />
            </span>
            {!compact && (
              <span className="min-w-6 text-right">
                {known && clamped !== null ? `${clamped}%` : '—'}
              </span>
            )}
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80 border-(--ui-stroke-secondary) p-0" side="top" sideOffset={8}>
        <div className="max-h-[min(70vh,32rem)] overflow-y-auto" data-slot="context-popover">
          <div className="[&>div]:w-full">
            <ContextUsagePanel breakdown={breakdown} loading={loading} usage={usage} />
          </div>
          <div className="border-t border-(--ui-stroke-tertiary)">
            <AccountUsagePanel />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
