/**
 * The Word viewer's one load-bearing assumption: that the renderer honours the
 * document's own writing direction.
 *
 * The generator this app ships writes `w:bidi` on paragraphs and `w:rtl` on
 * runs for Arabic, Hebrew, Persian and Urdu. A viewer that ignored those would
 * render every one of those documents worse than the PDF it replaced, so the
 * check lives here rather than in a reviewer's memory.
 */

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

function documentXml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>`
}

function docxBytes(body: string) {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(documentXml(body))
  })
}

async function renderDocx(body: string) {
  const { renderAsync } = await import('docx-preview')
  const content = document.createElement('div')
  const styles = document.createElement('div')

  document.body.append(styles, content)

  await renderAsync(docxBytes(body), content, styles, {
    breakPages: true,
    className: 'hermes-docx',
    experimental: true,
    inWrapper: true
  })

  return content
}

describe('the Word viewer', () => {
  it('renders an Arabic paragraph right to left', async () => {
    const content = await renderDocx(
      `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>مرحبا بالعالم</w:t></w:r></w:p>`
    )

    expect(content.textContent).toContain('مرحبا بالعالم')

    const paragraph = content.querySelector('p')

    expect(paragraph).toBeTruthy()
    expect(paragraph!.style.direction).toBe('rtl')
  })

  it('leaves a document with no direction set reading left to right', async () => {
    const content = await renderDocx(`<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>`)
    const paragraph = content.querySelector('p')

    expect(content.textContent).toContain('Hello world')
    expect(paragraph!.style.direction).not.toBe('rtl')
  })

  it('renders a table right to left when the document says so', async () => {
    const content = await renderDocx(
      `<w:tbl><w:tblPr><w:bidiVisual/></w:tblPr><w:tr><w:tc><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>الأول</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    )

    const table = content.querySelector('table')

    expect(table).toBeTruthy()
    expect(content.textContent).toContain('الأول')
    expect(table!.querySelector('p')!.style.direction).toBe('rtl')
  })

  it('lays the document out on page-sized sheets', async () => {
    const content = await renderDocx(`<w:p><w:r><w:t>Page one</w:t></w:r></w:p>`)
    // The wrapper's class is the `className` option, so the section carries it.
    const section = content.querySelector('section.hermes-docx') as HTMLElement | null

    expect(section).toBeTruthy()
    // 12240 twips is 8.5in, which docx-preview writes as 612pt.
    expect(section!.style.width).toBe('612pt')
  })
})
