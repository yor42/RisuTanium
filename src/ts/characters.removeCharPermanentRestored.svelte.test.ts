/**
 * `removeChar` (src/ts/characters.ts) with `'permanent'`: a character that was in the trash
 * when the delete was asked, and was restored by the user while its two confirmations were
 * open, is not deleted, nothing owned by it is stopped, and the selection is left alone. A
 * permanent delete of a character that was not in the trash when it was asked behaves as it
 * always has.
 *
 * Drives the REAL `removeChar` and `restoreCharacterFromTrash` against a real `$state`
 * database. Every other module `characters.ts` imports is mocked purely so the module loads
 * (the set of `characters.saveMarks.svelte.test.ts`); the alert confirm is a mock the test
 * holds open and answers, and `stopWorkIn` is a recording stub. Titles beginning "guard:"
 * pin behaviour that must be preserved before and after the change; every other test is a
 * regression reproducer for the behaviour it names.
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from './storage/database.svelte'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

const stopped = vi.hoisted(() => [] as string[])

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
    alertConfirm: confirms.ask,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDBState: Database }).__testDBState),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.find((c: { chaId: string }) => c.chaId === id)
    }),
    findCharacterIndexbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.findIndex((c: { chaId: string }) => c.chaId === id)
    }),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

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

vi.mock(import('src/ts/process/chatOrigin'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        hasWorkIn: vi.fn(() => false),
        stopWorkIn: vi.fn((scope: { chaId: string }) => { stopped.push(scope.chaId) }),
    }
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { removeChar, restoreCharacterFromTrash } from './characters'

//#region fixtures and helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

const TRASHED_AT = 1_700_000_000_000

function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['live', 'trashed'],
        characters: [makeCharacter('live', 'Live'), makeCharacter('trashed', 'Trashed', TRASHED_AT)],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
    selectedCharID.set(0)
}

const ids = () => DBState.db.characters.map((c) => c.chaId)

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await sleep(10)
}

beforeEach(() => {
    confirms.pending.length = 0
    stopped.length = 0
    installDb()
})

//#endregion

describe('removeChar with permanent, for a character that was in the trash when asked', () => {
    test('guard: a character that stays in the trash through both confirmations is removed and its work is stopped', async () => {
        const done = removeChar(DBState.db.characters[1], 'Trashed', 'permanent')
        await sleep(10)
        await answer(true)
        await answer(true)
        await done
        expect(ids()).toEqual(['live'])
        expect(stopped).toEqual(['trashed'])
    })

    test('guard: refusing a confirmation keeps the character in the trash and stops nothing', async () => {
        const done = removeChar(DBState.db.characters[1], 'Trashed', 'permanent')
        await sleep(10)
        await answer(true)
        await answer(false)
        await done
        expect(ids()).toEqual(['live', 'trashed'])
        expect(DBState.db.characters[1].trashTime).toBe(TRASHED_AT)
        expect(stopped).toEqual([])
    })

    test('a character restored while the confirmations are open stays, and nothing owned by it is stopped', async () => {
        const done = removeChar(DBState.db.characters[1], 'Trashed', 'permanent')
        await sleep(10)
        restoreCharacterFromTrash(DBState.db.characters[1])
        await answer(true)
        await answer(true)
        await done
        expect(ids()).toEqual(['live', 'trashed'])
        expect(DBState.db.characters[1].trashTime).toBeUndefined()
        expect(stopped).toEqual([])
    })

    test('a character asked for by id and restored while the confirmations are open stays, and nothing owned by it is stopped', async () => {
        const done = removeChar('trashed', 'Trashed', 'permanent')
        await sleep(10)
        restoreCharacterFromTrash('trashed')
        await answer(true)
        await answer(true)
        await done
        expect(ids()).toEqual(['live', 'trashed'])
        expect(stopped).toEqual([])
    })

    test('a restore during the confirmations leaves the selection where it was', async () => {
        selectedCharID.set(0)
        const done = removeChar(DBState.db.characters[1], 'Trashed', 'permanent')
        await sleep(10)
        restoreCharacterFromTrash(DBState.db.characters[1])
        await answer(true)
        await answer(true)
        await done
        let selected = -2
        selectedCharID.subscribe((v) => { selected = v })()
        expect(selected).toBe(0)
    })
})

describe('removeChar with permanent, for a character that was not in the trash when asked', () => {
    test('guard: the character is removed and its work is stopped', async () => {
        const done = removeChar(DBState.db.characters[0], 'Live', 'permanent')
        await sleep(10)
        await answer(true)
        await answer(true)
        await done
        expect(ids()).toEqual(['trashed'])
        expect(stopped).toEqual(['live'])
    })

    test('guard: a normal delete puts a live character in the trash after one confirmation and keeps it in the list', async () => {
        const done = removeChar(DBState.db.characters[0], 'Live', 'normal')
        await sleep(10)
        await answer(true)
        await done
        expect(confirms.pending).toHaveLength(0)
        expect(ids()).toEqual(['live', 'trashed'])
        expect(DBState.db.characters[0].trashTime).toBeTypeOf('number')
    })
})
