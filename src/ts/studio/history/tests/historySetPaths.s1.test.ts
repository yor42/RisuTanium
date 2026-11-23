// @vitest-environment jsdom
// The S1 set paths through the strict record reader. T1-RB: a record holding every new path reads back equal, each
// op equal to the real builder's output. T1-WR: a value of the wrong type refuses the record whole. T1-KIND: a chat or
// module record naming a new path in a set op or a restore key is refused whole, while a label alone reads.
import { describe, expect, test, vi } from 'vitest'
import { buildFieldEdit, createLiveReader } from '../../edit/studioSetters'
import { parseOwnerRecord, type SetPath, type Step } from '../historyModel'
import { chatOwnerKey, moduleOwnerKey } from '../ownerPhase'
import type { StoredOwnerRecord } from '../studioHistoryStore'
import { readBack, S1_OWNER, S1_PATHS, s1Character, s1Record, s1Restore, s1Value } from './s1Records.test-helpers'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [], modules: [] } },
    selIdState: { selId: 0 },
    clearCharEmotionCache: () => {},
}))

describe('T1-RB: a record holding the new paths', () => {
    test('reads back equal, with one set step per path, its label and a restore point keyed by all of them', () => {
        const record = s1Record()
        expect(record.done).toHaveLength(S1_PATHS.length)
        expect(Object.keys(record.restore?.fields ?? {})).toEqual([...S1_PATHS])
        expect(readBack(record)).toEqual(record)
    })

    test.each(S1_PATHS)('%s: the fixture op equals the builder output', (path) => {
        const built = buildFieldEdit(path, s1Value(path), createLiveReader({ character: s1Character(), chat: null }))
        expect(built.ok && built.ops).toEqual(s1Record().done[S1_PATHS.indexOf(path)].ops)
    })
})

describe('T1-WR: a value of the wrong type refuses the record whole', () => {
    function raw(path: SetPath, value: unknown, where: 'set' | 'restore'): unknown {
        const step = { id: 'p:1', at: 1, label: { kind: 'field', field: path }, ops: [{ op: 'set', path, before: { had: false }, after: { had: true, value: where === 'set' ? value : 'x' } }] }
        const restore = { visitId: 'v1', at: 2, fields: { [path]: { before: { had: false }, last: { had: true, value: where === 'restore' ? value : 'x' } } } }
        return { ownerKey: S1_OWNER, touchedAt: 4, done: [step], undone: [], deleted: [], restore }
    }

    test.each(S1_PATHS)('%s', (path) => {
        expect(parseOwnerRecord(raw(path, 'v', 'set'), S1_OWNER), 'text set').not.toBeNull()
        expect(parseOwnerRecord(raw(path, true, 'set'), S1_OWNER), 'boolean set').toBeNull()
        expect(parseOwnerRecord(raw(path, true, 'restore'), S1_OWNER), 'boolean restore').toBeNull()
    })
})

describe('T1-KIND: the new paths belong to the character owner only', () => {
    const owners = [chatOwnerKey('c1', 'chat1'), moduleOwnerKey('m1')]

    test.each(owners)('%s: a set op or a restore key naming any new path is refused whole', (owner) => {
        for (const path of S1_PATHS) {
            const step: Step = { id: 'p:1', at: 1, label: { kind: 'restorePoint' }, ops: [{ op: 'set', path, before: { had: false }, after: { had: true, value: 'x' } }] }
            const withSet: StoredOwnerRecord = { ownerKey: owner, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }
            expect(readBack(withSet), `set ${path}`).toBeNull()
            const withRestore: StoredOwnerRecord = { ownerKey: owner, touchedAt: 1, done: [], undone: [], deleted: [], restore: { visitId: 'v1', at: 2, fields: { [path]: s1Restore().fields[path] } } }
            expect(readBack(withRestore), `restore ${path}`).toBeNull()
        }
    })

    test('a chat record whose step only carries a new path label is readable', () => {
        const chat = chatOwnerKey('c1', 'chat1')
        const step: Step = { id: 'p:1', at: 1, label: { kind: 'field', field: 'depth_prompt.prompt' }, ops: [{ op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'n' } }] }
        expect(readBack({ ownerKey: chat, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null })).not.toBeNull()
    })
})
