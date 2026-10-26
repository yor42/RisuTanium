// @vitest-environment happy-dom

/**
 * The add-asset button of `AssetInput.svelte` writes into the character that
 * was shown when it was clicked, however the character list changes while the
 * file picker or an asset save is awaited:
 * - a list shift (a programmatic selection change) makes the `currentCharacter`
 *   prop name another character afterwards; the asset still goes to the clicked
 *   one;
 * - a slot swapped for an archived stub (a `coldstorage` pointer) or a removed
 *   character receives nothing and the action stops quietly with a console
 *   warning;
 * - a cancelled picker writes nothing, not even an empty `additionalAssets`.
 *
 * Every test is a regression reproducer: each fails against the version that
 * writes through the live `currentCharacter` prop without marking the target.
 * The prop is a getter over a `$state` database, as the chat screen derives it
 * from the selected index.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { character, groupChat } from 'src/ts/storage/database.svelte'

const hoisted = vi.hoisted(() => ({
    testDb: { db: {} as { characters: unknown[] } },
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: hoisted.testDb,
}))

vi.mock('src/ts/storage/database.svelte', () => ({}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: vi.fn(async (loc: string) => `blob:${loc}`),
    saveAssetFromBlob: vi.fn(),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
}))

vi.mock('src/ts/util', () => ({
    selectMultipleFileObjects: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
}))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: vi.fn(),
}))

// The real busy registry, with `beginBusy` observable so a test can assert that no entry was started.
vi.mock('src/ts/process/memory/busyActions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/memory/busyActions')>()
    return { ...actual, beginBusy: vi.fn(actual.beginBusy) }
})

import AssetInput from './AssetInput.svelte'
import { saveAssetFromBlob } from 'src/ts/globalApi.svelte'
import { selectMultipleFileObjects } from 'src/ts/util'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { alertError } from 'src/ts/alert'
import { beginBusy, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

type Slot = character | groupChat

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

function fullCharacter(chaId: string): Slot {
    return { type: 'character', chaId, name: chaId, image: '', chats: [] } as unknown as Slot
}

function stubOf(chaId: string): Slot {
    return { type: 'character', chaId, name: chaId, image: '', coldstorage: `unit-${chaId}`, chats: [] } as unknown as Slot
}

async function flush(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setTimeout(r, 0))
}

// The picker hands back the File itself, unread; the save reads it in slices.
const file = new File([new Uint8Array([1, 2, 3])], 'pic.png')

/** The limit the mocked store reports. */
const LIMIT = 1024 * 1024

/** A file that reports `size` bytes without holding them; reading it would fail the test. */
function fileReportingSize(name: string, size: number): File {
    const big = new File([new Uint8Array([1])], name)
    Object.defineProperty(big, 'size', { value: size })
    Object.defineProperty(big, 'slice', { value: () => { throw new Error('an oversized file must not be read') } })
    return big
}

let characters: Slot[]
// Index the `currentCharacter` prop shows; a test moves it to model a selection change.
let selected = 0
let mounted: ReturnType<typeof mount> | null = null
let host: HTMLElement | null = null
let warn: ReturnType<typeof vi.spyOn>

function install(...slots: Slot[]): void {
    const reactive = $state({ characters: slots })
    hoisted.testDb.db = reactive
    characters = reactive.characters
}

function mountInput(): HTMLButtonElement {
    host = document.createElement('div')
    document.body.appendChild(host)
    mounted = mount(AssetInput, {
        target: host,
        props: {
            get currentCharacter() { return characters[selected] },
            onSelect: () => {},
        },
    })
    flushSync()
    return host.querySelector('button') as HTMLButtonElement
}

function additionalAssetsOf(slot: Slot): unknown {
    return (slot as { additionalAssets?: unknown }).additionalAssets
}

beforeEach(() => {
    resetBusyActionsForTest()
    vi.mocked(beginBusy).mockClear()
    selected = 0
    vi.mocked(saveAssetFromBlob).mockReset().mockResolvedValue('assets/saved.png')
    vi.mocked(selectMultipleFileObjects).mockReset()
    vi.mocked(markCharacterForSave).mockReset()
    vi.mocked(alertError).mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted)
        mounted = null
    }
    host?.remove()
    host = null
    warn.mockRestore()
    vi.restoreAllMocks()
})

describe('AssetInput add button', () => {
    test('regression reproducer: an unchanged list gets the asset, the target is marked for save, and no busy entry is open before the picker returns', async () => {
        install(fullCharacter('X'), fullCharacter('Y'))
        const picker = deferred<typeof file[] | null>()
        vi.mocked(selectMultipleFileObjects).mockReturnValue(picker.promise as never)
        const button = mountInput()

        button.click()
        expect(isBusy()).toBe(false)
        picker.resolve([file])
        await flush()

        expect(additionalAssetsOf(characters[0])).toEqual([['pic.png', 'assets/saved.png', 'png']])
        expect(additionalAssetsOf(characters[1])).toBeUndefined()
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(saveAssetFromBlob).toHaveBeenCalledWith(file, 'png')
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a mixed pick saves the files within the limit in order, then shows one notice naming the refused ones', async () => {
        install(fullCharacter('X'))
        const ok1 = new File([new Uint8Array([1])], 'ok1.png')
        const big1 = fileReportingSize('big1.mp4', LIMIT + 1)
        const ok2 = new File([new Uint8Array([2])], 'ok2.png')
        const big2 = fileReportingSize('big2.mp4', LIMIT * 2)
        vi.mocked(selectMultipleFileObjects).mockResolvedValue([ok1, big1, ok2, big2] as never)
        const button = mountInput()

        button.click()
        await flush()

        expect(vi.mocked(saveAssetFromBlob).mock.calls.map((call) => (call[0] as File).name)).toEqual(['ok1.png', 'ok2.png'])
        expect(additionalAssetsOf(characters[0])).toEqual([
            ['ok1.png', 'assets/saved.png', 'png'],
            ['ok2.png', 'assets/saved.png', 'png'],
        ])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith('"big1.mp4" and "big2.mp4" are larger than the 1 MB limit, so they were not added.')
        expect(vi.mocked(alertError).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(saveAssetFromBlob).mock.invocationCallOrder[1])
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: when every file is above the limit no busy entry starts, nothing is saved and one notice is shown', async () => {
        install(fullCharacter('X'))
        vi.mocked(selectMultipleFileObjects).mockResolvedValue([fileReportingSize('big1.mp4', LIMIT + 1), fileReportingSize('big2.mp4', LIMIT + 2)] as never)
        const button = mountInput()

        button.click()
        await flush()

        expect(saveAssetFromBlob).not.toHaveBeenCalled()
        expect(beginBusy).not.toHaveBeenCalled()
        expect(additionalAssetsOf(characters[0])).toBeUndefined()
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a cancelled picker writes nothing, not even an empty asset list', async () => {
        install(fullCharacter('X'))
        vi.mocked(selectMultipleFileObjects).mockResolvedValue(null as never)
        const button = mountInput()

        button.click()
        await flush()

        expect(additionalAssetsOf(characters[0])).toBeUndefined()
        expect(saveAssetFromBlob).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a character inserted before the target during the picker does not take the asset', async () => {
        install(fullCharacter('X'), fullCharacter('Y'))
        const x = characters[0]
        const picker = deferred<typeof file[] | null>()
        vi.mocked(selectMultipleFileObjects).mockReturnValue(picker.promise as never)
        const button = mountInput()

        button.click()
        characters.unshift(fullCharacter('Z'))
        picker.resolve([file])
        await flush()

        expect(additionalAssetsOf(x)).toEqual([['pic.png', 'assets/saved.png', 'png']])
        expect(additionalAssetsOf(characters[0])).toBeUndefined()
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(markCharacterForSave).not.toHaveBeenCalledWith('Z')
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: the target is marked for save although the selection moved to another character during the save', async () => {
        install(fullCharacter('X'), fullCharacter('Y'))
        const x = characters[0]
        const saving = deferred<string>()
        vi.mocked(saveAssetFromBlob).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFileObjects).mockResolvedValue([file] as never)
        const button = mountInput()

        button.click()
        await flush()
        selected = 1
        saving.resolve('assets/saved.png')
        await flush()

        expect(additionalAssetsOf(x)).toEqual([['pic.png', 'assets/saved.png', 'png']])
        expect(additionalAssetsOf(characters[1])).toBeUndefined()
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
    })

    test('regression reproducer: a slot swapped for a stub during the picker receives nothing and the action stops quietly', async () => {
        install(fullCharacter('X'), fullCharacter('Y'))
        const picker = deferred<typeof file[] | null>()
        vi.mocked(selectMultipleFileObjects).mockReturnValue(picker.promise as never)
        const button = mountInput()

        button.click()
        characters[0] = stubOf('X')
        const stub = characters[0]
        picker.resolve([file])
        await flush()

        expect(additionalAssetsOf(stub)).toBeUndefined()
        expect(additionalAssetsOf(characters[1])).toBeUndefined()
        expect(saveAssetFromBlob).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledOnce()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a slot swapped for a stub while the asset is saved ends as a quiet abort, not an unhandled throw', async () => {
        install(fullCharacter('X'))
        const saving = deferred<string>()
        vi.mocked(saveAssetFromBlob).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFileObjects).mockResolvedValue([file] as never)
        const button = mountInput()

        button.click()
        await flush()
        characters[0] = stubOf('X')
        const stub = characters[0]
        saving.resolve('assets/saved.png')
        await flush()

        expect(additionalAssetsOf(stub)).toBeUndefined()
        expect(warn).toHaveBeenCalledOnce()
        expect(isBusy()).toBe(false)
    })
})
