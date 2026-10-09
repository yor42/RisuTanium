// @vitest-environment happy-dom

/**
 * Closing the file chooser of the emotion image picker without choosing files
 * does nothing: the pending flag that disables the add button is cleared, no
 * busy indicator starts and no emotion is added. Runs the REAL `addCharEmotion`
 * over the REAL `selectMultipleFile`; the chooser is played by
 * `util.domPickerHarness.ts`.
 */
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from './util.domPickerHarness'
import type { Database } from './storage/database.svelte'

const h = vi.hoisted(() => ({
    begin: vi.fn(() => ({ end: vi.fn() })),
    save: vi.fn(async () => 'saved-emotion'),
}))
//#region module mocks -- copied from characters.saveMarks.svelte.test.ts

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

const testDb = vi.hoisted(() => ({ db: {} as unknown as Database }))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: testDb,
    selectedCharID: writable(-1),
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => testDb.db),
    saveImage: h.save,
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ beginBusy: h.begin }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { addCharEmotion, addingEmotion } from './characters'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    h.begin.mockClear()
    h.save.mockClear()
    testDb.db = { characters: [{ type: 'character', chaId: 'c1', emotionImages: [] }], allowAllExtentionFiles: false } as unknown as Database
    addingEmotion.set(false)
})

afterEach(() => {
    picker.restore()
})

describe('addCharEmotion', () => {
    test('closing the chooser clears the pending flag and adds nothing', async () => {
        const pending = addCharEmotion(0)
        expect(get(addingEmotion)).toBe(true)

        picker.cancel()

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(get(addingEmotion)).toBe(false)
        expect(h.begin).not.toHaveBeenCalled()
        expect((testDb.db.characters[0] as unknown as { emotionImages: unknown[] }).emotionImages).toEqual([])
    })

    test('guard: chosen images are added and the pending flag is cleared', async () => {
        const pending = addCharEmotion(0)

        picker.pick([new File([Uint8Array.of(1)], 'happy.png'), new File([Uint8Array.of(2)], 'sad.webp')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(get(addingEmotion)).toBe(false)
        expect((testDb.db.characters[0] as unknown as { emotionImages: unknown[][] }).emotionImages.map((entry) => entry[0])).toEqual(['happy', 'sad'])
    })
})
