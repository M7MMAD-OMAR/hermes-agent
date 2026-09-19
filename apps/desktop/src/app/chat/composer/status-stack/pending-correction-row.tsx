import { memo } from 'react'

import { StatusRow } from '@/components/chat/status-row'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import type { PendingCorrection } from '@/store/correction-delivery'

/**
 * "Your message is waiting for X" for a mid-turn correction that has been accepted but has not
 * reached the model yet.
 *
 * The complaint this answers: you send a follow-up while a turn is running, the bubble appears,
 * and then nothing visibly happens for a long time. The correction WAS accepted, but it is queued
 * behind a tool batch that may itself be blocked on a command that cannot be handed to the
 * background, and the UI had no way to say so. "Accepted" and "delivered" looked the same, so a
 * normal wait was indistinguishable from the message being eaten.
 *
 * Presentational only: whether there is anything to say is the stack's decision, made once where
 * it also decides whether to render a section at all. Splitting that gate across both layers is
 * how an empty status card ended up floating over an idle composer.
 */

interface PendingCorrectionRowProps {
  pending: PendingCorrection
}

function PendingCorrectionRowImpl({ pending }: PendingCorrectionRowProps) {
  const blocked = pending.delivery === 'tool_boundary_blocked'

  return (
    <StatusRow
      leading={
        blocked ? (
          <Codicon className="text-(--ui-warning)/85" name="watch" size="0.8rem" />
        ) : (
          <GlyphSpinner
            ariaLabel="delivering"
            className="text-[0.85rem] leading-none text-(--ui-success)/85"
            spinner="braille"
          />
        )
      }
    >
      <span className="min-w-0 text-xs text-muted-foreground/80">
        <span className="text-foreground/80">
          {blocked ? 'Waiting for the running command' : 'Arriving after the current step'}
        </span>
        {/* The text itself, so there is no doubt WHICH message is waiting when several were
            sent in a row. Truncated rather than wrapped: this is a status line, not a bubble. */}
        <span className="ms-1 block truncate opacity-75">{pending.text}</span>
      </span>
    </StatusRow>
  )
}

export const PendingCorrectionRow = memo(PendingCorrectionRowImpl)
