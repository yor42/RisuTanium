// @vitest-environment jsdom
/**
 * Plain-HTTP chat export: "HTML embed" is omitted from the export mode prompt when `ClipboardItem` or
 * `navigator.clipboard.write` is unavailable, while JSON, TXT, and HTML file modes keep their indices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const h = vi.hoisted(() => ({
  download: vi.fn(),
  normal: vi.fn(),
  clear: vi.fn(),
  wait: vi.fn(),
  selections: [] as string[],
  select: vi.fn(),
}))

const OFFERED_CANCEL = 'offered-cancel'

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
    downloadFile: h.download,
  } as unknown as typeof import('./globalApi.svelte'))
)

vi.mock(import('./stores.svelte'), () => {
  const chat = {
    fmIndex: -1,
    message: [
      { role: 'user', data: 'Question' },
      { role: 'char', data: 'Answer' },
    ],
  }
  const character = {
    type: 'character',
    name: 'Aria',
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
    alertSelect: async (msg: string[], display?: string, options?: { cancel?: string }) => {
      h.select(msg, display, options)
      const next = h.selections.shift() ?? '0'
      if (next === OFFERED_CANCEL) {
        return options?.cancel ?? Promise.reject(new Error('no cancel offered'))
      }
      return next
    },
    alertWait: h.wait,
    alertClear: h.clear,
    alertError: (e: unknown) => { throw e },
    alertNormal: h.normal,
  } as unknown as typeof import('./alert'))
)

vi.mock(import('./util'), async (importOriginal) => ({
  ...(await importOriginal()),
  findCharacterbyId: () => ({ name: 'Aria' } as ReturnType<typeof import('./util').findCharacterbyId>),
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

import { language } from '../lang'
import { exportChat } from './characters'
import { resetTaskHostForTests } from './alertTask.svelte'

beforeEach(() => {
  resetTaskHostForTests()
  h.download.mockReset()
  h.normal.mockReset()
  h.clear.mockReset()
  h.wait.mockReset()
  h.select.mockReset()
  h.selections = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('exportChat plain-HTTP clipboard availability', () => {
  it('regression reproducer: omits HTML embed option when ClipboardItem is undefined', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } })
    h.selections = [OFFERED_CANCEL]

    await exportChat(0)

    expect(h.select).toHaveBeenCalledTimes(1)
    expect(h.select.mock.calls[0][0]).toEqual([
      language.alerts.exportAsJson,
      language.alerts.exportAsTxt,
      language.alerts.exportAsHtmlFile,
    ])
    expect(h.select.mock.calls[0][0]).not.toContain(language.alerts.exportAsHtmlEmbed)
  })

  it('regression reproducer: omits HTML embed option when navigator.clipboard.write is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', class {
      constructor(public items: Record<string, Blob>) {}
    })
    vi.stubGlobal('navigator', {})
    h.selections = [OFFERED_CANCEL]

    await exportChat(0)

    expect(h.select).toHaveBeenCalledTimes(1)
    expect(h.select.mock.calls[0][0]).toEqual([
      language.alerts.exportAsJson,
      language.alerts.exportAsTxt,
      language.alerts.exportAsHtmlFile,
    ])

    h.select.mockReset()
    vi.stubGlobal('navigator', { clipboard: {} })
    h.selections = [OFFERED_CANCEL]

    await exportChat(0)

    expect(h.select).toHaveBeenCalledTimes(1)
    expect(h.select.mock.calls[0][0]).toEqual([
      language.alerts.exportAsJson,
      language.alerts.exportAsTxt,
      language.alerts.exportAsHtmlFile,
    ])
  })

  it('guard: offers HTML embed when ClipboardItem and navigator.clipboard.write exist and copies the HTML table', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    let writtenItems: FakeClipboardItem[] = []
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      writtenItems = items
    })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })
    h.selections = ['3', '1', '0']

    await exportChat(0)

    expect(h.select.mock.calls[0][0]).toEqual([
      language.alerts.exportAsJson,
      language.alerts.exportAsTxt,
      language.alerts.exportAsHtmlFile,
      language.alerts.exportAsHtmlEmbed,
    ])
    expect(write).toHaveBeenCalledTimes(1)
    expect(writtenItems).toHaveLength(1)
    expect(writtenItems[0].items['text/html'].type).toBe('text/html')
    expect(writtenItems[0].items['text/plain'].type).toBe('text/plain')
  })

  it('guard: JSON, TXT, and HTML file modes keep their indices and export when ClipboardItem is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', {})
    h.download.mockResolvedValue(true)

    h.selections = ['0']
    await exportChat(0)
    expect(h.download.mock.calls[0][0]).toMatch(/\.json$/)

    h.selections = ['1']
    await exportChat(0)
    expect(h.download.mock.calls[1][0]).toMatch(/\.txt$/)

    h.selections = ['2', '1', '0']
    await exportChat(0)
    expect(h.download.mock.calls[2][0]).toMatch(/\.html$/)
  })
})
