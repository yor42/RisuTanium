// @vitest-environment jsdom
/**
 * With combineTranslation on, a paragraph that holds one sentence is rewritten
 * from its flattened text. That text is already decoded, so it must be written
 * back as text: parsing it as markup turns an escaped `&lt;img&gt;` into a live
 * element and collapses `&amp;amp;` into `&amp;`.
 *
 * processScriptFull is the identity here so the editdisplay replacement path,
 * which parses markup on purpose, does not run and mask the single-sentence write.
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
  processScriptFull: async (_char: unknown, data: string) => ({ data }),
}))

vi.mock('../parser/parser.svelte', () => ({
  applyMarkdownToNode: () => {},
  risuChatParser: (data: string) => data,
}))

import { translateHTML } from './translator'

beforeEach(() => {
  db.combineTranslation = true
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

describe('translateHTML single-sentence paragraph', () => {
  it('keeps an escaped tag as literal text instead of creating an element', async () => {
    const out = await translateHTML('<p>&lt;img src=x onerror=alert(1)&gt;</p>', false, '', -1)
    const body = parse(out)

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelectorAll('*[onerror]').length).toBe(0)
    expect(body.querySelector('p')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('keeps an escaped ampersand entity as literal text', async () => {
    const out = await translateHTML('<p>a &amp;amp; b</p>', false, '', -1)

    expect(parse(out).querySelector('p')?.textContent).toBe('a &amp; b')
  })

  // Compatibility guard: passes before and after the fix.
  it('keeps bold and italic markers in a single-sentence paragraph', async () => {
    const out = await translateHTML('<p><b>x</b> and <i>y</i></p>', false, '', -1)

    expect(parse(out).querySelector('p')?.textContent).toBe('**x** and *y*')
  })

  // Compatibility guard: passes before and after the fix.
  it('still splits a multi-sentence paragraph into spans separated by breaks', async () => {
    const out = await translateHTML('<p>alpha<br>beta</p>', false, '', -1)

    expect(out).toBe('<p><span>alpha</span><br /><span>beta</span><br /></p>')
  })
})
