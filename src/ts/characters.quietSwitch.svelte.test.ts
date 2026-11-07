/**
 * `changeChar` (`src/ts/characters.ts`) as the chat shell's character switch
 * drives it: an optional `quiet` request that shows no alert of its own, and a
 * returned outcome the caller reports from.
 *
 * Invariants exercised here:
 * - `quiet` passes through to the cold restore: a refused restore shows no
 *   alert and comes back as `{failed: reason}`; without `quiet` the user is
 *   told exactly as before.
 * - `busy` is returned when a reply is being written, at entry and when one
 *   starts during the read; `superseded` when a later call has started.
 * - Selection is unchanged by every outcome except `selected`.
 *
 * This file drives the REAL `src/ts/characters.ts`; every other module it
 * imports is mocked, following `characters.coldRestore.svelte.test.ts` (same
 * source file, same import set).
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'

//#region module mocks -- copied from characters.coldRestore.svelte.test.ts

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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

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

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
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

const readColdStorageItemMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    getColdStorageItem: async (key: string) => {
        const result = await readColdStorageItemMock(key)
        return result?.status === 'ok' ? result.value : null
    },
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { alertError, alertNormal } from 'src/ts/alert'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { changeChar } from './characters'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function fullCharacter(chaId: string): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 1,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function warmCharacter(chaId: string): CharacterFixture {
    return fullCharacter(chaId) as unknown as CharacterFixture
}

/** An archived character as this fork's stub builder makes it. */
function forkStub(chaId: string, key: string): CharacterFixture {
    return buildColdStub(fullCharacter(chaId), key, []) as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

interface PendingRead {
    key: string
    resolve: (result: unknown) => void
}

/** Every read stays pending until the test settles it. */
function holdReads(): PendingRead[] {
    const pending: PendingRead[] = []
    readColdStorageItemMock.mockImplementation((key: string) => new Promise((resolve) => {
        pending.push({ key, resolve })
    }))
    return pending
}

function ok(restored: character) {
    return { status: 'ok', value: { character: restored } }
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    vi.mocked(alertError).mockClear()
    vi.mocked(alertNormal).mockClear()
    doingChat.set(false)
    selectedCharID.set(-1)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('changeChar quiet and outcomes', () => {
    test('diagnostic: the selection mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
        selectedCharID.set(-1)
    })

    test('TA1: a quiet restore of a missing unit shows no alert and reports the reason', async () => {
        installDb([forkStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })

        const outcome = await changeChar(0, { quiet: true })

        expect(alertError).not.toHaveBeenCalled()
        expect(outcome).toEqual({ failed: 'missing' })
        expect(get(selectedCharID)).toBe(-1)
    })

    test('TA2: guard, without quiet a refused restore tells the user once and selects nothing', async () => {
        installDb([forkStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })

        await changeChar(0)

        expect(alertError).toHaveBeenCalledTimes(1)
        expect(get(selectedCharID)).toBe(-1)
    })

    test('TA3: busy at entry while a reply is being written, nothing selected', async () => {
        installDb([warmCharacter('a'), warmCharacter('b')])
        doingChat.set(true)

        const outcome = await changeChar(1)

        expect(outcome).toBe('busy')
        expect(get(selectedCharID)).toBe(-1)
        // Old callers (hotkeys, the old shell) stay silent: only the shell's own switch path shows the notice.
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('TA4: a restore overtaken by a later call reports superseded and keeps the later selection', async () => {
        installDb([forkStub('slow', 'unit-slow'), warmCharacter('fast')])
        const pending = holdReads()

        const slow = changeChar(0, { quiet: true })
        await tick()
        const fast = await changeChar(1)
        expect(fast).toBe('selected')
        expect(get(selectedCharID)).toBe(1)

        pending[0].resolve(ok(fullCharacter('slow')))
        const outcome = await slow

        expect(outcome).toBe('superseded')
        expect(get(selectedCharID)).toBe(1)
    })

    test('TA4b: a reply that starts during the read reports busy, nothing selected', async () => {
        installDb([forkStub('slow', 'unit-slow')])
        const pending = holdReads()

        const call = changeChar(0, { quiet: true })
        await tick()
        doingChat.set(true)
        pending[0].resolve(ok(fullCharacter('slow')))
        const outcome = await call

        expect(outcome).toBe('busy')
        expect(get(selectedCharID)).toBe(-1)
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('a stub removed during the read reports gone without an alert', async () => {
        installDb([forkStub('slow', 'unit-slow'), warmCharacter('other')])
        const pending = holdReads()

        const call = changeChar(0, { quiet: true })
        await tick()
        DBState.db.characters.splice(0, 1)
        pending[0].resolve(ok(fullCharacter('slow')))
        const outcome = await call

        expect(outcome).toBe('gone')
        expect(alertError).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
    })

    test('a warm character is selected and reported selected, quiet or not', async () => {
        installDb([warmCharacter('a'), warmCharacter('b')])

        expect(await changeChar(1, { quiet: true })).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
        expect(await changeChar(0)).toBe('selected')
        expect(get(selectedCharID)).toBe(0)
    })
})
