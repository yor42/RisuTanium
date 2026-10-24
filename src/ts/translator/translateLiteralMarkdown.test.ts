// @vitest-environment jsdom
/**
 * End to end through the real markdown pass: a single-sentence paragraph whose
 * decoded text is `a &amp; b` must display exactly that, not `a & b`.
 * processScriptFull is the identity so the editdisplay replacement path does not
 * mask the markdown pass.
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

import { translateHTML } from './translator'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('translateHTML with the real markdown pass', () => {
  // Reproducer: fails while the markdown pass decodes entities in decoded text.
  it('keeps a decoded ampersand entity as displayed text', async () => {
    const out = await translateHTML('<p>a &amp;amp; b</p>', false, '', -1)
    const body = new DOMParser().parseFromString(out, 'text/html').body

    expect(body.textContent?.trim()).toBe('a &amp; b')
  })
})
