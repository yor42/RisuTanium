// The list tables are the only source of every list-dependent rule: the data module is replaced by itself plus a
// `probe` list held by the character only, and the session kinds by themselves plus a `probeSession` kind that names
// it. Every parser, kind check and anchor body is the real one.
import { describe, expect, test, vi } from 'vitest'
import { holdsObjList, isOpAllowedFor, objItemAllowedFor, parseOwnerRecord, type Op, type OwnerKind } from '../historyModel'
import { entryAnchor, parseObjItem, parseObjLabel, parseObjOp } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'

vi.mock('../objectLists', async (importOriginal) => {
    const original = await importOriginal<typeof import('../objectLists')>()
    return {
        ...original,
        OBJ_LIST_HOLDERS: { ...original.OBJ_LIST_HOLDERS, probe: { character: 'probeList' } },
        OBJ_LIST_FIELDS: { ...original.OBJ_LIST_FIELDS, probe: { fields: { x: 'text' }, labelOnly: [], refused: [] } },
        OBJ_LIST_IDENTITY: { ...original.OBJ_LIST_IDENTITY, probe: { id: null, folder: null, content: true } },
        OBJ_LIST_ANCHOR_EXCLUDED: { ...original.OBJ_LIST_ANCHOR_EXCLUDED, probe: [] },
        OBJ_LIST_ASSET_PREFIX: { ...original.OBJ_LIST_ASSET_PREFIX, probe: 'probe/' },
        OBJ_LIST_MESSAGES: {
            ...original.OBJ_LIST_MESSAGES,
            probe: { line: 'probeLine', changed: 'probeChanged', earlierVisit: 'probeEarlier', idTaken: 'probeIdTaken', mixed: 'probeMixed' },
        },
    }
})
vi.mock('../sessionKinds', async (importOriginal) => {
    const original = await importOriginal<typeof import('../sessionKinds')>()
    return {
        ...original,
        SESSION_OWNER_KINDS: { ...original.SESSION_OWNER_KINDS, probeSession: { setPaths: ['customModuleToggle'], objLists: ['probe'] } },
    }
})

const KEYS: Record<'character' | 'chat' | 'module', StoredOwnerKey> = {
    character: characterOwnerKey('c1'),
    chat: chatOwnerKey('c1', 'k1'),
    module: moduleOwnerKey('m1'),
}
const ALL_KINDS = ['character', 'chat', 'module', 'probeSession'] as unknown as OwnerKind[]

const probeInsert = { op: 'objInsert', list: 'probe', index: 0, entry: { x: 'a' }, counts: { content: 1 } }
const loreInsert = { op: 'objInsert', list: 'lore', index: 0, entry: { comment: 'c', content: 'x' }, counts: { content: 1 } }
const probeLabel = { kind: 'obj', list: 'probe', action: 'edit', name: null, field: 'x' }
const loreLabel = { kind: 'obj', list: 'lore', action: 'edit', name: null, field: 'comment' }
const probeItem = { id: 'P', at: 1, list: 'probe', entries: [{ index: 0, entry: { x: 'a' }, counts: { content: 1 } }] }
const loreItem = { id: 'L', at: 1, list: 'lore', entries: [{ index: 0, entry: { comment: 'c' }, counts: { content: 1 } }] }

function record(kind: keyof typeof KEYS, label: unknown, ops: unknown[], deleted: unknown[] = []): unknown {
    return { ownerKey: KEYS[kind], touchedAt: 1, done: ops.length > 0 ? [{ id: 's1', at: 1, label, ops }] : [], undone: [], deleted, restore: null }
}

function read(kind: keyof typeof KEYS, value: unknown): unknown {
    return parseOwnerRecord(JSON.parse(JSON.stringify(value)), KEYS[kind])
}

describe('T55: kind acceptance follows the tables', () => {
    test('a probe op, label and item parse on a character record and each refuses a chat and a module record whole', () => {
        expect(read('character', record('character', probeLabel, [probeInsert]))).not.toBeNull()
        expect(read('character', record('character', probeLabel, [], [probeItem]))).not.toBeNull()
        for (const kind of ['chat', 'module'] as const) {
            expect(read(kind, record(kind, probeLabel, [loreInsert])), `${kind} label`).toBeNull()
            expect(read(kind, record(kind, loreLabel, [probeInsert])), `${kind} op`).toBeNull()
            expect(read(kind, record(kind, loreLabel, [], [probeItem])), `${kind} item`).toBeNull()
        }
    })

    test('lore ops, labels and items parse on all three stored kinds', () => {
        for (const kind of ['character', 'chat', 'module'] as const) {
            expect(read(kind, record(kind, loreLabel, [loreInsert], [loreItem])), kind).not.toBeNull()
        }
    })

    test('isOpAllowedFor agrees with the tables for every list and kind, and a session kind holds what its spec names', () => {
        const expected: Record<string, Record<string, boolean>> = {
            lore: { character: true, chat: true, module: true, probeSession: false },
            probe: { character: true, chat: false, module: false, probeSession: true },
        }
        for (const [list, op] of [['lore', loreInsert], ['probe', probeInsert]] as const) {
            for (const kind of ALL_KINDS) {
                expect(isOpAllowedFor(kind, op as unknown as Op), `${list} on ${kind}`).toBe(expected[list][kind])
                expect(holdsObjList(kind, list as 'lore'), `holds ${list} on ${kind}`).toBe(expected[list][kind])
            }
        }
        const item = parseObjItem(probeItem)
        expect(item).not.toBeNull()
        expect(objItemAllowedFor('probeSession' as unknown as OwnerKind, item as NonNullable<typeof item>)).toBe(true)
        expect(objItemAllowedFor('chat', item as NonNullable<typeof item>)).toBe(false)
    })

    test('propSet loreSettings is refused whole on a chat and a module record', () => {
        const propOp = { op: 'propSet', prop: 'loreSettings', before: { had: false }, after: { had: true, value: { a: 1 } } }
        const label = { kind: 'prop', prop: 'loreSettings' }
        expect(read('character', record('character', label, [propOp]))).not.toBeNull()
        expect(read('chat', record('chat', label, [propOp]))).toBeNull()
        expect(read('module', record('module', label, [propOp]))).toBeNull()
    })
})

describe('T56: the parser reads each list\'s own table', () => {
    const setOp = (list: string, field: string): unknown => ({
        op: 'objSet', list, index: 0, field, before: { had: true, value: 'a' }, after: { had: true, value: 'b' }, anchorBefore: 1, anchorAfter: 2,
    })

    test('an unknown list, an unknown lore field and an unknown label field are refused whole', () => {
        expect(parseObjOp({ ...loreInsert, list: 'regex' })).toBeNull()
        expect(parseObjOp(setOp('lore', 'flag'))).toBeNull()
        expect(parseObjLabel({ kind: 'obj', list: 'lore', action: 'edit', name: null, field: 'flag' })).toBeNull()
        expect(read('character', record('character', loreLabel, [{ ...loreInsert, list: 'regex' }]))).toBeNull()
    })

    test('a probe objSet parses on its own field and refuses a lore field', () => {
        expect(parseObjOp(setOp('probe', 'x'))).not.toBeNull()
        expect(parseObjOp(setOp('probe', 'comment'))).toBeNull()
        expect(parseObjOp(setOp('lore', 'comment'))).not.toBeNull()
        expect(parseObjOp(setOp('lore', 'x'))).toBeNull()
    })

    test('two probe rows that differ only in bookVersion have different anchors, while lore ignores it', () => {
        expect(entryAnchor('probe' as 'lore', { x: 'a', bookVersion: 1 })).not.toBe(entryAnchor('probe' as 'lore', { x: 'a', bookVersion: 2 }))
        expect(entryAnchor('lore', { comment: 'a', bookVersion: 1 })).toBe(entryAnchor('lore', { comment: 'a', bookVersion: 2 }))
    })
})
