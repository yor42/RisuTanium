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
