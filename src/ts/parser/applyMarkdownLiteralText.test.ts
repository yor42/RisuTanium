// @vitest-environment jsdom
/**
 * applyMarkdownToNode receives text that was already decoded from markup, so it
 * must render markdown without turning that text back into HTML: `<` and `&`
 * outside code and `$$` math stay literal, and a failed or attribute-borne `$$`
 * match never becomes an element.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const katexSpy = vi.hoisted(() => ({
  renderToString: vi.fn<(content: string) => string>(),
}))

vi.mock('katex', () => ({ default: katexSpy }))

vi.mock(import('../storage/database.svelte'), () =>
  ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
  } as typeof import('../storage/database.svelte'))
)

vi.mock(import('../globalApi.svelte'), () =>
  ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
  } as unknown as typeof import('../globalApi.svelte'))
)

vi.mock(import('../stores.svelte'), () =>
  ({
    DBState: { db: { characters: [], globalChatVariables: {}, templateDefaultVariables: '' } },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../stores.svelte'))
)

import { applyMarkdownToNode } from './parser.svelte'

const MATHML = '<math><mi>M</mi></math>'

beforeEach(() => {
  katexSpy.renderToString.mockReset()
  katexSpy.renderToString.mockImplementation(() => MATHML)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function render(text: string): HTMLElement {
  const doc = new DOMParser().parseFromString('<p></p>', 'text/html')
  const p = doc.body.querySelector('p')!
  p.appendChild(doc.createTextNode(text))
  applyMarkdownToNode(doc.body)
  return doc.body
}

describe('applyMarkdownToNode literal text', () => {
  // Reproducers: fail when the markdown pass parses the text as HTML.
  it('reproducer: keeps an entity-looking sequence as written', () => {
    expect(render('a &amp; b').textContent).toBe('a &amp; b\n')
  })

  it('reproducer: shows a raw tag as text, not an element', () => {
    const body = render('hi <img src=x onerror=alert(1)>')
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelectorAll('[onerror]').length).toBe(0)
    expect(body.textContent).toContain('hi <img src=x onerror=alert(1)>')
  })

  it('reproducer: shows inline bold tags as text', () => {
    const body = render('<b>hi</b>')
    expect(body.querySelector('b')).toBeNull()
    expect(body.textContent).toContain('<b>hi</b>')
  })

  it('reproducer: an escaped backtick does not open a code span that hides a tag', () => {
    const body = render('\\`<b>x</b>`')
    expect(body.querySelector('b')).toBeNull()
    expect(body.textContent).toContain('<b>x</b>')
  })

  it('reproducer: a failed KaTeX match stays text and creates no element', () => {
    katexSpy.renderToString.mockImplementation(() => { throw new Error('bad') })
    const body = render('$$ \\foo <img src=x onerror=1> $$')
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelectorAll('[onerror]').length).toBe(0)
    expect(body.textContent).toContain('$$ \\foo <img src=x onerror=1> $$')
  })

  it('reproducer: math inside an image alt or link title is escaped attribute text', () => {
    const body = render('![$$a$$](x) [a](y "$$a<b$$")')
    const img = body.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('$$a$$')
    expect(body.querySelector('math')).toBeNull()
    expect(body.querySelector('a')!.getAttribute('title')).toBe('$$a<b$$')
    expect(body.querySelectorAll('img').length).toBe(1)
  })

  // Guards: pass before and after.
  it('guard: bold and italic still render', () => {
    const body = render('**x** and *y*')
    expect(body.querySelector('strong')!.textContent).toBe('x')
    expect(body.querySelector('em')!.textContent).toBe('y')
  })

  it('guard: single line breaks become br', () => {
    expect(render('a\nb').querySelectorAll('br').length).toBe(1)
  })

  it('guard: code spans and fences display as written', () => {
    expect(render('`<b>x</b>`').querySelector('b')).toBeNull()
    expect(render('`<b>x</b>`').querySelector('code')!.textContent).toBe('<b>x</b>')
    expect(render('`a &amp; b`').querySelector('code')!.textContent).toBe('a &amp; b')
    for (const fenced of ['```\n<b>x</b>', '```\n<b>x</b>\n`````', '~~~~\n<b>x</b>\n~~~~']) {
      const body = render(fenced)
      expect(body.querySelector('b')).toBeNull()
      expect(body.textContent).toContain('<b>x</b>')
    }
  })

  it('guard: backslash escapes show the literal characters', () => {
    expect(render('\\<b>x').textContent).toContain('<b>x')
    expect(render('\\<b>x').querySelector('b')).toBeNull()
    expect(render('\\&amp; z').textContent).toContain('&amp; z')
  })

  it('guard: $$ math reaches KaTeX unescaped and the MathML is an element', () => {
    const body = render('$$a<b$$')
    expect(katexSpy.renderToString).toHaveBeenCalledTimes(1)
    expect(katexSpy.renderToString.mock.calls[0][0]).toBe('a<b')
    expect(body.querySelector('math')).not.toBeNull()
  })

  it('guard: angle-bracket autolinks and blockquotes work', () => {
    const body = render('<https://e.com>')
    expect(body.querySelector('a')!.getAttribute('href')).toBe('https://e.com')
    const quote = render('> a<b')
    expect(quote.querySelector('blockquote')!.textContent).toContain('a<b')
  })

  it('guard: quote placeholders become quote marks in default mode', () => {
    const body = render('say "hi" now')
    expect(body.querySelector('mark[risu-mark="quote2"]')!.textContent).toBe('“hi”')
  })

  it('guard: user text holding a placeholder pair does not duplicate math', () => {
    const body = render('$$a$$ \uE9C00\uE9C1')
    expect(body.querySelectorAll('math').length).toBe(1)
  })

  it('characterisation: $$ inside a fence restores MathML inside the code block', () => {
    // The `$$` pass runs before markdown, so math inside a fence is still rendered.
    const body = render('```\n$$a$$\n```')
    expect(body.querySelector('pre code math')).not.toBeNull()
  })

  it('characterisation: emphasis underscores after $$ stay plain, asterisks work', () => {
    expect(render('$$a$$_x_').querySelector('em')).toBeNull()
    expect(render('$$a$$*x*').querySelector('em')!.textContent).toBe('x')
  })
})
