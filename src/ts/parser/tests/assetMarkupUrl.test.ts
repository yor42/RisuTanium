/**
 * What `parseAdditionalAssets` (through the exported `ParseMarkdown`) does with
 * the URL `getFileSrc` hands back: the markup's `alt` carries the asset name and
 * never the URL, a short URL is cached per asset, a `data:` URL never is, and a
 * bgm control carries the same URL on every parse. `getFileSrc` is mocked; the
 * mock set is the one `fileSrcCacheAv3.test.ts` proves loads `parser.svelte.ts`.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown, resetAssetsCache } from '../parser.svelte'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getCurrentChat: () => ({}),
      getDatabase: () => ({ modules: [], enabledModules: [] }),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: vi.fn(),
  setUsingSw: vi.fn(),
  readImage: vi.fn(),
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

import { getFileSrc } from '../../globalApi.svelte'

const ROUTE_URL = '/api/asset/6173736574732f782e706e67?risu-auth=aaa.bbb.ccc'

function makeChar(additionalAssets: string[][], emotionImages: string[][] = []) {
  return {
    type: 'character',
    chaId: 'char-asset-markup',
    additionalAssets,
    emotionImages,
    customscript: [],
  } as unknown as Parameters<typeof ParseMarkdown>[1]
}

function elementOf(html: string, selector: string): Element {
  const element = new DOMParser().parseFromString(html, 'text/html').querySelector(selector)
  if (element === null) {
    throw new Error(`no ${selector} in: ${html}`)
  }
  return element
}

beforeEach(() => {
  vi.mocked(getFileSrc).mockReset()
  vi.mocked(getFileSrc).mockResolvedValue(ROUTE_URL)
})

describe('asset markup alt text', () => {
  test.each([
    ['img', 'fox'],
    ['image', 'fox'],
    ['asset', 'fox'],
  ])('{{%s}} carries the asset name in alt, never the URL', async (type, name) => {
    const char = makeChar([[name, 'assets/fox-alt.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    const html = await ParseMarkdown(`{{${type}::${name}}}`, char, 'back')
    const img = elementOf(html, 'img')
    expect(img.getAttribute('src')).toBe(ROUTE_URL)
    expect(img.getAttribute('alt')).toBe(name)
  })

  test('{{emotion}} carries the emotion name in alt, never the URL', async () => {
    const char = makeChar([], [['happy', 'assets/happy-alt.png']])
    resetAssetsCache([], (char as { emotionImages: string[][] }).emotionImages, [])
    const html = await ParseMarkdown('{{emotion::happy}}', char, 'back')
    const img = elementOf(html, 'img')
    expect(img.getAttribute('src')).toBe(ROUTE_URL)
    expect(img.getAttribute('alt')).toBe('happy')
  })

  test('a name with quotes and an ampersand cannot leave the alt attribute', async () => {
    const name = 'say "hi" & bye'
    const char = makeChar([[name, 'assets/odd-name.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    const html = await ParseMarkdown(`{{img::${name}}}`, char, 'back')
    const img = elementOf(html, 'img')
    expect(img.getAttribute('alt')).toBe(name)
    expect(img.getAttribute('src')).toBe(ROUTE_URL)
    expect(img.getAttributeNames().every((attribute) => /^[a-z]+$/.test(attribute))).toBe(true)
  })
})

describe('caching what getFileSrc returned', () => {
  test('a route URL is cached per asset', async () => {
    const char = makeChar([['cached', 'assets/route-cached.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    await ParseMarkdown('{{img::cached}}', char, 'back')
    await ParseMarkdown('{{img::cached}}', char, 'back')
    expect(getFileSrc).toHaveBeenCalledTimes(1)
  })

  test('a data URL is never cached, whichever branch made it', async () => {
    vi.mocked(getFileSrc).mockResolvedValue('data:image/png;base64,AAAA')
    const char = makeChar([['dataurl', 'assets/data-url.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    await ParseMarkdown('{{img::dataurl}}', char, 'back')
    await ParseMarkdown('{{img::dataurl}}', char, 'back')
    expect(getFileSrc).toHaveBeenCalledTimes(2)
  })

  test('guard: a failed lookup (an empty string) is asked again on the next render', async () => {
    vi.mocked(getFileSrc).mockResolvedValue('')
    const char = makeChar([['empty', 'assets/empty-src.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    await ParseMarkdown('{{img::empty}}', char, 'back')
    await ParseMarkdown('{{img::empty}}', char, 'back')
    expect(getFileSrc).toHaveBeenCalledTimes(2)
  })
})

describe('bgm control and reload stability', () => {
  test('guard: a bgm control carries the same URL on every parse', async () => {
    const char = makeChar([['theme', 'assets/theme-bgm.mp3', 'mp3']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    const first = elementOf(await ParseMarkdown('{{bgm::theme}}', char, 'back'), '[risu-ctrl]').getAttribute('risu-ctrl')
    const second = elementOf(await ParseMarkdown('{{bgm::theme}}', char, 'back'), '[risu-ctrl]').getAttribute('risu-ctrl')
    expect(first).toBe(`bgm___auto___${ROUTE_URL}`)
    expect(second).toBe(first)
  })

  test('guard: a message with an asset parses to identical HTML after the module state is rebuilt', async () => {
    const char = makeChar([['stable', 'assets/stable.png', 'png']])
    resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    const before = await ParseMarkdown('hello {{img::stable}} {{bgm::stable}}', char, 'back')

    vi.resetModules()
    const reloaded = await import('../parser.svelte')
    reloaded.resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
    const after = await reloaded.ParseMarkdown('hello {{img::stable}} {{bgm::stable}}', char, 'back')

    expect(after).toBe(before)
  })
})
