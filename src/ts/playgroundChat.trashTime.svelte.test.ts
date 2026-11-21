/**
 * `openPlaygroundChat` (`src/ts/playgroundChat.ts`) and the trash state of the
 * `'§playground'` utility character.
 *
 * Invariant: the Playground character is never hidden from the user and then
 * trashed at once. Character lists skip it, so a `trashTime` on it could not be
 * undone from the trash tab and the boot purge of trashed characters would
 * delete the Playground's history while it is in use. Opening the Playground
 * chat therefore leaves the selected `§playground` untrashed, including one
 * just restored from an archive. A `§playground` that carries no `trashTime`
 * stays without one, a failed restore writes nothing, and other characters'
 * trash state is never touched.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`. This
 * file drives the REAL `src/ts/playgroundChat.ts`, `src/ts/characters.ts` and
 * the cold-character modules, with the import set of
 * `playgroundChat.coldStub.svelte.test.ts` (same directory).
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'

//#region module mocks -- the import set of playgroundChat.coldStub.svelte.test.ts

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
    return {
        DBState: state,
        selectedCharID: writable(-1),
        PlaygroundStore: writable(0),
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
    alertToast: vi.fn(),
    alertMd: vi.fn(),
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

// `findCharacterIndexbyId` is faithful to production: the index of the first
// character holding the id, or -1.
vi.mock(import('src/ts/util'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        findCharacterbyId: vi.fn(),
        findCharacterIndexbyId: vi.fn((id: string) => liveDBState.db.characters.findIndex((c) => c.chaId === id)),
        getUserName: vi.fn(() => 'User'),
        selectMultipleFile: vi.fn(),
        selectSingleFile: vi.fn(),
    } as unknown as typeof import('src/ts/util')
})

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

import { DBState, PlaygroundStore, selectedCharID } from 'src/ts/stores.svelte'
import { alertError, alertNormal, alertToast, alertMd } from 'src/ts/alert'
import { buildColdStub } from 'src/ts/process/tests/coldStubFixture'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { openPlaygroundChat } from './playgroundChat'

//#region fixtures and helpers

type Slot = Database['characters'][number]

const PLAYGROUND = '§playground'

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: '',
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        firstMessage: `${chaId} greeting`,
        creatorNotes: '',
        lastInteraction: 1,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        utilityBot: false,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function asSlot(value: character): Slot {
    return value as unknown as Slot
}

/**
 * An archived copy of `source` as the character list holds it: the stub
 * builder's fields, with the collections a loaded list entry always carries
 * defaulted to empty, so formatting the stub is possible but reads no data.
 */
function stubOf(source: character, key: string): Slot {
    return asSlot({ ...buildColdStub(source, key, []), globalLore: [] } as unknown as character)
}

function installDb(characters: Slot[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

function ok(restored: character) {
    return { status: 'ok', value: { character: restored } }
}

function shownAlerts(): string[] {
    return [alertError, alertNormal, alertToast, alertMd].flatMap((fn) => vi.mocked(fn).mock.calls.map((args) => String(args[0])))
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    for (const fn of [alertError, alertNormal, alertToast, alertMd]) {
        vi.mocked(fn).mockClear()
    }
    vi.mocked(markCharacterForSave).mockClear()
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

const TRASHED_AT = 1_700_000_000_000

describe('openPlaygroundChat leaves the Playground untrashed', () => {
    test('a full trashed §playground is selected and loses its trashTime', async () => {
        installDb([asSlot(fullCharacter('other')), asSlot(fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT }))])

        await openPlaygroundChat()

        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(slot(1).chaId).toBe(PLAYGROUND)
        expect(slot(1).trashTime).toBeFalsy()
    })

    test('an archived trashed §playground is restored, selected and has no trashTime on the selected character', async () => {
        const unit = fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT })
        installDb([asSlot(fullCharacter('other')), stubOf(unit, 'unit-playground')])
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await openPlaygroundChat()

        expect(slot(1).coldstorage).toBeUndefined()
        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(slot(get(selectedCharID)).trashTime).toBeFalsy()
        expect(shownAlerts()).toEqual([])
    })

    test('a trashed §playground sitting behind other characters is cleared at its own index and leaves the others\' trash state alone', async () => {
        installDb([
            asSlot(fullCharacter('first')),
            asSlot(fullCharacter('trashed-other', { trashTime: TRASHED_AT })),
            asSlot(fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT })),
        ])

        await openPlaygroundChat()

        expect(get(selectedCharID)).toBe(2)
        expect(slot(2).trashTime).toBeFalsy()
        expect(slot(1).trashTime).toBe(TRASHED_AT)
        expect(slot(0).trashTime).toBeUndefined()
    })

    // Clearing the trashTime requests a save for the Playground character
    // explicitly, independent of the selected-character tracking.
    test('clearing a full §playground\'s trashTime marks it for save', async () => {
        installDb([asSlot(fullCharacter('other')), asSlot(fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT }))])

        await openPlaygroundChat()

        expect(slot(1).trashTime).toBeFalsy()
        expect(vi.mocked(markCharacterForSave)).toHaveBeenCalledWith(PLAYGROUND)
    })

    test('clearing the trashTime of a §playground restored from an archive marks it for save', async () => {
        const unit = fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT })
        installDb([asSlot(fullCharacter('other')), stubOf(unit, 'unit-playground')])
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await openPlaygroundChat()

        expect(slot(1).trashTime).toBeFalsy()
        expect(vi.mocked(markCharacterForSave)).toHaveBeenCalledWith(PLAYGROUND)
    })

    // Guard: passes with and without the clearing; a Playground without a
    // trashTime stays without one after opening, and opening twice changes
    // nothing further.
    test('guard: a §playground without a trashTime has none after opening, once or twice', async () => {
        installDb([asSlot(fullCharacter('other')), asSlot(fullCharacter(PLAYGROUND))])

        await openPlaygroundChat()
        expect(slot(1).trashTime).toBeUndefined()

        await openPlaygroundChat()
        expect(slot(1).trashTime).toBeUndefined()
        expect(get(selectedCharID)).toBe(1)
    })

    // Guard: passes with and without the clearing; a blank Playground made
    // because none existed carries no trashTime.
    test('guard: a newly created §playground has no trashTime', async () => {
        installDb([asSlot(fullCharacter('other'))])

        await openPlaygroundChat()

        expect(slot(1).chaId).toBe(PLAYGROUND)
        expect(slot(1).trashTime).toBeUndefined()
    })

    // Guard: passes with and without the clearing; a failed restore writes
    // nothing, so the archived placeholder keeps its trashTime.
    test('guard: a failed restore of an archived trashed §playground leaves the placeholder exactly as it was and selects nothing', async () => {
        const unit = fullCharacter(PLAYGROUND, { trashTime: TRASHED_AT })
        installDb([asSlot(fullCharacter('other')), stubOf(unit, 'unit-playground')])
        selectedCharID.set(0)
        const before = JSON.stringify(DBState.db.characters[1])
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })

        await openPlaygroundChat()

        expect(JSON.stringify(DBState.db.characters[1])).toBe(before)
        expect(slot(1).trashTime).toBe(TRASHED_AT)
        expect(get(selectedCharID)).toBe(0)
        expect(get(PlaygroundStore)).toBe(0)
    })
})
