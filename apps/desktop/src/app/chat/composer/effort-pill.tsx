import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { resolveFastControl } from '@/app/shell/model-edit-submenu'
import { Button } from '@/components/ui/button'
import { releaseTypingFocus } from '@/components/ui/keyboard-first'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Brain, iconSize } from '@/lib/icons'
import type { CurrentModelCaps } from '@/lib/model-options'
import {
  DEFAULT_REASONING_EFFORT,
  isThinkingEnabled,
  REASONING_EFFORTS,
  reasoningEffortLabel,
  resolveReasoningEffort
} from '@/lib/reasoning-effort'
import { writeSessionFast, writeSessionReasoning } from '@/lib/session-model-writes'
import { cn } from '@/lib/utils'
import { $defaultReasoningEffort } from '@/store/session'

/** The pill sits on the composer toolbar next to the model pill; same size
 *  contract, so the two read as one family of controls. */
const PILL = cn(
  'h-(--composer-control-size) min-w-0 shrink gap-1.5 rounded-md px-2 text-xs font-normal',
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
  'data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground'
)

/**
 * The composer's THINKING control — the quick effort dial the model menu hides
 * behind a hover submenu. A pill showing the live level; the popover is a
 * Faster↔Smarter ladder over Hermes' real reasoning levels, the thinking
 * on/off switch, and the fast-mode toggle when the model takes the speed
 * parameter. Every write goes through `lib/session-model-writes`, the same
 * optimistic+rollback seam the model menu edits use.
 *
 * Scope follows THIS surface's SessionView (primary or tile) — never the
 * primary-only globals — so side-by-side panes each dial their own thinking.
 */
export function EffortPill({
  caps,
  disabled,
  requestGateway
}: {
  caps?: CurrentModelCaps
  disabled: boolean
  requestGateway?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const { t } = useI18n()
  const copy = t.shell.modelOptions
  const view = useSessionView()
  // Live atoms, not the ChatBarState snapshot: the popover writes through
  // these, so the pill + slider must repaint on the write, not on a re-render
  // from upstream.
  const model = useStore(view.$model)
  const provider = useStore(view.$provider)
  const rawEffort = useStore(view.$reasoningEffort)
  const fast = useStore(view.$fast)
  const runtimeId = useStore(view.$runtimeId)
  const defaultEffort = useStore($defaultReasoningEffort) || DEFAULT_REASONING_EFFORT
  const [open, setOpen] = useState(false)
  const touchesPrimary = view.kind === 'primary'

  const reasoningSupported = caps?.reasoning ?? true
  const fastControl = resolveFastControl(model, caps?.providerModels ?? [], caps?.fast ?? false, fast)
  const fastToggleable = fastControl.kind === 'param'

  // A model that can neither think nor go fast has no dial to offer — hide
  // rather than mount a control that silently does nothing.
  if (!reasoningSupported && !fastToggleable) {
    return null
  }

  const effortValue = resolveReasoningEffort(rawEffort, defaultEffort)
  const thinkingOn = isThinkingEnabled(rawEffort, defaultEffort)
  const level = thinkingOn ? (effortValue || defaultEffort) : 'none'
  const activeIndex = REASONING_EFFORTS.indexOf(level as (typeof REASONING_EFFORTS)[number])

  const setEffort = (next: string) => {
    if (!requestGateway || next === (thinkingOn ? (effortValue || defaultEffort) : 'none')) {
      return
    }

    void writeSessionReasoning({
      next,
      previous: rawEffort,
      request: requestGateway,
      sessionId: runtimeId,
      surface: { model, primary: touchesPrimary, provider },
      updateFailedMessage: copy.updateFailed
    })
  }

  const setThinking = (checked: boolean) => {
    setEffort(checked ? (effortValue || defaultEffort) : 'none')
  }

  const setFast = (checked: boolean) => {
    if (!requestGateway || fastControl.kind !== 'param') {
      return
    }

    void writeSessionFast({
      next: checked,
      previous: fast,
      request: requestGateway,
      sessionId: runtimeId,
      surface: { model, primary: touchesPrimary, provider },
      updateFailedMessage: copy.fastFailed
    })
  }

  // Closing the popover ends its claim on the keyboard: Radix restores focus
  // to this pill (a toolbar button), so without the release the Enter that
  // set a level also swallows whatever you type next.
  const setPopoverOpen = (next: boolean) => {
    setOpen(next)

    if (!next) {
      releaseTypingFocus()
    }
  }

  // A reasoning-capable model shows the level; a fast-only model is just the
  // fast toggle wearing a pill, so its label is the toggle's own name.
  const label = reasoningSupported ? reasoningEffortLabel(level) : copy.fast

  return (
    <Popover onOpenChange={setPopoverOpen} open={open}>
      <Tip label={reasoningSupported ? `${copy.effort}: ${reasoningEffortLabel(level)}` : copy.fast} side="top">
        <PopoverTrigger asChild>
          <Button aria-label={reasoningSupported ? copy.effort : copy.fast} className={PILL} disabled={disabled} type="button" variant="ghost">
            <Brain className={cn(iconSize.xs, 'shrink-0 opacity-70')} />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-64 p-3" side="top" sideOffset={8}>
        <div className="flex flex-col gap-3 text-[0.75rem]" data-slot="effort-popover">
          {reasoningSupported && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-foreground">{copy.effort}</p>
                <span className="text-[0.6875rem] text-muted-foreground">{reasoningEffortLabel(level)}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">{t.composer.effortFaster}</span>

                <div
                  aria-label={copy.effort}
                  className="flex flex-1 items-center gap-1"
                  role="radiogroup"
                >
                  {REASONING_EFFORTS.map((step, index) => (
                    <button
                      aria-checked={index === activeIndex}
                      aria-label={copy[step]}
                      className={cn(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        index <= activeIndex ? 'bg-primary' : 'bg-(--ui-stroke-secondary) hover:bg-(--ui-stroke-primary)'
                      )}
                      key={step}
                      onClick={() => setEffort(step)}
                      role="radio"
                      type="button"
                    />
                  ))}
                </div>

                <span className="shrink-0 text-[0.625rem] text-muted-foreground">{t.composer.effortSmarter}</span>
              </div>

              {caps?.canDisableReasoning !== false && (
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="text-muted-foreground">{copy.thinking}</span>
                  <Switch checked={thinkingOn} onCheckedChange={setThinking} size="xs" />
                </label>
              )}
            </>
          )}

          {fastToggleable && (
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-muted-foreground">{copy.fast}</span>
              <Switch checked={fast} onCheckedChange={setFast} size="xs" />
            </label>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
