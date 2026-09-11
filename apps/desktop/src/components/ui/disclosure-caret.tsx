import { Codicon, type CodiconProps } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

interface DisclosureCaretProps extends Omit<CodiconProps, 'name'> {
  open: boolean
}

// Chrome caret for collapsible sections: points toward the content when closed
// (▶ in LTR, ◀ in RTL), rotates to point down (▼) when open. The flip is a CSS
// `rtl:` variant rather than the locale hook because this caret also renders
// inside document views, where the surrounding `dir` is the file's, not the
// app's. Mirror and rotation are exclusive: rotation is applied to an already
// mirrored glyph, so stacking them would aim an open caret up, and "down" needs
// no mirroring anyway. Override `className` to layer hover/opacity styling;
// twMerge resolves transition conflicts.
export function DisclosureCaret({ className, open, size = '0.75rem', ...props }: DisclosureCaretProps) {
  return (
    <Codicon
      className={cn('shrink-0 transition-transform duration-150', open ? 'rotate-90' : 'rtl:-scale-x-100', className)}
      name="chevron-right"
      size={size}
      {...props}
    />
  )
}
