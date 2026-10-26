// @vitest-environment happy-dom

/**
 * Closing the file chooser of the emotion image picker without choosing files
 * does nothing: the pending flag that disables the add button is cleared, no
 * busy indicator starts and no emotion is added. Runs the REAL `addCharEmotion`
 * over the REAL `selectMultipleFileObjects` and `readPickedFileBytes`; the chooser
 * is played by `util.domPickerHarness.ts`. A file above the limit is never handed
 * to `FileReader.readAsArrayBuffer`, which is how the real reader reads a file.
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
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
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
import { alertError } from 'src/ts/alert'

/** A file that reports `size` bytes without holding them; a read of it is caught by the `FileReader` spy. */
function fileReportingSize(name: string, size: number): File {
    const file = new File([Uint8Array.of(1)], name)
    Object.defineProperty(file, 'size', { value: size })
    return file
}

let picker: DomPicker
// Every Blob the real reader was asked to read, through the same call the real reader uses.
let readBlobs: Blob[]

beforeEach(() => {
    picker = installDomPicker()
    readBlobs = []
    const realRead = FileReader.prototype.readAsArrayBuffer
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader, blob: Blob) {
        readBlobs.push(blob)
        return realRead.call(this, blob)
    })
    h.begin.mockClear()
    h.save.mockClear()
    vi.mocked(alertError).mockClear()
    testDb.db = { characters: [{ type: 'character', chaId: 'c1', emotionImages: [] }], allowAllExtentionFiles: false } as unknown as Database
    addingEmotion.set(false)
})

afterEach(() => {
    vi.mocked(FileReader.prototype.readAsArrayBuffer).mockRestore()
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
        expect(alertError).not.toHaveBeenCalled()
    })

    test('regression reproducer: when every file is above the limit the pending flag is cleared, nothing is read or added, one notice names them', async () => {
        const pending = addCharEmotion(0)

        picker.pick([fileReportingSize('big1.png', 1024 * 1024 + 1), fileReportingSize('big2.png', 2 * 1024 * 1024)])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(readBlobs).toEqual([])
        expect(get(addingEmotion)).toBe(false)
        expect(h.begin).not.toHaveBeenCalled()
        expect(h.save).not.toHaveBeenCalled()
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe('"big1.png" and "big2.png" are larger than the 1 MB limit, so they were not added.')
    })

    test('regression reproducer: a mixed pick saves the files within the limit in order, then reports the refused ones once', async () => {
        const pending = addCharEmotion(0)

        picker.pick([new File([Uint8Array.of(1)], 'happy.png'), fileReportingSize('big.png', 1024 * 1024 + 1), new File([Uint8Array.of(2)], 'sad.webp')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect((readBlobs as File[]).map((blob) => blob.name)).toEqual(['happy.png', 'sad.webp'])
        expect(get(addingEmotion)).toBe(false)
        expect((testDb.db.characters[0] as unknown as { emotionImages: unknown[][] }).emotionImages.map((entry) => entry[0])).toEqual(['happy', 'sad'])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe('"big.png" is larger than the 1 MB limit, so it was not added.')
        expect(vi.mocked(alertError).mock.invocationCallOrder[0]).toBeGreaterThan(h.save.mock.invocationCallOrder[1])
    })

    test('when a later save throws, the refused names are logged and the save error escapes', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        h.save.mockRejectedValueOnce(new Error('disk full'))
        const pending = addCharEmotion(0)
        const outcome = pending.then(() => 'resolved', (error: Error) => error.message)

        picker.pick([new File([Uint8Array.of(1)], 'happy.png'), fileReportingSize('big.png', 1024 * 1024 + 1)])

        expect(await outcome).toBe('disk full')
        expect(get(addingEmotion)).toBe(false)
        expect(warn).toHaveBeenCalledWith('"big.png" is larger than the 1 MB limit, so it was not added.')
        expect(alertError).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})
