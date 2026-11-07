/**
 * The real `changeChar` (`src/ts/characters.ts`) under the chat shell's
 * selection watcher (`chatShell/switchTarget.svelte.ts`).
 *
 * Invariants exercised here:
 * - A selection move to another character, or to none, while a loading
 *   switch restores an archived character ends the switch and supersedes the
 *   restore: when it lands it selects nothing and the user stays where the
 *   move put them.
 * - A re-index of the character selected when the switch started (same entry,
 *   new slot) keeps the switch, which lands on its target at the new slot.
 * - With no shell switch pending, a selection move leaves a running restore
 *   alone.
 *
 * Every module `characters.ts` imports is mocked as in
 * `characters.quietSwitch.svelte.test.ts`; the character removals are real.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'
//#region module mocks -- copied from characters.quietSwitch.svelte.test.ts

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
        alertStore: writable({ type: 'none', msg: '' }),
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
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { changeChar, removeChar, removeTrashedCharacters } from './characters'
import { clearPending, switchCharacter, switchTarget } from './chatShell/switchTarget.svelte'

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

function warmWithChats(chaId: string): CharacterFixture {
    const owner = fullCharacter(chaId)
    owner.chats = ['one', 'two', 'three'].map((name, i) => ({ id: `${chaId}-${i}`, message: [], note: '', name, localLore: [] })) as unknown as character['chats']
    return owner as unknown as CharacterFixture
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
    doingChat.set(false)
    selectedCharID.set(-1)
    clearPending()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    clearPending()
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('a selection move while a loading switch restores its target', () => {
    test('QS1: a bare move home supersedes the restore: the switch idles now and nothing is selected when it lands', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b')])
        selectedCharID.set(0)
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[1])
        await tick()
        expect(switchTarget.phase).toBe('loading')
        selectedCharID.set(-1)
        expect(switchTarget.phase).toBe('idle')

        pending[0].resolve(ok(fullCharacter('b')))
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(-1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('QS2: a direct move to another character keeps that selection when the restore lands', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b'), warmWithChats('c')])
        selectedCharID.set(0)
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[1])
        await tick()
        selectedCharID.set(2)

        pending[0].resolve(ok(fullCharacter('b')))
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(2)
        expect(switchTarget.phase).toBe('idle')
    })

    test('QS3: removing an unrelated character sends the user home and the restore selects nothing', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b'), warmWithChats('c')])
        selectedCharID.set(0)
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[1])
        await tick()
        await removeChar(DBState.db.characters[2], 'c', 'permanentForce')
        expect(get(selectedCharID)).toBe(-1)
        expect(switchTarget.phase).toBe('idle')

        pending[0].resolve(ok(fullCharacter('b')))
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(-1)
    })

    test('QS4: a re-index of the selected character keeps the switch, which lands on the target at its new slot', async () => {
        const trashed = warmWithChats('t')
        trashed.trashTime = 1
        installDb([trashed, warmWithChats('a'), forkStub('b', 'unit-b')])
        selectedCharID.set(1)
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[2])
        await tick()
        await removeTrashedCharacters([DBState.db.characters[0]], { matching: false })
        expect(DBState.db.characters.length).toBe(2)
        expect(get(selectedCharID)).toBe(0)
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target?.chaId).toBe('b')

        pending[0].resolve(ok(fullCharacter('b')))
        expect(await run).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
        expect(DBState.db.characters[1].chaId).toBe('b')
        expect(switchTarget.phase).toBe('idle')
    })

    test('QS5: a switch started from home is not disturbed by removing an unrelated character', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b'), warmWithChats('c')])
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[1])
        await tick()
        await removeChar(DBState.db.characters[2], 'c', 'permanentForce')
        expect(switchTarget.phase).toBe('loading')

        pending[0].resolve(ok(fullCharacter('b')))
        expect(await run).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
    })

    test('QS6: an undisturbed switch lands on its target and idles', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b')])
        selectedCharID.set(0)
        const pending = holdReads()

        const run = switchCharacter(DBState.db.characters[1])
        await tick()
        pending[0].resolve(ok(fullCharacter('b')))

        expect(await run).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('QS7: tapping the same target again while its read is in flight still lands once', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b')])
        selectedCharID.set(0)
        const pending = holdReads()

        const first = switchCharacter(DBState.db.characters[1])
        await tick()
        const second = switchCharacter(DBState.db.characters[1])
        await tick()
        expect(pending.length).toBe(1)
        pending[0].resolve(ok(fullCharacter('b')))

        expect(await first).toBe('superseded')
        expect(await second).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('QS8: with no shell switch pending, a selection move leaves a running legacy restore alone', async () => {
        installDb([warmWithChats('a'), forkStub('b', 'unit-b')])
        selectedCharID.set(0)
        const pending = holdReads()

        const call = changeChar(1, { quiet: true })
        await tick()
        selectedCharID.set(-1)
        pending[0].resolve(ok(fullCharacter('b')))

        expect(await call).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
    })
})
