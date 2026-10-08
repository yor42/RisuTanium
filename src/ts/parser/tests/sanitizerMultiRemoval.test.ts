// @vitest-environment jsdom
/**
 * Every offending node in one input must be removed, not only the first.
 *
 * This file runs under jsdom, not the suite's default happy-dom: DOMPurify walks
 * the tree with a NodeIterator, and happy-dom's NodeIterator does not survive
 * the removal of the node it is standing on, so DOMPurify stops after the first
 * removed node and leaves every later script, handler attribute and unsafe URL
 * in place. A removal assertion made under happy-dom therefore only proves that
 * the first offender was removed. Any test that asserts what a DOMPurify-backed
 * sanitizer removes belongs in a jsdom file.
 */
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { trimMarkdown, parseMarkdownSafe } from '../parser.svelte'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [
          {
            chatPage: 0,
            chats: [{}],
            defaultVariables: '',
          },
        ],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

/** Several independent offenders, spread over several elements. */
const offenders = [
  '<script>alert(1)</script>',
  '<p onclick="a()" onmouseover="b()">first</p>',
  '<script>alert(2)</script>',
  '<div onfocus="c()" onerror="d()">second</div>',
  '<a href="javascript:alert(3)">link</a>',
  '<img src="javascript:alert(4)" onerror="e()">',
  '<svg onload="f()"><circle r="1"></circle></svg>',
  '<script>alert(5)</script>',
  '<span onanimationend="g()">third</span>',
].join('\n')

const expectNoOffenders = (html: string) => {
  const body = parse(html)
  expect(body.querySelectorAll('script').length).toBe(0)
  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name, `${el.localName} attribute`).not.toMatch(/^on/i)
    }
  }
  expect(html).not.toContain('javascript:')
  expect(html).not.toMatch(/alert\(/)
}

describe('trimMarkdown removes every offender in one input', () => {
  it('removes all scripts, handler attributes and javascript: URLs, keeping the allowed content', () => {
    const out = trimMarkdown(offenders)
    expectNoOffenders(out)
    const body = parse(out)
    expect(body.querySelector('p')?.textContent).toBe('first')
    expect(body.querySelector('div')?.textContent).toBe('second')
    expect(body.querySelector('span')?.textContent).toBe('third')
    expect(body.querySelector('a')?.textContent).toBe('link')
  })

  it('removes every iframe that is not a youtube embed and keeps the youtube one', () => {
    const out = trimMarkdown(
      '<iframe src="https://evil.example/a"></iframe>' +
      '<p>between</p>' +
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>' +
      '<iframe src="https://evil.example/b"></iframe>' +
      '<iframe src="javascript:alert(1)"></iframe>'
    )
    const iframes = Array.from(parse(out).querySelectorAll('iframe'))
    expect(iframes.map((f) => f.getAttribute('src'))).toEqual(['https://www.youtube.com/embed/abc'])
    expect(out).toContain('between')
  })

  it('removes every offender on the risu-style RETURN_DOM path while the decoded style survives', () => {
    const hex = Buffer.from('.a{color:red;}').toString('hex')
    const out = trimMarkdown(`lead<risu-style>${hex}</risu-style>\n${offenders}`)
    expectNoOffenders(out)
    const body = parse(out)
    expect(body.querySelectorAll('style').length).toBe(1)
    expect(body.querySelector('style')?.textContent).toContain('color:red')
    expect(body.querySelector('p')?.textContent).toBe('first')
  })

  it('keeps the app custom tags, attributes, class prefixing and http links while stripping the offenders', () => {
    const out = trimMarkdown(
      '<script>alert(1)</script>' +
      '<x-em>emph</x-em>' +
      '<button risu-btn="go" onclick="x()" class="big">go</button>' +
      '<script>alert(2)</script>' +
      '<a href="https://example.com/p" onclick="y()">site</a>' +
      '<p class="hljs-keyword keep" onmouseover="z()">text</p>'
    )
    expectNoOffenders(out)
    const body = parse(out)
    expect(body.querySelector('x-em')?.textContent).toBe('emph')
    const button = body.querySelector('button')!
    expect(button.getAttribute('risu-btn')).toBe('go')
    expect(button.getAttribute('class')).toBe('x-risu-big')
    const anchor = body.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('https://example.com/p')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(body.querySelector('p')?.getAttribute('class')).toBe('hljs-keyword x-risu-keep')
  })
})

describe('parseMarkdownSafe removes every offender in one input', () => {
  it('removes all scripts, handler attributes and unsafe URLs, and strips links, classes and styles, keeping text', () => {
    const out = parseMarkdownSafe(
      '<script>alert(1)</script>' +
      '<p onclick="a()" style="color:red" class="c">first</p>' +
      '<script>alert(2)</script>' +
      '<a href="https://example.com/" onclick="b()">link</a>' +
      '<img src="javascript:alert(3)" onerror="c()">' +
      '<svg onload="d()"></svg>' +
      '<style>p{color:red}</style>' +
      '<iframe src="https://evil.example/"></iframe>' +
      '<b onmouseover="e()">bold</b>'
    )
    expectNoOffenders(out)
    const body = parse(out)
    expect(body.querySelector('a')).toBeNull()
    expect(body.querySelector('style')).toBeNull()
    expect(body.querySelector('iframe')).toBeNull()
    expect(body.querySelector('[style]')).toBeNull()
    expect(body.querySelector('[class]')).toBeNull()
    expect(body.querySelector('p')?.textContent).toBe('first')
    expect(body.querySelector('b')?.textContent).toBe('bold')
    expect(out).toContain('link')
  })

  it('removes a caller-forbidden tag everywhere it appears', () => {
    const out = parseMarkdownSafe('<p>a</p><em>x</em><p>b</p><em>y</em><script>alert(1)</script>', { forbidTags: ['em'] })
    const body = parse(out)
    expect(body.querySelectorAll('em').length).toBe(0)
    expect(body.querySelectorAll('script').length).toBe(0)
    expect(body.querySelectorAll('p').length).toBe(2)
  })
})
