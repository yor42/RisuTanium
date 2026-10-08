// @vitest-environment jsdom
/**
 * Every name exportChat interpolates into HTML (the HTML file and the
 * clipboard table) must reach the output as text, never as markup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const downloads: { name: string, data: Buffer }[] = []
let selections: string[] = []
const state = { charName: 'Aria', speakerName: 'Aria', userName: 'User' }

vi.mock(import('./storage/database.svelte'), () =>
  ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
  } as typeof import('./storage/database.svelte'))
)

vi.mock(import('./globalApi.svelte'), () =>
  ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
    downloadFile: async (name: string, data: Buffer) => { downloads.push({ name, data }) },
  } as unknown as typeof import('./globalApi.svelte'))
)

vi.mock(import('./stores.svelte'), () => {
  const chat = {
    fmIndex: -1,
    message: [
      { role: 'user', data: 'Question' },
      { role: 'char', data: 'Answer' },
      { role: 'char', data: 'Spoken', saying: 'speaker-id' },
    ],
  }
  const character = {
    type: 'character',
    get name() { return state.charName },
    firstMessage: 'Hello there',
    chatPage: 0,
    chats: [chat],
    defaultVariables: '',
  }
  return ({
    DBState: {
      db: {
        characters: [character],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('./stores.svelte'))
})

vi.mock(import('./alert'), () =>
  ({
    alertSelect: async () => selections.shift() ?? '0',
    alertWait: () => {},
    alertError: (e: unknown) => { throw e },
    alertNormal: () => {},
  } as unknown as typeof import('./alert'))
)

vi.mock(import('./util'), async (importOriginal) => ({
  ...(await importOriginal()),
  findCharacterbyId: () => ({ get name() { return state.speakerName } } as ReturnType<typeof import('./util').findCharacterbyId>),
  getUserName: () => state.userName,
}))

vi.mock(import('./translator/translator'), () =>
  ({
    translateHTML: async (v: string) => v,
  } as unknown as typeof import('./translator/translator'))
)

vi.mock(import('./process/index.svelte'), () => ({ doingChat: writable(false) } as unknown as typeof import('./process/index.svelte')))
vi.mock(import('./characterCards'), () => ({} as unknown as typeof import('./characterCards')))
vi.mock(import('./pngChunk'), () => ({} as unknown as typeof import('./pngChunk')))
vi.mock(import('./process/inlayScreen'), () => ({} as unknown as typeof import('./process/inlayScreen')))
vi.mock(import('./process/coldCharacterRestore'), () => ({} as unknown as typeof import('./process/coldCharacterRestore')))
vi.mock(import('./media/avatarThumb'), () => ({} as unknown as typeof import('./media/avatarThumb')))
vi.mock(import('./storage/characterSaveMarks'), () => ({} as unknown as typeof import('./storage/characterSaveMarks')))
vi.mock(import('./process/chatOrigin'), () => ({} as unknown as typeof import('./process/chatOrigin')))
vi.mock(import('./process/memory/busyActions'), () => ({} as unknown as typeof import('./process/memory/busyActions')))
vi.mock(import('./process/files/inlayCleanup'), () => ({} as unknown as typeof import('./process/files/inlayCleanup')))
vi.mock(import('./media'), () => ({} as unknown as typeof import('./media')))

//#endregion

import { exportChat } from './characters'

const HOSTILE = '</title><script>x</script><b>'

// Mode '2' is "export as HTML file", mode '3' copies an HTML table; the second
// answer is "do not translate", the third includes the persona name.
const exportHtmlFile = async () => {
  selections = ['2', '1', '0']
  await exportChat(0)
  expect(downloads).toHaveLength(1)
  return downloads[0].data.toString('utf-8')
}

const exportTable = async () => {
  let written = ''
  class FakeClipboardItem {
    constructor(public items: Record<string, Blob>) {}
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    written = await items[0].items['text/html'].text()
  })
  vi.stubGlobal('navigator', { clipboard: { write } })
  selections = ['3', '1', '0']
  await exportChat(0)
  expect(write).toHaveBeenCalledTimes(1)
  return written
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

beforeEach(() => {
  downloads.length = 0
  state.charName = 'Aria'
  state.speakerName = 'Aria'
  state.userName = 'User'
  vi.unstubAllGlobals()
})

describe('exportChat name escaping', () => {
  it('renders a hostile character name in the HTML file as text', async () => {
    state.charName = HOSTILE
    const doc = parse(await exportHtmlFile())

    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(doc.querySelectorAll('b')).toHaveLength(0)
    expect(doc.title).toBe(`${HOSTILE} Chat`)
    const headings = Array.from(doc.querySelectorAll('h2')).map((h) => h.textContent)
    expect(headings).toContain(HOSTILE)
  })

  it('renders hostile speaker and persona names in the HTML file as text', async () => {
    state.speakerName = HOSTILE
    state.userName = '<i>me</i>'
    const doc = parse(await exportHtmlFile())

    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(doc.querySelectorAll('b, i')).toHaveLength(0)
    const headings = Array.from(doc.querySelectorAll('h2')).map((h) => h.textContent)
    expect(headings).toContain(HOSTILE)
    expect(headings).toContain('<i>me</i>')
  })

  it('renders hostile names in both name cells of the clipboard table as text', async () => {
    state.charName = HOSTILE
    state.speakerName = '<u>s</u>'
    state.userName = '<i>me</i>'
    const doc = parse(await exportTable())

    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(doc.querySelectorAll('b, u, i')).toHaveLength(0)
    const cells = Array.from(doc.querySelectorAll('td:first-child')).map((c) => c.textContent)
    expect(cells).toEqual([HOSTILE, '<i>me</i>', HOSTILE, '<u>s</u>'])
  })

  it('leaves a plain name unchanged and writes an ampersand name as a single escaped entity', async () => {
    const plain = await exportHtmlFile()
    expect(plain).toContain('<title>Aria Chat</title>')
    expect(plain).toContain('<h2>Aria</h2>')

    downloads.length = 0
    state.charName = 'Tom & Jerry'
    const html = await exportHtmlFile()
    expect(html).toContain('<title>Tom &amp; Jerry Chat</title>')
    expect(html).toContain('<h2>Tom &amp; Jerry</h2>')
    expect(html).not.toContain('&amp;amp;')
  })
})
