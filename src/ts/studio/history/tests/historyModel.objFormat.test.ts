// The stored format of the object-list ops (S7-0): every new shape round-trips through the strict reader, every
// pre-S7 shape still reads, and what the reader does not know is refused whole. Rows come from the classic
// producers' golden (`loreClassic.golden.json`). The record literals are what the parser reads; the writer-made records
// are pinned by `s7Records.fixtures.test.ts`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
    isObjItem,
    isOpAllowedFor,
    parseOwnerRecord,
    planRestoreDeleted,
    type LiveReader,
    type OwnerKind,
    type OwnerRecord,
} from '../historyModel'
import { LORE_FIELDS } from '../objectLists'
import { parseObjItem, parseObjLabel, parseObjOp, type ObjEntry } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import baseFixture from './fixtures/historyV2.b0.json'

interface Golden {
    blank: { globalLore: ObjEntry[] }
    folderWithId: { globalLore: ObjEntry[] }
}
const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))
const [ADDED, FOLDER] = golden.blank.globalLore
const [FOLDER_WITH_ID, ENTRY_WITH_ID] = golden.folderWithId.globalLore

const KEYS: Record<'character' | 'chat' | 'module', StoredOwnerKey> = {
    character: characterOwnerKey('c1'),
    chat: chatOwnerKey('c1', 'k1'),
    module: moduleOwnerKey('m1'),
}

const insertOp = { op: 'objInsert', list: 'lore', index: 1, entry: ADDED, counts: { content: 1 }, deletedId: 'D' }
const removeOp = { op: 'objRemove', list: 'lore', index: 0, entry: FOLDER_WITH_ID, counts: { id: 1, folderKey: 2 } }
const setOp = {
    op: 'objSet',
    list: 'lore',
    index: 2,
    field: 'activationPercent',
    before: { had: false },
    after: { had: true, value: null },
    anchorBefore: 123,
    anchorAfter: 456,
}
const propOp = { op: 'propSet', prop: 'loreSettings', before: { had: false }, after: { had: true, value: { tokenBudget: 1 } } }
const item = { id: 'D', at: 5, list: 'lore', entries: [{ index: 0, entry: FOLDER, counts: { folderKey: 1 } }, { index: 3, entry: ENTRY_WITH_ID, counts: { id: 1 } }] }

function step(id: string, label: unknown, ops: unknown[]): unknown {
    return { id, at: 1, label, ops }
}

function recordOf(kind: keyof typeof KEYS, steps: unknown[], deleted: unknown[] = []): unknown {
    return { ownerKey: KEYS[kind], touchedAt: 4, done: steps, undone: [], deleted, restore: null }
}

const OBJ_LABEL = { kind: 'obj', list: 'lore', action: 'edit', name: 'Entry', field: 'activationPercent' }

function parse(kind: keyof typeof KEYS, record: unknown): OwnerRecord | null {
    return parseOwnerRecord(JSON.parse(JSON.stringify(record)), KEYS[kind])
}

describe('T8: every new shape round-trips', () => {
    test('a character record with every op, both labels and an obj item reads back deep-equal', () => {
        const record = recordOf(
            'character',
            [
                step('s1', OBJ_LABEL, [insertOp, removeOp, setOp]),
                step('s2', { kind: 'prop', prop: 'loreSettings' }, [propOp]),
                step('s3', { kind: 'obj', list: 'lore', action: 'delete', name: null, count: 2 }, [removeOp]),
            ],
            [item],
        )
        expect(parse('character', record)).toEqual(record)
    })

    test('chat and module records hold the lore ops and items', () => {
        for (const kind of ['chat', 'module'] as const) {
            const record = recordOf(kind, [step('s1', OBJ_LABEL, [insertOp, removeOp, setOp])], [item])
            expect(parse(kind, record), kind).toEqual(record)
        }
    })

    test('a lorePlus set step reads on a character and is refused on a chat and a module', () => {
        const lorePlus = step('s1', { kind: 'field', field: 'lorePlus' }, [{ op: 'set', path: 'lorePlus', before: { had: false }, after: { had: true, value: true } }])
        expect(parse('character', recordOf('character', [lorePlus]))).not.toBeNull()
        expect(parse('chat', recordOf('chat', [lorePlus]))).toBeNull()
        expect(parse('module', recordOf('module', [lorePlus]))).toBeNull()
    })
})

describe('T5: the v2 base vocabulary still reads, and the new shapes are not read as old ones', () => {
    test('the version 2 base record reads back deep-equal', () => {
        const stored = baseFixture as unknown as { record: unknown }
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(stored.record)), KEYS.character)).toEqual(stored.record)
    })

    test('an obj op under an old op name, and old ops with obj keys, are refused', () => {
        for (const oldName of ['set', 'listSet', 'listInsert', 'listRemove', 'chatFm', 'textEdit', 'assetRowInsert']) {
            const relabelled = { ...insertOp, op: oldName }
            expect(parse('character', recordOf('character', [step('s1', OBJ_LABEL, [relabelled])])), oldName).toBeNull()
        }
        expect(parse('character', recordOf('character', [step('s1', OBJ_LABEL, [{ op: 'objInsert', index: 0, value: 'x', deletedId: null }])]))).toBeNull()
    })

    test('the obj item has no value, index or sideChat key, and a greeting item with entries is not an obj item', () => {
        expect(parse('character', recordOf('character', [], [{ ...item, value: 'g' }]))).toBeNull()
        expect(parse('character', recordOf('character', [], [{ ...item, index: 0 }]))).toBeNull()
        expect(parse('character', recordOf('character', [], [{ ...item, sideChat: null }]))).toBeNull()
        const greeting = { id: 'G', at: 5, index: 1, value: 'hello', sideChat: null }
        expect(parse('character', recordOf('character', [], [greeting]))).toEqual(recordOf('character', [], [greeting]))
        expect(parse('character', recordOf('character', [], [{ ...greeting, entries: item.entries }]))).toBeNull()
    })

    test('a greeting item stays character-only, an obj item is held by every owner of its list', () => {
        const greeting = { id: 'G', at: 5, index: 1, value: 'hello', sideChat: null }
        expect(parse('chat', recordOf('chat', [], [greeting]))).toBeNull()
        expect(parse('module', recordOf('module', [], [greeting]))).toBeNull()
        expect(parse('chat', recordOf('chat', [], [item]))).not.toBeNull()
    })

    test('the obj and prop labels are not read as another label', () => {
        for (const label of [{ kind: 'obj' }, { kind: 'prop' }, { kind: 'obj', list: 'lore' }]) {
            expect(parse('character', recordOf('character', [step('s1', label, [])])), JSON.stringify(label)).toBeNull()
        }
    })
})

describe('what the reader does not know is refused whole', () => {
    const refusedOps: [string, unknown][] = [
        ['an unknown list', { ...insertOp, list: 'regex' }],
        ['an unknown list on a set', { ...setOp, list: 'regex' }],
        ['a field outside the table', { ...setOp, field: 'flag' }],
        ['a set of id', { ...setOp, field: 'id', before: { had: false }, after: { had: true, value: 'x' } }],
        ['a set of mode', { ...setOp, field: 'mode', before: { had: true, value: 'normal' }, after: { had: true, value: 'folder' } }],
        ['a set of bookVersion', { ...setOp, field: 'bookVersion', before: { had: false }, after: { had: true, value: 2 } }],
        ['a set of the label-only probability', { ...setOp, field: 'probability', before: { had: false }, after: { had: true, value: 5 } }],
        ['a set side of the wrong kind', { ...setOp, field: 'insertorder', before: { had: true, value: '100' }, after: { had: true, value: 101 } }],
        ['a set after of the wrong kind', { ...setOp, field: 'content', before: { had: false }, after: { had: true, value: null } }],
        ['an extra key on an op', { ...insertOp, extra: 1 }],
        ['a non-integer index', { ...insertOp, index: 1.5 }],
        ['a negative index', { ...removeOp, index: -1 }],
        ['an unsafe anchor', { ...setOp, anchorBefore: -1 }],
        ['a non-integer anchor', { ...setOp, anchorAfter: 1.5 }],
        ['an entry that is not an object', { ...insertOp, entry: 'x' }],
        ['a non-string deletedId', { ...insertOp, deletedId: null }],
        ['a missing counts', { op: 'objInsert', list: 'lore', index: 0, entry: ADDED }],
        ['an unknown prop', { ...propOp, prop: 'regexSettings' }],
        ['a prop side that is not an object', { ...propOp, after: { had: true, value: 5 } }],
        ['a had value beside had false', { ...setOp, before: { had: false, value: 1 } }],
        ['an absent-to-absent set of id', { ...setOp, field: 'id', before: { had: false }, after: { had: false } }],
        ['an absent-to-absent set of an unknown field', { ...setOp, field: 'flag', before: { had: false }, after: { had: false } }],
    ]
    test.each(refusedOps)('%s', (_name, op) => {
        expect(parseObjOp(op)).toBeNull()
        expect(parse('character', recordOf('character', [step('s1', OBJ_LABEL, [op])]))).toBeNull()
    })

    const refusedLabels: [string, unknown][] = [
        ['an unknown action', { ...OBJ_LABEL, action: 'explode' }],
        ['an unknown list', { ...OBJ_LABEL, list: 'regex' }],
        ['an unknown label field', { ...OBJ_LABEL, field: 'flag' }],
        ['an extra key', { ...OBJ_LABEL, extra: 1 }],
        ['a missing name', { kind: 'obj', list: 'lore', action: 'edit' }],
        ['a non-count count', { ...OBJ_LABEL, count: -1 }],
        ['an unknown prop', { kind: 'prop', prop: 'regexSettings' }],
        ['a prop label with an extra key', { kind: 'prop', prop: 'loreSettings', list: 'lore' }],
    ]
    test.each(refusedLabels)('a label with %s', (_name, label) => {
        expect(parse('character', recordOf('character', [step('s1', label, [])]))).toBeNull()
    })

    test('a label field may be a settable field or the label-only probability', () => {
        expect(parseObjLabel({ ...OBJ_LABEL, field: 'probability' })).toEqual({ ...OBJ_LABEL, field: 'probability' })
        expect(parseObjLabel({ kind: 'obj', list: 'lore', action: 'add', name: null })).toEqual({ kind: 'obj', list: 'lore', action: 'add', name: null })
    })

    test('the prop ops and labels belong to the character only (T23, prop half)', () => {
        const propStep = step('s1', { kind: 'prop', prop: 'loreSettings' }, [propOp])
        expect(parse('character', recordOf('character', [propStep]))).not.toBeNull()
        expect(parse('chat', recordOf('chat', [propStep]))).toBeNull()
        expect(parse('module', recordOf('module', [propStep]))).toBeNull()
        expect(parse('chat', recordOf('chat', [step('s1', { kind: 'prop', prop: 'loreSettings' }, [])]))).toBeNull()
        for (const kind of ['chat', 'module'] as const) {
            expect(isOpAllowedFor(kind, parseObjOp(propOp) as never)).toBe(false)
            expect(isOpAllowedFor(kind, parseObjOp(insertOp) as never)).toBe(true)
        }
        expect(isOpAllowedFor('character', parseObjOp(propOp) as never)).toBe(true)
    })

    test('an item with no entries, a repeated or descending index, or a bad count is refused', () => {
        const entry = (index: number) => ({ index, entry: ADDED, counts: { content: 1 } })
        for (const entries of [[], [entry(2), entry(2)], [entry(3), entry(1)], [{ ...entry(0), counts: { content: 0 } }]]) {
            expect(parseObjItem({ ...item, entries }), JSON.stringify(entries)).toBeNull()
        }
        expect(parseObjItem({ ...item, entries: [entry(0), entry(5)] })).not.toBeNull()
        expect(parseObjItem({ ...item, list: 'regex' })).toBeNull()
        expect(parseObjItem({ ...item, at: 'now' })).toBeNull()
    })
})

describe('T52: counts hold exactly the entry identity kinds', () => {
    test('a missing, extra, zero or fractional count is refused', () => {
        const withCounts = (entry: ObjEntry, counts: unknown) => ({ ...insertOp, entry, counts })
        expect(parseObjOp(withCounts(ADDED, { content: 1 }))).not.toBeNull()
        expect(parseObjOp(withCounts(ADDED, {}))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { content: 1, id: 1 }))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { id: 1 }))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { content: 0 }))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { content: 1.5 }))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { content: '1' }))).toBeNull()
        expect(parseObjOp(withCounts(ADDED, { other: 1 }))).toBeNull()
        expect(parseObjOp(withCounts(FOLDER_WITH_ID, { id: 1 }))).toBeNull()
        expect(parseObjOp(withCounts(FOLDER_WITH_ID, { id: 2, folderKey: 1 }))).not.toBeNull()
        expect(parseObjOp(withCounts(FOLDER, { folderKey: 3 }))).not.toBeNull()
    })

    test('an entry with an empty id holds the content identity, not an id', () => {
        const emptyId = { ...ADDED, id: '' }
        expect(parseObjOp({ ...insertOp, entry: emptyId, counts: { content: 1 } })).not.toBeNull()
        expect(parseObjOp({ ...insertOp, entry: emptyId, counts: { id: 1 } })).toBeNull()
    })

    test('LORE_FIELDS is the frozen settable table, without id, mode or bookVersion', () => {
        expect(LORE_FIELDS).toEqual({
            comment: 'text',
            key: 'text',
            secondkey: 'text',
            content: 'text',
            insertorder: 'number',
            alwaysActive: 'bool',
            selective: 'bool',
            useRegex: 'bool',
            extentions: 'object',
            activationPercent: 'numberOrNull',
            folder: 'text',
        })
        for (const field of ['id', 'mode', 'bookVersion']) {
            expect(Object.hasOwn(LORE_FIELDS, field), field).toBe(false)
        }
    })
})

describe('T-0a: an obj item in a parsed record is restored through the obj planner', () => {
    const live: LiveReader = { field: () => ({ had: false }), greetings: () => ['g'], fmIndex: () => null }

    test('planRestoreDeleted refuses an obj item whose list the reader cannot serve, and writes nothing', () => {
        const record = parse('character', recordOf('character', [], [item]))
        expect(record).not.toBeNull()
        const parsed = record as OwnerRecord
        expect(isObjItem(parsed.deleted[0])).toBe(true)
        expect(planRestoreDeleted(parsed, 'D', live, null)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
    })

    test('a greeting item still restores', () => {
        const greeting = { id: 'G', at: 5, index: 0, value: 'hello', sideChat: null }
        const parsed = parse('character', recordOf('character', [], [greeting])) as OwnerRecord
        const plan = planRestoreDeleted(parsed, 'G', live, null)
        expect(plan.ok).toBe(true)
    })
})

describe('kind acceptance derives from the tables', () => {
    test('every stored kind holds lore ops, and only the character holds propSet', () => {
        const kinds: OwnerKind[] = ['character', 'chat', 'module']
        for (const kind of kinds) {
            expect(isOpAllowedFor(kind, parseObjOp(setOp) as never), kind).toBe(true)
            expect(isOpAllowedFor(kind, parseObjOp(propOp) as never), kind).toBe(kind === 'character')
        }
    })
})
