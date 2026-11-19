// @vitest-environment jsdom
/**
 * Chat-body sanitizing (trimMarkdown) runs on dedicated DOMPurify instances that are
 * configured once with setConfig, and those instances carry exactly the same hooks and
 * config as the default instance's per-call path, so the output is unchanged.
 *
 * The file runs under jsdom: sanitizer output asserted under happy-dom is not evidence.
 * Accessor-based assertions call trimPurifiersForTests() inside test bodies only, so a
 * missing export fails the affected tests and never the whole file at collection.
 */
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import DOMPurify from 'dompurify'
import type { Config } from 'dompurify'
import { trimMarkdown, sanitizeMarkdownSafe, trimPurifiersForTests, ParseMarkdown } from '../parser.svelte'

//#region module mocks

const mockState = vi.hoisted(() => ({
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
    hideAllImages: false,
  },
}))

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
    DBState: mockState,
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../stores.svelte')
})

//#endregion

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body
const encodeStyle = (css: string) => `<risu-style>${Buffer.from(css).toString('hex')}</risu-style>`

const setHideAllImages = (value: boolean) => {
  mockState.db.hideAllImages = value
}

// An independent copy of the chat-body config. Its default-instance per-call output is the reference
// that the chat instances must equal.
const baselineConfig: Config = {
  ADD_TAGS: ["iframe", "style", "risu-style", "x-em", 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt'],
  ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "risu-btn", "risu-ctrl", 'risu-form', 'risu-trigger', 'risu-mark', 'risu-id', 'x-hl-lang', 'x-hl-text'],
}

type Probe = { count: number, configs: Config[], hook: (node: Node, data: unknown, config: Config) => void }
const makeProbe = (): Probe => {
  const probe: Probe = {
    count: 0,
    configs: [],
    hook: (_node, _data, config) => {
      probe.count++
      probe.configs.push(config)
    },
  }
  return probe
}

/** Probes never mutate nodes and are removed afterwards, so the hook table is restored. */
const withProbe = (
  purifier: Pick<typeof DOMPurify, 'addHook' | 'removeHook'>,
  run: (probe: Probe) => void
) => {
  const probe = makeProbe()
  purifier.addHook('uponSanitizeElement', probe.hook)
  try {
    run(probe)
  }
  finally {
    purifier.removeHook('uponSanitizeElement', probe.hook)
  }
}

const riskyBody = '<p>x</p><img src="https://e.example/a.png">'
const riskyStyleBody = `${encodeStyle('.a{color:red;}')}<p>y</p>`

describe('trimMarkdown does not sanitize on the default instance', () => {
  it('leaves the default instance untouched for plain and risu-style bodies (T1)', () => {
    withProbe(DOMPurify, (probe) => {
      // Positive control: the default instance does fire the probe.
      DOMPurify.sanitize('<p>x</p>')
      expect(probe.count).toBeGreaterThan(0)
      probe.count = 0

      const plain = trimMarkdown(riskyBody)
      const styled = trimMarkdown(riskyStyleBody)
      expect(plain).toContain('<p>x</p>')
      expect(plain).toContain('loading="lazy"')
      expect(styled).toContain('<style>')
      expect(probe.count).toBe(0)
    })
  })
})

describe('chat instances', () => {
  it('are configured once, memoised, distinct and not the default instance (T2)', () => {
    const a = trimPurifiersForTests()
    const b = trimPurifiersForTests()
    expect(a.html).toBe(b.html)
    expect(a.dom).toBe(b.dom)
    expect(a.html).not.toBe(DOMPurify)
    expect(a.dom).not.toBe(DOMPurify)
    expect(a.html).not.toBe(a.dom)
    // A per-call config is ignored once the instance has its own.
    expect(a.html.sanitize('<p>a</p><em>b</em>', { FORBID_TAGS: ['p', 'em'] })).toBe('<p>a</p><em>b</em>')
    const root = a.dom.sanitize('<p>a</p>', a.domConfig)
    expect(root.nodeName).toBe('BODY')
  })

  it('serve trimMarkdown per path with a config that is parsed once (T2b)', () => {
    const a = trimPurifiersForTests()
    withProbe(a.html, (pHtml) => {
      withProbe(a.dom, (pDom) => {
        trimMarkdown('<p>x</p>')
        trimMarkdown('<p>x</p>')
        expect(pHtml.count).toBeGreaterThan(0)
        expect(pDom.count).toBe(0)
        const [c1, c2] = [pHtml.configs[0], pHtml.configs[pHtml.configs.length - 1]]
        expect(c1).toBeTypeOf('object')
        expect(c2).toBeTypeOf('object')
        expect(c1).toBe(c2)

        pHtml.count = 0
        pHtml.configs.length = 0
        pDom.count = 0
        pDom.configs.length = 0
        trimMarkdown(riskyStyleBody)
        trimMarkdown(riskyStyleBody)
        expect(pDom.count).toBeGreaterThan(0)
        expect(pHtml.count).toBe(0)
        const [d1, d2] = [pDom.configs[0], pDom.configs[pDom.configs.length - 1]]
        expect(d1).toBeTypeOf('object')
        expect(d2).toBeTypeOf('object')
        expect(d1).toBe(d2)
      })
    })
  })
})

//#region equivalence corpus (T3)

const stringRows: string[] = [
  '<pre><code class="hljs language-js">const a = 1</code></pre>',
  '<ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote><a href="https://e.example/">l</a>',
  '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
  '<iframe src="https://evil.example/a"></iframe><p>between</p>',
  '<img src="https://e.example/a.png">',
  '<img src="https://e.example/a.png" loading="eager" decoding="sync">',
  '<p class="hljs-a x-risu-b c">t</p>',
  '<a href="http://e.example/">h</a><a href="https://e.example/" target="_self" rel="x">s</a>',
  '<a href="javascript:alert(1)">j</a><a href="/relative">r</a>',
  '<img src="blob:abc"><video src="asset:abc"></video><audio src="blob:def"></audio><source src="asset:ghi">',
  '<math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation>x+1</annotation></semantics></math>',
  '<button risu-btn="go" risu-ctrl="c" risu-form="f" risu-trigger="t" risu-mark="m" risu-id="i">go</button>',
  '<span x-hl-lang="js" x-hl-text="t">t</span><x-em>e</x-em>',
  '<p style="background:url(x);color:red">s</p><p style="background-image:url(x)">s2</p>',
  '<script>alert(1)</script><p onclick="a()">o</p>',
  'a & b > c &nbsp; d',
  '',
]

const domRows: string[] = [
  ...stringRows.filter((row) => row !== ''),
  `lead${encodeStyle('.a{color:red;}')}<p onclick="a()">first</p>`,
  `${encodeStyle('.b{background:url(x);}')}<script>alert(2)</script><img src="https://e.example/a.png">`,
]

describe('chat instances produce the same output as the default per-call path (T3)', () => {
  for (const hide of [false, true]) {
    it(`trimMarkdown equals the default instance on string rows, hideAllImages=${hide}`, () => {
      setHideAllImages(hide)
      try {
        for (const row of stringRows) {
          expect(trimMarkdown(row), row).toBe(DOMPurify.sanitize(row, baselineConfig))
        }
      }
      finally {
        setHideAllImages(false)
      }
    })

    it(`the html instance equals the default per-call output on string rows, hideAllImages=${hide}`, () => {
      setHideAllImages(hide)
      try {
        const a = trimPurifiersForTests()
        for (const row of stringRows) {
          expect(a.html.sanitize(row), row).toBe(DOMPurify.sanitize(row, a.config))
        }
      }
      finally {
        setHideAllImages(false)
      }
    })

    it(`the dom instance equals the default RETURN_DOM per-call output, hideAllImages=${hide}`, () => {
      setHideAllImages(hide)
      try {
        const a = trimPurifiersForTests()
        for (const row of domRows) {
          const chat = (a.dom.sanitize(row, a.domConfig) as HTMLElement).innerHTML
          const base = (DOMPurify.sanitize(row, { ...a.config, RETURN_DOM: true }) as HTMLElement).innerHTML
          expect(chat, row).toBe(base)
        }
      }
      finally {
        setHideAllImages(false)
      }
    })
  }

  it('keeps a text body without markup verbatim on the string path (not re-serialised)', () => {
    expect(trimMarkdown('a & b > c')).toBe('a & b > c')
  })

  it('matches the default instance for a real ParseMarkdown notrim body', async () => {
    const body = await ParseMarkdown('# t\n\n```js\nconst a = 1\n```\n\n- a\n- b\n\n> q\n\n[l](https://e.example/)', null, 'notrim')
    expect(trimMarkdown(body)).toBe(DOMPurify.sanitize(body, baselineConfig))
  })

  it('the html instance matches the default instance for a real ParseMarkdown notrim body', async () => {
    const a = trimPurifiersForTests()
    const body = await ParseMarkdown('# t\n\n```js\nconst a = 1\n```\n\n- a\n- b\n\n> q\n\n[l](https://e.example/)', null, 'notrim')
    expect(a.html.sanitize(body)).toBe(DOMPurify.sanitize(body, a.config))
  })
})

//#endregion

describe('trimMarkdown keeps the sanitizing rules on both paths (T4)', () => {
  const both = (body: string) => [body, body + encodeStyle('.k{color:blue;}')]

  it('removes scripts and handlers, and applies the href and rel rules', () => {
    for (const body of both('<script>alert(1)</script><p onclick="a()">p</p><a href="javascript:alert(1)">j</a><a href="/rel">r</a><a href="https://e.example/" rel="x">h</a>')) {
      const out = parse(trimMarkdown(body))
      expect(out.querySelectorAll('script').length).toBe(0)
      for (const el of Array.from(out.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name).not.toMatch(/^on/i)
        }
      }
      const anchors = Array.from(out.querySelectorAll('a'))
      expect(anchors[0].getAttribute('href')).toBe('')
      expect(anchors[1].getAttribute('href')).toBe('')
      expect(anchors[2].getAttribute('href')).toBe('https://e.example/')
      expect(anchors[2].getAttribute('target')).toBe('_blank')
      expect(anchors[2].getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('prefixes classes, filters iframes and defaults img loading attributes', () => {
    for (const body of both('<p class="hljs-a x-risu-b c">t</p><iframe src="https://evil.example/a"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe><img src="https://e.example/a.png"><img src="https://e.example/b.png" loading="eager">')) {
      const out = parse(trimMarkdown(body))
      expect(out.querySelector('p')?.getAttribute('class')).toBe('hljs-a x-risu-b x-risu-c')
      const iframes = Array.from(out.querySelectorAll('iframe'))
      expect(iframes.map((f) => f.getAttribute('src'))).toEqual(['https://www.youtube.com/embed/abc'])
      const imgs = Array.from(out.querySelectorAll('img'))
      expect(imgs[0].getAttribute('loading')).toBe('lazy')
      expect(imgs[0].getAttribute('decoding')).toBe('async')
      expect(imgs[1].getAttribute('loading')).toBe('eager')
    }
  })

  it('keeps blob and asset sources, MathML and the risu attributes', () => {
    for (const body of both('<img src="blob:a"><source src="asset:b"><video src="blob:c"></video><audio src="asset:d"></audio><math><semantics><mrow><mi>x</mi></mrow><annotation>x</annotation></semantics></math><button risu-btn="go" risu-id="i">g</button>')) {
      const out = parse(trimMarkdown(body))
      expect(out.querySelector('img')?.getAttribute('src')).toBe('blob:a')
      expect(out.querySelector('source')?.getAttribute('src')).toBe('asset:b')
      expect(out.querySelector('video')?.getAttribute('src')).toBe('blob:c')
      expect(out.querySelector('audio')?.getAttribute('src')).toBe('asset:d')
      expect(out.querySelector('semantics')).not.toBeNull()
      expect(out.querySelector('annotation')).not.toBeNull()
      expect(out.querySelector('button')?.getAttribute('risu-btn')).toBe('go')
      expect(out.querySelector('button')?.getAttribute('risu-id')).toBe('i')
    }
  })

  it('removes offenders on the risu-style path and decodes the style', () => {
    const out = parse(trimMarkdown(`lead${encodeStyle('.a{color:red;}')}<script>alert(1)</script><p onclick="a()">p</p>`))
    expect(out.querySelectorAll('script').length).toBe(0)
    expect(out.querySelector('p')?.hasAttribute('onclick')).toBe(false)
    expect(out.querySelector('style')?.textContent).toContain('color:red')
  })
})

describe('hideAllImages is read at hook time (T5)', () => {
  it('replaces image sources and strips background urls only while enabled', () => {
    const body = '<img src="https://e.example/a.png"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs="><p style="background-image:url(x);color:red">s</p>'
    try {
      setHideAllImages(true)
      const hidden = parse(trimMarkdown(body))
      const imgs = Array.from(hidden.querySelectorAll('img'))
      expect(imgs[0].getAttribute('src')).toBe('/none.webp')
      expect(imgs[0].getAttribute('alt')).toBe('?')
      expect(imgs[0].hasAttribute('loading')).toBe(false)
      expect(imgs[1].getAttribute('src')).toContain('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP')
      expect(hidden.querySelector('p')?.getAttribute('style')).not.toContain('url')
      expect(hidden.querySelector('p')?.getAttribute('style')).toContain('color:red')

      setHideAllImages(false)
      const shown = parse(trimMarkdown(body))
      expect(shown.querySelector('img')?.getAttribute('src')).toBe('https://e.example/a.png')
      expect(shown.querySelector('img')?.getAttribute('loading')).toBe('lazy')
      expect(shown.querySelector('p')?.getAttribute('style')).toContain('url')
    }
    finally {
      setHideAllImages(false)
    }
  })
})

describe('default-instance callers keep their own per-call behaviour', () => {
  it('sanitizeMarkdownSafe still forbids links, styles, classes and the extra tags (T6)', () => {
    trimMarkdown(riskyBody)
    const out = parse(sanitizeMarkdownSafe(
      '<a href="https://e.example/">l</a><p style="color:red" class="c">t</p><style>p{}</style><em>x</em>',
      { forbidTags: ['em'] }
    ))
    expect(out.querySelector('a')).toBeNull()
    expect(out.querySelector('style')).toBeNull()
    expect(out.querySelector('[style]')).toBeNull()
    expect(out.querySelector('[class]')).toBeNull()
    expect(out.querySelector('em')).toBeNull()
    expect(out.textContent).toContain('t')
    expect(out.textContent).toContain('x')
  })

  it('the default instance is not configured by trimMarkdown (T7)', () => {
    trimMarkdown(riskyBody)
    expect(DOMPurify.sanitize('<p>a</p><em>b</em>', { FORBID_TAGS: ['em'] })).toBe('<p>a</p>b')
  })

  it('the default instance keeps the trim hooks (T8)', () => {
    trimMarkdown(riskyBody)
    const out = parse(DOMPurify.sanitize('<img src="https://e.example/a.png"><a href="https://e.example/">l</a><p class="c">t</p>'))
    expect(out.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(out.querySelector('img')?.getAttribute('decoding')).toBe('async')
    expect(out.querySelector('a')?.getAttribute('target')).toBe('_blank')
    expect(out.querySelector('p')?.getAttribute('class')).toBe('x-risu-c')
  })
})

describe('deferred image attribute (T9)', () => {
  const body = '<img data-risu-deferred-src="http://asset.localhost/x" alt="x">'

  it('drops an author attribute only while deferral is requested, and restores the flag', () => {
    const deferred = parse(trimMarkdown(body, { deferLargeAssetImages: true }))
    expect(deferred.querySelector('img')?.hasAttribute('data-risu-deferred-src')).toBe(false)
    const plain = parse(trimMarkdown(body))
    expect(plain.querySelector('img')?.getAttribute('data-risu-deferred-src')).toBe('http://asset.localhost/x')
    const again = parse(trimMarkdown(body))
    expect(again.querySelector('img')?.getAttribute('data-risu-deferred-src')).toBe('http://asset.localhost/x')
  })
})
