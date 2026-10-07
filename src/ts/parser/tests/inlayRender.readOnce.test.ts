import { beforeEach, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { setInlayAsset } from 'src/ts/process/files/inlays'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'

const legacy = vi.hoisted(() => ({ map: new Map<string, unknown>(), gets: 0 }))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: vi.fn(async (key: string) => { legacy.gets++; return legacy.map.get(key) ?? null }),
      setItem: vi.fn(async (key: string, value: unknown) => { legacy.map.set(key, value) }),
      removeItem: vi.fn(async (key: string) => { legacy.map.delete(key) }),
      keys: vi.fn(async () => [...legacy.map.keys()]),
    }),
  },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => ({}),
  getCurrentChat: () => ({}),
  getDatabase: () => ({ modules: [], enabledModules: [] }),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: vi.fn(),
  setUsingSw: vi.fn(),
  readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
  DBState: { db: { characters: [{ chatPage: 0, chats: [{}], defaultVariables: '' }], globalChatVariables: {}, templateDefaultVariables: '' } },
  selIdState: { selId: 0 },
  selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as unknown as typeof import('src/ts/util'))

beforeEach(() => {
  let c = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++c}`)
})

test('parsing the same inlay twice gives the same markup and the second parse reads nothing from the app store or the old store', async () => {
  const store = createMemoryByteStore()
  injectAppStore(store)
  await setInlayAsset('ro-1', { name: 'v.mp4', ext: 'mp4', type: 'video', data: new Blob(['x'], { type: 'video/mp4' }) })
  const first = await ParseMarkdown('{{inlay::ro-1}}', null, 'back')
  const afterFirst = store.reads.length + legacy.gets
  const second = await ParseMarkdown('{{inlay::ro-1}}', null, 'back')
  expect(second).toBe(first)
  expect(store.reads.length + legacy.gets).toBe(afterFirst)
})
