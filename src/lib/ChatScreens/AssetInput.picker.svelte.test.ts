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
    saveAsset: vi.fn(),
}))

vi.mock('src/ts/util', () => ({
    selectMultipleFile: vi.fn(),
}))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: vi.fn(),
}))

import AssetInput from './AssetInput.svelte'
import { saveAsset } from 'src/ts/globalApi.svelte'
import { selectMultipleFile } from 'src/ts/util'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

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

const file = { name: 'pic.png', data: new Uint8Array([1, 2, 3]) }

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
    selected = 0
    vi.mocked(saveAsset).mockReset().mockResolvedValue('assets/saved.png')
    vi.mocked(selectMultipleFile).mockReset()
    vi.mocked(markCharacterForSave).mockReset()
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
        vi.mocked(selectMultipleFile).mockReturnValue(picker.promise as never)
        const button = mountInput()

        button.click()
        expect(isBusy()).toBe(false)
        picker.resolve([file])
        await flush()

        expect(additionalAssetsOf(characters[0])).toEqual([['pic.png', 'assets/saved.png', 'png']])
        expect(additionalAssetsOf(characters[1])).toBeUndefined()
        expect(markCharacterForSave).toHaveBeenCalledWith('X')
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a cancelled picker writes nothing, not even an empty asset list', async () => {
        install(fullCharacter('X'))
        vi.mocked(selectMultipleFile).mockResolvedValue(null as never)
        const button = mountInput()

        button.click()
        await flush()

        expect(additionalAssetsOf(characters[0])).toBeUndefined()
        expect(saveAsset).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a character inserted before the target during the picker does not take the asset', async () => {
        install(fullCharacter('X'), fullCharacter('Y'))
        const x = characters[0]
        const picker = deferred<typeof file[] | null>()
        vi.mocked(selectMultipleFile).mockReturnValue(picker.promise as never)
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
        vi.mocked(saveAsset).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFile).mockResolvedValue([file] as never)
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
        vi.mocked(selectMultipleFile).mockReturnValue(picker.promise as never)
        const button = mountInput()

        button.click()
        characters[0] = stubOf('X')
        const stub = characters[0]
        picker.resolve([file])
        await flush()

        expect(additionalAssetsOf(stub)).toBeUndefined()
        expect(additionalAssetsOf(characters[1])).toBeUndefined()
        expect(saveAsset).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledOnce()
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: a slot swapped for a stub while the asset is saved ends as a quiet abort, not an unhandled throw', async () => {
        install(fullCharacter('X'))
        const saving = deferred<string>()
        vi.mocked(saveAsset).mockReturnValue(saving.promise)
        vi.mocked(selectMultipleFile).mockResolvedValue([file] as never)
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
