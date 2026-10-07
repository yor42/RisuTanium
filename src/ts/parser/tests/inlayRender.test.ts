/**
 * What `parseInlayAssets` (through the exported `ParseMarkdown`) does with an
 * inlay token: the markup it makes from the render the inlay module gives, and
 * the same markup on every render. `getInlayRender` is mocked; the render cache
 * and the delivery of the source are the inlay module's, tested with the module
 * in `process/files/tests/inlays.seam.test.ts`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown } from '../parser.svelte'

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

const mockedDb = vi.hoisted(() => ({
  db: {
    characters: [{ chatPage: 0, chats: [{}], defaultVariables: '' }],
    globalChatVariables: {},
    templateDefaultVariables: '',
    hideAllImages: false,
  } as Record<string, unknown>,
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: mockedDb,
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../stores.svelte')
})

const inlayReads = vi.hoisted(() => ({ asked: [] as string[], result: null as unknown }))

vi.mock(import('../../process/files/inlays'), () => {
  const read = vi.fn(async (id: string) => {
    inlayReads.asked.push(id)
    return inlayReads.result
  })
  return { getInlayRender: read } as unknown as typeof import('../../process/files/inlays')
})

//#endregion

import type { InlayRender } from '../../process/files/inlays'

function reading(result: InlayRender | null) {
  inlayReads.result = result
}

let counter = 0
const freshId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

beforeEach(() => {
  inlayReads.asked = []
  inlayReads.result = null
  mockedDb.db.hideAllImages = false
})

describe('rendering an inlay token', () => {
  test('an image becomes an img element carrying the URL of the render, and every render has the same markup', async () => {
    const id = freshId()
    reading({ type: 'image', url: 'https://assets.test/a.png', source: 'store-url' })
    const first = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    const second = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    expect(first).toContain('<img src="https://assets.test/a.png"')
    expect(second).toBe(first)
    expect(inlayReads.asked).toEqual([id, id])
  })

  test.each([
    ['video', '<video controls=""><source src="blob:test/v" type="video/mp4"></video>'],
    ['audio', '<audio controls=""><source src="blob:test/v" type="audio/mpeg"></audio>'],
  ] as const)('a %s becomes its element carrying the URL of the render', async (type, element) => {
    const id = freshId()
    reading({ type, url: 'blob:test/v', source: 'stored-blob' })
    const first = await ParseMarkdown(`{{inlayed::${id}}}`, null, 'back')
    const second = await ParseMarkdown(`{{inlayed::${id}}}`, null, 'back')
    expect(first).toContain(element)
    expect(second).toBe(first)
  })

  test('an image is left out when images are hidden, and a video is not', async () => {
    const id = freshId()
    mockedDb.db.hideAllImages = true
    reading({ type: 'image', url: 'blob:test/i', source: 'memory-blob' })
    expect(await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')).not.toContain('blob:test/i')
    reading({ type: 'video', url: 'blob:test/v', source: 'memory-blob' })
    expect(await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')).toContain('blob:test/v')
  })

  test('a signature token is removed on every render', async () => {
    const id = freshId()
    reading({ type: 'signature', url: '', source: 'signature' })
    const first = await ParseMarkdown(`{{inlayeddata::${id}}}`, null, 'back')
    const second = await ParseMarkdown(`{{inlayeddata::${id}}}`, null, 'back')
    expect(first.trim()).toBe('')
    expect(second).toBe(first)
  })

  test('an id that is not found renders without an element and is asked again', async () => {
    const id = freshId()
    reading(null)
    const first = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    const second = await ParseMarkdown(`{{inlay::${id}}}`, null, 'back')
    expect(first).not.toContain('<img')
    expect(first).toContain(`{{inlay::${id}}}`)
    expect(second).toBe(first)
    expect(inlayReads.asked).toEqual([id, id])
  })
})
