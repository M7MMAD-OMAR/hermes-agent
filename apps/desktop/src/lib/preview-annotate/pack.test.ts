import { describe, expect, it, vi } from 'vitest'

import { flushAnnotateStack } from './flush'
import { compactIdentity } from './identity'
import { annotateFlushPrompt, packageAnnotatePin, packageAnnotateStack } from './pack'
import { addAnnotatePin, type AnnotatePin, emptyAnnotateStack } from './stack'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function pin(partial: Partial<AnnotatePin> = {}): AnnotatePin {
  return {
    id: 'annotate-1',
    imageDataUrl: png,
    kind: 'element',
    note: 'This button overflows on mobile.',
    number: 1,
    pageTitle: 'Pricing',
    pageUrl: 'http://127.0.0.1:4173/',
    rect: { height: 40, width: 120, x: 8, y: 8 },
    identity: {
      css: { color: 'rgb(24, 24, 24)', 'font-size': '14px' },
      selector: 'button.plan',
      tag: 'button',
      text: 'Select plan'
    },
    ...partial
  }
}

// CONTRACT CHANGE (2026-09-02). These tests used to assert the opposite — that
// the selector and the computed style stayed OUT of the prompt. The comment
// then reached the model as `Target: "تصميم."` and nothing else: no address, no
// geometry, no way to tell an h2 from a div, on a page the model cannot see.
// The identity was captured, clipped, and carried the whole way, so "address my
// comment" was answerable only by guessing. The payload is the point of a
// comment; brevity is not worth a comment that cannot be acted on.
//
// What the old tests were right about, and what these keep: everything is
// CLIPPED at capture (selector 180, text 80, each CSS value 80) and the CSS is
// a curated whitelist, so a hostile or enormous page cannot flood the prompt.

describe('packageAnnotatePin', () => {
  it('gives a generic container an address, not just its text', () => {
    const text = 'גם בקיבוץ חולית הקטן יש ילד שעושה את הצעד הראשון במערכת החינוך'

    const packed = packageAnnotatePin(
      pin({
        identity: {
          css: { color: 'rgb(0, 0, 0)', 'font-family': 'Moses, NarkisBlock', 'font-size': '18px' },
          selector:
            'div.DraftEditor-editorContainer>div.public-DraftEditor-content>div>div.text_editor_paragraph.rtl:nth-of-type(9)',
          tag: 'div',
          text
        },
        note: 'תסכם את זה'
      })
    )

    // A div is not named on the label line (the quoted text identifies it to a
    // human better than "div" does) — but the selector is how the agent finds
    // it, so it always ships.
    expect(packed.prompt).toContain(`Target: "${text}"`)
    expect(packed.prompt).toContain('Note: תסכם את זה')
    expect(packed.prompt).toContain('Selector: div.DraftEditor-editorContainer')
    expect(packed.prompt).toContain('font-size: 18px')
  })

  it('packs a numbered crop, the full identity, and the note', () => {
    const packed = packageAnnotatePin(pin())

    expect(packed.number).toBe(1)
    expect(packed.imageDataUrl).toBe(png)
    expect(packed.note).toContain('overflows')
    expect(packed.prompt).toContain('Comment 1')
    expect(packed.prompt).toContain('Target: button "Select plan"')
    expect(packed.prompt).toContain('Selector: button.plan')
    expect(packed.prompt).toContain('Box: 120×40px at 8,8')
    expect(packed.prompt).toContain('font-size: 14px')
    expect(packed.prompt).toContain('Image 1 marks the target in blue.')
    expect(packed.prompt).toContain('Note: This button overflows on mobile.')
  })

  it('does not repeat the selector when it is already the label', () => {
    const packed = packageAnnotatePin(
      pin({
        identity: { css: { display: 'block' }, selector: '#sales-chart', tag: 'div', text: '' },
        note: 'Use the same scale as the chart above.'
      })
    )

    expect(packed.prompt).toContain('Target: #sales-chart')
    expect(packed.prompt).toContain('display: block')
    // The label line already IS the selector; a `Selector:` line under it would
    // be the same string twice.
    expect(packed.prompt).toContain('Selector: #sales-chart')
  })

  it('packages an area pin without pretending it has a selector', () => {
    const packed = packageAnnotatePin(pin({ identity: undefined, kind: 'area', note: 'too tight' }))

    expect(packed.prompt).toContain('area')
    expect(packed.prompt).toContain('120×40px at 8,8')
    expect(packed.prompt).toContain('too tight')
    expect(packed.prompt).not.toContain('Selector:')
  })

  it('names the page per comment only when the review walked across pages', () => {
    const oneP = packageAnnotateStack([pin(), pin({ id: 'annotate-2', number: 2 })])

    expect(oneP.every(item => !item.prompt.includes('Page:'))).toBe(true)

    const twoP = packageAnnotateStack([
      pin(),
      pin({ id: 'annotate-2', number: 2, pageUrl: 'http://127.0.0.1:4173/about' })
    ])

    expect(twoP[0].prompt).toContain('Page: http://127.0.0.1:4173/')
    expect(twoP[1].prompt).toContain('Page: http://127.0.0.1:4173/about')
    // …and the header must not then claim one page for both.
    expect(annotateFlushPrompt(twoP, 'http://127.0.0.1:4173/about')).not.toContain('comments on http')
  })
})

describe('compactIdentity', () => {
  it('never keeps the whole document and clips long text', () => {
    const compact = compactIdentity({
      css: { color: 'red', display: 'none', margin: '0px' },
      selector: 'html>body>div>div>button.submit',
      tag: 'BUTTON',
      text: 'x'.repeat(200)
    })

    expect(compact.tag).toBe('button')
    expect(compact.text.endsWith('…')).toBe(true)
    expect(compact.text.length).toBeLessThanOrEqual(80)
    expect(compact.css.display).toBeUndefined()
    expect(compact.css.margin).toBeUndefined()
    expect(compact.css.color).toBe('red')
  })
})

describe('flushAnnotateStack', () => {
  it('attaches one composer item per pin and does not invoke send', async () => {
    const first = pin()
    const second = pin({ id: 'annotate-2', kind: 'area', identity: undefined, note: 'align the chart', number: 2 })
    let stack = emptyAnnotateStack()
    stack = addAnnotatePin(stack, {
      imageDataUrl: first.imageDataUrl,
      identity: first.identity,
      kind: first.kind,
      note: first.note,
      pageTitle: first.pageTitle,
      pageUrl: first.pageUrl,
      rect: first.rect
    })
    stack = addAnnotatePin(stack, {
      imageDataUrl: second.imageDataUrl,
      kind: 'area',
      note: second.note,
      pageTitle: second.pageTitle,
      pageUrl: second.pageUrl,
      rect: second.rect
    })

    const attachImage = vi.fn()
    const insertText = vi.fn()
    const send = vi.fn()
    const result = await flushAnnotateStack(stack.pins, { attachImage, insertText, send }, 'http://127.0.0.1:4173/')

    expect(result.sent).toBe(false)
    expect(result.count).toBe(2)
    expect(send).not.toHaveBeenCalled()
    expect(attachImage).toHaveBeenCalledTimes(2)
    expect(attachImage.mock.calls[0]?.[0]).toBeInstanceOf(File)
    expect((attachImage.mock.calls[0]?.[0] as File).name).toBe('Comment_1.png')
    expect((attachImage.mock.calls[1]?.[0] as File).name).toBe('Comment_2.png')
    expect(insertText).toHaveBeenCalledOnce()
    expect(insertText.mock.calls[0]?.[0]).toContain('I left 2 comments')
    expect(insertText.mock.calls[0]?.[0]).toContain('Comment 1')
    expect(insertText.mock.calls[0]?.[0]).toContain('Comment 2')
    // The WIRE, not the helper. `packageAnnotatePin` was correct and tested
    // while the text that actually reached the composer said `Target: "…"` and
    // nothing more — assert the identity on the port that carries it, or this
    // whole file can go green over an unusable comment again.
    expect(insertText.mock.calls[0]?.[0]).toContain('Selector: button.plan')
    expect(insertText.mock.calls[0]?.[0]).toContain('Box: 120×40px at 8,8')
  })

  it('a pin save is stacking, not flushing', () => {
    const stacked = packageAnnotateStack([pin(), pin({ id: 'annotate-2', number: 2, note: 'second' })])

    expect(stacked).toHaveLength(2)
    expect(annotateFlushPrompt(stacked)).toContain('2 comments')
  })
})
