// @vitest-environment happy-dom

/**
 * The image writers of `src/ts/characters.ts` (`selectCharImg`, `addCharEmotion`,
 * `makeGroupImage`) write into the character the user acted on, however the
 * character list changes while a file picker, an image save or an image load
 * is awaited:
 * - the list can shift (a programmatic selection change or an index shift during
 *   the picker), so a stored index may name another character afterwards;
 * - the slot can be swapped for an archived stub (a placeholder with a
 *   `coldstorage` key), which must never receive image data;
 * - a target that is gone or is now a stub makes the writer stop quietly, with a
 *   console warning and no write.
 *
 * - a member image that fails to load settles the action: busy ends and the
 *   group keeps its current image instead of getting a blank composite.
 *
 * Titles beginning "regression reproducer:" fail against the version without
 * the fix they pin (index-bound writes, or no image error handling); "guard:"
 * titles pass before and after the fix.
 *
 * The real `src/ts/characters.ts` is driven with every other module mocked,
 * following `characters.makeGroupImageWait.test.ts`; `busyActions` is real.
 * The database is a `$state` proxy, as in the application.
 */
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'

//#region module mocks

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
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

const hoisted = vi.hoisted(() => ({
    testDb: { db: {} as unknown as Database },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: hoisted.testDb,
    selectedCharID: writable(0),
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async (loc: string) => `blob:${loc}`),
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
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => hoisted.testDb.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(() => 'WEBP'),
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
    PngChunk: { readGenerator: vi.fn() },
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

import { addCharEmotion, addingEmotion, makeGroupImage, selectCharImg } from './characters'
import { getImageType } from 'src/ts/media'
import { PngChunk } from 'src/ts/pngChunk'
import { alertStore } from 'src/ts/alert'
import { saveImage } from 'src/ts/storage/database.svelte'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { findCharacterbyId, selectMultipleFile, selectSingleFile } from 'src/ts/util'
import { selectedCharID } from 'src/ts/stores.svelte'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

type Slot = Database['characters'][number]

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

function fullCharacter(chaId: string, image: string): Slot {
    return {
        type: 'character',
        chaId,
        name: chaId,
        image,
        ccAssets: [],
        emotionImages: [],
        chats: [],
    } as unknown as Slot
}

/** What the character list holds for an archived character: no content, a `coldstorage` pointer. */
function stubOf(chaId: string, image: string): Slot {
    return {
        type: 'character',
        chaId,
        name: chaId,
        image,
        coldstorage: `unit-${chaId}`,
        coldStoragedChats: [],
        chats: [],
    } as unknown as Slot
}

function installList(...slots: Slot[]): Slot[] {
    const reactive = $state({ characters: slots })
    hoisted.testDb.db = reactive as unknown as Database
    return reactive.characters
}

async function flush(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setTimeout(r, 0))
}

const picked = { name: 'new.webp', data: new Uint8Array([1, 2, 3]) }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    resetBusyActionsForTest()
    vi.mocked(saveImage).mockReset().mockResolvedValue('saved/new.webp')
    vi.mocked(markCharacterForSave).mockReset()
    vi.mocked(selectSingleFile).mockReset()
    vi.mocked(selectMultipleFile).mockReset()
    vi.mocked(getImageType).mockReset().mockReturnValue('WEBP')
    vi.mocked(PngChunk.readGenerator).mockReset()
    addingEmotion.set(false)
    selectedCharID.set(0)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    warn.mockRestore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('selectCharImg writes into the character that was acted on', () => {
    test('guard: an unchanged list gets the new image, the old one becomes an asset, and the character is marked', async () => {
        const characters = installList(fullCharacter('X', 'old.png'), fullCharacter('Y', 'y.png'))
        const picker = deferred<typeof picked | null>()
        vi.mocked(selectSingleFile).mockReturnValue(picker.promise as never)

        const running = selectCharImg(0)
        expect(isBusy()).toBe(false)
        picker.resolve(picked)
        await running

        const x = characters[0]
        expect(x.image).toBe('saved/new.webp')
        expect((x as { ccAssets: unknown[] }).ccAssets).toHaveLength(1)
        expect(characters[1].image).toBe('y.png')
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(isBusy()).toBe(false)
    })

    test('guard: a cancelled picker writes nothing and starts no busy entry', async () => {
        const characters = installList(fullCharacter('X', 'old.png'))
        vi.mocked(selectSingleFile).mockResolvedValue(null as never)

        await selectCharImg(0)

        expect(characters[0].image).toBe('old.png')
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a slot swapped for a stub during the picker receives nothing', async () => {
        const characters = installList(fullCharacter('X', 'old.png'), fullCharacter('Y', 'y.png'))
        const picker = deferred<typeof picked | null>()
        vi.mocked(selectSingleFile).mockReturnValue(picker.promise as never)

        const running = selectCharImg(0)
        characters[0] = stubOf('X', 'old.png')
        const stub = characters[0]
        picker.resolve(picked)
        await running

        expect((stub as { ccAssets?: unknown[] }).ccAssets).toBeUndefined()
        expect(stub.image).toBe('old.png')
        expect(characters[1].image).toBe('y.png')
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledOnce()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a character inserted before the target during the picker does not take the image', async () => {
        const characters = installList(fullCharacter('X', 'old.png'), fullCharacter('Y', 'y.png'))
        const x = characters[0]
        const picker = deferred<typeof picked | null>()
        vi.mocked(selectSingleFile).mockReturnValue(picker.promise as never)

        const running = selectCharImg(0)
        characters.unshift(fullCharacter('Z', 'z.png'))
        picker.resolve(picked)
        await running

        expect(x.image).toBe('saved/new.webp')
        expect(characters[0].image).toBe('z.png')
        expect((characters[0] as { ccAssets: unknown[] }).ccAssets).toHaveLength(0)
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(markCharacterForSave).not.toHaveBeenCalledWith('Z')
    })

    test('regression reproducer: a target removed during the picker leaves its neighbour untouched', async () => {
        const characters = installList(fullCharacter('X', 'old.png'), fullCharacter('Y', 'y.png'))
        const picker = deferred<typeof picked | null>()
        vi.mocked(selectSingleFile).mockReturnValue(picker.promise as never)

        const running = selectCharImg(0)
        characters.splice(0, 1)
        picker.resolve(picked)
        await running

        expect(characters[0].image).toBe('y.png')
        expect((characters[0] as { ccAssets: unknown[] }).ccAssets).toHaveLength(0)
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledOnce()
    })

    test('regression reproducer: PNG chunks go to the target when the list shifted during the picker', async () => {
        const characters = installList(fullCharacter('X', 'old.png'))
        const x = characters[0]
        vi.mocked(getImageType).mockReturnValue('PNG')
        vi.mocked(PngChunk.readGenerator).mockImplementation(async function* () {
            yield { key: 'Title', value: 'a title' }
        } as never)
        const picker = deferred<typeof picked | null>()
        vi.mocked(selectSingleFile).mockReturnValue(picker.promise as never)

        const running = selectCharImg(0)
        characters.unshift(fullCharacter('Z', 'z.png'))
        picker.resolve(picked)
        await running

        expect((x as { extentions?: { pngExif?: Record<string, string> } }).extentions?.pngExif?.Title).toBe('a title')
        expect((characters[0] as { extentions?: unknown }).extentions).toBeUndefined()
    })

    test('regression reproducer: a slot swapped for a stub while the image is saved receives nothing', async () => {
        const characters = installList(fullCharacter('X', 'old.png'))
        const saving = deferred<string>()
        vi.mocked(saveImage).mockReturnValue(saving.promise)
        vi.mocked(selectSingleFile).mockResolvedValue(picked as never)

        const running = selectCharImg(0)
        await flush()
        characters[0] = stubOf('X', 'old.png')
        const stub = characters[0]
        saving.resolve('saved/new.webp')
        await running

        expect((stub as { ccAssets?: unknown[] }).ccAssets).toBeUndefined()
        expect(stub.image).toBe('old.png')
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })
})

describe('addCharEmotion writes into the character that was acted on', () => {
    test('guard: an unchanged list gets the emotion images and the character is marked', async () => {
        const characters = installList(fullCharacter('X', 'x.png'))
        const picker = deferred<typeof picked[] | null>()
        vi.mocked(selectMultipleFile).mockReturnValue(picker.promise as never)

        const running = addCharEmotion(0)
        expect(get(addingEmotion)).toBe(true)
        picker.resolve([{ name: 'happy.png', data: picked.data }])
        await running

        expect((characters[0] as { emotionImages: unknown[] }).emotionImages).toEqual([['happy', 'saved/new.webp']])
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(get(addingEmotion)).toBe(false)
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a slot swapped for a stub while an image is saved receives nothing and the call still settles', async () => {
        const characters = installList(fullCharacter('X', 'x.png'))
        const saving = deferred<string>()
        vi.mocked(saveImage).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFile).mockResolvedValue([{ name: 'happy.png', data: picked.data }] as never)

        const running = addCharEmotion(0)
        await flush()
        characters[0] = stubOf('X', 'x.png')
        const stub = characters[0]
        saving.resolve('saved/new.webp')

        await expect(running).resolves.toBeUndefined()
        expect((stub as { emotionImages?: unknown[] }).emotionImages).toBeUndefined()
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(get(addingEmotion)).toBe(false)
        expect(isBusy()).toBe(false)
        expect(warn).toHaveBeenCalledOnce()
    })

    test('regression reproducer: a character inserted before the target while an image is saved does not take the emotion', async () => {
        const characters = installList(fullCharacter('X', 'x.png'))
        const x = characters[0]
        const saving = deferred<string>()
        vi.mocked(saveImage).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFile).mockResolvedValue([{ name: 'happy.png', data: picked.data }] as never)

        const running = addCharEmotion(0)
        await flush()
        characters.unshift(fullCharacter('Z', 'z.png'))
        saving.resolve('saved/new.webp')
        await running

        expect((x as { emotionImages: unknown[] }).emotionImages).toEqual([['happy', 'saved/new.webp']])
        expect((characters[0] as { emotionImages: unknown[] }).emotionImages).toEqual([])
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(markCharacterForSave).not.toHaveBeenCalledWith('Z')
    })

    test('regression reproducer: a slot swapped for a stub during the picker receives nothing', async () => {
        const characters = installList(fullCharacter('X', 'x.png'))
        const picker = deferred<typeof picked[] | null>()
        vi.mocked(selectMultipleFile).mockReturnValue(picker.promise as never)

        const running = addCharEmotion(0)
        characters[0] = stubOf('X', 'x.png')
        const stub = characters[0]
        picker.resolve([{ name: 'happy.png', data: picked.data }])

        await expect(running).resolves.toBeUndefined()
        expect((stub as { emotionImages?: unknown[] }).emotionImages).toBeUndefined()
        expect(saveImage).not.toHaveBeenCalled()
        expect(get(addingEmotion)).toBe(false)
    })
})

describe('makeGroupImage', () => {
    interface FakeImage {
        onload: (() => void) | null
        onerror: (() => void) | null
    }

    function stubImage(settle: 'error' | 'load'): FakeImage[] {
        const instances: FakeImage[] = []
        vi.stubGlobal('Image', function FakeImageElement(this: FakeImage & { crossOrigin: string }) {
            this.onload = null
            this.onerror = null
            this.crossOrigin = ''
            Object.defineProperty(this, 'src', {
                set: () => {
                    instances.push(this)
                    queueMicrotask(() => {
                        if (settle === 'error') {
                            this.onerror?.()
                        } else {
                            this.onload?.()
                        }
                    })
                },
            })
        })
        return instances
    }

    function stubCanvas(): void {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QUJD')
    }

    function groupWithMember(): Slot {
        return {
            type: 'group',
            chaId: 'G',
            name: 'G',
            image: '',
            characters: ['M'],
            chats: [],
        } as unknown as Slot
    }

    beforeEach(() => {
        vi.mocked(findCharacterbyId).mockReset().mockReturnValue({ image: 'm.png' } as never)
        stubCanvas()
    })

    test('regression reproducer: a member image that fails to load still lets the action settle and end its busy entry', async () => {
        const characters = installList(groupWithMember())
        const instances = stubImage('error')

        void makeGroupImage()
        await flush()

        expect(instances).toHaveLength(1)
        expect(isBusy()).toBe(false)
        expect(characters[0].image).toBe('')
        expect(saveImage).not.toHaveBeenCalled()
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(vi.mocked(alertStore.set).mock.lastCall?.[0]).toEqual({ type: 'none', msg: '' })
        expect(warn).toHaveBeenCalledOnce()
    })

    test('regression reproducer: the image is written to the group even when the list shifted while member images loaded', async () => {
        const characters = installList(groupWithMember())
        const group = characters[0]
        stubImage('load')
        vi.mocked(findCharacterbyId).mockImplementation(() => {
            characters.unshift(fullCharacter('Z', 'z.png'))
            return { image: 'm.png' } as never
        })

        await makeGroupImage()

        expect(group.image).toBe('saved/new.webp')
        expect(characters[0].image).toBe('z.png')
        expect(markCharacterForSave).toHaveBeenCalledWith('G')
        expect(markCharacterForSave).not.toHaveBeenCalledWith('Z')
        expect(isBusy()).toBe(false)
    })
})
