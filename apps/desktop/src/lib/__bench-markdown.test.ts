import { describe, expect, it } from 'vitest'

import { preprocessMarkdown } from '@/lib/markdown-preprocess'
import { parseMarkdownIntoBlocksCached } from '@/lib/markdown-blocks'
import { tailBoundedRemend } from '@assistant-ui/react-streamdown'

function buildText(chars: number): string {
  const para =
    '## Finding\n\nThe handler swallows the rejection and the retry loop is unbounded.\n\n- The catch block drops the error.\n- Retries are unbounded, see `retry.ts`.\n\n```ts\nexport function retry(fn: () => Promise<void>): void {\n  while (true) {\n    void fn().catch(() => {})\n  }\n}\n```\n\nRead [the report](/home/user/report.md) and check https://example.com/docs for more.\n\n'

  let out = ''
  while (out.length < chars) {
    out += para
  }

  return out.slice(0, chars)
}

describe('scratch: per-flush markdown preprocess cost', () => {
  it('measures per-call cost at streaming sizes', () => {
    for (const size of [8_000, 30_000, 100_000]) {
      const text = buildText(size)
      // warm
      preprocessMarkdown(text)
      tailBoundedRemend(text)
      parseMarkdownIntoBlocksCached(text)

      const runs = 20
      const t0 = performance.now()
      for (let i = 0; i < runs; i += 1) {
        preprocessMarkdown(text)
      }
      const preprocessMs = (performance.now() - t0) / runs

      const t1 = performance.now()
      for (let i = 0; i < runs; i += 1) {
        tailBoundedRemend(text)
      }
      const remendMs = (performance.now() - t1) / runs

      const t2 = performance.now()
      for (let i = 0; i < runs; i += 1) {
        parseMarkdownIntoBlocksCached(text)
      }
      const parseMs = (performance.now() - t2) / runs

      // Full pipeline as the app runs it per flush:
      const t3 = performance.now()
      for (let i = 0; i < runs; i += 1) {
        parseMarkdownIntoBlocksCached(tailBoundedRemend(preprocessMarkdown(text)))
      }
      const pipelineMs = (performance.now() - t3) / runs

      // eslint-disable-next-line no-console
      console.log(
        `size=${size}B preprocess=${preprocessMs.toFixed(2)}ms remend=${remendMs.toFixed(2)}ms parse=${parseMs.toFixed(2)}ms pipeline=${pipelineMs.toFixed(2)}ms`
      )

      expect(pipelineMs).toBeGreaterThan(0)
    }
  })
})
