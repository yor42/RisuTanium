// @vitest-environment jsdom
/**
 * translateHTML parses its input in an inert DOMParser document. Markup built
 * from translated text or from a card's editdisplay output must be created in
 * that document: an element created in the live `document` parses its markup
 * there, where an image's `src` or an `onerror` handler can act immediately.
 *
 * jsdom does not load images or fire `onerror`, so the checks watch where
 * elements are created and where markup is parsed, not what the markup does.
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

let translateText: (text: string) => string = (text) => text

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
    data: { translations: [{ text: translateText(init.body.text[0]) }] },
  }),
}))

vi.mock('../secretRef', () => ({
  resolveSecret: async (value: string) => value,
  SecretRefError: class SecretRefError extends Error {},
}))

// Stands in for the card's editdisplay scripts: appends markup to the text.
vi.mock('../process/scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../process/scripts')>()),
  processScriptFull: async (_char: unknown, data: string) => ({ data: `${data}<b>shown</b>` }),
}))

vi.mock('../parser/parser.svelte', () => ({
  applyMarkdownToNode: () => {},
  risuChatParser: (data: string) => data,
}))

import { translateHTML } from './translator'

interface Creation {
  kind: 'createElement' | 'innerHTML'
  inLiveDocument: boolean
}

const creations: Creation[] = []
const restores: (() => void)[] = []

const watchCreations = () => {
  const createElement = Document.prototype.createElement
  Document.prototype.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    creations.push({ kind: 'createElement', inLiveDocument: this === document })
    return createElement.apply(this, args)
  } as Document['createElement']
  restores.push(() => { Document.prototype.createElement = createElement })

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!
  Object.defineProperty(Element.prototype, 'innerHTML', {
    ...descriptor,
    set(this: Element, value: string) {
      creations.push({ kind: 'innerHTML', inLiveDocument: this.ownerDocument === document })
      descriptor.set!.call(this, value)
    },
  })
  restores.push(() => { Object.defineProperty(Element.prototype, 'innerHTML', descriptor) })
}

beforeEach(() => {
  creations.length = 0
  db.combineTranslation = true
  translateText = (text) => text
  vi.spyOn(console, 'log').mockImplementation(() => {})
  watchCreations()
})

afterEach(() => {
  restores.splice(0).forEach((restore) => restore())
  vi.restoreAllMocks()
})

describe('translateHTML element ownership', () => {
  it('creates wrappers and parses translated markup in the translated document, not the live one', async () => {
    translateText = () => 'a <img src=x onerror=alert(1)> b'

    await translateHTML('<p>one<br>two</p><p>solo</p>', false, '', -1)

    expect(creations.length).toBeGreaterThan(0)
    expect(creations.filter((c) => c.inLiveDocument)).toEqual([])
    // The multi-sentence path and the editdisplay replacement both ran.
    expect(creations.filter((c) => c.kind === 'createElement').length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the translated output for ordinary text', async () => {
    translateText = (text) => `T(${text})`

    const multi = await translateHTML('<p>alpha<br>beta</p>', false, '', -1)
    const single = await translateHTML('<p>gamma</p>', false, '', -1)

    expect(multi).toBe('<p><span>T(alpha)<b>shown</b></span><br /><span>T(beta)<b>shown</b></span><br /></p>')
    expect(single).toBe('<p>T(gamma)<b>shown</b></p>')
  })
})
