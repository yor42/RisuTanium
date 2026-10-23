// @vitest-environment happy-dom

/**
 * Regex keys of a lorebook entry (`useRegex`) in the REAL `loadLoreBookV3Prompt`
 * scan. A `/pattern/flags` key is matched against every message inside the scan
 * depth, a flagless `/pattern/` key is valid, a key that is not written as
 * `/pattern/flags` matches as a plain substring, and a `/pattern/flags` key that
 * is not a valid regex never activates the entry and never throws.
 *
 * Labels: R = regression reproducer (fails on the slash-stripping
 * implementation that rewrote the key in place, passes on the parse-once
 * implementation); G = compatibility guard (passes on both).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
    },
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn(async () => 1) }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'

type Said = { role: 'user' | 'char', data: string }

function entry(key: string, useRegex: boolean) {
    return {
        key,
        comment: 'entry',
        content: 'LORE BODY',
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        useRegex,
    }
}

// Messages are listed oldest first, as in `chat.message`. The default scan depth
// equals the message count so every message is scanned.
function setScene(lore: ReturnType<typeof entry>[], said: Said[], scanDepth = said.length) {
    h.db.characters = [{
        name: 'Char',
        chatPage: 0,
        globalLore: lore,
        loreSettings: { scanDepth, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: false },
        chats: [{
            id: 'chat-1',
            localLore: [],
            message: said.map((m) => ({ role: m.role, data: m.data, time: 0 })),
        }],
    }]
}

async function activated(lore: ReturnType<typeof entry>[], said: Said[], scanDepth = said.length) {
    setScene(lore, said, scanDepth)
    const result = await loadLoreBookV3Prompt()
    return result.actives.length
}

const sleepy: Said[] = [
    { role: 'user', data: 'A Dragon sleeps under the mountain.' },
    { role: 'char', data: 'Nothing else to report.' },
    { role: 'user', data: 'Let us have tea.' },
]

beforeEach(() => {
    h.db.characters = []
})

describe('lorebook regex keys', () => {
    test('R: a flagged regex key activates on an older scanned message, not only the latest', async () => {
        expect(await activated([entry('/dragon/i', true)], sleepy)).toBe(1)
    })

    test('R: a regex key with no flags activates when a scanned message contains the pattern', async () => {
        expect(await activated([entry('/dragon/', true)], [
            { role: 'user', data: 'The dragon appears.' },
        ])).toBe(1)
    })

    test('R: the match is found on a later message after earlier messages fail', async () => {
        expect(await activated([entry('/dragon/', true)], [
            { role: 'user', data: 'Hello.' },
            { role: 'char', data: 'Welcome.' },
            { role: 'user', data: 'I saw a dragon.' },
        ])).toBe(1)
    })

    test('R: the first key failing does not stop a later comma-separated regex key from matching', async () => {
        expect(await activated([entry('/zzz/i,/dragon/i', true)], sleepy)).toBe(1)
    })

    test('R: a g-flag regex key activates (the pattern is retried from the start on each message)', async () => {
        // Fails on the slash-stripping implementation through its slash
        // handling; lastIndex alone is not observable because a successful
        // test ends the scan of that entry.
        expect(await activated([entry('/dragon/gi', true)], sleepy)).toBe(1)
    })

    test('G: a regex key with no match does not activate', async () => {
        expect(await activated([entry('/wyvern/i', true)], sleepy)).toBe(0)
    })

    test('G: a message outside the scan depth is not matched', async () => {
        expect(await activated([entry('/dragon/i', true)], sleepy, 2)).toBe(0)
    })

    test('G: an invalid regex key does not activate and does not throw', async () => {
        await expect(activated([entry('/(/', true)], sleepy)).resolves.toBe(0)
        await expect(activated([entry('/(/i', true)], sleepy)).resolves.toBe(0)
    })

    test('R: a regex-mode key that is not written as /pattern/ matches as a case-insensitive substring', async () => {
        expect(await activated([entry('dragon', true)], sleepy)).toBe(1)
    })

    test('G: a regex-mode key that is not written as /pattern/ and is absent does not activate', async () => {
        expect(await activated([entry('wyvern', true)], sleepy)).toBe(0)
    })

    test('G: a plain key still matches by substring, case-insensitively', async () => {
        expect(await activated([entry('dragon', false)], sleepy)).toBe(1)
    })
})
