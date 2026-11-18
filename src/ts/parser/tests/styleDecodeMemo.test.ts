// @vitest-environment jsdom
// Sanitized-markup assertions need a DOM in which DOMPurify removes every offending
// node; see sanitizerMultiRemoval.test.ts for why happy-dom is not one.
/**
 * `decodeStyleContent` memoizes the scoped CSS of a style by its post-CBS text. The memo may only save CSS parses:
 * CBS still runs on every decode, failures are never stored, every `<risu-style>` still yields its own `<style>`, and
 * the memo stays bounded.
 *
 * Tests titled `regression reproducer:` fail without the memo; `guard:` tests pass before and after and pin output
 * that must not change; `diagnostic:` tests only describe the memo's bounds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
  parses: 0,
}))

//#region module mocks

vi.mock('@adobe/css-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@adobe/css-tools')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      parse: (...args: Parameters<typeof actual.default.parse>) => {
        h.parses++
        return actual.default.parse(...args)
      },
    },
  }
})

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getCurrentChat: () => ({}),
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
        globalChatVariables: {} as Record<string, string>,
        templateDefaultVariables: '',
        returnCSSError: false,
      },
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

import { ParseMarkdown, STYLE_MEMO_MAX, STYLE_MEMO_MAX_KEY } from '../parser.svelte'
import { DBState } from '../../stores.svelte'

// The explicit <body> start tag keeps a leading <style> in the body.
const parse = (html: string) => new DOMParser().parseFromString('<body>' + html, 'text/html').body

const styles = (body: HTMLElement) => Array.from(body.querySelectorAll('style')).map((s) => s.textContent)

const render = async (markup: string) => parse(await ParseMarkdown(markup, null, 'back'))

// Every style in these tests has its own class name, so no test reuses another test's memo entry.
let uniq = 0
const nextClass = () => `memo${++uniq}`

beforeEach(() => {
  h.parses = 0
  DBState.db.globalChatVariables = {}
  DBState.db.returnCSSError = false
})

describe('style decode memo', () => {
  it('regression reproducer: the same style rendered twice is parsed once', async () => {
    const cls = nextClass()
    const markup = `<style>.${cls} { color: red; }</style><div class="${cls}">x</div>`

    const first = await ParseMarkdown(markup, null, 'back')
    const second = await ParseMarkdown(markup, null, 'back')

    expect(first).toContain(`<style>.chattext .x-risu-${cls}{color:red;}</style>`)
    expect(second).toBe(first)
    expect(h.parses).toBe(1)
  })

  it('guard: a CBS variable that changes between renders gives the new CSS', async () => {
    const cls = nextClass()
    const markup = `<style>.${cls}{color:{{getglobalvar::c}};}</style>`

    DBState.db.globalChatVariables.c = 'red'
    expect(styles(await render(markup))).toEqual([`.chattext .x-risu-${cls}{color:red;}`])

    DBState.db.globalChatVariables.c = 'blue'
    expect(styles(await render(markup))).toEqual([`.chattext .x-risu-${cls}{color:blue;}`])
  })

  it('guard: a CSS error follows returnCSSError on every render and is never stored', async () => {
    const hex = Buffer.from('.a{color:red').toString('hex')
    const markup = `<risu-style>${hex}</risu-style>`

    DBState.db.returnCSSError = true
    const withError = await ParseMarkdown(markup, null, 'back')
    expect(withError).toContain('CSS ERROR')

    DBState.db.returnCSSError = false
    const without = await ParseMarkdown(markup, null, 'back')
    expect(without).not.toContain('CSS ERROR')
    expect(without).not.toContain('<style>')

    DBState.db.returnCSSError = true
    expect(await ParseMarkdown(markup, null, 'back')).toContain('CSS ERROR')
  })

  it('guard: two identical styles give two scoped style elements and no event handler survives', async () => {
    const cls = nextClass()
    const one = `<style>.${cls} { color: red; }</style>`
    const body = await render(`${one}${one}<img src=x onerror=alert(1)>`)

    expect(styles(body)).toEqual([`.chattext .x-risu-${cls}{color:red;}`, `.chattext .x-risu-${cls}{color:red;}`])
    expect(body.querySelector('[onerror]')).toBeNull()
  })

  it('diagnostic: the memo is bounded by entry count and by key size', async () => {
    const base = nextClass()
    const make = (i: number) => `<style>.${base}n${i}{color:red}</style>`

    for (let i = 0; i <= STYLE_MEMO_MAX; i++) {
      await render(make(i))
    }
    expect(h.parses).toBe(STYLE_MEMO_MAX + 1)

    // The oldest entry was evicted to make room, so it is parsed again.
    await render(make(0))
    expect(h.parses).toBe(STYLE_MEMO_MAX + 2)

    h.parses = 0
    const padding = '/*' + 'x'.repeat(STYLE_MEMO_MAX_KEY) + '*/'
    const big = `<style>.${base}big{color:red}${padding}</style>`
    await render(big)
    await render(big)
    expect(h.parses).toBe(2)
  })

  it('guard: rendering many styles gives the same output with a warm memo as with a fresh module', async () => {
    const base = nextClass()
    const markup = Array.from({ length: 30 }, (_, i) =>
      `<style>.${base}w${i} a{color:red} @media (max-width:600px){.${base}w${i}{color:red}}</style>`
    ).join('')

    const cold = await ParseMarkdown(markup, null, 'back')
    const warm = await ParseMarkdown(markup, null, 'back')
    expect(warm).toBe(cold)

    vi.resetModules()
    const fresh = await import('../parser.svelte')
    expect(await fresh.ParseMarkdown(markup, null, 'back')).toBe(cold)
  })
})
