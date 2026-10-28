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
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { alertError, alertNormal } from 'src/ts/alert'
import { language } from 'src/lang'
import { selectedCharID } from 'src/ts/stores.svelte'
import { changeChatTo } from 'src/ts/globalApi.svelte'
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

describe('importChat -- character saved before chat folders existed', () => {
    const header = JSON.stringify({ user_name: 'U', character_name: 'C' })
    const message = JSON.stringify({ name: 'C', is_user: false, mes: 'hello there' })

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(changeChatTo).mockClear()
        vi.mocked(selectSingleFile).mockReset()
    })

    // Regression reproducer: a character without `chatFolders` made the import throw,
    // so the user saw an error and no chat was added.
    test('a character with no chatFolders field still imports the chat', async () => {
        const cha = makeCharacter([])
        delete (cha as { chatFolders?: unknown }).chatFolders
        testDb.db = { characters: [cha] } as unknown as Database
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'chat.jsonl', data: utf8(`${header}\n${message}`) })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        const chats = (testDb.db.characters[0] as character).chats
        expect(chats).toHaveLength(1)
        expect(chats[0].folderId ?? null).toBeNull()
        expect(changeChatTo).toHaveBeenCalledWith(0)
    })
})

describe('importChat -- SillyTavern JSONL reading', () => {
    const header = JSON.stringify({ user_name: 'U', character_name: 'C', create_date: '2024-01-01', chat_metadata: {} })
    const first = JSON.stringify({ name: 'C', is_user: false, mes: 'first message' })
    const second = JSON.stringify({ name: 'U', is_user: true, mes: 'second message' })

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(alertNormal).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    function importedMessages() {
        const chats = (testDb.db.characters[0] as character).chats
        return chats.length === 0 ? [] : chats[0].message
    }

    // R1: regression reproducer. A file without a header keeps its first line.
    test('R1: a header-less two-message file imports both messages', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'chat.jsonl', data: utf8(`${first}\n${second}`) })

        await importChat()

        expect(importedMessages()).toHaveLength(2)
        expect(importedMessages().map((m) => m.role)).toEqual(['char', 'user'])
    })

    // R2: regression reproducer. One unreadable line must not discard the chat.
    test('R2: an invalid line among valid lines is skipped, the valid lines import and the count is reported', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`${header}\n${first}\n{not json\n${second}`),
        })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        expect(importedMessages()).toHaveLength(2)
        expect(alertNormal).toHaveBeenCalledTimes(1)
        // Green-only extra: the notice names the skipped count.
        expect(alertNormal).toHaveBeenCalledWith(language.chatImportSkippedLines(1))
    })

    // R3: regression reproducer relative to the pre-reader import. A line whose `mes`
    // is an object without a string `message` must not fail the import.
    test('R3: a line with an object mes and no message is skipped and does not fail the import', async () => {
        const chubLine = JSON.stringify({ name: 'C', is_user: false, mes: { other: 1 } })
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`${header}\n${first}\n${chubLine}\n${second}`),
        })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        expect(importedMessages()).toHaveLength(2)
    })

    // R4: compatibility guard. Passes before and after the fix. The lines are named `C` and
    // `U`, the header's own names, so no `name` key is stored and the objects stay exactly
    // `role` and `data`.
    test('R4: a header file imports the same roles and data as before and reports success', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`${header}\n${first}\n${second}`),
        })

        await importChat()

        expect(importedMessages()).toEqual([
            { role: 'char', data: 'first message' },
            { role: 'user', data: 'second message' },
        ])
        expect(alertNormal).toHaveBeenCalledWith(language.successImport)
    })

    // Regression reproducer: a BOM-prefixed header file imports instead of failing on the BOM.
    test('a BOM-prefixed header file imports its messages with the success notice', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({
            name: 'chat.jsonl',
            data: utf8(`\uFEFF${header}\n${first}\n${second}`),
        })

        await importChat()

        expect(alertError).not.toHaveBeenCalled()
        expect(importedMessages()).toHaveLength(2)
        expect(alertNormal).toHaveBeenCalledWith(language.successImport)
    })
})

describe('importChat -- SillyTavern JSONL field fidelity', () => {
    // The selected character is `Solo` and the mocked app user is `User`.
    const header = JSON.stringify({ user_name: 'U', character_name: 'C', create_date: '2024-01-01', chat_metadata: {} })
    const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    const charLine = (mes: unknown, extra: Record<string, unknown> = {}) =>
        JSON.stringify({ name: 'Solo', is_user: false, mes, ...extra })
    const userLine = (mes: unknown, extra: Record<string, unknown> = {}) =>
        JSON.stringify({ name: 'User', is_user: true, mes, ...extra })

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(alertNormal).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    afterEach(() => {
        // Restored by assignment: deleting TZ does not re-zone Date on every host.
        process.env.TZ = originalZone
    })

    async function runImport(lines: string[], fileName = 'chat.jsonl') {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: fileName, data: utf8(lines.join('\n')) })
        await importChat()
    }

    function importedChat() {
        return (testDb.db.characters[0] as character).chats[0]
    }

    function importedMessages() {
        const chats = (testDb.db.characters[0] as character).chats
        return chats.length === 0 ? [] : chats[0].message
    }

    function noticeText() {
        expect(alertNormal).toHaveBeenCalledTimes(1)
        return String(vi.mocked(alertNormal).mock.calls[0][0])
    }

    // T1: regression reproducer. The message time comes from `send_date`.
    test('T1: an ISO send_date becomes the message time', async () => {
        await runImport([header, charLine('a', { send_date: '2024-07-12T01:31:37.123Z' }), userLine('b')])

        expect(importedMessages()[0].time).toBe(Date.UTC(2024, 6, 12, 1, 31, 37, 123))
        expect(importedMessages()[1]).not.toHaveProperty('time')
    })

    describe.each(['Asia/Seoul', 'America/Los_Angeles'])('local-time forms in %s', (zone) => {
        beforeEach(() => {
            process.env.TZ = zone
        })

        // T2: regression reproducer. The pre-3.x meridiem form is read as local time.
        test('T2: a meridiem send_date is read as local time', async () => {
            await runImport([header, charLine('a', { send_date: 'June 19, 2023 2:20pm' })])

            expect(importedMessages()[0].time).toBe(
                zone === 'Asia/Seoul' ? Date.UTC(2023, 5, 19, 5, 20, 0) : Date.UTC(2023, 5, 19, 21, 20, 0)
            )
        })

        test('an ISO send_date without an offset is read as local time', async () => {
            await runImport([header, charLine('a', { send_date: '2024-07-12T10:31:37' })])

            expect(importedMessages()[0].time).toBe(
                zone === 'Asia/Seoul' ? Date.UTC(2024, 6, 12, 1, 31, 37) : Date.UTC(2024, 6, 12, 17, 31, 37)
            )
        })
    })

    // T3: regression reproducer. `is_system` lines import as disabled messages.
    test('T3: an is_system line imports as a disabled message and its neighbours do not', async () => {
        await runImport([header, charLine('a'), charLine('narration', { is_system: true }), userLine('b')])

        const messages = importedMessages()
        expect(messages).toHaveLength(3)
        expect(messages[1].disabled).toBe(true)
        expect(messages[0]).not.toHaveProperty('disabled')
        expect(messages[2]).not.toHaveProperty('disabled')
    })

    // T4: regression reproducer. A speaker other than the app's own names is kept.
    test('T4: a line named Narrator keeps its name', async () => {
        await runImport([header, charLine('a', { name: 'Narrator' }), userLine('b')])

        expect(importedMessages()[0].name).toBe('Narrator')
    })

    // T5: regression reproducer. The chat is named after the file.
    test('T5: the chat name is the file name without its extension', async () => {
        await runImport([header, charLine('a')], 'my chat.jsonl')
        expect(importedChat().name).toBe('my chat')

        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        await runImport([header, charLine('a')], 'CHAT.JSONL')
        expect(importedChat().name).toBe('CHAT')
    })

    // Compatibility guard: passes before and after; the base names every chat with the default.
    test('a file name that is only the extension keeps the default chat name', async () => {
        await runImport([header, charLine('a')], '.jsonl')

        expect(importedChat().name).toBe('Imported Chat')
    })

    // T6: regression reproducer. A Chub line with an object `mes` imports its message.
    test('T6: a Chub object mes imports as its message with the success notice', async () => {
        await runImport([header, charLine('a'), charLine({ message: 'hi' }), userLine('b')])

        expect(alertError).not.toHaveBeenCalled()
        expect(importedMessages().map((m) => m.data)).toEqual(['a', 'hi', 'b'])
        expect(noticeText()).toBe(language.successImport)
    })

    // T7: regression reproducers by assertion on observables that exist on the base.
    test('T7: dropped swipes change the notice and name the count', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b', 'c'] }), userLine('b')])

        const text = noticeText()
        expect(text).not.toBe(language.successImport)
        expect(text).toContain('1 message')
        expect(text).toContain('other swipes were not imported')
    })

    test('T7: several swipe lines are counted together', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b', 'c'] }), charLine('b', { swipes: ['b', 'x'] }), charLine('c', { swipes: ['c', 'x'] })])

        const text = noticeText()
        expect(text).not.toBe(language.successImport)
        expect(text).toContain('3 messages')
        expect(text).toContain('other swipes were not imported')
    })

    test('T7: a skipped line and a swipe line show both sentences', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b'] }), '{broken', userLine('b')])

        const text = noticeText()
        expect(text).toContain(language.chatImportSkippedLines(1))
        expect(text).toContain('other swipes were not imported')
    })

    test('T7: a single swipe line uses the singular sentence', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b'] })])

        const text = noticeText()
        expect(text).toContain('1 message')
        expect(text).toContain('its other swipes')
    })

    // Green only: the exact strings use the new language keys, which the base lacks.
    test('green-only: the exact swipe notice strings', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b', 'c'] }), charLine('b', { swipes: ['b', 'x'] }), charLine('c', { swipes: ['c', 'x'] })])
        expect(noticeText()).toBe(language.chatImportDone + ' ' + language.chatImportSwipesNotKept(3))

        vi.mocked(alertNormal).mockClear()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        await runImport([header, charLine('a', { swipes: ['a', 'b', 'c'] }), charLine('b', { swipes: ['b', 'x'] }), charLine('c', { swipes: ['c', 'x'] }), '{broken'])
        expect(noticeText()).toBe(language.chatImportSkippedLines(1) + ' ' + language.chatImportSwipesNotKept(3))
    })

    // T8: regression reproducers. An empty shown reply with other swipes still reports them.
    test('T8: an empty-shown line with another non-empty swipe adds no message but is counted', async () => {
        await runImport([header, charLine('a'), charLine('', { swipes: ['', 'x'] }), userLine('b')])

        expect(importedMessages()).toHaveLength(2)
        const text = noticeText()
        expect(text).toContain('1 message')
        expect(text).toContain('other swipes were not imported')
    })

    test('T8: the Chub form of an empty-shown line is counted too', async () => {
        await runImport([header, charLine('a'), charLine({ message: '' }, { swipes: [{ message: 'a' }, { message: 'b' }] })])

        expect(importedMessages()).toHaveLength(1)
        const text = noticeText()
        expect(text).toContain('1 message')
        expect(text).toContain('other swipes were not imported')
    })

    // Compatibility guard: passes before and after; nothing is lost, so no swipe notice.
    test('T8: empty-shown lines whose swipes are all empty, or single, show the plain success notice', async () => {
        await runImport([header, charLine('a'), charLine('', { swipes: ['', ''] }), charLine('', { swipes: ['x'] })])

        expect(noticeText()).toBe(language.successImport)
    })

    // G1: guard. Passes before and after.
    test('G1: a plain file yields exactly role and data on every message', async () => {
        await runImport([header, charLine('a'), userLine('b')])

        expect(importedMessages()).toStrictEqual([
            { role: 'char', data: 'a' },
            { role: 'user', data: 'b' },
        ])
        expect(noticeText()).toBe(language.successImport)
        expect(Object.keys(importedChat()).sort()).toEqual(['fmIndex', 'folderId', 'id', 'localLore', 'message', 'name', 'note'])
    })

    // G2: guard. Passes before and after; the paired mutants prove it.
    test('G2: the app names and the header names are not stored as name', async () => {
        await runImport([
            header,
            charLine('a'),
            charLine('b', { name: 'C' }),
            charLine('c', { name: ' Solo ' }),
            userLine('d'),
            userLine('e', { name: 'U' }),
        ])

        expect(importedMessages()).toHaveLength(5)
        for (const message of importedMessages()) {
            expect(message).not.toHaveProperty('name')
        }
    })

    test('G2: padded and unused header names are own names too', async () => {
        const padded = JSON.stringify({ user_name: ' U ', character_name: ' C ' })
        await runImport([padded, charLine('a', { name: 'C' }), userLine('b', { name: 'U' })])
        for (const message of importedMessages()) {
            expect(message).not.toHaveProperty('name')
        }

        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        const unused = JSON.stringify({ user_name: 'unused', character_name: 'unused' })
        await runImport([unused, charLine('a', { name: 'unused' }), userLine('b', { name: 'unused' })])
        for (const message of importedMessages()) {
            expect(message).not.toHaveProperty('name')
        }
    })

    // Regression reproducer: fails on the base, which stores no name.
    test('G2: a name that is the other side\'s own name is kept', async () => {
        await runImport([header, charLine('a', { name: 'User' }), userLine('b', { name: 'Solo' })])

        expect(importedMessages().map((m) => m.name)).toEqual(['User', 'Solo'])
    })

    // G3: guard. No swipe structure or foreign field is stored.
    test('G3: a swipe line stores no swipe data and no foreign field', async () => {
        await runImport([header, charLine('a', { swipes: ['a', 'b', 'c'], swipe_id: 1, extra: { x: 1 }, swipe_info: [{}] })])

        expect(Object.keys(importedMessages()[0]).sort()).toEqual(['data', 'role'])
    })

    // Regression reproducer: fails on the base, which writes only role and data.
    test('G3: every field written together is exactly role, data, time, name and disabled', async () => {
        await runImport([header, charLine('a', { name: 'Narrator', is_system: true, send_date: '2024-07-12T01:31:37.123Z', swipes: ['a', 'b'] })])

        expect(importedMessages()[0]).toStrictEqual({
            role: 'char',
            data: 'a',
            time: Date.UTC(2024, 6, 12, 1, 31, 37, 123),
            name: 'Narrator',
            disabled: true,
        })
    })

    // G5: guard. Swipes are counted only where something is lost.
    test('G5: a skipped line, a one-entry swipes array and extra adds no swipe notice', async () => {
        await runImport([header, charLine('a', { swipes: ['a'] }), charLine('b', { extra: {} }), charLine(5, { swipes: ['a', 'b'] })])

        expect(noticeText()).toBe(language.chatImportSkippedLines(1))
    })

    // G6: guard. An unparseable date does not drop the message.
    test('G6: an unparseable send_date still imports the message, without a time', async () => {
        await runImport([header, charLine('a', { send_date: 'not a date' }), charLine('b', { send_date: 7.5e300 })])

        expect(importedMessages()).toHaveLength(2)
        expect(importedMessages()[0]).not.toHaveProperty('time')
        expect(importedMessages()[1]).not.toHaveProperty('time')
        expect(noticeText()).toBe(language.successImport)
    })

    // G7: guard. Dropped extra, generation and metadata keys are silent.
    test('G7: extra, gen_started, gen_finished and chat_metadata alone keep the success notice', async () => {
        const noisy = JSON.stringify({ user_name: 'U', character_name: 'C', chat_metadata: { note: { a: 1 } } })
        await runImport([noisy, charLine('a', { extra: { api: 'x' }, gen_started: '2024-07-12', gen_finished: '2024-07-13' })])

        expect(noticeText()).toBe(language.successImport)
    })

    // G8: regression reproducer (fails on the base, which stores no time). A saved time can always be formatted.
    test('G8: an out-of-range send_date stores no time and an accepted one formats', async () => {
        await runImport([
            header,
            charLine('a', { send_date: '99999999999999999999' }),
            charLine('b', { send_date: 8.64e15 + 1 }),
            charLine('c', { send_date: 253402300799999 }),
        ])

        const messages = importedMessages()
        expect(messages[0]).not.toHaveProperty('time')
        expect(messages[1]).not.toHaveProperty('time')
        expect(messages[2].time).toBe(253402300799999)
        expect(() => new Intl.DateTimeFormat().format(messages[2].time)).not.toThrow()
    })
})

describe('importChat -- Ooba JSON', () => {
    const marker = '<|BEGIN-VISIBLE-CHAT|>'
    const stamp = (minute: number) => new Date(2025, 9, 24, 1, minute).getTime()

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(alertNormal).mockClear()
        vi.mocked(changeChatTo).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    async function runOoba(body: unknown, fileName = 'ooba.json') {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: fileName, data: utf8(JSON.stringify(body)) })
        await importChat()
    }

    function chatList() {
        return (testDb.db.characters[0] as character).chats
    }

    function importedMessages() {
        const chats = chatList()
        return chats.length === 0 ? [] : chats[0].message
    }

    function noticeText() {
        expect(alertNormal).toHaveBeenCalledTimes(1)
        return String(vi.mocked(alertNormal).mock.calls[0][0])
    }

    const greetingAndTwoTurns = {
        internal: [[marker, 'Welcome'], ['hello', 'first reply'], ['more', 'second reply']],
        visible: [['', 'Welcome'], ['hello', 'first reply'], ['more', 'second reply']],
    }

    // R1: regression reproducer. An Ooba chat file imports as one chat.
    test('R1: an Ooba file imports its messages without the marker row', async () => {
        await runOoba(greetingAndTwoTurns)

        expect(chatList()).toHaveLength(1)
        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['char', 'Welcome'],
            ['user', 'hello'],
            ['char', 'first reply'],
            ['user', 'more'],
            ['char', 'second reply'],
        ])
        expect(alertError).not.toHaveBeenCalled()
        expect(noticeText()).toBe(language.successImport)
        expect(changeChatTo).toHaveBeenCalledTimes(1)
        expect(changeChatTo).toHaveBeenCalledWith(0)
    })

    // R1 variant: regression reproducer. The marker is read from the internal cell.
    test('R1: a marker row with a non-empty visible cell is still the marker row', async () => {
        await runOoba({
            internal: [[marker, 'Welcome'], ['hello', 'reply']],
            visible: [['shown', 'Welcome'], ['hello', 'reply']],
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['char', 'Welcome'],
            ['user', 'hello'],
            ['char', 'reply'],
        ])
    })

    // R2: regression reproducer. The typed text is the visible cell.
    test('R2: the user text comes from visible and is unescaped, the character text from internal as is', async () => {
        await runOoba({
            internal: [['INJECTED CONTEXT typed', 'a &amp; b']],
            visible: [['it&#x27;s &quot;ok&quot;', 'ignored']],
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['user', 'it\'s "ok"'],
            ['char', 'a &amp; b'],
        ])
    })

    // R3: regression reproducer. The chat is named after the file.
    test('R3: the chat is named after the file without its extension', async () => {
        await runOoba(greetingAndTwoTurns, 'My Ooba.json')

        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('My Ooba')
    })

    // R4: regression reproducer. The older data / data_visible pair imports.
    test('R4: the legacy data and data_visible pair imports', async () => {
        await runOoba({
            data: [['hello', 'reply']],
            data_visible: [['hello', 'reply']],
        })

        expect(chatList()).toHaveLength(1)
        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['user', 'hello'],
            ['char', 'reply'],
        ])
    })

    // R5: regression reproducer. Times come from the row-indexed metadata.
    test('R5: user_ and assistant_ timestamps give each message its own local time', async () => {
        await runOoba({
            ...greetingAndTwoTurns,
            metadata: {
                assistant_0: { timestamp: 'Oct 24, 2025 01:04', model_name: 'ignored' },
                user_1: { timestamp: 'Oct 24, 2025 01:05' },
                assistant_1: { timestamp: 'Oct 24, 2025 01:06' },
            },
        })

        const messages = importedMessages()
        expect(messages).toHaveLength(5)
        expect(messages[0].time).toBe(stamp(4))
        expect(messages[1].time).toBe(stamp(5))
        expect(messages[2].time).toBe(stamp(6))
        expect(messages[3]).not.toHaveProperty('time')
        expect(messages[4]).not.toHaveProperty('time')
    })

    // R6: regression reproducer. Unreadable rows do not discard the chat.
    test('R6: unreadable rows are skipped, counted, and the valid rows import', async () => {
        await runOoba({
            internal: [['x'], ['hello', 'reply'], 'str', null],
            visible: [['x'], ['hello', 'reply'], 'str', null],
        })

        expect(importedMessages().map((m) => m.role)).toEqual(['user', 'char'])
        expect(noticeText()).toBe(language.chatImportSkippedLines(3))
    })

    // R7: regression reproducer. Cells beyond the second are ignored without a count.
    test('R7: a row with extra cells imports its two messages and counts nothing', async () => {
        await runOoba({
            internal: [['hello', 'reply', 'extra', 'more']],
            visible: [['hello', 'reply', 'extra', 'more']],
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['user', 'hello'],
            ['char', 'reply'],
        ])
        expect(noticeText()).toBe(language.successImport)
    })

    // R9: regression reproducer. Regenerated replies are not imported, and the notice says so.
    test('R9: a regenerated reply imports its shown text and the notice names the count', async () => {
        await runOoba({
            internal: [['hello', 'shown reply']],
            visible: [['hello', 'shown reply']],
            metadata: { assistant_0: { versions: [{ content: 'old reply' }, { content: 'shown reply' }], current_version_index: 1 } },
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['user', 'hello'],
            ['char', 'shown reply'],
        ])
        expect(noticeText()).toBe(language.chatImportDone + ' ' + language.chatImportSwipesNotKept(1))
    })

    test('R9: two regenerated rows are counted together', async () => {
        await runOoba({
            internal: [['a', 'b'], ['c', 'd']],
            visible: [['a', 'b'], ['c', 'd']],
            metadata: {
                assistant_0: { versions: [{ content: 'b0' }, { content: 'b' }] },
                assistant_1: { versions: [{ content: 'd0' }, { content: 'd' }] },
            },
        })

        expect(importedMessages()).toHaveLength(4)
        expect(noticeText()).toBe(language.chatImportDone + ' ' + language.chatImportSwipesNotKept(2))
    })

    test('R9: a skipped row and a regenerated row show both sentences', async () => {
        await runOoba({
            internal: [['x'], ['a', 'b']],
            visible: [['x'], ['a', 'b']],
            metadata: { assistant_1: { versions: [{ content: 'b0' }, { content: 'b' }] } },
        })

        expect(importedMessages()).toHaveLength(2)
        expect(noticeText()).toBe(language.chatImportSkippedLines(1) + ' ' + language.chatImportSwipesNotKept(1))
    })

    // R10: boundary pairing with R9. Passes only once the feature exists, because the base never imports.
    test('R10: one version, or malformed versions, add no swipe notice', async () => {
        for(const versions of [[{ content: 'shown' }], 'x', {}]){
            vi.mocked(alertNormal).mockClear()
            testDb.db = { characters: [makeCharacter([])] } as unknown as Database
            await runOoba({
                internal: [['hello', 'shown']],
                visible: [['hello', 'shown']],
                metadata: { assistant_0: { versions } },
            })

            expect(importedMessages()).toHaveLength(2)
            expect(noticeText()).toBe(language.successImport)
        }
    })

    // R11: regression reproducer. An empty visible user cell falls back to the raw internal text.
    test('R11: an empty or missing visible user cell falls back to the internal text, raw', async () => {
        for(const visible of [[['', 'reply']], [], [[]]]){
            vi.mocked(alertNormal).mockClear()
            testDb.db = { characters: [makeCharacter([])] } as unknown as Database
            await runOoba({ internal: [['typed &amp; kept', 'reply']], visible })

            expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
                ['user', 'typed &amp; kept'],
                ['char', 'reply'],
            ])
            expect(noticeText()).toBe(language.successImport)
        }
    })

    test('R11: empty user cells on both sides give no user message and no count', async () => {
        await runOoba({ internal: [['', 'reply']], visible: [['', 'reply']] })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([['char', 'reply']])
        expect(noticeText()).toBe(language.successImport)
    })

    // R12: guard. Versions on the user entry are never a swipe loss.
    test('R12: versions on the user entry add no swipe notice', async () => {
        await runOoba({
            internal: [['hello', 'reply']],
            visible: [['hello', 'reply']],
            metadata: { user_0: { versions: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] } },
        })

        expect(importedMessages()).toHaveLength(2)
        expect(noticeText()).toBe(language.successImport)
    })

    // R13: regression reproducer. A stopped generation keeps its old reply only as an unimported version.
    test('R13: an empty shown reply with a non-empty alternate adds no message and is counted', async () => {
        await runOoba({
            internal: [[marker, 'Welcome'], ['hello', '']],
            visible: [['', 'Welcome'], ['hello', '']],
            metadata: { assistant_1: { versions: [{ content: '' }, { content: 'old reply' }] } },
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([
            ['char', 'Welcome'],
            ['user', 'hello'],
        ])
        expect(noticeText()).toBe(language.chatImportDone + ' ' + language.chatImportSwipesNotKept(1))
    })

    // R14: boundary pairing with R13. Red on the base only because the base never imports.
    test('R14: an empty shown reply without a non-empty alternate is not counted', async () => {
        const cases: unknown[] = [
            { versions: [{ content: '' }, { content: '' }] },
            { versions: [{ content: 'old reply' }] },
            { versions: 'old reply' },
        ]
        for(const entry of cases){
            vi.mocked(alertNormal).mockClear()
            testDb.db = { characters: [makeCharacter([])] } as unknown as Database
            await runOoba({
                internal: [['hello', '']],
                visible: [['hello', '']],
                metadata: { assistant_0: entry },
            })

            expect(importedMessages().map((m) => [m.role, m.data])).toEqual([['user', 'hello']])
            expect(noticeText()).toBe(language.successImport)
        }
    })
})

describe('importChat -- unchanged routing and the shared chat builder', () => {
    const marker = '<|BEGIN-VISIBLE-CHAT|>'
    const oobaRows = [['hi', 'there']]

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(alertNormal).mockClear()
        vi.mocked(changeChatTo).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    async function runFile(name: string, text: string) {
        vi.mocked(selectSingleFile).mockResolvedValue({ name, data: utf8(text) })
        await importChat()
    }

    function chatList() {
        return (testDb.db.characters[0] as character).chats
    }

    function expectNoData() {
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.noData)
        expect(chatList()).toHaveLength(0)
        expect(changeChatTo).not.toHaveBeenCalled()
    }

    // G1: guard (passes before and after). A Risu v1 chat keeps its route.
    test('G1: a valid risuChat v1 file imports with a fresh id and the success notice', async () => {
        await runFile('chat.json', JSON.stringify({
            type: 'risuChat',
            ver: 1,
            data: { message: [], note: 'n', name: 'Risu Chat', localLore: [], id: 'file-id' },
        }))

        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('Risu Chat')
        expect(chatList()[0].id).not.toBe('file-id')
        expect(alertNormal).toHaveBeenCalledWith(language.successImport)
    })

    // G2: guard (passes before and after). A ver 2 file carrying Ooba arrays still takes the ver 2 route.
    test('G2: risuChat and risuAllChats v2 files carrying internal and visible keep their route', async () => {
        const chat = { message: [], note: 'n', name: 'Risu V2', localLore: [], id: 'file-id' }
        await runFile('chat.json', JSON.stringify({ type: 'risuChat', ver: 2, data: chat, internal: oobaRows, visible: oobaRows }))
        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('Risu V2')
        expect(chatList()[0].message).toHaveLength(0)

        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        await runFile('all.json', JSON.stringify({ type: 'risuAllChats', ver: 2, data: [chat], internal: oobaRows, visible: oobaRows }))
        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('Risu V2')
        expect(chatList()[0].message).toHaveLength(0)
    })

    // G3: guard (passes before and after). A Risu type is never read as Ooba.
    test('G3: a risuChat v3 file carrying Ooba arrays is no data', async () => {
        await runFile('chat.json', JSON.stringify({ type: 'risuChat', ver: 3, internal: oobaRows, visible: oobaRows }))

        expectNoData()
    })

    test('G3: a risuChat v1 file with a null message is no data even carrying Ooba arrays', async () => {
        await runFile('chat.json', JSON.stringify({
            type: 'risuChat',
            ver: 1,
            data: { message: null, note: 'n', name: 'x', localLore: [] },
            internal: oobaRows,
            visible: oobaRows,
        }))

        expectNoData()
    })

    // G4: guard (passes before and after; kills a detector that accepts one half of a pair).
    const unknownShapes: Array<[string, unknown]> = [
        ['an empty object', {}],
        ['an empty array', []],
        ['a string', 'text'],
        ['internal alone', { internal: oobaRows }],
        ['internal with a non-array visible', { internal: oobaRows, visible: 'x' }],
        ['visible alone', { visible: oobaRows }],
        ['data alone', { data: oobaRows }],
        ['data_visible alone', { data_visible: oobaRows }],
        ['internal crossed with data_visible', { internal: oobaRows, data_visible: oobaRows }],
    ]
    test.each(unknownShapes)('G4: %s is no data', async (_label, body) => {
        await runFile('chat.json', JSON.stringify(body))

        expectNoData()
    })

    // G5: guard (passes before and after). The ST route keeps calling changeChatTo and its notices.
    test('G5: a SillyTavern file opens the new chat', async () => {
        await runFile('chat.jsonl', JSON.stringify({ name: 'Solo', is_user: false, mes: 'a' }))

        expect(chatList()).toHaveLength(1)
        expect(changeChatTo).toHaveBeenCalledTimes(1)
        expect(changeChatTo).toHaveBeenCalledWith(0)
    })

    test('G5: a skipped line with a swipe line shows both sentences', async () => {
        const swipeLine = JSON.stringify({ name: 'Solo', is_user: false, mes: 'a', swipes: ['a', 'b'] })
        await runFile('chat.jsonl', `${swipeLine}\n{bad`)

        expect(chatList()).toHaveLength(1)
        expect(alertNormal).toHaveBeenCalledWith(language.chatImportSkippedLines(1) + ' ' + language.chatImportSwipesNotKept(1))
    })

    // G7: guard (passes before and after). Nothing readable means no chat and no chat switch.
    test('G7: a SillyTavern file with only invalid lines is no data', async () => {
        await runFile('chat.jsonl', '{bad\nalso bad')

        expectNoData()
    })

    // G8: guard (passes before and after; kills a builder that imports an empty chat).
    test('G8: an Ooba file whose every row is unreadable is no data', async () => {
        await runFile('ooba.json', JSON.stringify({ internal: [['x'], 'str', null], visible: [['x'], 'str', null] }))

        expectNoData()
    })

    test('G8: an Ooba file holding only a marker row with an empty character cell is no data', async () => {
        await runFile('ooba.json', JSON.stringify({ internal: [[marker, '']], visible: [['', '']] }))

        expectNoData()
    })
})

describe('importChat -- the imported chat goes first and is the chat opened', () => {
    beforeEach(() => {
        vi.mocked(changeChatTo).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([makeChat('chat-existing', 'Existing Chat')])] } as unknown as Database
    })

    // Guard: pins index-0 placement and changeChatTo(0) for both formats; an append would
    // leave the existing chat at index 0.
    test.each([
        ['a SillyTavern JSONL file', 'new.jsonl', JSON.stringify({ name: 'Solo', is_user: false, mes: 'a' })],
        ['an Ooba file', 'new.json', JSON.stringify({ internal: [['hi', 'there']], visible: [['hi', 'there']] })],
        ['an Agnai file', 'new.json', JSON.stringify({ name: 'Exported', messages: [{ msg: 'hi', userId: 'u1' }] })],
    ])('%s is inserted at index 0 ahead of the existing chat and opened', async (_label, name, text) => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name, data: utf8(text) })

        await importChat()

        const chats = (testDb.db.characters[0] as character).chats
        expect(chats.map((c) => c.name)).toEqual(['new', 'Existing Chat'])
        expect(changeChatTo).toHaveBeenCalledTimes(1)
        expect(changeChatTo).toHaveBeenCalledWith(0)
    })
})

describe('importChat -- Agnai JSON', () => {
    const fileName = 'chat-4f2a.json'
    const stamp = (minute: number) => new Date(Date.UTC(2025, 0, 1, 0, minute)).toISOString()
    type Row = Record<string, unknown>

    // Every row carries the message text `m-<id>`, so an expectation reads as a list of ids.
    const row = (id: string, parent: string | undefined, minute: number, extra: Row = {}): Row => ({
        _id: id, parent, msg: `m-${id}`, createdAt: stamp(minute), characterId: 'imported', ...extra,
    })
    const agnaiFile = (messages: unknown[], treeLeafId?: unknown) => ({
        name: 'Exported',
        greeting: '',
        messages: treeLeafId === undefined ? messages : messages.map((m) => ({ ...(m as Row), treeLeafId })),
    })
    const branched = (): Row[] => [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'a1', 3), row('d4', 'c3', 4), row('e5', 'b2', 5)]

    beforeEach(() => {
        vi.mocked(alertError).mockClear()
        vi.mocked(alertNormal).mockClear()
        vi.mocked(changeChatTo).mockClear()
        vi.mocked(selectSingleFile).mockReset()
        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
    })

    async function runAgnai(body: unknown, name = fileName) {
        vi.mocked(selectSingleFile).mockResolvedValue({ name, data: utf8(JSON.stringify(body)) })
        await importChat()
    }

    function chatList() {
        return (testDb.db.characters[0] as character).chats
    }

    function importedMessages() {
        const chats = chatList()
        return chats.length === 0 ? [] : chats[0].message
    }

    function importedTexts() {
        return importedMessages().map((m) => m.data)
    }

    function noticeText() {
        expect(alertNormal).toHaveBeenCalledTimes(1)
        return String(vi.mocked(alertNormal).mock.calls[0][0])
    }

    // The notice addImportedChat builds for `skipped` unreadable elements and `swipes` messages not kept.
    function expectedNotice(skipped: number, swipes: number) {
        const lead = skipped > 0 ? language.chatImportSkippedLines(skipped) : language.chatImportDone
        if(swipes > 0){
            return lead + ' ' + language.chatImportSwipesNotKept(swipes)
        }
        return skipped > 0 ? language.chatImportSkippedLines(skipped) : language.successImport
    }

    function expectNoData() {
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.noData)
        expect(chatList()).toHaveLength(0)
        expect(changeChatTo).not.toHaveBeenCalled()
    }

    // Reproducers: on the base an Agnai file is no data, so each fails by assertion.
    test('E0: a file without ids keeps all messages in file order with no time', async () => {
        await runAgnai({
            name: 'Exported',
            messages: [
                { msg: 'hello there', userId: 'u1', characterId: 'imported' },
                { msg: 'first reply', characterId: 'c-1' },
                { msg: 'second reply', characterId: 'c-2' },
            ],
        })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([['user', 'hello there'], ['char', 'first reply'], ['char', 'second reply']])
        expect(importedMessages().every((m) => m.time === undefined)).toBe(true)
        expect(alertError).not.toHaveBeenCalled()
        expect(noticeText()).toBe(language.successImport)
    })

    test('E1: parents that are text prefixes keep all messages in file order', async () => {
        const texts = ['Once upon a time', 'The knight rode out', 'A dragon woke up', 'Fire filled the sky', 'The knight fled', 'Peace returned', 'A feast began', 'Everyone slept']
        const rows = texts.map((text, index) => row(`e1a0000${index}`, index === 0 ? undefined : text.slice(0, 8), index, { msg: text }))

        await runAgnai(agnaiFile(rows, 'e1a00002'))

        expect(importedTexts()).toEqual(texts)
        expect(noticeText()).toBe(language.successImport)
    })

    test.each([['an ancestor', 'r0'], ['a missing id', undefined]])('E2: a real chain imports whole when treeLeafId is %s', async (_label, leaf) => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'b2', 3)]

        await runAgnai(agnaiFile(rows, leaf))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-c3'])
        expect(noticeText()).toBe(language.successImport)
    })

    test('E3: a branched file imports the path to the newest tip and reports the rest', async () => {
        await runAgnai(agnaiFile(branched(), 'd4'))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-e5'])
        expect(noticeText()).toBe(expectedNotice(0, 2))
    })

    test('E3: the same file in reverse order gives the same chat', async () => {
        await runAgnai(agnaiFile(branched().reverse(), 'd4'))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-e5'])
        expect(noticeText()).toBe(expectedNotice(0, 2))
    })

    test('FC: fork and continue imports the newer branch although treeLeafId names the older tip', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('d4', 'b2', 3), row('e5', 'a1', 4), row('f6', 'e5', 5)]

        await runAgnai(agnaiFile(rows, 'd4'))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-e5', 'm-f6'])
        expect(noticeText()).toBe(expectedNotice(0, 2))
    })

    test.each([['a tip', 'd4'], ['an ancestor', 'a1'], ['an unknown id', 'zzzzzzzz'], ['a number', 7], ['a missing value', undefined]])(
        'TL1: treeLeafId as %s does not change the result', async (_label, leaf) => {
            await runAgnai(agnaiFile(branched(), leaf))

            expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-e5'])
            expect(noticeText()).toBe(expectedNotice(0, 2))
        })

    test('ties: equal creation times pick the later element in the file', async () => {
        await runAgnai(agnaiFile([row('r0', undefined, 0), row('c3', 'r0', 5), row('b2', 'r0', 5)]))

        expect(importedTexts()).toEqual(['m-r0', 'm-b2'])
        expect(noticeText()).toBe(expectedNotice(0, 1))
    })

    const undatedCases: Array<[string, string[], string[]]> = [
        ['undated tip last', ['r0', 'x1', 'y2'], ['m-r0', 'm-y2']],
        ['undated tip before the dated one', ['r0', 'y2', 'x1'], ['m-r0', 'm-x1']],
    ]
    test.each(undatedCases)('ties: %s, the greatest file index wins', async (_label, order, expected) => {
        const byId: Record<string, Row> = {
            r0: row('r0', undefined, 0),
            x1: row('x1', 'r0', 9),
            y2: row('y2', 'r0', 0, { createdAt: 'not a date' }),
        }

        await runAgnai(agnaiFile(order.map((id) => byId[id])))

        expect(importedTexts()).toEqual(expected)
        expect(noticeText()).toBe(expectedNotice(0, 1))
    })

    test('O1: a newer orphan subtree is imported and the main chain is counted', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'b2', 3), row('x9', 'zzzzzzzz', 4), row('y8', 'x9', 5)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-x9', 'm-y8'])
        expect(noticeText()).toBe(expectedNotice(0, 4))
    })

    test('O2: an older orphan subtree is counted and the main chain is imported', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'b2', 3), row('x9', 'zzzzzzzz', 1), row('y8', 'x9', 2)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-c3'])
        expect(noticeText()).toBe(expectedNotice(0, 2))
    })

    test('E1c: one coincidental text prefix equal to an id makes the file branched (accepted risk)', async () => {
        const rows = Array.from({ length: 12 }, (_, index) => {
            const text = index === 4 ? 'e1a00002 and more' : `Line ${index} of the story`
            return row(`e1a0000${(index + 1).toString(16)}`, text.slice(0, 8), index, { msg: text })
        })

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['Line 11 of the story'])
        expect(noticeText()).toBe(expectedNotice(0, 11))
    })

    test('D1: a repeated id inside a tree imports everything in file order', async () => {
        const rows = [row('r0', undefined, 0), row('x1', 'r0', 1, { msg: 'first x1' }), row('x1', 'r0', 2, { msg: 'second x1' }), row('c3', 'x1', 3)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-r0', 'first x1', 'second x1', 'm-c3'])
        expect(noticeText()).toBe(language.successImport)
    })

    const loopCases: Array<[string, Row[], string[]]> = [
        ['D2: a two-message cycle and a separate message', [row('A', 'B', 0), row('B', 'A', 1), row('C', undefined, 2)], ['m-A', 'm-B', 'm-C']],
        ['D3: a self-parent and a separate chain', [row('S', 'S', 0), row('a1', undefined, 1), row('b2', 'a1', 2)], ['m-S', 'm-a1', 'm-b2']],
        // The loop check, or failing it the bounded path walk, ends this case as file order; D2 and D3 pin the loop check.
        ['D4: a cycle above two tips', [row('A', 'B', 0), row('B', 'A', 1), row('C', 'A', 2), row('D', 'A', 3)], ['m-A', 'm-B', 'm-C', 'm-D']],
    ]
    test.each(loopCases)('%s imports in file order with no swipe sentence', async (_label, rows, expected) => {
        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(expected)
        expect(noticeText()).toBe(language.successImport)
    })

    test('K2: a skipped element inside a chain keeps the chain whole', async () => {
        const rows = [row('a1', undefined, 0), row('b2', 'a1', 1, { msg: 5 }), row('c3', 'b2', 2), row('d4', 'c3', 3)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-a1', 'm-c3', 'm-d4'])
        expect(noticeText()).toBe(expectedNotice(1, 0))
    })

    test('K1: a numeric msg off the path is skipped, not counted as a swipe', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'r0', 2, { msg: 5 }), row('c3', 'a1', 3), null]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-r0', 'm-a1', 'm-c3'])
        expect(noticeText()).toBe(expectedNotice(2, 0))
    })

    test('K1b: the same tree with a newer tip reports both sentences', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'r0', 2, { msg: 5 }), row('c3', 'a1', 3), null, row('d4', 'r0', 4)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-r0', 'm-d4'])
        expect(noticeText()).toBe(expectedNotice(2, 2))
    })

    test('E1x-a: an empty msg in a chain keeps it whole and is uncounted; all-empty is no data', async () => {
        await runAgnai(agnaiFile([row('a1', undefined, 0), row('b2', 'a1', 1, { msg: '' }), row('c3', 'b2', 2)]))

        expect(importedTexts()).toEqual(['m-a1', 'm-c3'])
        expect(noticeText()).toBe(language.successImport)

        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        vi.mocked(alertNormal).mockClear()
        vi.mocked(alertError).mockClear()
        vi.mocked(changeChatTo).mockClear()
        await runAgnai(agnaiFile([row('a1', undefined, 0, { msg: '' }), row('b2', 'a1', 1, { msg: '' })]))
        expectNoData()
    })

    test('E1x-b: an empty msg off the path is not counted', async () => {
        const rows = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'r0', 2, { msg: '' }), row('c3', 'a1', 3), row('d4', 'r0', 4)]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-r0', 'm-d4'])
        expect(noticeText()).toBe(expectedNotice(0, 2))
    })

    test('M1x: several characters in a linear chat are all kept', async () => {
        const rows = [
            row('a1', undefined, 0, { userId: 'u1' }),
            row('b2', 'a1', 1, { characterId: 'c-1' }),
            row('c3', 'b2', 2, { characterId: 'c-2' }),
            row('d4', 'c3', 3, { userId: 'u1' }),
            row('e5', 'd4', 4, { characterId: 'c-1' }),
            row('f6', 'e5', 5, { characterId: 'c-3' }),
        ]

        await runAgnai(agnaiFile(rows))

        expect(importedTexts()).toEqual(['m-a1', 'm-b2', 'm-c3', 'm-d4', 'm-e5', 'm-f6'])
        expect(noticeText()).toBe(language.successImport)
    })

    test('S1: speaker is decided by userId and names follow the line kind', async () => {
        await runAgnai({
            name: 'Exported',
            messages: [
                { msg: 'u1', userId: 'U1', characterId: 'imported', name: 'Sam' },
                { msg: 'u2', userId: 'U1', characterId: 'c-2', name: 'Narrator' },
                { msg: 'u3', userId: 'U1', name: 'handle' },
                { msg: 'u4', userId: 'U1', characterId: 'imported', name: 'User' },
                { msg: 'c1', characterId: 'imported', name: 'Bot' },
                { msg: 'c2', characterId: 'c-2', name: 'Ann' },
                { msg: 'c3', characterId: 'c-2', name: 'Solo' },
                { msg: 'c4' },
            ],
        })

        expect(importedMessages().map((m) => [m.data, m.role, m.name])).toEqual([
            ['u1', 'user', 'Sam'],
            ['u2', 'user', 'Narrator'],
            ['u3', 'user', undefined],
            ['u4', 'user', undefined],
            ['c1', 'char', undefined],
            ['c2', 'char', 'Ann'],
            ['c3', 'char', undefined],
            ['c4', 'char', undefined],
        ])
    })

    test('OOC1: ooc is an ordinary user message, never disabled', async () => {
        await runAgnai({ name: 'Exported', messages: [{ msg: 'a', ooc: true }, { msg: 'b', ooc: true, userId: 'U1' }] })

        expect(importedMessages().map((m) => [m.data, m.role])).toEqual([['a', 'user'], ['b', 'user']])
        expect(importedMessages().every((m) => !('disabled' in m))).toBe(true)
    })

    test('T1: a readable createdAt becomes time exactly; unreadable and year 10000 give none', async () => {
        const rows = [
            row('a1', undefined, 0, { createdAt: '2025-03-04T05:06:07.000Z' }),
            row('b2', 'a1', 1, { createdAt: 'later' }),
            row('c3', 'b2', 2, { createdAt: '10000-01-01T00:00:00.000Z' }),
        ]

        await runAgnai(agnaiFile(rows))

        expect(importedMessages().map((m) => m.time)).toEqual([Date.UTC(2025, 2, 4, 5, 6, 7), undefined, undefined])
    })

    test('N1: the chat is named after the file and opened first', async () => {
        await runAgnai(agnaiFile([row('a1', undefined, 0)]))

        expect(chatList().map((c) => c.name)).toEqual(['chat-4f2a'])
        expect(changeChatTo).toHaveBeenCalledTimes(1)
        expect(changeChatTo).toHaveBeenCalledWith(0)
    })

    test('F1: a written message holds exactly role, data, time and name', async () => {
        await runAgnai({
            name: 'Exported',
            messages: [{ _id: 'a1', msg: 'hi', userId: 'U1', characterId: 'c-2', name: 'Narrator', createdAt: '2025-03-04T05:06:07.000Z', ooc: true, extras: { x: 1 }, json: {}, values: {}, handle: 'h', state: 's' }],
        })

        expect(importedMessages()).toEqual([{ role: 'user', data: 'hi', time: Date.UTC(2025, 2, 4, 5, 6, 7), name: 'Narrator' }])
    })

    // Guards: these pass before and after the Agnai route exists.
    test('G-risu: Risu exports carrying a messages array still import as Risu', async () => {
        const chat = { message: [], note: 'n', name: 'Risu Chat', localLore: [], id: 'file-id' }
        await runAgnai({ type: 'risuChat', ver: 1, data: chat, messages: [{ msg: 'x' }] })
        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('Risu Chat')
        expect(chatList()[0].message).toHaveLength(0)

        testDb.db = { characters: [makeCharacter([])] } as unknown as Database
        await runAgnai({ type: 'risuAllChats', ver: 2, data: [chat], folders: [], messages: [{ msg: 'x' }] })
        expect(chatList()).toHaveLength(1)
        expect(chatList()[0].name).toBe('Risu Chat')
        expect(chatList()[0].message).toHaveLength(0)
    })

    test('G-ooba: an Ooba file with an added messages array still imports as Ooba', async () => {
        await runAgnai({ internal: [['hi', 'there']], visible: [['hi', 'there']], messages: [{ msg: 'x' }] })

        expect(importedMessages().map((m) => [m.role, m.data])).toEqual([['user', 'hi'], ['char', 'there']])
    })

    test('G-jsonl: a .jsonl file holding an Agnai-looking object goes to the SillyTavern reader and is no data', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'chat.jsonl', data: utf8('{"messages":[{"msg":"x"}]}') })

        await importChat()

        expectNoData()
    })

    const notAgnai: Array<[string, unknown]> = [
        ['a Lianne-like file', { messages: [{ msg: 'x', candidates: ['a'] }] }],
        ['an OpenAI-like file', { messages: [{ role: 'user', content: 'x' }] }],
        ['a Kobold-like file', { gamestarted: true, prompt: 'x', actions: ['a'] }],
        ['an empty messages array', { messages: [] }],
    ]
    test.each(notAgnai)('G-other: %s is no data', async (_label, body) => {
        await runAgnai(body)

        expectNoData()
    })
})
