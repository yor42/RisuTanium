// @vitest-environment jsdom
/**
 * The completion notice of `exportChat` (text mode): the web build says the download started, desktop keeps
 * the saved wording. Same module mocks as characters.exportChatNames.test.ts; the alert records its argument.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const platformBox = vi.hoisted(() => ({ isTauri: false }))
const alerts = vi.hoisted(() => ({ normal: [] as string[], selections: [] as string[] }))

vi.mock(import('./platform'), () => ({
  get isTauri() { return platformBox.isTauri },
}) as unknown as typeof import('./platform'))

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
    downloadFile: async () => true,
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
    alertSelect: async () => alerts.selections.shift() ?? '0',
    alertWait: () => {},
    alertError: (e: unknown) => { throw e },
    alertNormal: (text: string) => { alerts.normal.push(text) },
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

// Mode '1' is "export as text file", which asks no translate or persona questions.
const exportTextFile = async () => {
  alerts.selections = ['1']
  await exportChat(0)
}

beforeEach(() => {
  alerts.normal.length = 0
  platformBox.isTauri = false
})

describe('exportChat completion notice', () => {
  it('on the web says the download started and not that the file was saved', async () => {
    await exportTextFile()

    expect(alerts.normal).toEqual([language.exportDownloadStarted])
    expect(alerts.normal).not.toContain(language.successExport)
  })

  it('on desktop keeps the saved wording', async () => {
    platformBox.isTauri = true
    await exportTextFile()

    expect(alerts.normal).toEqual([language.successExport])
    expect(alerts.normal).not.toContain(language.exportDownloadStarted)
  })
})
