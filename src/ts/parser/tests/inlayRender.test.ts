// @vitest-environment jsdom
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

  describe('an image the platform withholds', () => {
    const MIB = 1024 * 1024
    const withheld = (name: string): InlayRender => ({ type: 'image', url: '', source: 'withheld', name, size: 64 * MIB + 1 })
    const parsedInto = (html: string) => {
      const root = document.createElement('div')
      root.innerHTML = html
      return root
    }

    test('an inlayed token becomes a box inside the image block, with the name and the size and no img element', async () => {
      const id = freshId()
      reading(withheld('big.png'))
      const root = parsedInto(await ParseMarkdown(`{{inlayed::${id}}}`, null, 'back'))
      expect(root.querySelector('img')).toBeNull()
      const box = root.querySelector('.x-risu-risu-inlay-image div.x-risu-tool-call')
      expect(box).not.toBeNull()
      expect(box?.textContent).toContain('big.png')
      expect(box?.textContent).toContain('64.0 MiB')
    })

    test('a hostile name is text: no element is made from it and its characters survive', async () => {
      const hostile = '<img src=x onerror=alert(1)>.png'
      reading(withheld(hostile))
      const root = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
      expect(root.querySelector('img')).toBeNull()
      expect(root.textContent).toContain(hostile)
      reading(withheld('a$&b.png'))
      const dollar = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
      expect(dollar.textContent).toContain('a$&b.png')
    })

    test('a name with markdown and typographer triggers renders verbatim inside an inline span', async () => {
      const name = 'a*b*_c_ -- "q" (c)... +-.png'
      reading(withheld(name))
      const root = parsedInto(await ParseMarkdown(`see {{inlay::${freshId()}}} here`, null, 'normal'))
      const box = root.querySelector('span.x-risu-tool-call')
      expect(box).not.toBeNull()
      expect(root.querySelector('em')).toBeNull()
      expect(root.querySelector('mark')).toBeNull()
      expect(box?.textContent).toContain(name)
    })

    test('a multi-line name is one line of text, not a code block', async () => {
      reading(withheld('a\n\n    b.png'))
      const root = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'normal'))
      expect(root.querySelector('pre')).toBeNull()
      expect(root.querySelector('code')).toBeNull()
      expect(root.querySelector('.x-risu-tool-call')?.textContent).toContain('a b.png')
    })

    test('a name over 200 characters is cut with an ellipsis', async () => {
      reading(withheld('x'.repeat(300) + '.png'))
      const root = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
      const text = root.querySelector('.x-risu-tool-call')?.textContent ?? ''
      expect(text).toContain('x'.repeat(200) + '...')
      expect(text).not.toContain('x'.repeat(201))
    })

    test('guard: nothing is shown when images are hidden', async () => {
      mockedDb.db.hideAllImages = true
      reading(withheld('big.png'))
      const html = await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back')
      expect(html).not.toContain('x-risu-tool-call')
      expect(html).not.toContain('big.png')
    })
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

describe('an audio or video the platform withholds', () => {
  const MIB = 1024 * 1024
  const withheld = (type: 'audio' | 'video', name: string): InlayRender => ({ type, url: '', source: 'withheld', name, size: 64 * MIB + 1 })
  const parsedInto = (html: string) => {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  test('an audio in an inlayed token becomes a box inside the image block, with the name and the size and no audio element', async () => {
    reading(withheld('audio', 'big.mp3'))
    const root = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
    expect(root.querySelector('audio')).toBeNull()
    const box = root.querySelector('.x-risu-risu-inlay-image div.x-risu-tool-call')
    expect(box).not.toBeNull()
    expect(box?.textContent).toContain('big.mp3')
    expect(box?.textContent).toContain('64.0 MiB')
  })

  test('an audio in an inline token becomes an inline span', async () => {
    reading(withheld('audio', 'big.mp3'))
    const root = parsedInto(await ParseMarkdown(`see {{inlay::${freshId()}}} here`, null, 'normal'))
    expect(root.querySelector('audio')).toBeNull()
    const box = root.querySelector('span.x-risu-tool-call')
    expect(box).not.toBeNull()
    expect(root.querySelector('div.x-risu-tool-call')).toBeNull()
    expect(box?.textContent).toContain('big.mp3')
  })

  test('a hostile audio name is text: no element is made from it and its characters survive', async () => {
    const hostile = '<img src=x onerror=alert(1)>.mp3'
    reading(withheld('audio', hostile))
    const root = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('audio')).toBeNull()
    expect(root.textContent).toContain(hostile)
  })

  test('a video becomes the same box in an inlayed token and an inline span in an inline one, with no video element', async () => {
    reading(withheld('video', 'big.webm'))
    const block = parsedInto(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back'))
    expect(block.querySelector('video')).toBeNull()
    expect(block.querySelector('.x-risu-risu-inlay-image div.x-risu-tool-call')?.textContent).toContain('big.webm')
    expect(block.querySelector('.x-risu-tool-call')?.textContent).toContain('64.0 MiB')
    const inline = parsedInto(await ParseMarkdown(`see {{inlay::${freshId()}}} here`, null, 'normal'))
    expect(inline.querySelector('video')).toBeNull()
    expect(inline.querySelector('span.x-risu-tool-call')?.textContent).toContain('big.webm')
    expect(inline.querySelector('div.x-risu-tool-call')).toBeNull()
  })

  test('guard: hiding images leaves the box of a withheld audio and video', async () => {
    mockedDb.db.hideAllImages = true
    reading(withheld('audio', 'big.mp3'))
    expect(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back')).toContain('big.mp3')
    reading(withheld('video', 'big.webm'))
    expect(await ParseMarkdown(`{{inlayed::${freshId()}}}`, null, 'back')).toContain('big.webm')
  })
})
