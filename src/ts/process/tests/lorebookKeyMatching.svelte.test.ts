// @vitest-environment happy-dom

/**
 * Key matching and token budgeting of the REAL `loadLoreBookV3Prompt`
 * (`../lorebook.svelte`) over an in-memory character.
 *
 * - Case-sensitive flag (`extentions.risu_case_sensitive`, as the card import
 *   produces it): plain keys match case-sensitively when it is true; regex keys
 *   keep the flags written in the key.
 * - Regex mode: a key not written as `/pattern/flags` matches as an ordinary
 *   case-insensitive substring; regex keys stay regex.
 * - Budget: when an `@@inject_lore` injector survives the cut but its target
 *   was cut, the injector's tokens are given back to the other entries.
 *
 * The tokenizer is a stand-in that counts characters, so entry sizes are the
 * budget arithmetic.
 *
 * Tests titled `regression reproducer:` are `test.fails` until the matching or
 * budget rule changes (CHORE-09 items 9, 10 and 11, MC-710); flip them to
 * `test` with the fix. Tests titled `guard:` pin behaviour that must be
 * preserved and pass before and after.
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
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn(async (text: string) => text.length) }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'

type Entry = Record<string, unknown>

function entry(key: string, over: Entry = {}): Entry {
    return {
        key,
        comment: 'entry',
        content: 'LORE BODY',
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    }
}

function setScene(lore: Entry[], said: string[], tokenBudget = 100000) {
    h.db.characters = [{
        name: 'Char',
        chatPage: 0,
        globalLore: lore,
        loreSettings: { scanDepth: said.length, tokenBudget, fullWordMatching: false, recursiveScanning: false },
        chats: [{
            id: 'chat-1',
            localLore: [],
            message: said.map((data) => ({ role: 'user', data, time: 0 })),
        }],
    }]
}

async function activated(lore: Entry[], said: string, tokenBudget?: number) {
    setScene(lore, [said], tokenBudget)
    return (await loadLoreBookV3Prompt()).actives
}

const caseSensitive = (on: boolean) => ({ extentions: { risu_case_sensitive: on } })

beforeEach(() => {
    h.db.characters = []
})

describe('lorebook case-sensitive flag', () => {
    test('guard: without the flag a plain key matches regardless of case', async () => {
        expect(await activated([entry('Dragon', caseSensitive(false))], 'a DRAGON here')).toHaveLength(1)
    })

    test('guard: with the flag a plain key still matches text in the same case', async () => {
        expect(await activated([entry('Dragon', caseSensitive(true))], 'a Dragon here')).toHaveLength(1)
    })

    test('guard: a regex key keeps its own flags whatever the flag says', async () => {
        expect(await activated([entry('/dragon/i', { useRegex: true, ...caseSensitive(true) })], 'a DRAGON here')).toHaveLength(1)
        expect(await activated([entry('/Dragon/', { useRegex: true, ...caseSensitive(false) })], 'a DRAGON here')).toHaveLength(0)
    })

    // CHORE-09 item 9, MC-710: flip to `test` once the flag is honoured for plain keys.
    test.fails('regression reproducer: with the flag a plain key does not match text in another case', async () => {
        expect(await activated([entry('Dragon', caseSensitive(true))], 'a DRAGON here')).toHaveLength(0)
    })

    // CHORE-09 item 9, MC-710: flip to `test` once the flag is honoured for plain keys.
    test.fails('regression reproducer: with the flag a lower-case plain key does not match capitalised text', async () => {
        expect(await activated([entry('dragon', caseSensitive(true))], 'a Dragon here')).toHaveLength(0)
    })
})

describe('lorebook regex mode with a non-regex key', () => {
    const regexEntry = (key: string) => entry(key, { useRegex: true })

    test('guard: a key written as /pattern/ matches as a regex', async () => {
        expect(await activated([regexEntry('/dr.gon/')], 'a dragon here')).toHaveLength(1)
    })

    test('guard: a list of regex keys with no match does not activate', async () => {
        expect(await activated([regexEntry('/wyvern/,/wolf/')], 'a dragon here')).toHaveLength(0)
    })

    // CHORE-09 item 11, MC-710: flip to `test` once a bare key falls back to a substring.
    test.fails('regression reproducer: a bare key in a list with a regex key matches as a substring', async () => {
        expect(await activated([regexEntry('/dragon/,wolf')], 'a wolf here')).toHaveLength(1)
    })

    // CHORE-09 item 11, MC-710: flip to `test` once a bare key falls back to a substring.
    test.fails('regression reproducer: a bare key matches as a case-insensitive substring', async () => {
        expect(await activated([regexEntry('dragon')], 'a Dragon here')).toHaveLength(1)
    })

    // CHORE-09 item 11, MC-710: flip to `test` once a bare key falls back to a substring.
    test.fails('regression reproducer: a bare key before a regex key does not stop the regex key matching', async () => {
        expect(await activated([regexEntry('wolf,/dragon/')], 'a dragon here')).toHaveLength(1)
    })

    test('guard: a bare key is a substring, not a regex', async () => {
        expect(await activated([regexEntry('dr.gon')], 'a dragon here')).toHaveLength(0)
    })
})

describe('lorebook @@inject_lore budget', () => {
    const target = (size: number) => entry('dragon', { comment: 'TARGET', content: 'T'.repeat(size), insertorder: 50 })
    const injector = entry('dragon', { comment: 'INJ', content: '@@inject_lore TARGET\n' + 'I'.repeat(10), insertorder: 100 })
    const other = (size: number) => entry('dragon', { comment: 'OTHER', content: 'O'.repeat(size), insertorder: 10 })
    const sources = (actives: { source: string }[]) => actives.map((a) => a.source)

    test('guard: an injector and its target that both fit are merged into the target', async () => {
        const actives = await activated([target(10), injector], 'dragon', 100)
        expect(actives.map((a) => [a.source, a.prompt])).toEqual([['TARGET', 'T'.repeat(10) + ' ' + 'I'.repeat(10)]])
    })

    test('guard: an injector that is cut itself does not merge into its target', async () => {
        const actives = await activated([target(10), { ...injector, insertorder: 10 }], 'dragon', 15)
        expect(actives.map((a) => [a.source, a.prompt])).toEqual([['TARGET', 'T'.repeat(10)]])
    })

    // CHORE-09 item 10, MC-710: flip to `test` once the injector's tokens are refunded when its target is cut.
    test.fails('regression reproducer: the injector\'s tokens are given back when its target was cut', async () => {
        // The injector (10) fits in 25, the target (30) never does, and the other entry (20)
        // fits only when the injector's 10 are refunded.
        const actives = await activated([target(30), injector, other(20)], 'dragon', 25)
        expect(sources(actives)).toEqual(['OTHER'])
    })
})
