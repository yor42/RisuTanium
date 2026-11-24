// @vitest-environment happy-dom

/**
 * The probability read and the Clear rule against the real scan. Each case runs `loadLoreBookV3Prompt` with a probe whose
 * `roll` is fixed and reads which `@@probability` lines executed and what the active entry looks like afterwards.
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
import { probabilityClearKeeps, readProbabilityLine, writeProbabilityLine } from '../../studio/longText/loreDecorators'

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

type Seen = { pos: string; depth: number; prompt: string }
type Scan = { records: Map<number, LoreEntryRecord>; actives: Seen[] }

// The scan calls `probe.entry` once per pass for an entry not yet activated, so a blocked entry can report again on a
// later pass. Only the first record per entry index describes the content as written.
async function probeScan(contents: string[], roll = 0.5): Promise<Scan> {
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
    const records = new Map<number, LoreEntryRecord>()
    const probe: LoreScanProbe = {
        roll: () => roll,
        begin: () => {},
        entry: (record) => { if (!records.has(record.index)) records.set(record.index, record) },
        final: () => {},
    }
    const result = await loadLoreBookV3Prompt(sandboxSubject(char, chat), undefined, probe)
    return { records, actives: result.actives.map((a) => ({ pos: a.pos, depth: a.depth, prompt: a.prompt })) }
}

beforeEach(() => {
    h.db.loreBookDepth = 5
    h.db.loreBookToken = 100000
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('probability read against a probe scan (T32)', () => {
    test('the read value is the value the scan records', async () => {
        const cases: { content: string; read: ReturnType<typeof readProbabilityLine>; probe: number[] }[] = [
            { content: 'body', read: { kind: 'none' }, probe: [] },
            { content: '@@probability 30\nbody', read: { kind: 'one', value: 30, line: 0 }, probe: [30] },
            { content: '@@probability 50%\nbody', read: { kind: 'one', value: 50, line: 0 }, probe: [50] },
            { content: '@@probability 150\nbody', read: { kind: 'one', value: 150, line: 0 }, probe: [150] },
            { content: '@@depth 1\n\n@@probability 30\nbody', read: { kind: 'none' }, probe: [] },
            { content: '\n\n@@probability 30\nbody', read: { kind: 'one', value: 30, line: 2 }, probe: [30] },
            { content: '@@probability 30\r\nbody', read: { kind: 'one', value: 30, line: 0 }, probe: [30] },
            { content: '@@depth 1\r\n\r\n@@probability 30\r\nbody', read: { kind: 'none' }, probe: [] },
        ]
        const scan = await probeScan(cases.map((c) => c.content), 0.1)
        cases.forEach((c, i) => {
            expect(readProbabilityLine(c.content), c.content).toEqual(c.read)
            expect(scan.records.get(i)?.probability, c.content).toEqual(c.probe)
        })
    })

    test('an unreadable value records NaN and never blocks', async () => {
        const contents = ['@@probability x\nbody', '@@probability\nbody']
        const scan = await probeScan(contents, 0.999)
        contents.forEach((content, i) => {
            expect(readProbabilityLine(content)).toMatchObject({ kind: 'unreadable' })
            expect(scan.records.get(i)?.probability.map((v) => Number.isNaN(v))).toEqual([true])
            expect(scan.records.get(i)?.activated, content).toBe(true)
        })
    })
})

describe('read-only layouts against a probe scan (T34)', () => {
    test('what the scan records for several, fallback and unreadable lines', async () => {
        const contents = [
            '@@probability 30\n@@probability 60\nbody',
            '@@depth 1\n@@@probability 30\nbody',
            '@@keep_activate_after_match\n@@@probability 30\nbody',
        ]
        const scan = await probeScan(contents, 0.1)
        expect(readProbabilityLine(contents[0])).toEqual({ kind: 'many', reason: 'several' })
        expect(scan.records.get(0)?.probability).toEqual([30, 60])
        expect(readProbabilityLine(contents[1])).toEqual({ kind: 'many', reason: 'fallback' })
        expect(scan.records.get(1)?.probability).toEqual([])
        expect(readProbabilityLine(contents[2])).toEqual({ kind: 'many', reason: 'fallback' })
        expect(scan.records.get(2)?.probability).toEqual([30])
    })
})

describe('Clear keeps what the scan sees (T47, T47e)', () => {
    test('T47: a fallback chain keeps @@@depth 0 skipped, where removal would run it', async () => {
        const content = '@@keep_activate_after_match\n@@probability 50\n@@@depth 0\nbody'
        const cleared = writeProbabilityLine(content, null)
        expect(probabilityClearKeeps(content)).toBe(true)
        const before = await probeScan([content], 0.1)
        const after = await probeScan([cleared], 0.1)
        expect(before.actives[0].pos).toBe('')
        expect(after.actives[0]).toEqual(before.actives[0])
        const removed = await probeScan(['@@keep_activate_after_match\n@@@depth 0\nbody'], 0.1)
        expect(removed.actives[0].pos).toBe('depth')
    })

    test('T47e (1): the decorator after a blank line stays outside the block', async () => {
        const content = '@@probability 30\n\n@@depth 5\nbody'
        const cleared = writeProbabilityLine(content, null)
        const before = await probeScan([content], 0.1)
        const after = await probeScan([cleared], 0.1)
        expect(before.actives[0]).toEqual({ pos: '', depth: 0, prompt: '@@depth 5\nbody' })
        expect(after.actives[0]).toEqual(before.actives[0])
        const removed = await probeScan(['\n@@depth 5\nbody'], 0.1)
        expect(removed.actives[0]).toEqual({ pos: 'depth', depth: 5, prompt: 'body' })
    })

    test('T47e (2): a position line after the blank line never reaches the scan', async () => {
        const content = '@@probability 30\n\n@@position\nbody'
        const cleared = writeProbabilityLine(content, null)
        expect((await probeScan([content], 0.1)).actives[0].pos).toBe('')
        expect((await probeScan([cleared], 0.1)).actives[0].pos).toBe('')
        await expect(probeScan(['\n@@position\nbody'], 0.1)).rejects.toThrow(TypeError)
    })

    test('T47e (3): CRLF with a whitespace-only line gives the same active before and after', async () => {
        const content = '\n@@probability 30\r\n  \r\n@@depth 5\r\nbody'
        const cleared = writeProbabilityLine(content, null)
        const before = await probeScan([content], 0.1)
        const after = await probeScan([cleared], 0.1)
        expect(after.actives[0]).toEqual(before.actives[0])
    })

    test('a removal that changes nothing gives the same active', async () => {
        const content = '@@depth 1\n@@probability 30\n\n@@depth 5\nbody'
        const before = await probeScan([content], 0.1)
        const after = await probeScan([writeProbabilityLine(content, null)], 0.1)
        expect(after.actives[0]).toEqual(before.actives[0])
    })
})
