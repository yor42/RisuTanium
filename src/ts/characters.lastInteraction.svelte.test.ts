/**
 * `lastInteraction` and `characterFormatUpdate` (`src/ts/characters.ts`).
 *
 * `lastInteraction` orders the character lists by recency, so formatting a
 * character (filling in fields it lacks) must not change it unless the caller
 * says the formatting is an interaction (`updateInteraction: true`). Opening an
 * archived character through `changeChar`, and bringing one back for a group
 * turn through `restoreColdCharacterByChaId`, are interactions and set it to
 * now.
 *
 * This file drives the REAL `src/ts/characters.ts`, `coldCharacter.ts`,
 * `coldCharacterRestore.ts` and `coldMemberRestore.ts`. The other modules
 * `characters.ts` imports (stores, database, alert, util, globalApi, the
 * cold-storage read and the rest listed in the mock region) are mocked,
 * following `characters.coldRestore.svelte.test.ts`.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'

//#region module mocks -- the import set of characters.coldRestore.svelte.test.ts

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

const readColdStorageItemMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
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
import { doingChat } from 'src/ts/process/index.svelte'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { changeChar, characterFormatUpdate, selectCharacterByChaId } from './characters'
import { restoreColdCharacterByChaId } from 'src/ts/process/coldMemberRestore'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const LONG_AGO = 1000

function fullCharacter(chaId: string): character {
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
    } as unknown as character
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

function lastInteractionOf(index: number): number | undefined {
    return (DBState.db.characters[index] as unknown as character).lastInteraction
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    doingChat.set(false)
    selectedCharID.set(-1)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('characterFormatUpdate and lastInteraction', () => {
    test.each([
        ['no argument', undefined],
        ['an empty argument', {}],
        ['updateInteraction false', { updateInteraction: false }],
    ])('formatting a character by index with %s leaves lastInteraction unchanged', (_label, arg) => {
        installDb([fullCharacter('hero') as unknown as CharacterFixture])

        if (arg) {
            characterFormatUpdate(0, arg)
        } else {
            characterFormatUpdate(0)
        }

        expect(lastInteractionOf(0)).toBe(LONG_AGO)
    })

    test('formatting a character object with no argument leaves lastInteraction unchanged', () => {
        const hero = fullCharacter('hero')

        characterFormatUpdate(hero)

        expect(hero.lastInteraction).toBe(LONG_AGO)
    })

    test('guard: formatting with updateInteraction true sets lastInteraction to now', () => {
        installDb([fullCharacter('hero') as unknown as CharacterFixture])
        const before = Date.now()

        characterFormatUpdate(0, { updateInteraction: true })

        expect(lastInteractionOf(0)).toBeGreaterThanOrEqual(before)
    })

    test('guard: formatting still fills the fields a character lacks', () => {
        const hero = fullCharacter('hero') as unknown as Record<string, unknown>
        delete hero.tags
        delete hero.alternateGreetings

        characterFormatUpdate(hero as unknown as character)

        expect(hero.tags).toEqual([])
        expect(hero.alternateGreetings).toEqual([])
    })
})

describe('opening or restoring an archived character is an interaction', () => {
    test('guard: changeChar on a stub sets the restored character\'s lastInteraction to now', async () => {
        const stub = buildColdStub(fullCharacter('member'), 'unit-member', []) as unknown as CharacterFixture
        installDb([fullCharacter('before') as unknown as CharacterFixture, stub])
        readColdStorageItemMock.mockResolvedValue({ status: 'ok', value: { character: fullCharacter('member') } })
        const before = Date.now()

        await changeChar(1)

        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBeUndefined()
        expect(lastInteractionOf(1)).toBeGreaterThanOrEqual(before)
        expect(get(selectedCharID)).toBe(1)
    })

    test('guard: restoring a group member by chaId sets its lastInteraction to now', async () => {
        const stub = buildColdStub(fullCharacter('member'), 'unit-member', []) as unknown as CharacterFixture
        installDb([fullCharacter('before') as unknown as CharacterFixture, stub])
        readColdStorageItemMock.mockResolvedValue({ status: 'ok', value: { character: fullCharacter('member') } })
        const before = Date.now()

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBeUndefined()
        expect(lastInteractionOf(1)).toBeGreaterThanOrEqual(before)
    })
})

describe('selecting a character by its id after an idle reload', () => {
    test('selects the inline holder of the id and leaves its lastInteraction as it was', async () => {
        installDb([fullCharacter('other') as unknown as CharacterFixture, fullCharacter('hero') as unknown as CharacterFixture])

        expect(await selectCharacterByChaId('hero')).toBe(true)

        expect(get(selectedCharID)).toBe(1)
        expect(lastInteractionOf(1)).toBe(LONG_AGO)
    })

    test('restores an archived holder and selects it without changing its lastInteraction', async () => {
        const stub = buildColdStub(fullCharacter('member'), 'unit-member', []) as unknown as CharacterFixture
        installDb([fullCharacter('before') as unknown as CharacterFixture, stub])
        readColdStorageItemMock.mockResolvedValue({ status: 'ok', value: { character: fullCharacter('member') } })

        expect(await selectCharacterByChaId('member')).toBe(true)

        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBeUndefined()
        expect(get(selectedCharID)).toBe(1)
        expect(lastInteractionOf(1)).toBe(LONG_AGO)
    })

    test('selects nothing when no character holds the id', async () => {
        installDb([fullCharacter('hero') as unknown as CharacterFixture])

        expect(await selectCharacterByChaId('missing')).toBe(false)

        expect(get(selectedCharID)).toBe(-1)
    })

    test('selects nothing when several characters hold the id', async () => {
        installDb([fullCharacter('twin') as unknown as CharacterFixture, fullCharacter('twin') as unknown as CharacterFixture])

        expect(await selectCharacterByChaId('twin')).toBe(false)

        expect(get(selectedCharID)).toBe(-1)
        expect(lastInteractionOf(0)).toBe(LONG_AGO)
    })

    test('reports false when the selection did not happen because a chat is generating', async () => {
        installDb([fullCharacter('hero') as unknown as CharacterFixture])
        doingChat.set(true)

        expect(await selectCharacterByChaId('hero')).toBe(false)

        expect(get(selectedCharID)).toBe(-1)
    })

    test('guard: changeChar without the option still sets lastInteraction to now on an inline character', async () => {
        installDb([fullCharacter('hero') as unknown as CharacterFixture])
        const before = Date.now()

        await changeChar(0)

        expect(lastInteractionOf(0)).toBeGreaterThanOrEqual(before)
    })
})
