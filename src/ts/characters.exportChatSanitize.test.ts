// @vitest-environment jsdom
/**
 * The HTML written by exportChat must hold only markup the app would display,
 * including when translation output is merged in.
 *
 * Runs under jsdom: DOMPurify under happy-dom stops after its first removal, so
 * a removal assertion with several offenders would only prove the first one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const downloads: { name: string, data: Buffer }[] = []
const translateHTML = vi.fn<(v: string) => Promise<string>>()
let selections: string[] = []

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

vi.mock(import('./stores.svelte'), () =>
  ({
    DBState: {
      db: {
        characters: [
          {
            type: 'character',
            name: 'Aria',
            firstMessage: 'Hello there',
            chatPage: 0,
            chats: [
              {
                fmIndex: -1,
                message: [
                  { role: 'user', data: 'Question *one*' },
                  { role: 'char', data: 'Answer **two**' },
                ],
              },
            ],
            defaultVariables: '',
          },
        ],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('./stores.svelte'))
)

vi.mock(import('./alert'), () =>
  ({
    alertSelect: async () => selections.shift() ?? '0',
    alertWait: () => {},
    alertError: () => {},
    alertNormal: () => {},
  } as unknown as typeof import('./alert'))
)

vi.mock(import('./util'), async (importOriginal) => ({
  ...(await importOriginal()),
  findCharacterbyId: () => ({ name: 'Aria' } as ReturnType<typeof import('./util').findCharacterbyId>),
  getUserName: () => 'User',
}))

vi.mock(import('./translator/translator'), () =>
  ({
    translateHTML: (v: string) => translateHTML(v),
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
import { parseMarkdownSafe } from './parser/parser.svelte'

// Mode '2' is "export as HTML file"; the second answer picks translation
// ('0') or no translation ('1'); the third includes the persona name.
const exportHtml = async (translate: boolean) => {
  selections = ['2', translate ? '0' : '1', '0']
  await exportChat(0)
  expect(downloads).toHaveLength(1)
  return downloads[0].data.toString('utf-8')
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

beforeEach(() => {
  downloads.length = 0
  translateHTML.mockReset()
})

describe('exportChat HTML export', () => {
  it('removes handlers and scripts from merged translation output and keeps the text and normal markup', async () => {
    translateHTML.mockImplementation(async (v) =>
      `<p>Traducido: ${v.replace(/<[^>]*>/g, '')}</p>` +
      '<img src="x" onerror="alert(1)">' +
      '<script>alert(2)</script>' +
      '<b>negrita</b>' +
      '<iframe src="https://example.com/x"></iframe>' +
      '<style>p{color:red}</style>' +
      '<span class="big">clase</span>'
    )
    const html = await exportHtml(true)
    const doc = parse(html)

    // The first message div and both chat messages carry the translation.
    expect(translateHTML).toHaveBeenCalledTimes(3)
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/alert\(/)
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(doc.querySelectorAll('img[onerror]')).toHaveLength(0)
    expect(html).toContain('Traducido: Hello there')
    expect(html).toContain('Traducido: Question one')
    expect(doc.querySelectorAll('b').length).toBe(3)
    // Same strictness as the untranslated export: no iframe, style or class.
    expect(doc.querySelectorAll('iframe')).toHaveLength(0)
    expect(doc.querySelectorAll('style')).toHaveLength(1) // the export's own stylesheet
    expect(html).not.toContain('color:red')
    expect(doc.querySelectorAll('[class="big"]')).toHaveLength(0)
    expect(html).toContain('clase')
  })

  it('leaves a non-translated export identical to the markdown-safe rendering of each message', async () => {
    const html = await exportHtml(false)

    expect(translateHTML).not.toHaveBeenCalled()
    expect(html).toContain(`<div>${parseMarkdownSafe('Hello there')}</div>`)
    expect(html).toContain(`<div>${parseMarkdownSafe('Question *one*')}</div>`)
    expect(html).toContain(`<div>${parseMarkdownSafe('Answer **two**')}</div>`)
  })
})
