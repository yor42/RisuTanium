// The six module paths of Studio S5 read through the strict record parser: set ops, labels and restore keys of a module
// record read back equal, the kind rule keeps them off a character and a chat record, a value of the wrong type refuses
// the record whole, and a foreign reading is accepted on these paths only and only with a value of another type.
import { describe, expect, test, vi } from 'vitest'
import type { RisuModule } from 'src/ts/process/modules'
import { buildFieldEdit, createModuleLiveReader } from '../../edit/studioSetters'
import { parseOwnerRecord, type OwnerRecord } from '../historyModel'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

const MODULE = moduleOwnerKey('m1')

type S5Path = 'moduleName' | 'moduleDescription' | 'moduleNamespace' | 'moduleHideIcon' | 'moduleLowLevelAccess' | 'backgroundEmbedding'
const S5_PATHS: readonly S5Path[] = ['moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding']

// The two boolean paths, written out here: the file never reads the registry, so on a base without these paths its tests
// fail on the record assertions instead of at collection.
const isBool = (path: string): boolean => path === 'moduleHideIcon' || path === 'moduleLowLevelAccess'

const typed = (path: string, text: string): string | boolean => (isBool(path) ? true : text)

function recordOf(ownerKey: StoredOwnerKey, parts: { label?: unknown; path?: string; before?: unknown; after?: unknown; restore?: unknown; ops?: unknown[] }): unknown {
    const path = parts.path ?? 'moduleName'
    const ops = parts.ops ?? [{ op: 'set', path, before: parts.before ?? { had: false }, after: parts.after ?? { had: true, value: typed(path, 'x') } }]
    return {
        ownerKey,
        touchedAt: 4,
        done: [{ id: 'p:1', at: 1, label: parts.label ?? { kind: 'field', field: path }, ops }],
        undone: [],
        deleted: [],
        restore: parts.restore ?? null,
    }
}

// What the store round trip gives: plain JSON, as the record is stored.
const asStored = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('T5-RB: a module record holding every new path reads back equal', () => {
    test.each(S5_PATHS)('%s: set op, label and restore key', (path) => {
        const restore = {
            visitId: 'v1',
            at: 2,
            fields: { [path]: { before: { had: false }, last: { had: true, value: typed(path, 'last') } } },
        }
        const raw = asStored(recordOf(MODULE, { path, restore, before: { had: true, value: typed(path, 'a') }, after: { had: true, value: typed(path, 'b') } }))
        const read = parseOwnerRecord(raw, MODULE)
        expect(read).not.toBeNull()
        expect(read).toEqual(raw)
    })
})

describe('T5-RB-OPS: the ops of T5-RB are the ones the edit builder makes', () => {
    test.each(S5_PATHS)('%s', (path) => {
        const module = { id: 'm1', name: 'A', description: 'D' } as RisuModule
        const built = buildFieldEdit(path, path === 'moduleName' ? 'B' : typed(path, 'v'), createModuleLiveReader(module))
        expect(built.ok).toBe(true)
        if (built.ok === false) {
            return
        }
        const raw = asStored(recordOf(MODULE, { path, ops: built.ops, label: built.label }))
        expect(parseOwnerRecord(raw, MODULE)?.done[0].ops).toEqual(built.ops)
    })
})

describe('T5-KIND-a/b: the kind rule keeps the new paths off a character and a chat record', () => {
    const kinds: [string, StoredOwnerKey][] = [
        ['character', characterOwnerKey('c1')],
        ['chat', chatOwnerKey('c1', 'chat1')],
    ]

    test.each(kinds)('a %s record with a set op or a restore key of a new path is refused whole', (_name, key) => {
        for (const path of S5_PATHS) {
            expect(parseOwnerRecord(recordOf(key, { path }), key), `set ${path}`).toBeNull()
            const restore = { visitId: 'v1', at: 2, fields: { [path]: { before: { had: false }, last: { had: false } } } }
            expect(parseOwnerRecord(recordOf(key, { ops: [], label: { kind: 'restorePoint' }, restore }), key), `restore ${path}`).toBeNull()
        }
    })

    test('a character record whose step label alone names a new path reads (labels are not kind-checked)', () => {
        const key = characterOwnerKey('c1')
        for (const path of S5_PATHS) {
            const read: OwnerRecord | null = parseOwnerRecord(recordOf(key, { ops: [], label: { kind: 'field', field: path } }), key)
            expect(read?.done[0].label, path).toEqual({ kind: 'field', field: path })
        }
    })
})

describe('T5-WR: a had:true value of the wrong type refuses the record whole', () => {
    test.each(S5_PATHS)('%s', (path) => {
        const wrong = isBool(path) ? 'x' : true
        const right = typed(path, 'x')
        expect(parseOwnerRecord(asStored(recordOf(MODULE, { path, after: { had: true, value: right } })), MODULE), 'right').not.toBeNull()
        expect(parseOwnerRecord(asStored(recordOf(MODULE, { path, after: { had: true, value: wrong } })), MODULE), 'wrong set').toBeNull()
        const restore = (value: unknown): unknown => ({ visitId: 'v1', at: 2, fields: { [path]: { before: { had: false }, last: { had: true, value } } } })
        expect(parseOwnerRecord(asStored(recordOf(MODULE, { path, restore: restore(right) })), MODULE), 'right restore').not.toBeNull()
        expect(parseOwnerRecord(asStored(recordOf(MODULE, { path, restore: restore(wrong) })), MODULE), 'wrong restore').toBeNull()
    })
})

describe('T5-FOREIGN-RB: a foreign reading is read on the new paths and refused elsewhere', () => {
    const BOOL_FOREIGN: unknown[] = [1, null, { x: 1 }, 'yes', [1, 'a']]
    const TEXT_FOREIGN: unknown[] = [5, null, { x: 1 }, true, [1]]
    const cases = S5_PATHS.flatMap((path) => (isBool(path) ? BOOL_FOREIGN : TEXT_FOREIGN).map((value) => [path, value] as const))

    test.each(cases)('%s holding %j reads back equal in before, after and a restore key', (path, value) => {
        const foreign = { had: 'foreign', value }
        const restore = { visitId: 'v1', at: 2, fields: { [path]: { before: foreign, last: { had: true, value: typed(path, 'x') } } } }
        const raw = asStored(recordOf(MODULE, { path, before: foreign, after: { had: true, value: typed(path, 'x') }, restore }))
        const read = parseOwnerRecord(raw, MODULE)
        expect(read).not.toBeNull()
        expect(read).toEqual(raw)
        const back = asStored(recordOf(MODULE, { path, before: { had: true, value: typed(path, 'x') }, after: foreign }))
        expect(parseOwnerRecord(back, MODULE)).toEqual(back)
    })

    test('a foreign reading on a path without keepForeign refuses the record whole', () => {
        const foreign = { had: 'foreign', value: 1 }
        expect(parseOwnerRecord(asStored(recordOf(MODULE, { path: 'customModuleToggle', before: foreign })), MODULE)).toBeNull()
        const character = characterOwnerKey('c1')
        expect(parseOwnerRecord(asStored(recordOf(character, { path: 'desc', before: foreign })), character)).toBeNull()
        expect(parseOwnerRecord(asStored(recordOf(character, { path: 'hideChatIcon', before: foreign })), character)).toBeNull()
    })

    test('a foreign string on a text path, a foreign boolean on a bool path and a foreign reading with no value refuse the record whole', () => {
        const refused = (path: S5Path, foreign: unknown): unknown => parseOwnerRecord(asStored(recordOf(MODULE, { path, before: foreign })), MODULE)
        expect(refused('moduleName', { had: 'foreign', value: 'text' })).toBeNull()
        expect(refused('backgroundEmbedding', { had: 'foreign', value: '' })).toBeNull()
        expect(refused('moduleHideIcon', { had: 'foreign', value: true })).toBeNull()
        expect(refused('moduleLowLevelAccess', { had: 'foreign', value: false })).toBeNull()
        expect(refused('moduleName', { had: 'foreign' })).toBeNull()
        expect(refused('moduleLowLevelAccess', { had: 'foreign' })).toBeNull()
        expect(refused('moduleName', { had: 'other', value: 5 })).toBeNull()
    })
})
