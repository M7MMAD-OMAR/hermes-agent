import { StrictMode, memo } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown'

// Mirrors the app's components map (markdown-text.tsx) — inline arrows over a
// memoized map — with invocation counters on the leaves.
let paragraphRuns = 0
let strongRuns = 0
let blockRuns = 0

const ProbeBlock = memo(
  function ProbeBlock(props: Record<string, unknown>) {
    blockRuns += 1
    return null
  },
  // The same compare streamdown's own Block uses (content/index/components/
  // plugins), reduced to what the probe passes:
  (a, b) => a.content === b.content && a.index === b.index && a.components === b.components
)

function buildText(paras: number): string {
  const out: string[] = []

  for (let i = 0; i < paras; i += 1) {
    out.push(`Paragraph ${i} with **bold** and ` + 'some shared filler text. '.repeat(4))
  }

  return out.join('\n\n')
}

describe('scratch: streamdown block memo behavior on tail-only change', () => {
  it('counts leaf/block invocations when only the tail grows', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root: Root | null = null

    const components = {
      p: (props: Record<string, unknown>) => {
        paragraphRuns += 1

        return <p>{props.children as React.ReactNode}</p>
      },
      strong: (props: Record<string, unknown>) => {
        strongRuns += 1

        return <strong>{props.children as React.ReactNode}</strong>
      }
    }

    const render = (text: string) => {
      act(() => {
        root = root ?? createRoot(container)
        root.render(
          <StrictMode>
            <StreamdownTextPrimitive
              BlockComponent={ProbeBlock}
              components={components}
              mode="streaming"
              parseIncompleteMarkdown={false}
              parseMarkdownIntoBlocksFn={(t: string) => t.split(/\n\n/)}
            >
              {text}
            </StreamdownTextPrimitive>
          </StrictMode>
        )
      })
    }

    // Initial: 10 paragraphs.
    const base = buildText(10)
    render(base)

    // Tail-only growth: append to the last paragraph (what a delta does).
    let grown = base
    for (let delta = 0; delta < 10; delta += 1) {
      grown += ` token${delta}`
      render(grown)
    }

    // eslint-disable-next-line no-console
    console.log(
      `blocks=${blockRuns} paragraphs=${paragraphRuns} strong=${strongRuns} (10 tail deltas over a 10-paragraph body)`
    )

    expect(blockRuns).toBeGreaterThan(0)
    root?.unmount()
    container.remove()
  })
})
