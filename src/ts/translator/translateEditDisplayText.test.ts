// @vitest-environment jsdom
/**
 * The editdisplay pass receives translated text that is already decoded. It is
 * escaped (`&` and `<` only) before the display scripts run, so literal text stays
 * text and only markup a script adds becomes elements. Quotes and `>` stay as
 * written so script regexes that match them keep working.
 *
 * The markdown pass (applyMarkdownToNode) is mocked as a no-op and isolated out,
 * so this tests the edit-display write only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = {
  translatorType: 'deepl',
  deeplOptions: { freeApi: true, key: 'k' },
  combineTranslation: true,
  translator: 'ko',
  aiModel: 'gpt',
  presetRegex: [],
  characters: [],
}

const scriptMock = vi.hoisted(() => ({
  run: async (data: string): Promise<{ data: string }> => ({ data }),
  seen: [] as string[],
}))

vi.mock('../storage/database.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/database.svelte')>()),
  getDatabase: () => db,
}))

vi.mock('../process/modules', () => ({
  getModuleRegexScripts: () => [],
  moduleUpdate: () => {},
}))

vi.mock('../globalApi.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../globalApi.svelte')>()),
  globalFetch: async (_url: string, init: { body: { text: string[] } }) => ({
    ok: true,
    data: { translations: [{ text: init.body.text[0] }] },
  }),
}))

vi.mock('../secretRef', () => ({
  resolveSecret: async (value: string) => value,
  SecretRefError: class SecretRefError extends Error {},
}))

vi.mock('../process/scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../process/scripts')>()),
  processScriptFull: async (_char: unknown, data: string) => {
    scriptMock.seen.push(data)
    return scriptMock.run(data)
  },
}))

vi.mock('../parser/parser.svelte', () => ({
  applyMarkdownToNode: () => {},
  risuChatParser: (data: string) => data,
}))

import { translateHTML } from './translator'

const appendBold = async (data: string) => ({ data: data + ' <b>shown</b>' })
const identity = async (data: string) => ({ data })

beforeEach(() => {
  db.combineTranslation = true
  scriptMock.run = appendBold
  scriptMock.seen = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

describe('translateHTML edit-display write', () => {
  it('keeps an escaped tag as text while the script-added markup is parsed', async () => {
    const body = parse(await translateHTML('<p>&lt;img src=x onerror=alert(1)&gt;</p>', false, '', -1))

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelectorAll('*[onerror]').length).toBe(0)
    expect(body.querySelector('p')?.textContent?.startsWith('<img src=x onerror=alert(1)>')).toBe(true)
    expect(body.querySelector('b')?.textContent).toBe('shown')
  })

  it('keeps an escaped ampersand entity as literal text', async () => {
    const body = parse(await translateHTML('<p>a &amp;amp; b</p>', false, '', -1))

    expect(body.querySelector('p')?.textContent).toContain('a &amp; b')
  })

  it('keeps a bare less-than in the text instead of opening an element', async () => {
    const body = parse(await translateHTML('<p>x&lt;y and z</p>', false, '', -1))

    expect(body.querySelector('p')?.textContent).toContain('x<y and z')
    expect(body.querySelector('y')).toBeNull()
  })

  // Compatibility guard: passes before and after the fix.
  it('parses script-added markup as elements for plain text', async () => {
    const body = parse(await translateHTML('<p>plain</p>', false, '', -1))

    expect(body.querySelector('b')?.textContent).toBe('shown')
    expect(body.querySelector('p')?.textContent).toContain('plain')
  })

  // Compatibility guard: passes before and after the fix.
  it('lets a quote-matching script regex still produce its span', async () => {
    scriptMock.run = async (data) => ({
      data: data.replace(/"(.*?)"/g, '<span class="q">"$1"</span>'),
    })
    const body = parse(await translateHTML('<p>say "hi"</p>', false, '', -1))

    expect(body.querySelector('span.q')?.textContent).toBe('"hi"')
  })

  // Compatibility guard: passes before and after the fix.
  it('lets a script regex that matches a greater-than still produce its span', async () => {
    scriptMock.run = async (data) => ({
      data: data.replace(/a>b/g, '<span class="gt">a&gt;b</span>'),
    })
    const body = parse(await translateHTML('<p>a&gt;b</p>', false, '', -1))

    expect(body.querySelector('span.gt')?.textContent).toBe('a>b')
  })

  // Compatibility guard: passes before and after the fix.
  it('writes unchanged text as text when the script is the identity', async () => {
    scriptMock.run = identity
    const body = parse(await translateHTML('<p>&lt;img src=x&gt; &amp;amp;</p>', false, '', -1))

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('p')?.textContent).toBe('<img src=x> &amp;')
  })

  // Documents the trade-off: scripts see a literal `<` as `&lt;`.
  it('hands the script the escaped form of a literal less-than', async () => {
    await translateHTML('<p>x&lt;y</p>', false, '', -1)

    expect(scriptMock.seen).toContain('x&lt;y')
  })
})
