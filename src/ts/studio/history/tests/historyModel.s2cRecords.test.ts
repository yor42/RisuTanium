// @vitest-environment jsdom
// T2-RB and T2-BI-1 (S2c): the record of the bias list. A record from the real builder reads back equal through the real
// serializer; the parse guard accepts a valid list, with no range check, and refuses a record whole for a 3-tuple, a
// non-finite number, a `null` cell and a non-array, in a set op and in a restore field.
import { describe, expect, test, vi } from 'vitest'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { character } from 'src/ts/storage/database.svelte'
import { buildFieldEdit, createLiveReader } from '../../edit/studioSetters'
import type { RestorePoint, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import type { StoredOwnerRecord } from '../studioHistoryStore'
import { readBack } from './s1Records.test-helpers'
import { seedOwner, storedRecord } from './studioStoreDoubles'

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

const OWNER = characterOwnerKey('c1')

function record(list: unknown = [['tok', 5], ['other', -3]]): StoredOwnerRecord {
    const live = applyCharacterDefaults({ chaId: 'c1' } as unknown as character) as character
    const reader = createLiveReader({ character: live, chat: null })
    const built = buildFieldEdit('bias', [['tok', 5], ['other', -3]], reader, false)
    if (built.ok === false) {
        throw new Error('no edit for bias')
    }
    const done: Step[] = [{ id: 'p:1', at: 1, label: built.label, ops: built.ops }]
    const fields: RestorePoint['fields'] = { bias: { before: reader.field('bias'), last: { had: true, value: list as [string, number][] } } }
    return { ownerKey: OWNER, touchedAt: 9, done, undone: [], deleted: [], restore: { visitId: 'v1', at: 5, fields } }
}

function stored(written: StoredOwnerRecord): StoredOwnerRecord | null {
    const shared = new Map<string, string>()
    seedOwner(shared, written, 'w:1')
    return storedRecord(shared, OWNER)?.record ?? null
}

describe('T2-RB: the record of the bias path', () => {
    test('a record from the real builder reads back equal through the real serializer', () => {
        const written = record()
        const op = written.done[0].ops[0]
        expect(op).toMatchObject({ op: 'set', path: 'bias', before: { had: true, value: [] }, after: { had: true, value: [['tok', 5], ['other', -3]] } })
        expect(readBack(written)).toEqual(written)
    })
})

describe('T2-BI-1: the parse guard of a stored bias list', () => {
    test.each([
        ['a list in range', [['a', 1]]],
        ['an empty list', []],
        ['values outside -100..100 (no range check)', [['a', 250], ['b', -1000]]],
        ['a decimal', [['a', 0.25]]],
    ])('%s is accepted, in a set op and in a restore field', (_name, list) => {
        const written = record(list)
        ;(written.done[0].ops[0] as { after: unknown }).after = { had: true, value: list }
        expect(stored(written)).not.toBeNull()
    })

    test.each([
        ['a 3-tuple', [['a', 1, 2]]],
        ['a 1-tuple', [['a']]],
        ['a NaN value', [['a', Number.NaN]]],
        ['an Infinity value', [['a', Number.POSITIVE_INFINITY]]],
        ['a null cell', [['a', null]]],
        ['a numeric token', [[5, 1]]],
        ['a row that is not an array', ['a']],
        ['a non-array', 'x'],
        ['an object', { 0: ['a', 1] }],
    ])('%s refuses the record whole in a set op and in a restore field', (_name, bad) => {
        const inSet = record()
        ;(inSet.done[0].ops[0] as { after: unknown }).after = { had: true, value: bad }
        expect(stored(inSet), 'set op').toBeNull()
        const inRestore = record()
        ;(inRestore.restore!.fields.bias as { last: unknown }).last = { had: true, value: bad }
        expect(stored(inRestore), 'restore field').toBeNull()
    })
})
