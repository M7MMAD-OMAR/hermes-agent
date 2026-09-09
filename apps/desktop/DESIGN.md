# Desktop Design System

Conventions for the Electron desktop app (`apps/desktop`). Read this before
adding a component, overlay, or style. The rule of thumb: **one source per
concern, tokens over literals, flat over boxed.** If you reach for a raw color,
a one-off shadow, a bespoke button, or a hardcoded `px-*` on a control — stop,
there's already a primitive for it.

This file owns the visual and interaction contract. Read
[`AGENTS.md`](./AGENTS.md) for architecture, state, resolver, transport, and
testing rules.

This doc contains two kinds of content, maintained differently:

- **Principles** (flatness, intent, feedback, motion, cancellation) are durable.
  They hold as components come and go.
- **Named contracts** (tokens, `Button` variants, primitive names) are the
  design system's current API. They are maintained *with* the code: if you
  change a primitive, token, or variant, update its entry here **in the same
  change** — a stale name in this file is a bug, exactly like a stale type.

When a rule and the code disagree, fix whichever is wrong rather than forking a
one-off at the call site.

## Principles

1. **Flat, not boxed.** No card-in-card, no divider borders inside a panel.
   Group with whitespace and a single hairline, never nested rounded boxes.
2. **Borderless elevation for floating panels.** Overlays float on
   `shadow-nous` + a `--stroke-nous` hairline, not thick framed boxes. In-panel
   structure may use token hairlines sparingly.
3. **One primitive per concern.** One `Button`, one set of control variants,
   one `SearchField`, one `Loader`, one `ErrorState`. Migrate onto them; don't
   fork.
4. **Tokens, not literals.** Reference CSS vars (`--ui-*`, `--shadow-nous`,
   `--theme-*`), never raw hex / ad-hoc rgba in components.
5. **Style lives in the primitive.** Variants and sizes own padding, radius,
   color, chrome. Call sites pass a `variant`/`size`, not `className` overrides
   that re-specify those.
6. **Intent before automation.** Surface useful actions and previews, but do not
   open panes, move focus, or navigate because a tool happened to produce
   something.
7. **Immediate feedback.** Direct manipulation updates the view first. Network
   or disk persistence reconciles afterward and rolls back visibly on failure.

## Information architecture

- **Chat is the home surface.** The transcript and composer stay primary; tools,
  previews, files, review, and terminal complement the conversation.
- **Pages are durable destinations.** Chat, Skills, Messaging, and Artifacts
  remain in shell chrome. Do not hide a distinct product noun inside an
  unrelated page.
- **Route overlays are short tasks.** Settings, Command Center, Cron, Profiles,
  Agents, and Starmap render as `OverlayView` cards and return to the previous
  route on close. Model/session pickers and dialogs layer above the current
  surface; they are not navigation stacks.
- **Panes are working context.** Preview, files, review, and terminal remain
  attached to the current task. Their state survives temporary hiding and chat
  switches where the underlying tool is meant to persist.
- **One action, one home.** A command may have keyboard, palette, and visible
  affordances, but they invoke the same action and state. Do not fork behavior
  per entry point.
- **Projects own workspace cwd.** Use Sidebar → Projects for local folders and
  worktrees; do not reintroduce a per-session/right-sidebar folder-picker flow.

Navigation must preserve context. A background session finishing, a tool result
arriving, or a project refresh may update badges and cached data; it must not
replace the foreground transcript or steal focus.

## Surfaces & elevation

Floating panels (base `Dialog`, route overlays, boot/install/update surfaces,
model-picker, onboarding, prompt overlays, notifications) use:

```
shadow-nous           /* downward-weighted, layered contact→ambient falloff */
border-(--stroke-nous) /* currentColor hairline, theme-adaptive */
```

Both are CSS vars in `src/styles.css` — tune in one place, everything inherits.
Don't add per-overlay `shadow-[…]` or `border-(--ui-stroke-secondary)`
one-offs; if elevation needs to change, change the token.

Menus and popovers use their own shared `shadow-md` +
`--ui-stroke-secondary` primitive treatment. Drag affordances may use tokenized
dashed targets and local blur. These are semantic surface classes, not licenses
for call-site shadow or border inventions.

## Stroke & color tokens

| Token | Use |
| --- | --- |
| `--ui-stroke-primary…quaternary` | hairlines, in descending strength |
| `--ui-stroke-tertiary` | the default in-panel divider / list hairline — and every bordered surface in the transcript |
| `--stroke-nous` | the overlay hairline (pairs with `shadow-nous`) |
| `--ui-text-primary / -secondary / -tertiary` | text hierarchy |
| `--ui-bg-quaternary` | soft control fill (secondary button) |
| `--ui-widget-surface-background` | fill for inline chat widgets (`WIDGET_SHELL_CLASS`) |
| `--chrome-action-hover` | hover fill for quiet controls |
| `--theme-primary`, `--ui-accent` | brand/accent |

Never hardcode `border-gray-*`, `bg-white`, `text-black`, etc. The white tile in
`BrandMark` is the one sanctioned literal (the mark needs a fixed backdrop).

## Buttons — one component

`src/components/ui/button.tsx` is the single source. Pick a `variant` + `size`;
do **not** pass `h-*`, `px-*`, `py-*`, or icon-size overrides.

**Variants:** `default` (primary), `destructive`, `secondary` (soft fill —
the default non-primary look), `outline` (transparent + 1px inset ring, no
fill/shadow), `ghost`, `link`, `text` (boxless quiet inline — "Cancel",
"Clear"), `textStrong` (bold underlined inline affordance — "Change",
"Open logs").

**Sizes:** `default`, `xs`, `sm`, `lg`, `inline` (flush, zero box — for buttons
that sit inside a heading/sentence; replaces `h-auto px-0 py-0`), `micro`
(status-stack/table-footers), and the icon family `icon` / `icon-xs` /
`icon-sm` / `icon-lg` / `icon-titlebar`.

**Tooltips only when hover teaches something new.** `<Tip>` is for discovery,
not a tax on every icon. Ask: does hover reveal something the user cannot
already see or infer? If not, skip the tip; keep an `aria-label` for a11y.

Tip unlabeled chrome when the job (or a keybind / truncated path / host /
other detail) is not already on screen — toolbar / titlebar / statusbar icons,
`TipKeybindLabel` shortcuts, ownership chips, unlabeled icon grids.

Do **not** tip:

- Menu triggers (kebabs / ⋯ / `ActionsMenu` / `DropdownMenuTrigger`) — the
  affordance is "open menu"; verbs live in the menu. Never tip
  `"Actions for ${row title}"` / `"Project actions"` / `"Actions"`.
- Close / dismiss X buttons — the glyph is the label (`aria-label` only).
- Controls whose visible label already says what the tip would ("click to…",
  paraphrases of the same words, timer labels restating "Running").

Never use native HTML `title=` on buttons — unstyled, ~500ms OS delay, clashes
with the themed `Tip`. `src/components/ui/__tests__/no-native-title.test.ts`
fails on any `<button>` / `<Button>` that still carries `title=`.

**Tooltip timing.** A hover is not a click — the cursor crosses triggers on
the way somewhere else. `Tip` waits 200ms before the first open so a sweep
does not flash a trail. After a tip has opened the page is warm: the next
trigger within 300ms opens instantly. The cooldown starts on close, so a
hover a second later waits again. Close is immediate. `OverflowTip` stays
on its own longer delay (list titles must not trail while scanning).

**Slash descriptions.** Keep autocomplete rows single-line and ellipsized, but reveal the complete catalog description in the shared themed tooltip when hovering anywhere on a slash row. Size that tooltip to the window with collision padding and word wrapping; it must not intercept row selection. Catalog and completion producers preserve the full author-supplied description.

**Model search.** Model filters and their highlighted labels treat hyphens, dots, underscores and spaces equivalently. Preserve original label spelling inside marks. The shared highlighter remains literal for other surfaces such as the command palette; model callers explicitly opt in. Model identifier search does not use dictionary spellcheck.

**Keybind hints in tooltips.** On a tipped button bound to a rebindable hotkey,
use `<TipKeybindLabel actionId="..." />` — it reads the i18n label and the
current combo from `$bindings`. Pass `text={...}` only when the label is
context-dependent (e.g. "Show" / "Hide"). Never hardcode combos; always use
`useKeybindHint` or `TipKeybindLabel`.

Notes:
- Text buttons are square (no radius) and sized by padding + line-height (no
  fixed heights). Only icon buttons carry the shared 4px radius.
- SVGs inherit `size-3.5` (`size-3` at `xs`). Don't re-set icon size.
- Polymorph with `asChild` when the button must render as a link/Slot.

## Badges — one component

`src/components/ui/badge.tsx`. Variants: `default` (tinted primary), `muted`,
`warn`, `destructive`, `outline`, `solid` (primary fill — icon-corner counts).
Sizes: `default`, `xs`, `overlay` (titlebar glyph counts).

## Form controls

- **`controlVariants`** (`src/components/ui/control.ts`) is the shared shape for
  `Input` / `Textarea` / `SelectTrigger`. New text-entry controls compose it.
- **`SearchField`** — borderless, underline-on-focus, auto-width. The only
  search input. Don't build boxed search bars; don't wrap it in a bordered tile.
  Empty lists hide their search field.
- **`SegmentedControl`** — the choice control for small mutually-exclusive sets
  (color mode, tool-call display, usage period). Replaces radio piles and
  pill rows.
- **`Switch`** (`size="xs"`) — bare, with `aria-label`. No bordered text wrapper.

## Layout

- **Gutters:** `PAGE_INSET_X` (`src/app/layout-constants.ts`) for page side
  padding; `PAGE_INSET_NEG_X` to bleed a child to the edge. Don't hardcode
  `px-6`/`px-8` on pages.
- **Master/detail overlays:** `OverlaySplitLayout` + `OverlaySidebar` /
  `OverlayMain`. Cron, profiles, etc. ride this — don't rebuild a titlebar
  shell.
- **Rows:** `ListRow` (settings `primitives.tsx`) for label/description/action
  rows. Flat, flush-left; no per-row indentation that fights flush headers.
- **No dividers between rows** unless the list genuinely needs them; prefer
  spacing. When you do need one, it's a single `--ui-stroke-tertiary` hairline.

## Feedback & empty/error/loading states

- **Loading:** `Loader` (`src/components/ui/loader.tsx`) — animated math/ascii
  curves (`lemniscate-bloom` for long ops). Never ship the literal text
  "Loading…".
- **Errors:** `ErrorState` + the canonical `ErrorIcon` (no bg chip). One look
  for the React boundary, in-dialog errors, and the boot-failure banner. Pass
  nodes for title/description so Radix `DialogTitle`/`Description` can flow
  through for a11y.
- **Logs:** `LogView` — no bg, hairline border, tight padding, small mono.
  Every place we surface raw logs uses it.
- **Empty:** `EmptyState` for plain page bodies; `PanelEmpty` for overlay
  master/detail empties with an icon and action. Don't hand-roll a third
  centered empty.
- **Confirmation:** `ConfirmDialog` is the only way we ask "are you sure". It
  opens focused on Confirm, so `Enter` confirms and `Esc` cancels, and it owns
  the pending → done → close beat and the inline error — a call site passes an
  async `onConfirm` and nothing else. A third way out (e.g. "Remove from
  sidebar" beside "Delete worktree") goes in the one `secondaryAction` slot.
  Never `window.confirm`: it's an unstyled blocking Chromium modal. A handler
  that wants the answer inline instead of a mounted dialog calls `confirm()`
  from `src/store/confirm.ts`, which renders this same primitive through the
  single `ConfirmHost` at the shell — the way `notify()` backs notifications.

## Chat, tools & boot surfaces

- The transcript and composer are built on `@assistant-ui/react`. Extend the
  existing components under `src/components/assistant-ui` and
  `src/app/chat/composer`; do not fork a second markdown, message, tool-call, or
  approval renderer for one feature.
- **Inline widgets** — a tool result that renders as a panel the user reads or
  acts on (clarify, artifact card) wears `WIDGET_SHELL_CLASS`
  (`src/components/chat/widget-shell.ts`): shared radius, the
  `--ui-widget-surface-background` fill, no border. Its actions sit *outside*
  the panel, below it. Don't give one widget its own radius or fill.
- Bordered surfaces in the transcript (tables, fences, callouts, attachments)
  use `--ui-stroke-tertiary`. Not `border-border` — that's the app-wide
  default and reads too hot against the thread.
- Interactive directive chips in the composer expose their action on hover.
  The action stays visible for a 500ms grace period while the pointer crosses
  from the chip to the floating pill; leaving both dismisses it.
- A tool result may expose an inline action that opens a preview. It must not
  open the rail automatically.
- Conversation and tool summaries remain expandable while work is running.
  Preserve the user's open state as new activity arrives and the turn finishes.
  Task updates keep a readable receipt in history after the progress panel clears.
- **A worker roster answers two different questions, and must not confuse them.**
  An instruction sent *into* a subagent is recorded on its stream as a `steer`
  entry and drawn distinctly (steering-wheel glyph, `--ui-purple`, full text
  weight) so it never reads as output the worker produced. Anything answering
  "what is this worker doing" reads through `lastWorkerActivity`
  (`src/store/subagents.ts`), which skips those entries, and `updatedAt` tracks
  the child only: operator input is not worker activity. A live child's own
  conversation opens as a spectator window (`openSessionInNewWindow(id, { watch:
  true })`), never through the generic `openSession` navigation: a running
  worker is someone else's session to mirror, not yours to adopt.
- Install, onboarding, connecting, boot failure, and reauthentication are
  distinct states with shared visual primitives. Preserve their recovery
  semantics when unifying appearance.
- Respect `AppShell` overlay ownership. Persistent terminal/content layers,
  route overlays, dialogs, and boot surfaces must not compete through ad-hoc
  z-index literals. Pick a rung of the ladder in `styles.css` instead —
  `--z-modal-backdrop` / `--z-modal` / `--z-modal-popover`, `--z-over-modal`
  (toasts, tooltips, command surfaces) and `--z-over-modal-content`,
  `--z-switcher-backdrop` / `--z-switcher`, then the boot chain
  `--z-connecting` → `--z-onboarding` → `--z-setup` → `--z-crash`. Plain
  `z-10`/`z-20` are still right for stacking *within* one component.

## Iconography & brand

- **Tabler** is the default component/chrome set. Import its curated aliases and
  `iconSize` scale from `src/lib/icons.ts`; do not import icon packages directly
  in feature code.
- **`Codicon`** is the compact editor/tool/status vocabulary. Use
  `src/components/ui/codicon.tsx`, including `codiconIcon()` where a
  Tabler-shaped component is required.
- Pick the vocabulary by semantic context and reuse the existing icon for an
  action. Do not introduce a third icon set or mix styles within one control
  group.
- **`BrandMark`** (`src/components/brand-mark.tsx`) is the brand glyph — the
  `nous-girl` mark on a white tile, softly rounded, identical in light/dark.
  It replaced scattered Sparkles glyphs in updates / onboarding / about. Use it
  for hero/brand moments; don't reintroduce decorative star/sparkle icons.

## Motion

- Quick, functional transitions (~100ms on controls). Respect
  `prefers-reduced-motion` for anything beyond a fade.
- Choreographed exits (e.g. onboarding's "matrix" fade-down) stagger per-element
  then settle the surface — the outer container's fade is *delayed* so it
  doesn't swallow the inner animation. Don't let a global fade race the detail.
- Motion follows state; it never delays state. Selection, drag targets, cancel,
  and pressed feedback paint in the current frame.
- Do not animate layout geometry with `transition-all` on a hot interaction.
  Name the properties, avoid backdrop-filter repaints during movement, and
  remove animation before masking a performance problem.

## Direct manipulation & performance

The app should feel instant under real load — long transcripts, several panes,
live streams. Design toward that:

- Direct manipulation paints first; persistence reconciles after and rolls back
  visibly on failure.
- Keep interaction feedback cheap: hot-path state stays local or narrowly
  derived, not wired into heavy trees; pointer work coalesces per frame.
- One drop region has one visual owner, and drop targets speak one affordance
  language across files, sessions, tabs, and panes. Overlapping targets resolve
  to the active one instead of stacking overlays.
- Forgiving geometry beats pixel-perfect triggers; edge actions live near their
  edge, not clustered in the center.
- Expensive stateful surfaces stay mounted when hidden. Visibility is not
  lifecycle.

Prove speed with realistic content. A fast empty-state demo says nothing about a
long transcript or a busy terminal.

## Keyboard & cancellation

- Keyboard ownership follows focus. The focused surface wins its keys; shell
  shortcuts must not steal a terminal's or editor's bindings.
- Register global shortcuts through the shared layer, not ad-hoc listeners.
- One cancel gesture does one thing: cancel the active interaction, or close the
  topmost dismissable surface — never both, never the control underneath.
- Cancellation is synchronous in the UI even if cleanup is async: overlays,
  cursors, and pending gesture state clear at once.
- Flows that deliberately cannot be dismissed (install/onboarding, destructive
  confirmation) must make that explicit.

## i18n

- Every user-facing string goes through `useI18n()` (`src/i18n/context.tsx`).
  No literals in JSX.
- **Update all locales together** — `en`, `ja`, `zh`, `zh-hant`. A string change
  in `en.ts` that skips the others is a regression (drifted punctuation,
  stale labels). Keep trailing-punctuation and tone consistent across all four.

## State (TypeScript)

The detailed state contract lives in the scoped
[`AGENTS.md`](./AGENTS.md). Visual code follows these essentials:

- Shared/cross-component state → small **nanostores**, not prop-drilling.
  Each feature owns its atoms; shared atoms live in `src/store`.
- Rendering components subscribe with `useStore`; non-render actions read with
  `$atom.get()`.
- Subscribe to derived coarse facts instead of high-frequency source atoms when
  the component does not render the full value.
- Colocated action modules over god hooks. A hook owns one narrow job.
- Keep persistence beside the atom that owns it. Route roots stay thin.
- Prefer `interface` for public props; extend React primitives
  (`React.ComponentProps<'button'>`, `Omit<…>`).

## Affordances

- `cursor-pointer` at the primitive level (Button, dropdown/select) — don't
  hardcode it per call site.
- Global focus-ring reset; titlebar actions have no active-background state.
- `Esc` closes every dismissable overlay/dialog (install/onboarding excluded);
  close is an x-icon, not the word "Close".

## Before you add something — checklist

- [ ] Reuse a primitive (`Button`, `SearchField`, `SegmentedControl`,
      `ListRow`, `Loader`, `ErrorState`, `LogView`, `ConfirmDialog`) instead of
      forking one?
- [ ] Tokens (`--ui-*`, `shadow-nous`, `--stroke-nous`) — zero raw colors /
      one-off shadows?
- [ ] No `className` overriding a primitive's padding / size / radius / chrome?
- [ ] Tips only where hover teaches something new (no kebab / menu-trigger
      tips; unlabeled chrome that needs discovery gets `<Tip>` + `aria-label`)?
- [ ] No native `title=` on buttons?
- [ ] Keybind hints on tipped buttons use `useKeybindHint` / `TipKeybindLabel`?
- [ ] Overlay uses `shadow-nous` + `border-(--stroke-nous)`, no hard border?
- [ ] Flat — no card-in-card, no gratuitous row dividers?
- [ ] No automatic navigation, focus steal, or pane opening from background
      events?
- [ ] Direct manipulation paints immediately and rolls back cleanly on failure?
- [ ] Hot interactions avoid broad subscriptions, layout thrash, and
      `transition-all`?
- [ ] Keyboard ownership and single-action `Esc` behavior are correct?
- [ ] All four locales updated for any new/changed string?
- [ ] `cursor-pointer`, focus ring, and `Esc`-to-close behave?
- [ ] Touched a primitive, token, or variant? Its named-contract entry in this
      file is updated in the same change.

### Project source folders

Project actions expose Edit project, with a single draft for the name and source
folders. Changing a folder path reconnects saved task workspace metadata after an
external move; it does not move files. The first folder is primary, with an explicit
control to promote another folder. Add and remove stay local until Save. Cancel
writes nothing, and a failed save keeps the draft visible with an inline error.
At least one unique source folder is required. Running tasks prevent relocation
of their workspace until they finish. Removing a source only removes its project
membership; it never deletes files or conversation history.

Project health is loaded with the profile-scoped project list and refreshed when
opening Edit project. An unavailable source has a visible warning and recovery
control. Nearby verified candidates are suggestions, never automatic relocations.
Selecting a candidate updates the draft; only Save changes workspace metadata.

### Live task progress evidence

A running turn keeps a compact progress receipt outside folded history. It shows
recorded file edits, explicitly successful checks, the active todo, reported
errors and repeated actions. A subsequent edit makes the previous check stale.
Starting a background command is not a successful check. Shell commands that
mask failures and echoed test names do not earn success indicators. The receipt
is presentation of tool evidence, not an assertion that the whole task is done.

### Durable result files

The Artifacts page follows the active connection and profile, states that scope
in its filter row, and offers project filtering. It paints the persisted result
index before indexing further transcript batches. Search and filtering never
require reopening a conversation. Partial indexing failures keep existing rows
visible and show an inline error with the refresh action still available.

Saved versions live in a Dialog reached from a file row or image card. Capture
is explicit and records the file at that moment, up to 25 MiB. Each version has
its own review state. Opening a saved version uses its immutable snapshot path,
not the source file. Source-task navigation carries the owning profile and
connection. Switching owners unmounts the result view and cancels publication
of pending responses from the previous owner.

Substantial, complete HTML/SVG/code fences also enter the durable result shelf.
Their versions preserve the actual message content automatically, so their
version dialog explains the message origin and does not offer another capture.
Recent reported file results populate first during an initial historical index;
inline versions follow message order so numbering preserves their chronology.

The version dialog names the selected preview version. Snapshot previews verify
content hashes in the owning backend and reuse the existing artifact sandbox and
source viewer. Text previews are bounded to 512 KiB; image/PDF previews to 8 MiB.
Unsupported types and larger files retain the saved-file open action. A snapshot
captures one file's bytes, not a website's linked assets or external resources.

### Project brief and cited references

Artifacts exposes the selected project's brief and references in a dialog. The
brief edits the existing project description. Source folder health, extraction
coverage and approved result links provide context without synthesizing claims.
Reference refresh is explicit and bounded. Search cites saved source text with
PDF pages, Word paragraphs/comments or text lines and a source version hash.
Historical versions are opt-in and distinguishable from the current indexed
version. Only current sources expose the source-file open action; old citations
remain readable and copyable. Profile or connection changes close the scoped
dialog, and failed requests retain editable content with a retry path.

### Project workflow drafts

Explicit project menus offer four task templates: focused UI change, client
delivery, cited research and on-demand weekly review. The dialog collects the
requested outcome and task approach, then opens a reviewable composer draft.
Quick/standard/thorough guide scope and verification; they do not change model
settings or impose an execution timer. Existing installed skill commands expand
only on normal submission. Missing skills are explicit in the draft.
Draft text is seeded on the newly created durable session before its tile
mounts, never broadcast into the previous conversation. Profile/connection
switches discard pending workflow responses. No workflow auto-sends a prompt,
publishes a delivery, approves a result or schedules a recurring task.
