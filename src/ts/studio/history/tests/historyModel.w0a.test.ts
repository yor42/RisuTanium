// The closed set-path table and rule K, read through the strict record parser. Every expectation below is a literal
// written out here, so a table that drifts from it (a path dropped from a parse row, a kind that accepts too much)
// fails; the parser and the exported rule are also compared with each other.
import { describe, expect, test } from 'vitest'
import {
    isOpAllowedFor,
    parseOwnerRecord,
    RESTORE_PATH_ORDER,
    RESTORE_PATHS_BY_KIND,
    SET_PATHS_BY_KIND,
    textPathsFor,
    type OwnerKind as AnyOwnerKind,
    type OwnerRecord,
    type Op,
    type RestorePath,
    type SetPath,
} from '../historyModel'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import type { SessionOwnerKind } from '../sessionKinds'
import { PRESET_FORM_PATHS, PRESET_S4B_PATHS, PRESET_S4C_PATHS, PRESET_S4D_PATHS } from './presetPaths.test-helpers'

// The stored kinds: a session kind has no stored key, record or restore row.
type OwnerKind = Exclude<AnyOwnerKind, SessionOwnerKind>

const KEYS: Record<OwnerKind, StoredOwnerKey> = {
    character: characterOwnerKey('c1'),
    chat: chatOwnerKey('c1', 'chat1'),
    module: moduleOwnerKey('m1'),
}

const S1_PATHS: readonly SetPath[] = ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator', 'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote']
const S2A_PATHS: readonly SetPath[] = ['creatorNotes', 'removedQuotes']
const S2B_PATHS: readonly SetPath[] = ['lowLevelAccess', 'utilityBot', 'escapeOutput']
const S2C_PATHS: readonly SetPath[] = ['bias']

const S5_PATHS: readonly SetPath[] = ['moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding']

const ALL_SET_PATHS: readonly SetPath[] = ['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note', ...S1_PATHS, ...S5_PATHS, ...S2A_PATHS, ...S2B_PATHS, ...S2C_PATHS]

const EXPECTED_SET: Record<OwnerKind, readonly SetPath[]> = {
    character: ['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', ...S1_PATHS, ...S2A_PATHS, ...S2B_PATHS, ...S2C_PATHS],
    chat: ['note'],
    module: ['customModuleToggle', ...S5_PATHS],
}

const EXPECTED_RESTORE: Record<OwnerKind, readonly RestorePath[]> = {
    character: ['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', ...S1_PATHS, ...S2A_PATHS, ...S2B_PATHS, ...S2C_PATHS, 'alternateGreetings'],
    chat: ['note'],
    module: ['customModuleToggle', ...S5_PATHS],
}

function fieldValue(path: RestorePath, value: string): unknown {
    if (path === 'alternateGreetings') {
        return { list: [value] }
    }
    if (path === 'bias') {
        return { had: true, value: [[value, 1]] }
    }
    return { had: true, value: path === 'hideChatIcon' || path === 'risutanium_render_when_complete' || path === 'moduleHideIcon' || path === 'moduleLowLevelAccess' || path === 'removedQuotes' || S2B_PATHS.includes(path as SetPath) ? true : value }
}

function rawRecord(kind: OwnerKind, parts: { done?: unknown[]; restore?: unknown }): unknown {
    return { ownerKey: KEYS[kind], touchedAt: 1, done: parts.done ?? [], undone: [], deleted: [], restore: parts.restore ?? null }
}

function rawStep(ops: unknown[], label: unknown = { kind: 'restorePoint' }): unknown {
    return { id: 'p:1', at: 1, label, ops }
}

function rawSet(path: SetPath): unknown {
    return { op: 'set', path, before: fieldValue(path, 'a'), after: fieldValue(path, 'b') }
}

function readable(kind: OwnerKind, parts: { done?: unknown[]; restore?: unknown }): OwnerRecord | null {
    return parseOwnerRecord(rawRecord(kind, parts), KEYS[kind])
}

describe('A2: the set-path table is the only list of what each owner kind accepts', () => {
    test('the table rows are the literal closed rows', () => {
        for (const kind of ['character', 'chat', 'module'] as const) {
            expect([...SET_PATHS_BY_KIND[kind]], kind).toEqual([...EXPECTED_SET[kind]])
            expect([...RESTORE_PATHS_BY_KIND[kind]], kind).toEqual([...EXPECTED_RESTORE[kind]])
        }
    })

    test.each(['character', 'chat', 'module'] as const)('a %s record reads a set op exactly for the paths of its row', (kind) => {
        for (const path of ALL_SET_PATHS) {
            const record = readable(kind, { done: [rawStep([rawSet(path)], { kind: 'field', field: path })] })
            expect(record !== null, `${kind} set ${path}`).toBe(EXPECTED_SET[kind].includes(path))
        }
    })

    test.each(['character', 'chat', 'module'] as const)('a %s record reads a restore key exactly for the keys of its row', (kind) => {
        for (const path of [...ALL_SET_PATHS, 'alternateGreetings'] as const) {
            const fields = { [path]: { before: fieldValue(path, 'a'), last: fieldValue(path, 'b') } }
            const record = readable(kind, { restore: { visitId: 'v1', at: 1, fields } })
            expect(record !== null, `${kind} restore ${path}`).toBe(EXPECTED_RESTORE[kind].includes(path))
        }
    })

    test('a field label reads exactly for the paths some owner kind accepts', () => {
        for (const path of ALL_SET_PATHS) {
            const kind: OwnerKind = EXPECTED_SET.character.includes(path) ? 'character' : 'chat'
            expect(readable(kind, { done: [rawStep([], { kind: 'field', field: path })] }), path).not.toBeNull()
        }
        expect(readable('character', { done: [rawStep([], { kind: 'field', field: 'zzNeverRegistered' })] })).toBeNull()
        expect(readable('character', { done: [rawStep([], { kind: 'field', field: 'depth_prompt.zzNeverRegistered' })] })).toBeNull()
    })
})

describe('A8 (model half): the restore order lists every restore key once, the toggle before hideChatIcon', () => {
    test('RESTORE_PATH_ORDER is the literal order', () => {
        expect([...RESTORE_PATH_ORDER]).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note', ...S1_PATHS, ...S5_PATHS, ...PRESET_FORM_PATHS, ...S2A_PATHS, ...S2B_PATHS, ...S2C_PATHS, ...PRESET_S4B_PATHS, ...PRESET_S4C_PATHS, ...PRESET_S4D_PATHS, 'alternateGreetings'])
    })

    test('every restore key of every owner kind has a place in the order', () => {
        for (const kind of ['character', 'chat', 'module'] as const) {
            for (const path of RESTORE_PATHS_BY_KIND[kind]) {
                expect(RESTORE_PATH_ORDER.filter((entry) => entry === path), `${kind} ${path}`).toHaveLength(1)
            }
        }
    })
})

describe('rule K: isOpAllowedFor is the acceptance the parser applies', () => {
    const ops: { name: string; op: Op }[] = [
        ...ALL_SET_PATHS.map((path) => ({
            name: `set ${path}`,
            op: { op: 'set', path, before: { had: false }, after: { had: false } } as Op,
        })),
        { name: 'listSet', op: { op: 'listSet', index: 0, before: 'a', after: 'b' } },
        { name: 'listInsert', op: { op: 'listInsert', index: 0, value: 'a' } },
        { name: 'listRemove', op: { op: 'listRemove', index: 0, value: 'a', deletedId: null } },
        { name: 'chatFm', op: { op: 'chatFm', chatId: 'c', before: { had: false }, after: { had: true, value: 1 } } },
        { name: 'assetRowRemove', op: { op: 'assetRowRemove', array: 'assets', index: 0, tuple: ['a'], count: 1 } },
        { name: 'assetRowInsert', op: { op: 'assetRowInsert', array: 'assets', index: 0, tuple: ['a'], count: 1 } },
        { name: 'assetRowSet', op: { op: 'assetRowSet', array: 'assets', index: 0, before: ['a'], after: ['b'] } },
        { name: 'assetFolderSet', op: { op: 'assetFolderSet', name: 'f', before: { had: false }, after: { had: false } } },
        { name: 'assetFolderOrder', op: { op: 'assetFolderOrder', before: ['a'], after: ['b'] } },
        { name: 'textEdit', op: { op: 'textEdit', target: 'desc', offset: 0, from: '', to: 'x' } },
    ]
    const LIST_NAMES = ['listSet', 'listInsert', 'listRemove', 'chatFm']

    test.each(['character', 'chat', 'module'] as const)('for a %s owner it agrees with what its record reads back', (kind) => {
        for (const { name, op } of ops) {
            const record = readable(kind, { done: [rawStep([JSON.parse(JSON.stringify(op))])] })
            expect(isOpAllowedFor(kind, op), `${kind} ${name}`).toBe(record !== null)
        }
    })

    test('a chat owner holds only set note; a module holds only asset ops, text edits and the set paths of its row; a character holds every op but module-only paths', () => {
        const allowed = (kind: OwnerKind): string[] => ops.filter(({ op }) => isOpAllowedFor(kind, op)).map(({ name }) => name)
        expect(allowed('chat')).toEqual(['set note'])
        expect(allowed('module')).toEqual(
            ops.map(({ name }) => name).filter((name) => (name.startsWith('set ') ? EXPECTED_SET.module.some((path) => name === `set ${path}`) : !LIST_NAMES.includes(name))),
        )
        expect(allowed('character')).toEqual(ops.map(({ name }) => name).filter((name) => name !== 'set note' && !S5_PATHS.some((path) => name === `set ${path}`)))
    })

    test('the text paths of a kind are its row without the boolean field', () => {
        expect([...textPathsFor('character')]).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', ...S1_PATHS, 'creatorNotes'])
        expect([...textPathsFor('chat')]).toEqual(['note'])
        expect([...textPathsFor('module')]).toEqual(['customModuleToggle', 'moduleName', 'moduleDescription', 'moduleNamespace', 'backgroundEmbedding'])
    })
})

describe('CD-1: records holding the new constructs on the merged base', () => {
    test('a character record with set customModuleToggle and its label and restore key is readable', () => {
        const done = [rawStep([rawSet('customModuleToggle')], { kind: 'field', field: 'customModuleToggle' })]
        const restore = { visitId: 'v1', at: 1, fields: { customModuleToggle: { before: fieldValue('customModuleToggle', 'a'), last: fieldValue('customModuleToggle', 'b') } } }
        const record = readable('character', { done, restore })
        expect(record?.done[0].ops).toEqual([rawSet('customModuleToggle')])
        expect(record?.restore?.fields.customModuleToggle).toBeDefined()
    })

    test('a character record keeps a toggle value that is absent on one side', () => {
        const op = { op: 'set', path: 'customModuleToggle', before: { had: false }, after: { had: true, value: 'x' } }
        expect(readable('character', { done: [rawStep([op])] })?.done[0].ops).toEqual([op])
    })

    test('a module record with a set on any path outside the module row, or a restore key of one, is refused whole', () => {
        for (const path of ALL_SET_PATHS.filter((entry) => !EXPECTED_SET.module.includes(entry))) {
            expect(readable('module', { done: [rawStep([rawSet(path)])] }), `set ${path}`).toBeNull()
            const fields = { [path]: { before: fieldValue(path, 'a'), last: fieldValue(path, 'b') } }
            expect(readable('module', { restore: { visitId: 'v1', at: 1, fields } }), `restore ${path}`).toBeNull()
        }
        const toggle = rawSet('customModuleToggle')
        expect(readable('module', { done: [rawStep([toggle], { kind: 'field', field: 'customModuleToggle' })] })?.done[0].ops).toEqual([toggle])
        const fields = { customModuleToggle: { before: fieldValue('customModuleToggle', 'a'), last: fieldValue('customModuleToggle', 'b') } }
        expect(readable('module', { restore: { visitId: 'v1', at: 1, fields } })?.restore?.fields.customModuleToggle).toBeDefined()
    })

    test('an unknown label kind is refused whole', () => {
        const unknown = { kind: 'greetingFuture' }
        expect(readable('character', { done: [rawStep([], unknown)] })).toBeNull()
    })
})

describe('WR1 (model half): whole-record refusal is structural', () => {
    test('an unknown label kind in the third of five steps refuses the record, never a record with fewer steps', () => {
        const steps = [1, 2, 3, 4, 5].map((n) => ({ id: `p:${n}`, at: n, label: { kind: n === 3 ? 'futureKind' : 'restorePoint' }, ops: [] }))
        expect(readable('character', { done: steps })).toBeNull()
    })

    test('an unknown op kind in the third of five steps refuses the record (MW1: a parser that skips the op reads four ops short)', () => {
        const steps = [1, 2, 3, 4, 5].map((n) => ({
            id: `p:${n}`,
            at: n,
            label: { kind: 'restorePoint' },
            ops: n === 3 ? [rawSet('desc'), { op: 'futureOp' }] : [rawSet('desc')],
        }))
        expect(readable('character', { done: steps })).toBeNull()
    })

    test('an unknown op kind alone in a step refuses the record', () => {
        expect(readable('character', { done: [rawStep([{ op: 'futureOp' }])] })).toBeNull()
    })
})
