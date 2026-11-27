// @vitest-environment jsdom
/**
 * The speaker names `exportChat` writes for a group chat (text file, HTML file and clipboard table): the
 * live member's name, else the name the group recorded when the member joined, else "Unknown Character".
 * The member lookup is the real `findCharacterbyId` of `./util` and the real `groupMembers` over a
 * mocked database; only the download, clipboard and alert edges are mocked.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (a deleted member
 * was written as "Unknown Character"); `guard:` passes before and after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const downloads: { name: string, data: Buffer }[] = []
let selections: string[] = []

// `members` is the group's risutanium_members exactly as joinRecord writes it ({name, slot 0..7} under the
// member's chaId); `live` are the characters that still exist besides the group.
const state = vi.hoisted(() => ({
  members: undefined as Record<string, unknown> | undefined,
  live: [] as Record<string, unknown>[],
  // The database object of the mocked stores, which the real indCharacterbyId reads through getDatabase.
  db: {} as Record<string, unknown>,
}))

vi.mock(import('./storage/database.svelte'), () =>
  ({
    appVer: '1234.5.67',
    defaultSdDataFunc: () => ({}),
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => state.db,
  } as unknown as typeof import('./storage/database.svelte'))
)

vi.mock(import('./globalApi.svelte'), () =>
  ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
    downloadFile: async (name: string, data: Buffer) => { downloads.push({ name, data }); return true },
  } as unknown as typeof import('./globalApi.svelte'))
)

vi.mock(import('./stores.svelte'), () => {
  const chat = {
    fmIndex: -1,
    message: [
      { role: 'user', data: 'Question' },
      { role: 'char', data: 'Spoken', saying: 'gone-id' },
    ],
  }
  const group = {
    type: 'group',
    name: 'The Group',
    chaId: 'group-id',
    firstMessage: 'Welcome',
    characters: ['gone-id'],
    chatPage: 0,
    chats: [chat],
    defaultVariables: '',
    get risutanium_members() { return state.members },
  }
  state.db = {
    get characters() { return [group, ...state.live] },
    globalChatVariables: {},
    templateDefaultVariables: '',
  }
  return ({
    DBState: {
      db: state.db,
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
  getUserName: () => 'User',
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

const RECORDED = { 'gone-id': { name: 'Alice', slot: 0 } }
const member = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'character', chaId: 'gone-id', name, chats: [], chatPage: 0, ...extra,
})

// Mode '1' is "export as text file"; '2' is "export as HTML file", '3' copies an HTML table; the next
// answers are "do not translate" and "include the persona name".
const exportText = async () => {
  selections = ['1']
  await exportChat(0)
  expect(downloads).toHaveLength(1)
  return downloads[0].data.toString('utf-8')
}

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
const headings = (html: string) => Array.from(parse(html).querySelectorAll('h2')).map((h) => h.textContent)
const cells = (html: string) => Array.from(parse(html).querySelectorAll('td:first-child')).map((c) => c.textContent)

beforeEach(() => {
  downloads.length = 0
  state.members = undefined
  state.live = []
  vi.unstubAllGlobals()
})

describe('exportChat text file: speaker of a group message', () => {
  it('regression reproducer: a deleted member is written under the name recorded at join', async () => {
    state.members = RECORDED
    const text = await exportText()
    expect(text).toContain('--Alice\nSpoken')
    expect(text).not.toContain('Unknown Character')
  })

  it('guard: a live member is written under its own name, not the record (renamed after joining)', async () => {
    state.members = RECORDED
    state.live = [member('Alicia')]
    expect(await exportText()).toContain('--Alicia\nSpoken')
  })

  it('guard: a trashed member and a stub-shaped member still win over the record', async () => {
    state.members = RECORDED
    state.live = [member('Alicia', { trashTime: 1234 })]
    expect(await exportText()).toContain('--Alicia\nSpoken')

    downloads.length = 0
    // A stub carries only name, image, chaId, type and the trash/interaction times.
    state.live = [{ type: 'character', chaId: 'gone-id', name: 'Stubby', image: '', lastInteraction: 1 }]
    expect(await exportText()).toContain('--Stubby\nSpoken')
  })

  it('guard: a deleted member with no record is written as Unknown Character', async () => {
    expect(await exportText()).toContain('--Unknown Character\nSpoken')
  })
})

describe('exportChat HTML file and clipboard table: speaker of a group message', () => {
  it('regression reproducer: the HTML file names a deleted member by the record', async () => {
    state.members = RECORDED
    const html = await exportHtmlFile()
    expect(headings(html)).toContain('Alice')
    expect(headings(html)).not.toContain('Unknown Character')
  })

  it('regression reproducer: the clipboard table names a deleted member by the record', async () => {
    state.members = RECORDED
    expect(cells(await exportTable())).toEqual(['The Group', 'User', 'Alice'])
  })

  it('guard: a live member beats the record in the HTML file and the table', async () => {
    state.members = RECORDED
    state.live = [member('Alicia')]
    expect(headings(await exportHtmlFile())).toContain('Alicia')
    downloads.length = 0
    expect(cells(await exportTable())).toEqual(['The Group', 'User', 'Alicia'])
  })

  it('guard: a deleted member with no record is Unknown Character in both', async () => {
    expect(headings(await exportHtmlFile())).toContain('Unknown Character')
    downloads.length = 0
    expect(cells(await exportTable())).toEqual(['The Group', 'User', 'Unknown Character'])
  })

  it('regression reproducer: a recorded name that is markup reaches the HTML as text', async () => {
    state.members = { 'gone-id': { name: '<b>Al</b>', slot: 0 } }
    const doc = parse(await exportHtmlFile())
    expect(doc.querySelectorAll('b')).toHaveLength(0)
    expect(Array.from(doc.querySelectorAll('h2')).map((h) => h.textContent)).toContain('<b>Al</b>')
  })
})
