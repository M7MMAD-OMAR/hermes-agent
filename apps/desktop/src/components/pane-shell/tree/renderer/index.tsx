/**
 * Layout tree renderer (root).
 *
 * - `split` -> flex row/column; 1px seams between siblings double as resize
 *   sashes (the seam IS the boundary — junction-owned, never doubled). See
 *   tree-split.tsx.
 * - `group` -> a ZONE: header strip (tabs when stacked, minimize chevron) +
 *   the active pane's content, resolved from the contribution registry
 *   (`area: 'panes'`). Empty zones exist only in editor-authored trees. See
 *   tree-group.tsx.
 *
 * Dragging is FancyZones-style (drag-session.ts): the LAYOUT STAYS FIXED and
 * every zone lights up as a whole-region drop target; dropping moves the pane
 * into that zone (joining its tab stack). Structure changes (splitting/merging/
 * resizing zones) belong to the zone editor, not the drag.
 *
 * This file owns only the composition: the recursive tree, the narrow-viewport
 * overlays, the edit palette, and the zone editor. The pieces live in sibling
 * modules — track-model (sizing), drag-session (drag), tree-split / tree-group
 * (nodes), layout-picker + edit-bar (edit mode), narrow-overlays.
 */

import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect } from 'react'

import { useLayoutEditHotkey } from '../../edit-mode'
import { publishWorkspaceGeometry } from '../../geometry'
import { $layoutTree, trackActiveTreeGroup } from '../store'
import { useTabKeyHints } from '../tab-key-hint-state'
import { ZoneEditor } from '../zone-editor'

import { TreeEditBar } from './edit-bar'
import { FloatingPanes } from './floating-panes'
import { KeepAlivePanes } from './keep-alive-panes'
import { NarrowOverlays } from './narrow-overlays'
import { TreeNode } from './tree-node'

export function LayoutTreeRoot({ children, titlebar = false }: { children?: ReactNode; titlebar?: boolean }) {
  const tree = useStore($layoutTree)

  useLayoutEditHotkey(true)
  useTabKeyHints()
  // Track the interacted zone so ⌘W closes the right tab even when nothing is
  // DOM-focused.
  useEffect(trackActiveTreeGroup, [])
  // Publish --workspace-left/right so chrome (titlebar title) aligns to the
  // main pane's geometry in plain CSS.
  useEffect(publishWorkspaceGeometry, [])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 bg-(--ui-shell-ground)">
      {/* THE SEAM INVARIANT: boundaries are drawn by the tree (one sash
          hairline per seam) — content mounted in a zone must not paint its
          own edge chrome. App components (asides, the shadcn sidebar) carry
          edge borders + inset highlights for the OLD shell's geometry; this
          neutralizes all of them at the zone boundary, for every current and
          future pane, instead of per-pane class surgery. */}
      <style>{`
        [data-tree-group] :is(aside, [data-slot=sidebar]) {
          /* All four sides, not just the two the old hairline shell cared
             about: the zone card owns the closed border now, and a surviving
             top or bottom edge on the pane inside it is a half-border sitting
             a pixel in from a rounded corner. */
          border-width: 0;
          box-shadow: none;
        }
        /* ONE FILL PER ZONE: the zone card paints the surface, so anything
           mounted inside it that used to paint its own (the sidebar's rail
           fill, a pane's aside) goes transparent. Two fills stacked is how a
           rail ends up a different shade than its neighbour for no reason the
           design can explain. */
        [data-tree-group] :is(aside, [data-slot=sidebar], [data-slot=sidebar-inner]) {
          background: transparent;
        }
        /* Nothing inside a zone repeats the zone's own rounding at its edges:
           a second radius inside the first reads as a card inside a card. */
        [data-tree-group] > :is(aside, [data-slot=sidebar]) {
          border-radius: 0;
        }
        /* Old-shell titlebar BANDS (chat's session header et al size to
           --titlebar-height, which is 0 inside zones): a zero-height band is
           non-functional but still paints its border-b — a stray hairline
           doubling the zone's top seam. Remove the band entirely. */
        [data-tree-group] header[class*="h-(--titlebar-height)"] {
          display: none;
        }
      `}</style>
      <KeepAlivePanes>
        {/* THE GROUND FRAME. One seam of ground all the way around the set, so
            every zone is a card with four corners instead of a region fenced off
            at three of them. It is a wrapper rather than padding on the root
            because the narrow-viewport edge overlays position against the root
            and have to hug the WINDOW edge, not this inset. */}
        {tree && (
          <div className="relative flex min-h-0 min-w-0 flex-1 p-(--pane-seam)">
            <TreeNode
              leftEdge={titlebar}
              node={tree}
              rightEdge={titlebar}
              root
              rootRow={tree.type === 'split' && tree.orientation === 'row'}
              topEdge={titlebar}
            />
          </div>
        )}
        {tree && <NarrowOverlays />}
      </KeepAlivePanes>
      {/* The strip of ground above the top row would otherwise be the one band
          of the titlebar you cannot grab. Its own element, not app-region on
          the frame: that property inherits, and a draggable ancestor would
          make every control below it undraggable-by-default instead. */}
      {titlebar && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-(--pane-seam) [-webkit-app-region:drag]" />
      )}
      {tree && (
        <>
          {/* Non-tiling panes: fixed cards above the tree, outside every zone. */}
          <FloatingPanes />
          <TreeEditBar />
          <ZoneEditor />
          {children}
        </>
      )}
    </div>
  )
}
