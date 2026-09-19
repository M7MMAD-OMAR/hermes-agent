import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PaneTab, PaneTabLabel, PaneTabStrip } from './pane-tab'

afterEach(cleanup)

describe('pane tabs never see through each other', () => {
  it('paints every tab with its own fill and hands that fill to the close runway', () => {
    render(
      <PaneTabStrip>
        <PaneTab active>
          <PaneTabLabel>Sessions</PaneTabLabel>
        </PaneTab>
        <PaneTab>
          <PaneTabLabel>Bots</PaneTabLabel>
        </PaneTab>
      </PaneTabStrip>
    )

    const tabs = [...document.querySelectorAll<HTMLElement>('[data-slot="pane-tab"]')]

    expect(tabs).toHaveLength(2)

    for (const tab of tabs) {
      // The fill is what stops one tab's label being read over its neighbour.
      expect(tab.className).toContain('bg-(--tab-bg)')
      // The close-button runway fades into the tab's own fill, so it masks.
      expect(tab.className).toContain('[--tab-face:var(--tab-bg)]')
    }
  })

  it('does not force the strip to make its tabs transparent', () => {
    const { container } = render(
      <PaneTabStrip>
        <PaneTab>
          <PaneTabLabel>Sessions</PaneTabLabel>
        </PaneTab>
      </PaneTabStrip>
    )

    const strip = container.querySelector<HTMLElement>('.group\\/pane-header')!

    // A transparent --tab-bg is exactly how tabs started overlapping: the zone
    // publishes a real fill, and the strip must not override it to nothing.
    expect(strip.className).not.toContain('--pane-tab-strip-bg:transparent')
    expect(strip.className).not.toContain('--pane-tab-active-bg:transparent')
  })

  it('separates tabs with the shell seam instead of a rule', () => {
    const { container } = render(
      <PaneTabStrip>
        <PaneTab>
          <PaneTabLabel>Sessions</PaneTabLabel>
        </PaneTab>
      </PaneTabStrip>
    )

    const list = container.querySelector<HTMLElement>('[role="tablist"]')!

    expect(list.className).toContain('gap-(--pane-seam)')
    expect(container.innerHTML).not.toContain('border-s-(--ui-stroke-quaternary)')
  })
})
