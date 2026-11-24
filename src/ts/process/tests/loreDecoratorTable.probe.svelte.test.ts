// @vitest-environment happy-dom

/**
 * The decorator table against the real scan. Each case runs `loadLoreBookV3Prompt` with a probe whose `roll` is fixed and
 * reads which `@@probability` lines executed: a `@@@probability 0` fallback line records its value only when the line
 * before it returned false. These are compatibility guards: they pass whenever the table and the scan agree.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, character, Message } from '../../storage/database.svelte'
import type { RunSubject } from '../chatOrigin'
import type { LoreEntryRecord, LoreScanProbe } from '../lorebook.svelte'
import '../../polyfill'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
    },
}))

vi.mock('../../stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        selectedCharID: store(0),
    }
})
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'
import { selectedCharID } from '../../stores.svelte'
import { LORE_DECORATORS, decoratorResult } from '../loreDecoratorTable'
import { LORE_SCAN_DECORATORS } from '../loreScanDecorators'

function entry(content: string): Record<string, unknown> {
    return {
        key: '',
        comment: 'e',
        content,
        mode: 'normal',
        insertorder: 100,
        alwaysActive: true,
        secondkey: '',
        selective: false,
    }
}

function sandboxSubject(char: character, chat: Chat): RunSubject {
    const ctx = { owner: char, ownerIndex: 0, chat, chatIndex: 0, member: null, memberIndex: null }
    return {
        origin: { chaId: 'cha-1', chatId: 'chat-1' },
        resolve: () => ctx,
        status: () => 'ok',
        memberStatus: () => null,
        mark: () => {},
    }
}

// The scan calls `probe.entry` once per pass for an entry not yet activated, so a blocked entry can report again on a
// later pass. Only the first record per entry index describes the content as written.
async function probeScan(contents: string[]): Promise<Map<number, LoreEntryRecord>> {
    const chat = {
        id: 'chat-1',
        name: 'Chat',
        localLore: [],
        message: [{ role: 'char', data: 'hello', time: 0 }] as Message[],
    } as unknown as Chat
    const char = {
        name: 'Char',
        chaId: 'cha-1',
        chatPage: 0,
        globalLore: contents.map(entry),
        loreSettings: { scanDepth: 5, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: false },
        chats: [chat],
    } as unknown as character
    h.db.characters = [char]
    selectedCharID.set(0)
    const first = new Map<number, LoreEntryRecord>()
    const probe: LoreScanProbe = {
        roll: () => 0.5,
        begin: () => {},
        entry: (record) => { if (!first.has(record.index)) first.set(record.index, record) },
        final: () => {},
    }
    await loadLoreBookV3Prompt(sandboxSubject(char, chat), undefined, probe)
    return first
}

beforeEach(() => {
    h.db.loreBookDepth = 5
    h.db.loreBookToken = 100000
})

afterEach(() => {
    vi.restoreAllMocks()
})

function argsOf(example: string): string[] {
    return example === '' ? [] : example.split(',').map((s) => s.trim()).filter((s) => s !== '')
}

describe('decorator table against the scan', () => {
    test('T27 compatibility guard: a row returns false in the scan exactly when the table says so', async () => {
        const names = LORE_SCAN_DECORATORS
        const records = await probeScan(names.map((n) => `@@${n} ${LORE_DECORATORS[n].example}\n@@@probability 0\nbody`))
        names.forEach((name, i) => {
            const row = LORE_DECORATORS[name]
            const record = records.get(i)
            expect(record, name).toBeDefined()
            const ranFallback = record?.probability.includes(0) ?? false
            expect(ranFallback, name).toBe(row.returnsIgnored)
            expect(decoratorResult(name, argsOf(row.example)) === 'ignored', name).toBe(row.returnsIgnored)
        })
    })

    test('T27 compatibility guard: the probability row records its own value and a skipped fallback never forces', async () => {
        const records = await probeScan(['@@probability 50\n@@@activate\nbody'])
        expect(records.get(0)?.probability).toEqual([50])
        expect(records.get(0)?.forcedBy).toBeNull()
    })

    test('T27b compatibility guard: a refused argument returns false, and so does an unknown name', async () => {
        const cases: { content: string; name: string; args: string[] }[] = []
        for (const name of LORE_SCAN_DECORATORS) {
            const bad = LORE_DECORATORS[name].badExample
            if (bad !== null) cases.push({ content: `@@${name} ${bad}`, name, args: [bad] })
        }
        cases.push({ content: '@@scan_depth -1', name: 'scan_depth', args: ['-1'] })
        cases.push({ content: '@@probabilty 5', name: 'probabilty', args: ['5'] })
        const records = await probeScan(cases.map((c) => `${c.content}\n@@@probability 0\nbody`))
        cases.forEach((c, i) => {
            expect(records.get(i)?.probability.includes(0), c.content).toBe(true)
            expect(decoratorResult(c.name, c.args), c.content).toBe('ignored')
        })
    })

    test('T27c diagnostic: @@position without an argument throws out of the scan', async () => {
        await expect(probeScan(['@@position\nbody'])).rejects.toThrow(TypeError)
        expect(decoratorResult('position', [])).toBe('throws')
    })
})
