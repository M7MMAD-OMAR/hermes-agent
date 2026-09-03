import { describe, expect, it, vi } from 'vitest'

import { flushAnnotateStack } from './flush'
import { compactIdentity } from './identity'
import { annotateFlushPrompt, packageAnnotatePin, packageAnnotateStack } from './pack'
import { addAnnotatePin, type AnnotatePin, emptyAnnotateStack } from './stack'
import { ANNOTATE_HTML_BUDGET } from './tokens'

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
      html: '<button class="plan">Select plan</button>',
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
  it('carries the selector, markup, and computed styles the agent needs to find the source', () => {
    const packed = packageAnnotatePin(pin())

    expect(packed.prompt).toContain('Selector: button.plan')
    expect(packed.prompt).toContain('HTML: <button class="plan">Select plan</button>')
    expect(packed.prompt).toContain('color: rgb(24, 24, 24)')
    expect(packed.prompt).toContain('font-size: 14px')
  })

  it('keeps the target line prose while the DOM detail rides its own labelled lines', () => {
    const text = 'גם בקיבוץ חולית הקטן יש ילד שעושה את הצעד הראשון במערכת החינוך'

    const packed = packageAnnotatePin(
      pin({
        identity: {
          css: { color: 'rgb(0, 0, 0)', 'font-family': 'Moses, NarkisBlock', 'font-size': '18px' },
          html: '<div class="text_editor_paragraph rtl">…</div>',
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
    const target = packed.prompt.split('\n').find(line => line.startsWith('Target:'))

    expect(target).toBe(`Target: "${text}"`)
    expect(target).not.toContain('div')
    expect(target).not.toContain('DraftEditor')
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
    expect(packed.prompt).not.toContain('<html')
  })

  it('does not repeat the selector when it is already the label', () => {
    const packed = packageAnnotatePin(
      pin({
        identity: {
          css: { display: 'block' },
          html: '<div id="sales-chart"></div>',
          selector: '#sales-chart',
          tag: 'div',
          text: ''
        },
        note: 'Use the same scale as the chart above.'
      })
    )

    expect(packed.prompt).toContain('Target: #sales-chart')
    expect(packed.prompt).toContain('display: block')
    expect(packed.prompt).toContain('Selector: #sales-chart')
  })

  it('invents no element detail for an area pin', () => {
    const packed = packageAnnotatePin(pin({ identity: undefined, kind: 'area', note: 'too tight' }))

    expect(packed.prompt).toContain('area')
    expect(packed.prompt).toContain('120×40px at 8,8')
    expect(packed.prompt).toContain('too tight')
    expect(packed.prompt).not.toContain('Selector:')
    expect(packed.prompt).not.toContain('HTML:')
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

  it('clips markup to the budget rather than pasting a whole section', () => {
    const compact = compactIdentity({
      css: {},
      html: `<section>${'<p>filler</p>'.repeat(400)}</section>`,
      selector: 'section',
      tag: 'section',
      text: ''
    })

    expect(compact.html.length).toBeLessThanOrEqual(ANNOTATE_HTML_BUDGET)
    expect(compact.html.startsWith('<section>')).toBe(true)
    expect(compact.html.endsWith('…')).toBe(true)
  })

  it('tolerates a snapshot with no markup', () => {
    expect(compactIdentity({ css: {}, selector: 'div', tag: 'div', text: '' }).html).toBe('')
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

describe('annotateFlushPrompt batching', () => {
  function at(number: number, selector: string): AnnotatePin {
    return pin({
      id: `annotate-${number}`,
      number,
      identity: { css: {}, html: '', selector, tag: 'div', text: '' }
    })
  }

  const batch = packageAnnotateStack([
    at(1, 'body>main>section.hero>h1'),
    at(2, 'body>main>section.hero>p'),
    at(3, 'body>main>section.pricing>button'),
    at(4, 'body>main>section.pricing>span'),
    at(5, 'body>main>section.faq>li')
  ])

  it('heads each region so a long batch is fewer pieces of work than comments', () => {
    const prompt = annotateFlushPrompt(batch, 'http://localhost:5173/')

    expect(prompt).toContain('Group 1 — `section.hero` (2 comments)')
    expect(prompt).toContain('Group 2 — `section.pricing` (2 comments)')
    expect(prompt).toContain('Group 3 — `section.faq` (1 comment)')
    expect(prompt).toContain('Work them as 3 pieces of work, not 5.')
  })

  it('warns against the theme split that would put workers in the same files', () => {
    const prompt = annotateFlushPrompt(batch)

    expect(prompt).toContain('delegate whole groups')
    expect(prompt).toContain('never form new groups by theme')
    expect(prompt).toContain('Regroup if the code disagrees')
  })

  it('still lists every comment exactly once', () => {
    const prompt = annotateFlushPrompt(batch)

    for (const item of batch) {
      expect(prompt.split(`Comment ${item.number}\n`)).toHaveLength(2)
    }
  })

  it('leaves a short batch flat — grouping two comments is noise', () => {
    const prompt = annotateFlushPrompt(batch.slice(0, 2))

    expect(prompt).not.toContain('Group 1')
    expect(prompt).not.toContain('pieces of work')
  })

  it('leaves a batch flat when every comment is in one region', () => {
    const prompt = annotateFlushPrompt(
      packageAnnotateStack([
        at(1, 'body>div.card>h1'),
        at(2, 'body>div.card>p'),
        at(3, 'body>div.card>a'),
        at(4, 'body>div.card>span')
      ])
    )

    expect(prompt).not.toContain('Group 1')
  })

  it('gives dragged areas their own section instead of a guessed region', () => {
    const prompt = annotateFlushPrompt(
      packageAnnotateStack([
        at(1, 'body>main>section.hero>h1'),
        at(2, 'body>main>section.pricing>button'),
        pin({ id: 'annotate-3', identity: undefined, kind: 'area', number: 3 }),
        at(4, 'body>main>section.faq>li')
      ])
    )

    expect(prompt).toContain('Unanchored (dragged areas) (1 comment)')
  })
})
