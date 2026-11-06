// @vitest-environment jsdom
/**
 * Closing the save picker of `exportChat` shows no success notice and clears the wait dialog the
 * HTML mode puts up for every message. Same module mocks as characters.exportChatNotice.test.ts;
 * the download result is the picker outcome (`false` is a cancel) and the alert records its calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const h = vi.hoisted(() => ({
  download: vi.fn(),
  normal: vi.fn(),
  clear: vi.fn(),
  wait: vi.fn(),
  selections: [] as string[],
}))

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
    alertSelect: async () => h.selections.shift() ?? '0',
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

import { exportChat } from './characters'

// Mode '0' is JSON, '1' text and '2' an HTML file, which also asks the translate and persona questions.
const exportMode = async (selections: string[]) => {
  h.selections = selections
  await exportChat(0)
}

beforeEach(() => {
  h.download.mockReset()
  h.normal.mockReset()
  h.clear.mockReset()
  h.wait.mockReset()
})

describe('exportChat cancelled picker', () => {
  it('regression reproducer: the HTML mode clears its wait dialog and shows no success notice', async () => {
    h.download.mockResolvedValue(false)

    await exportMode(['2', '1', '0'])

    expect(h.download).toHaveBeenCalledTimes(1)
    expect(h.wait.mock.invocationCallOrder.length).toBeGreaterThan(0)
    expect(h.clear).toHaveBeenCalledTimes(1)
    expect(h.clear.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...h.wait.mock.invocationCallOrder))
    expect(h.normal).not.toHaveBeenCalled()
  })

  it('regression reproducer: the JSON and text modes show no success notice', async () => {
    h.download.mockResolvedValue(false)

    await exportMode(['0'])
    await exportMode(['1'])

    expect(h.download).toHaveBeenCalledTimes(2)
    expect(h.clear).toHaveBeenCalledTimes(2)
    expect(h.normal).not.toHaveBeenCalled()
  })

  it('guard: a saved HTML export shows the success notice once and does not clear', async () => {
    h.download.mockResolvedValue(true)

    await exportMode(['2', '1', '0'])

    expect(h.normal).toHaveBeenCalledTimes(1)
    expect(h.clear).not.toHaveBeenCalled()
  })
})
