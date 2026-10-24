// @vitest-environment happy-dom

/**
 * Scan depth of the REAL `loadLoreBookV3Prompt` (`../lorebook.svelte`) over an
 * in-memory character.
 *
 * - A depth larger than the number of messages scans every message; depth 0
 *   scans none; otherwise exactly the last `depth` messages are scanned.
 * - A `@@scan_depth` value that is not a number or is negative is ignored: the
 *   configured depth applies and a following `@@@scan_depth` fallback line is
 *   used; a valid value overrides the configured depth.
 *
 * Tests titled `regression reproducer:` fail on the rule they name (CHORE-178,
 * MC-540). Tests titled `guard:` pin behaviour that must be preserved and pass
 * before and after.
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

function setScene(lore: Entry[], said: string[], tokenBudget = 100000, settings: Entry = {}) {
    h.db.characters = [{
        name: 'Char',
        chatPage: 0,
        globalLore: lore,
        loreSettings: { scanDepth: said.length, tokenBudget, fullWordMatching: false, recursiveScanning: false, ...settings },
        chats: [{
            id: 'chat-1',
            localLore: [],
            message: said.map((data) => ({ role: 'user', data, time: 0 })),
        }],
    }]
}

// `count` messages, oldest first, with the keyword only in the message at `keywordAt`.
function chatWithKeywordAt(count: number, keywordAt: number): string[] {
    return Array.from({ length: count }, (_, i) => (i === keywordAt ? 'a dragon here' : `filler ${i}`))
}

async function isActivated(lore: Entry[], said: string[], depth: number): Promise<boolean> {
    setScene(lore, said, 100000, { scanDepth: depth })
    return (await loadLoreBookV3Prompt()).actives.length === 1
}

const dragon = () => entry('dragon')
const withDecorators = (lines: string) => entry('dragon', { content: `${lines}\nLORE BODY` })

beforeEach(() => {
    h.db.characters = []
})

describe('lorebook configured scan depth window', () => {
    test.each([3, 4])('regression reproducer: depth 5 over %i messages scans the oldest message', async (count) => {
        expect(await isActivated([dragon()], chatWithKeywordAt(count, 0), 5)).toBe(true)
    })

    test.each([1, 2])('guard: depth 5 over %i messages scans every message', async (count) => {
        expect(await isActivated([dragon()], chatWithKeywordAt(count, 0), 5)).toBe(true)
    })

    test('guard: depth 0 activates nothing by keyword', async () => {
        expect(await isActivated([dragon()], chatWithKeywordAt(3, 2), 0)).toBe(false)
    })

    test('guard: depth equal to the message count scans every message', async () => {
        expect(await isActivated([dragon()], chatWithKeywordAt(4, 0), 4)).toBe(true)
    })

    test('guard: depth below the message count scans exactly the last depth messages', async () => {
        expect(await isActivated([dragon()], chatWithKeywordAt(5, 2), 3)).toBe(true)
        expect(await isActivated([dragon()], chatWithKeywordAt(5, 1), 3)).toBe(false)
    })
})

describe('lorebook @@scan_depth decorator', () => {
    test('guard: a valid value overrides the configured depth', async () => {
        const lore = [withDecorators('@@scan_depth 2')]
        expect(await isActivated(lore, chatWithKeywordAt(5, 3), 1)).toBe(true)
        expect(await isActivated(lore, chatWithKeywordAt(5, 2), 5)).toBe(false)
    })

    test('regression reproducer: a non-number value keeps the configured depth', async () => {
        const lore = [withDecorators('@@scan_depth abc')]
        expect(await isActivated(lore, chatWithKeywordAt(4, 0), 1)).toBe(false)
        expect(await isActivated(lore, chatWithKeywordAt(4, 3), 1)).toBe(true)
    })

    test('regression reproducer: a negative value keeps the configured depth', async () => {
        const lore = [withDecorators('@@scan_depth -1')]
        expect(await isActivated(lore, chatWithKeywordAt(5, 0), 5)).toBe(true)
    })

    test('guard: a negative value does not widen a smaller configured depth', async () => {
        const lore = [withDecorators('@@scan_depth -1')]
        expect(await isActivated(lore, chatWithKeywordAt(5, 0), 2)).toBe(false)
    })

    test('regression reproducer: an empty value keeps the configured depth', async () => {
        const lore = [withDecorators('@@scan_depth ')]
        expect(await isActivated(lore, chatWithKeywordAt(4, 0), 1)).toBe(false)
    })

    test('regression reproducer: a rejected value lets the fallback decorator line apply', async () => {
        const lore = [withDecorators('@@scan_depth abc\n@@@scan_depth 3')]
        expect(await isActivated(lore, chatWithKeywordAt(5, 2), 1)).toBe(true)
        expect(await isActivated(lore, chatWithKeywordAt(5, 1), 1)).toBe(false)
    })
})
