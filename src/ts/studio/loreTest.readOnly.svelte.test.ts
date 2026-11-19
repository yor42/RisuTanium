/**
 * The lorebook rule tester's read-only contract: a Run over a `$state`
 * database leaves it strictly deep-equal, marks nothing for save and writes no
 * flag or variable, whatever the entries do.
 *
 * Runs the REAL `runLoreTest` (`./loreTest`), lorebook scan, `chatVar`,
 * `chatOrigin` and `cbs` over a reactive `$state` database. The parser is a
 * stand-in that performs `{{setvar::..}}`, `{{addvar::..}}` and `{{getvar::..}}`
 * through the chat-variable functions with the subject it is given, so an
 * entry whose text writes variables really writes wherever the subject points;
 * the tokenizer counts characters. The module list is a plain resident module
 * plus a stub.
 *
 * `regression reproducer (M-..)` tests fail when the named sandbox rule is
 * removed. `diagnostic:` is the positive control: the same fixture through a
 * live subject DOES write the flags and mark the character, so the contract
 * test cannot pass for lack of a write path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, character, Database, loreBook } from '../storage/database.svelte'
import '../polyfill'

const h = vi.hoisted(() => ({
    modules: [] as unknown[],
}))

vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('../stores.svelte')
})
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => ({}),
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../lang', () => ({ language: {} }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../parser/parser.svelte', async () => {
    const vars = await import('../parser/chatVar.svelte')
    return {
        risuChatParser: (text: string, arg?: { subject?: import('../process/chatOrigin').RunSubject }) => {
            return text
                .replace(/\{\{setvar::([^:}]+)::([^}]*)\}\}/g, (_all, key: string, value: string) => {
                    vars.setChatVar(key, value, arg?.subject)
                    return ''
                })
                .replace(/\{\{addvar::([^:}]+)::([^}]*)\}\}/g, (_all, key: string, value: string) => {
                    vars.setChatVar(key, String(Number(vars.getChatVar(key, arg?.subject)) + Number(value)), arg?.subject)
                    return ''
                })
                .replace(/\{\{getvar::([^}]+)\}\}/g, (_all, key: string) => vars.getChatVar(key, arg?.subject))
        },
    }
})
vi.mock('../tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../process/modules', () => ({
    getModules: vi.fn(() => h.modules),
    getModuleLorebooks: vi.fn(() => {
        const lorebooks: unknown[] = []
        for (const module of h.modules as { lorebook?: unknown[], 'moduleStub'?: number }[]) {
            if (module['moduleStub'] !== 1) {
                lorebooks.push(...(module.lorebook ?? []))
            }
        }
        return lorebooks
    }),
}))
vi.mock('../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn(), markDbWrite: vi.fn() }))
vi.mock('../process/memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { runLoreTest } from './loreTest'
import { DBState } from '../stores.svelte'
import { loadLoreBookV3Prompt } from '../process/lorebook.svelte'
import { createRunSubject, originOf } from '../process/chatOrigin'
import { markCharacterForSave, markDbWrite } from '../storage/characterSaveMarks'

function lore(key: string, content: string, over: Record<string, unknown> = {}): loreBook {
    return {
        key,
        comment: key || 'entry',
        content,
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    } as loreBook
}

// Every entry kind that can reach a write path: the two flag decorators, a
// folder and a foldered entry, a child link, a regex key, a text that sets and
// adds variables, a chat entry and a module entry.
function seed(withScriptstate: boolean): void {
    const chat = {
        id: 'chat-1',
        name: 'Chat',
        note: '',
        localLore: [lore('knight', 'chat entry body', { comment: 'chat entry' })],
        message: [
            { role: 'user', data: 'alpha beta knight dragon', time: 0 },
            { role: 'char', data: 'a dragon answers', time: 0 },
        ],
        ...(withScriptstate ? { scriptstate: { $existing: 'yes' } } : {}),
    }
    const character = {
        type: 'character',
        chaId: 'cha-1',
        name: 'Char',
        chatPage: 0,
        globalLore: [
            lore('alpha', '@@keep_activate_after_match\nkeeps', { id: 'k1', comment: 'keep' }),
            lore('beta', '@@dont_activate_after_match\nspent', { id: 'k2', comment: 'once' }),
            lore('', 'folder', { mode: 'folder', key: 'folder:F1', comment: 'Folder' }),
            lore('dragon', 'foldered body', { comment: 'foldered', folder: 'folder:F1' }),
            lore('knight', 'orig body', { id: 'L1', comment: 'orig' }),
            lore('zzz', 'x', { id: 'L1', mode: 'child', comment: 'child' }),
            lore('/dra+gon/i', 'regex body', { useRegex: true, comment: 'regex' }),
            lore('dragon', '{{setvar::counter::1}}{{addvar::counter::2}}{{getvar::counter}}', { comment: 'vars' }),
        ],
        loreSettings: { scanDepth: 10, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: true },
        chats: [chat],
    }
    DBState.db = {
        characters: [character],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
        globalChatVariables: {},
        enabledModules: [],
        moduleIntergration: '',
        modules: [],
        personas: [],
    } as unknown as Database
    h.modules = [
        { id: 'm1', lorebook: [lore('dragon', 'module body', { comment: 'module entry' })] },
        { id: 'stub', 'moduleStub': 1 },
    ]
}

function snapshot(): unknown {
    return $state.snapshot(DBState.db)
}

beforeEach(() => {
    vi.mocked(markCharacterForSave).mockClear()
    vi.mocked(markDbWrite).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a Run leaves the database alone', () => {
    test.each([
        ['no scriptstate yet', false],
        ['an existing scriptstate', true],
    ])('regression reproducer (M-R1, M-R2, M-R3): with %s the $state database stays strictly deep-equal and nothing is marked', async (_name, withScriptstate) => {
        seed(withScriptstate)
        const before = snapshot()
        const outcome = await runLoreTest({ chaId: 'cha-1', text: 'a typed knight message' })
        expect(outcome.status).toBe('ok')
        if (outcome.status === 'ok') {
            // The entries really ran: the flag decorators fired inside the sandbox.
            expect(outcome.entries.filter((entry) => entry.activated).map((entry) => entry.label)).toStrictEqual(
                expect.arrayContaining(['keep', 'once', 'orig', 'regex', 'vars', 'chat entry', 'module entry']),
            )
        }
        expect(snapshot()).toStrictEqual(before)
        expect(markCharacterForSave).not.toHaveBeenCalled()
        expect(markDbWrite).not.toHaveBeenCalled()
    })

    test('regression reproducer (M-R1): two runs in a row leave it equal and the second sees no flag from the first', async () => {
        seed(false)
        const before = snapshot()
        const first = await runLoreTest({ chaId: 'cha-1', text: '' })
        const second = await runLoreTest({ chaId: 'cha-1', text: '' })
        expect(snapshot()).toStrictEqual(before)
        expect(second).toStrictEqual(first)
    })

    test('diagnostic: the same fixture through a live subject writes the flags and marks the character', async () => {
        seed(false)
        const before = snapshot()
        const live = DBState.db.characters[0] as character
        const chat = live.chats[0] as Chat
        const origin = originOf(live, chat)
        if (!origin) {
            throw new Error('fixture has no origin')
        }
        await loadLoreBookV3Prompt(createRunSubject(origin))
        expect(snapshot()).not.toStrictEqual(before)
        expect(chat.scriptstate).toMatchObject({ $__internal_ka_k1: 'true', $__internal_da_k2: 'true' })
        expect(markCharacterForSave).toHaveBeenCalledWith('cha-1')
    })
})
