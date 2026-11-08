/**
 * `addCharacter` (`src/ts/characters.ts`) selects only a slot it added.
 *
 * After a cancelled, refused or empty import nothing was added, so the selection and every `lastInteraction`
 * stay as they were and the reset still runs once. After an import that added slots, the last one added is
 * selected, found again by identity because the list can change before the selection happens. A throw after
 * some files were collected returns those slots, so the last collected one is selected (the picker side is
 * covered in `characterCards.picker.test.ts`).
 *
 * This file drives the REAL `src/ts/characters.ts`; the modules it imports are mocked, following
 * `characters.lastInteraction.svelte.test.ts`. `importCharacter` is replaced by a per-test implementation that
 * pushes onto the list like the real picker does.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character, groupChat } from './storage/database.svelte'

//#region module mocks -- the import set of characters.lastInteraction.svelte.test.ts

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

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { alertAddCharacter } from 'src/ts/alert'
import { importCharacter } from 'src/ts/characterCards'
import { addCharacter } from './characters'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const LONG_AGO = 1000

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: LONG_AGO,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

// Appends a slot to the live list and returns the list's own object for it, as the real picker does.
function push(char: character): character | groupChat {
    DBState.db.characters.push(char as unknown as CharacterFixture)
    return DBState.db.characters[DBState.db.characters.length - 1]
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const importMock = vi.mocked(importCharacter)
const askMock = vi.mocked(alertAddCharacter)

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    importMock.mockReset()
    askMock.mockReset()
    selectedCharID.set(-1)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('addCharacter after an import that added nothing keeps the selection', () => {
    test('a cancelled import with a trashed last slot leaves the selection and the slot untouched, and the reset runs once', async () => {
        const trashed = fullCharacter('trashed', { trashTime: 5 })
        installDb([fullCharacter('live') as unknown as CharacterFixture, trashed as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('importCharacter')
        importMock.mockResolvedValue([])
        const reseter = vi.fn()

        await addCharacter({ reseter })
        await settle()

        expect(get(selectedCharID)).toBe(0)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
        expect(reseter).toHaveBeenCalledTimes(1)
    })

    test('a cancelled import with a hidden system last slot leaves the selection on the live slot', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture, fullCharacter('§playground') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('importCharacter')
        importMock.mockResolvedValue([])

        await addCharacter()
        await settle()

        expect(get(selectedCharID)).toBe(0)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
    })
})

describe('addCharacter after an import that added slots selects the last one added', () => {
    test('guard: a multi-file import selects the last slot added', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('importCharacter')
        importMock.mockImplementation(async () => [push(fullCharacter('x')), push(fullCharacter('y'))])

        await addCharacter()
        await settle()

        expect(get(selectedCharID)).toBe(2)
    })

    test('a slot pushed after the added one before the import returns is not selected', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('importCharacter')
        importMock.mockImplementation(async () => {
            const added = push(fullCharacter('x'))
            push(fullCharacter('later', { trashTime: 5 }))
            return [added]
        })

        await addCharacter()
        await settle()

        expect(get(selectedCharID)).toBe(1)
    })

    test('an added slot that is no longer in the list is not selected, and the tail is not guessed instead', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture, fullCharacter('other') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('importCharacter')
        importMock.mockResolvedValue([fullCharacter('gone')])

        await addCharacter()
        await settle()

        expect(get(selectedCharID)).toBe(0)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
    })
})

describe('addCharacter after a create selects the slot it created (guard)', () => {
    test('createfromScratch selects the new character', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('createfromScratch')

        await addCharacter()
        await settle()

        expect(DBState.db.characters.length).toBe(2)
        expect(get(selectedCharID)).toBe(1)
    })

    test('createGroup selects the new group', async () => {
        installDb([fullCharacter('live') as unknown as CharacterFixture])
        selectedCharID.set(0)
        askMock.mockResolvedValue('createGroup')

        await addCharacter()
        await settle()

        expect(get(selectedCharID)).toBe(1)
        expect(slot(1).type).toBe('group')
    })
})
