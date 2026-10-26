/**
 * Which `use` the parser asks `getFileSrc` for, per CBS asset tag, and that a
 * URL made for a media element never answers a `'whole'` request. `getFileSrc`
 * is replaced by a stand-in of the Android gate: a `'media'` use gets a URL, a
 * `'whole'` use gets `''` (the asset is over the limit), and a call that names
 * no use gets the URL, so a parser call that forgets to say what the URL is
 * for shows as a leaked URL. The mock set is that of `fileSrcCacheAv3.test.ts`.
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

const URL_OF = (path: string) => `/asset-url/${path.replace(/[^a-z0-9]/gi, '_')}`

function makeChar(assets: string[][], emotions: string[][] = []) {
  return {
    type: 'character',
    chaId: 'char-whole',
    additionalAssets: assets,
    emotionImages: emotions,
    customscript: [],
  } as unknown as Parameters<typeof ParseMarkdown>[1]
}

beforeEach(() => {
  vi.mocked(getFileSrc).mockReset()
  vi.mocked(getFileSrc).mockImplementation((async (path: string, use?: string) =>
    use === 'whole' ? '' : URL_OF(path)) as typeof getFileSrc)
})

async function render(text: string, char: ReturnType<typeof makeChar>, mode: 'normal' | 'back' = 'normal') {
  resetAssetsCache(
    (char as { additionalAssets: string[][] }).additionalAssets,
    (char as { emotionImages: string[][] }).emotionImages,
    [],
  )
  return await ParseMarkdown(text, char, mode)
}

describe('a whole use is withheld from author markup', () => {
  test.each([
    ['img', 'normal'],
    ['image', 'normal'],
    ['asset', 'normal'],
    ['raw', 'normal'],
    ['path', 'normal'],
    ['bg', 'back'],
  ] as const)('reproducer: {{%s::big}} asks for a whole use and shows no URL', async (type, mode) => {
    const path = `assets/whole-${type}-png`
    const char = makeChar([['big', path, 'png']])

    const out = await render(`{{${type}::big}}`, char, mode)

    expect(getFileSrc).toHaveBeenCalledWith(path, 'whole')
    expect(out).not.toContain(URL_OF(path))
  })

  test('reproducer: {{emotion::happy}} asks for a whole use and shows no URL', async () => {
    const path = 'assets/whole-emotion'
    const char = makeChar([], [['happy', path]])

    const out = await render('{{emotion::happy}}', char)

    expect(getFileSrc).toHaveBeenCalledWith(path, 'whole')
    expect(out).not.toContain(URL_OF(path))
  })

  test('reproducer: {{asset::clip}} of a non-video extension is a whole use even for a name that suggests a video', async () => {
    const path = 'assets/whole-clip-mov'
    const char = makeChar([['clip', path, 'mov']])

    await render('{{asset::clip}}', char)

    expect(getFileSrc).toHaveBeenCalledWith(path, 'whole')
  })
})

describe('a media use keeps the URL', () => {
  test.each([
    ['video'],
    ['video-img'],
    ['audio'],
    ['bgm'],
  ] as const)('contract: {{%s::clip}} asks for a media use and keeps the URL', async (type) => {
    const path = `assets/media-${type}`
    const char = makeChar([['clip', path, 'mp4']])

    const out = await render(`{{${type}::clip}}`, char)

    expect(getFileSrc).toHaveBeenCalledWith(path, 'media')
    // The bgm control attribute is removed by the later display passes.
    if (type !== 'bgm') {
      expect(out).toContain(URL_OF(path))
    }
  })

  test('contract: {{asset::clip}} of a video extension asks for a media use and keeps the URL', async () => {
    const path = 'assets/media-asset-mp4'
    const char = makeChar([['clip', path, 'mp4']])

    const out = await render('{{asset::clip}}', char)

    expect(getFileSrc).toHaveBeenCalledWith(path, 'media')
    expect(out).toContain(URL_OF(path))
  })
})

describe('the parser cache', () => {
  test('reproducer: a URL cached for a media use never answers a whole use of the same path', async () => {
    const path = 'assets/shared-mp4'
    const char = makeChar([['clip', path, 'mp4']])

    const video = await render('{{video::clip}}', char)
    const image = await render('{{img::clip}}', char)

    expect(video).toContain(URL_OF(path))
    expect(image).not.toContain(URL_OF(path))
    expect(getFileSrc).toHaveBeenCalledWith(path, 'media')
    expect(getFileSrc).toHaveBeenCalledWith(path, 'whole')
  })
})
