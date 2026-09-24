// The docked shell draws NO lines.
//
// A rail, a zone or a row is separated by its fill and the ground around it,
// never by a stroke: at shell scale a hairline pulls the eye and distorts what
// it frames, and the rails are meant to read as the window itself rather than
// as cards sitting on it. The rule keeps being re-broken one utility at a time
// (the sessions rail carried a dead edge line through two redesigns, and the
// line came back to life in the peek overlay, which mounts the same pane
// OUTSIDE the zone stylesheet that had been zeroing it), so the rule is
// enforced here instead of remembered.
//
// Scope is the DOCKED shell. Floating surfaces are excluded by the config that
// uses this block: they detach from what is behind them, and an outline is a
// legitimate part of how they do that.
//
// Two deliberate limits on what this matches:
//
//  - the WIDTH utility only (`border`, `border-t`, `border-s`, ...). A bare
//    colour (`border-(--token)`) is a colour for a width someone else
//    declared, and `arc-border` is a different class name entirely. Removing
//    the width is what removes the line.
//  - class strings only: a `className` attribute or a `cn()` argument. CSS
//    text inside a `<style>` element is not a class string, and the shell's
//    own stylesheet says `border-width: 0` in several places, which is the
//    rule being enforced rather than broken.
const BORDER_UTILITY = String.raw`(^|[\s'"\`])border(-(t|b|l|r|s|e|x|y))?([\s'"\`]|$)`

const MESSAGE =
  'No borders in the docked shell. Separate the surface with its fill and the ground around it, or with a shadow when it floats above the panes. A genuinely floating surface belongs in this block’s eslint ignores, with a reason.'

const CLASS_STRING_SCOPES = ['JSXAttribute[name.name="className"]', 'CallExpression[callee.name="cn"]']

/** `no-restricted-syntax` selectors, to be spread ALONGSIDE the base ones: flat config
 *  replaces a rule's options rather than merging them. */
export const shellNoBorders = CLASS_STRING_SCOPES.flatMap(scope => [
  { message: MESSAGE, selector: `${scope} Literal[value=/${BORDER_UTILITY}/]` },
  { message: MESSAGE, selector: `${scope} TemplateElement[value.raw=/${BORDER_UTILITY}/]` }
])

export const shellChromeFiles = ['src/app/chat/sidebar/**/*.tsx', 'src/components/pane-shell/tree/renderer/**/*.tsx']

export const shellChromeIgnores = [
  // Dialogs: modal, over a scrim, not part of the rail.
  'src/app/chat/sidebar/**/*-dialog.tsx',
  // The pane edit bar and its layout picker float over the layout like a popover.
  'src/components/pane-shell/tree/renderer/edit-bar.tsx',
  'src/components/pane-shell/tree/renderer/layout-picker.tsx',
  // Tests describe markup, they do not paint it.
  '**/*.test.tsx'
]
