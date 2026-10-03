// @vitest-environment happy-dom

/**
 * `importChat` (`src/ts/characters.ts`) always gives an imported chat a
 * fresh id, for both the HTML import and the `risuAllChats` v1 import.
 *
 * This file drives the REAL `src/ts/characters.ts`. Every other module it
 * imports is mocked below, following the precedent in
 * `characters.saveMarks.svelte.test.ts` (same source file, same import set).
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database, character, Chat } from './storage/database.svelte'

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
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(() => undefined),
    findCharacterIndexbyId: vi.fn(() => -1),
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

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { selectSingleFile } from 'src/ts/util'
import { alertError } from 'src/ts/alert'
import { selectedCharID } from 'src/ts/stores.svelte'
import { importChat } from './characters'

//#region fixture helpers

function makeChat(id: string, name: string): Chat {
    return { id, message: [], note: '', name, localLore: [] } as unknown as Chat
}

function makeCharacter(chats: Chat[]): character {
    return {
        type: 'character',
        name: 'Solo',
        chats,
        chatFolders: [],
        chatPage: 0,
        chaId: 'solo-1',
    } as unknown as character
}

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

function htmlFileWithChat(chatJson: unknown) {
    const idat = JSON.stringify(chatJson).replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<!DOCTYPE html><html><body><div class="idat">${idat}</div></body></html>`
    return { name: 'export.html', data: utf8(html) }
}

//#endregion

beforeEach(() => {
    testDb.db = { characters: [] } as unknown as Database
    selectedCharID.set(0)
})

describe('importChat -- HTML import always gives the imported chat a fresh id', () => {
    test('a file id that collides with an existing chat gets a fresh id, and the existing chat is unchanged', async () => {
        const existing = makeChat('chat-existing', 'Existing Chat')
        testDb.db.characters = [makeCharacter([existing])] as never
        vi.mocked(selectSingleFile).mockResolvedValue(
            htmlFileWithChat({ message: [], note: 'imported note', name: 'Imported', localLore: [], id: 'chat-existing' }),
        )

        await importChat()

        const cha = testDb.db.characters[0] as character
        expect(cha.chats).toHaveLength(2)
        const imported = cha.chats[0]
        const survivingExisting = cha.chats.find((c) => c.name === 'Existing Chat')!
        expect(imported.id).toBeTruthy()
        expect(imported.id).not.toBe('chat-existing')
        expect(survivingExisting.id).toBe('chat-existing')
    })

    // Every imported chat gets a fresh id regardless of whether the file's
    // id collides with an existing chat, so a unique file id must not be
    // kept as-is either.
    test('a unique file id also gets a fresh id, not the id from the file', async () => {
        const existing = makeChat('chat-existing', 'Existing Chat')
        testDb.db.characters = [makeCharacter([existing])] as never
        vi.mocked(selectSingleFile).mockResolvedValue(
            htmlFileWithChat({ message: [], note: 'imported note', name: 'Imported', localLore: [], id: 'chat-unique' }),
        )

        await importChat()

        const cha = testDb.db.characters[0] as character
        const imported = cha.chats[0]
        expect(imported.id).toBeTruthy()
        expect(imported.id).not.toBe('chat-unique')
    })
})

describe('importChat -- risuAllChats v1 import gives every imported chat a fresh, pairwise-distinct id', () => {
    test('two imported chats sharing one id (itself equal to an existing chat\'s id) all end up fresh and distinct', async () => {
        const existing = makeChat('dup-id', 'Existing Chat')
        testDb.db.characters = [makeCharacter([existing])] as never
        const payload = {
            type: 'risuAllChats',
            ver: 1,
            data: [
                { id: 'dup-id', message: [], note: '', name: 'Imported A', localLore: [] },
                { id: 'dup-id', message: [], note: '', name: 'Imported B', localLore: [] },
            ],
        }
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'export.json', data: utf8(JSON.stringify(payload)) })

        await importChat()

        const cha = testDb.db.characters[0] as character
        expect(cha.chats).toHaveLength(3)
        const importedA = cha.chats.find((c) => c.name === 'Imported A')!
        const importedB = cha.chats.find((c) => c.name === 'Imported B')!
        const survivingExisting = cha.chats.find((c) => c.name === 'Existing Chat')!

        expect(importedA.id).toBeTruthy()
        expect(importedB.id).toBeTruthy()
        expect(importedA.id).not.toBe(importedB.id)
        expect(importedA.id).not.toBe('dup-id')
        expect(importedB.id).not.toBe('dup-id')
        expect(survivingExisting.id).toBe('dup-id')
    })
})

describe('importChat -- file type selection', () => {
    const header = JSON.stringify({ user_name: 'U', character_name: 'C' })
    const message = JSON.stringify({ name: 'C', is_user: false, mes: 'hello there' })

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    test('the picker offers json, jsonl and html but not txt', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue(undefined as never)

        await importChat()

        expect(selectSingleFile).toHaveBeenCalledTimes(1)
        const list = vi.mocked(selectSingleFile).mock.calls[0][0]
        expect([...list].sort()).toEqual(['html', 'json', 'jsonl'])
    })

    test('a .txt file shows the no-data error and adds no chat', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'export.txt', data: utf8('some text') })

        await importChat()

        expect(alertError).toHaveBeenCalledTimes(1)
        expect((testDb.db.characters[0] as character).chats).toHaveLength(0)
    })

    test('an upper-case extension is recognised', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'CHAT.JSONL', data: utf8(`${header}\n${message}`) })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        expect((testDb.db.characters[0] as character).chats).toHaveLength(1)
    })

    test('a JSONL file ending with a newline, or containing blank lines, imports', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`${header}\n\n${message}\n   \n`),
        })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        const chats = (testDb.db.characters[0] as character).chats
        expect(chats).toHaveLength(1)
        expect(chats[0].message).toHaveLength(1)
    })

    test('blank lines before the header do not turn the first message into the skipped header', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`\n${header}\n${message}\n`),
        })

        await importChat()

        const chats = (testDb.db.characters[0] as character).chats
        expect(chats).toHaveLength(1)
        expect(chats[0].message).toHaveLength(1)
    })
})
