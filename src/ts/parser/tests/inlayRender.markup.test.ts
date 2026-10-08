// @vitest-environment jsdom
/**
 * The markup `ParseMarkdown` emits for an inlay token over the real inlay
 * module and an in-memory app store: the URL a store gives is the URL in the
 * markup, a rewrite shows in the next render's markup, and a deleted inlay's
 * token is left in the text. The old `inlay` LocalForage database is an
 * in-memory map. Synthetic data only.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { injectAppStore } from '../../storage/store/appStore'
import { createMemoryByteStore } from '../../process/files/tests/memoryByteStore'
import { removeInlayAsset, setInlayAsset } from '../../process/files/inlays'
import { ParseMarkdown } from '../parser.svelte'

//#region module mocks

const legacy = vi.hoisted(() => ({ map: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: vi.fn(async (key: string) => legacy.map.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: unknown) => { legacy.map.set(key, value) }),
      removeItem: vi.fn(async (key: string) => { legacy.map.delete(key) }),
      keys: vi.fn(async () => [...legacy.map.keys()]),
    }),
  },
}))

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
        characters: [{ chatPage: 0, chats: [{}], defaultVariables: '' }],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

vi.mock(import('../../media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('../../model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('../../util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('../../util'))

//#endregion

let created = 0
let revoked: string[]
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
let counter = 0
const freshId = () => `markup-${++counter}`

beforeEach(() => {
  legacy.map.clear()
  created = 0
  revoked = []
  URL.createObjectURL = vi.fn(() => `blob:test/${++created}`)
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
  return () => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  }
})

function video(text: string) {
  return { name: 'v.mp4', ext: 'mp4', type: 'video' as const, data: new Blob([text], { type: 'video/mp4' }) }
}

describe('the markup of an inlay token over the inlay module', () => {
  test('a store that serves URLs puts its URL in the markup and makes no object URL', async () => {
    const store = createMemoryByteStore({ urlFor: async (key) => `asset://localhost/${encodeURIComponent(key)}` })
    injectAppStore(store)
    const id = freshId()
    await setInlayAsset(id, video('x'))
    const body = [...store.files.keys()].find((key) => key.startsWith('inlays/b-'))!

    const markup = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')

    expect(markup).toContain(`<source src="asset://localhost/${encodeURIComponent(body)}" type="video/mp4">`)
    expect(created).toBe(0)
  })

  test('a rewrite shows in the next markup and the object URL of the old one is revoked', async () => {
    injectAppStore(createMemoryByteStore())
    const id = freshId()
    await setInlayAsset(id, video('old'))
    const first = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    expect(first).toContain('src="blob:test/1"')
    expect(await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')).toBe(first)

    await setInlayAsset(id, video('new'))
    const next = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')

    expect(next).toContain('src="blob:test/2"')
    expect(revoked).toEqual(['blob:test/1'])
  })

  test('a deleted inlay leaves its token in the text, as an id that was never written does', async () => {
    injectAppStore(createMemoryByteStore())
    const id = freshId()
    await setInlayAsset(id, video('x'))
    expect(await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')).toContain('<video')

    await removeInlayAsset(id)

    const gone = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    expect(gone).toBe((await ParseMarkdown(`{{inlay::${freshId()}}}`, null, 'back')).replace(/markup-\d+/, id))
    expect(gone).not.toContain('<video')
  })
})
