// @vitest-environment jsdom
// The group owner's resolver, live reader, `check` and writer over a plain database: the arrays are read as one list or
// not at all, a batch is verified whole before the first assignment, and a refused batch writes and marks nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { WriteOp } from 'src/ts/studio/history/historyModel'
import {
    GROUP_ID,
    archivedStub,
    arraysOf,
    corrupt,
    liveGroup,
    loadedCharacter,
    makeGroup,
    member,
    putWorld,
    sixths,
} from 'src/ts/studio/history/tests/group.test-helpers'
import { groupAdapter } from '../groupTarget'
import { SESSION_OWNER_ADAPTERS, sessionAdapterOf } from '../sessionAdapters'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
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

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

const insertAt = (index: number, entry: Record<string, unknown>): WriteOp => ({ op: 'objInsert', list: 'members', index, entry: entry as never })
const removeAt = (index: number): WriteOp => ({ op: 'objRemove', list: 'members', index })
const setField = (index: number, field: string, value: number | boolean | null): WriteOp => ({
    op: 'objSet',
    list: 'members',
    index,
    field,
    value: value === null ? { had: false } : { had: true, value },
})
const nameSet = (value: string): WriteOp => ({ op: 'set', path: 'name', value: { had: true, value } })

function readerOf(id: string) {
    const resolved = groupAdapter.resolve(id)
    if (!resolved.ok) {
        throw new Error('expected the group to resolve')
    }
    return resolved.target.reader
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = GROUP_ID
    putWorld([makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C')])
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

describe('T5: resolve names why a group cannot be written', () => {
    test('the adapter is registered under the group kind', () => {
        expect(SESSION_OWNER_ADAPTERS.group).toBe(groupAdapter)
        expect(sessionAdapterOf('group')).toBe(groupAdapter)
    })

    test('a selected loaded group resolves and names the kind and the id', () => {
        const resolved = groupAdapter.resolve(GROUP_ID)
        expect(resolved.ok && resolved.target.session).toBe('group')
        expect(resolved.ok && resolved.target.id).toBe(GROUP_ID)
    })

    test('not selected: another row is selected, or the visit is bound to another id', () => {
        selIdState.selId = 1
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'not-selected' })
        selIdState.selId = 0
        studioScreen.chaId = 'other'
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'not-selected' })
    })

    test('duplicate-id: two rows hold the chaId', () => {
        putWorld([makeGroup(), makeGroup()])
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'duplicate-id' })
    })

    test('gone: a character row, an archived group and an absent id are distinct from the other refusals', () => {
        putWorld([{ ...loadedCharacter(GROUP_ID) }])
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'gone' })
        putWorld([{ ...makeGroup(), coldstorage: 'cold' }])
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'gone' })
        putWorld([archivedStub('Q')])
        studioScreen.chaId = 'Q'
        expect(groupAdapter.resolve('Q')).toEqual({ ok: false, reason: 'gone' })
        putWorld([])
        expect(groupAdapter.resolve(GROUP_ID)).toEqual({ ok: false, reason: 'not-selected' })
    })
})

describe('T6a: the reader presents the arrays as one list or as none', () => {
    test('a good group reads fresh plain rows', () => {
        const reader = readerOf(GROUP_ID)
        const rows = reader.objList?.('members')
        expect(rows).toEqual([
            { chaId: 'A', talk: sixths(1), active: true },
            { chaId: 'B', talk: sixths(2), active: false },
            { chaId: 'C', talk: sixths(3), active: true },
        ])
        const again = reader.objList?.('members')
        expect(again).not.toBe(rows)
        ;(rows as { talk: number }[])[0].talk = 99
        expect(liveGroup().characterTalks[0]).toBe(sixths(1))
        expect(reader.objList?.('lore')).toBeNull()
    })

    test.each([
        ['talks one short', () => liveGroup().characterTalks.pop()],
        ['active one long', () => liveGroup().characterActive.push(true)],
        ['characters one short', () => liveGroup().characters.pop()],
        ['a non-array talks', () => corrupt('characterTalks', 'nope')],
        ['a missing active', () => corrupt('characterActive', undefined)],
        ['a hole in talks', () => delete liveGroup().characterTalks[1]],
        ['a hole in characters', () => delete (liveGroup().characters as unknown[])[0]],
    ])('%s reads as no list', (_title, damage) => {
        damage()
        expect(readerOf(GROUP_ID).objList?.('members')).toBeNull()
    })

    test('name and the order flag read as their kind or as absent; other paths are absent', () => {
        const reader = readerOf(GROUP_ID)
        expect(reader.field('name')).toEqual({ had: true, value: 'Group' })
        expect(reader.field('orderByOrder')).toEqual({ had: false })
        liveGroup().orderByOrder = true
        expect(reader.field('orderByOrder')).toEqual({ had: true, value: true })
        ;(liveGroup() as unknown as Record<string, unknown>).name = 5
        ;(liveGroup() as unknown as Record<string, unknown>).orderByOrder = 'yes'
        expect(reader.field('name')).toEqual({ had: false })
        expect(reader.field('orderByOrder')).toEqual({ had: false })
        expect(reader.field('desc')).toEqual({ had: false })
        expect(reader.greetings()).toBeNull()
        expect(reader.fmIndex('x')).toBeNull()
    })

    test('a gone group reads as nothing', () => {
        const reader = readerOf(GROUP_ID)
        putWorld([])
        expect(reader.objList?.('members')).toBeNull()
        expect(reader.field('name')).toEqual({ had: false })
    })
})

describe('T6b: a batch is verified whole before the first assignment', () => {
    test('a valid insert followed by an out-of-range remove writes nothing and marks nothing', () => {
        const before = arraysOf()
        expect(groupAdapter.write(GROUP_ID, [insertAt(3, { chaId: 'X', talk: 0.5, active: true }), removeAt(9)])).toBe(false)
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
    })

    test('an insert at the length and another at length + 1 succeed in order', () => {
        expect(groupAdapter.write(GROUP_ID, [insertAt(3, { chaId: 'X', talk: 0.5, active: true }), insertAt(4, { chaId: 'Y', talk: 0.25, active: false })])).toBe(true)
        expect(arraysOf()).toEqual({
            characters: ['A', 'B', 'C', 'X', 'Y'],
            talks: [sixths(1), sixths(2), sixths(3), 0.5, 0.25],
            active: [true, false, true, true, false],
        })
        expect(h.marks).toBe(1)
    })

    test('an insert beyond the length, a bad id, a bad field and a bad value kind are refused whole', () => {
        const before = arraysOf()
        const refused: WriteOp[][] = [
            [insertAt(4, { chaId: 'X', talk: 0.5, active: true })],
            [insertAt(0, { talk: 0.5, active: true })],
            [insertAt(0, { chaId: '', talk: 0.5, active: true })],
            [setField(0, 'chaId', 1)],
            [setField(0, 'talk', true)],
            [setField(0, 'active', 0.5)],
            [removeAt(-1)],
            [removeAt(0.5)],
            [setField(3, 'talk', 0.5)],
            [{ op: 'listInsert', index: 0, value: 'x' }],
        ]
        for (const batch of refused) {
            expect(groupAdapter.write(GROUP_ID, [setField(0, 'talk', 0.1), ...batch]), JSON.stringify(batch)).toBe(false)
            expect(arraysOf()).toEqual(before)
        }
        expect(h.marks).toBe(0)
    })

    test('a remove then an index that only the shorter list lacks is verified against the current length', () => {
        const before = arraysOf()
        expect(groupAdapter.write(GROUP_ID, [removeAt(2), removeAt(2)])).toBe(false)
        expect(arraysOf()).toEqual(before)
        expect(groupAdapter.write(GROUP_ID, [removeAt(2), removeAt(1)])).toBe(true)
        expect(arraysOf()).toEqual({ characters: ['A'], talks: [sixths(1)], active: [true] })
        expect(h.marks).toBe(1)
    })

    test('a group the batch cannot find is not written and not marked', () => {
        putWorld([])
        expect(groupAdapter.write(GROUP_ID, [nameSet('x')])).toBe(false)
        expect(h.marks).toBe(0)
    })

    test('a mismatched group refuses a members batch and writes nothing', () => {
        liveGroup().characterActive.pop()
        const before = arraysOf()
        expect(groupAdapter.write(GROUP_ID, [removeAt(0)])).toBe(false)
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
    })
})

describe('T6c: the entry\'s own value is stored, never a default', () => {
    test.each([
        ['talk', { chaId: 'X', active: true }, (a: ReturnType<typeof arraysOf>) => a.talks],
        ['active', { chaId: 'X', talk: 0.5 }, (a: ReturnType<typeof arraysOf>) => a.active],
    ])('an insert lacking %s grows all three arrays and stores undefined', (_field, entry, pick) => {
        expect(groupAdapter.write(GROUP_ID, [insertAt(3, entry)])).toBe(true)
        const arrays = arraysOf()
        expect(arrays.characters).toHaveLength(4)
        expect(arrays.talks).toHaveLength(4)
        expect(arrays.active).toHaveLength(4)
        expect(pick(arrays)[3]).toBeUndefined()
        const group = liveGroup()
        expect(3 in group.characterTalks).toBe(true)
        expect(3 in group.characterActive).toBe(true)
        // The row reads back without the key, and the list stays readable.
        expect(readerOf(GROUP_ID).objList?.('members')).toHaveLength(4)
    })

    test('a set with had:false assigns undefined at the index: no delete, no splice', () => {
        expect(groupAdapter.write(GROUP_ID, [setField(1, 'talk', null)])).toBe(true)
        const group = liveGroup()
        expect(group.characterTalks).toHaveLength(3)
        expect(1 in group.characterTalks).toBe(true)
        expect(group.characterTalks[1]).toBeUndefined()
        expect(groupAdapter.write(GROUP_ID, [setField(1, 'active', null)])).toBe(true)
        expect(1 in group.characterActive).toBe(true)
        expect(group.characterActive).toHaveLength(3)
    })
})

describe('T6d: check and write on foreign data', () => {
    test('check refuses a members batch on a mismatched or non-array group', () => {
        const batch = [removeAt(0)]
        expect(groupAdapter.check?.(GROUP_ID, batch)).toBe('ok')
        liveGroup().characterTalks.pop()
        expect(groupAdapter.check?.(GROUP_ID, batch)).toBe('precondition')
        corrupt('characterTalks', 'nope')
        expect(groupAdapter.check?.(GROUP_ID, batch)).toBe('precondition')
    })

    test('check passes a name-only batch on a non-array without reading the arrays', () => {
        const group = liveGroup()
        const reads: string[] = []
        for (const key of ['characters', 'characterTalks', 'characterActive'] as const) {
            Object.defineProperty(group, key, {
                get() {
                    reads.push(key)
                    return 'foreign'
                },
                configurable: true,
            })
        }
        expect(groupAdapter.check?.(GROUP_ID, [nameSet('x')])).toBe('ok')
        expect(reads).toEqual([])
    })

    test('write of a name-only batch on a non-array group assigns the name and leaves the arrays the same objects', () => {
        const group = liveGroup()
        const talks = group.characterTalks
        corrupt('characterActive', 'foreign')
        expect(groupAdapter.write(GROUP_ID, [nameSet('Renamed')])).toBe(true)
        expect(group.name).toBe('Renamed')
        expect(group.characterTalks).toBe(talks)
        expect(group.characterActive as unknown).toBe('foreign')
        expect(h.marks).toBe(1)
    })

    test('the order flag assigns a boolean and a had:false deletes the key; a non-boolean is refused', () => {
        const flag = (value: boolean | null): WriteOp => ({ op: 'set', path: 'orderByOrder', value: value === null ? { had: false } : { had: true, value } })
        expect(groupAdapter.write(GROUP_ID, [flag(true)])).toBe(true)
        expect(liveGroup().orderByOrder).toBe(true)
        expect(groupAdapter.write(GROUP_ID, [flag(null)])).toBe(true)
        expect('orderByOrder' in liveGroup()).toBe(false)
        const wrong: WriteOp = { op: 'set', path: 'orderByOrder', value: { had: true, value: 'yes' } }
        expect(groupAdapter.write(GROUP_ID, [wrong])).toBe(false)
        const absentName: WriteOp = { op: 'set', path: 'name', value: { had: false } }
        expect(groupAdapter.write(GROUP_ID, [absentName])).toBe(false)
        expect(liveGroup().name).toBe('Group')
    })
})

describe('archived and missing members are plain rows to the writer', () => {
    test('a stub chaId and a chaId with no character are written and removed like any other', () => {
        putWorld([makeGroup([member('S', sixths(2), true), member('GONE', sixths(1), false)]), archivedStub('S')])
        expect(readerOf(GROUP_ID).objList?.('members')).toHaveLength(2)
        expect(groupAdapter.write(GROUP_ID, [removeAt(1), setField(0, 'talk', sixths(5))])).toBe(true)
        expect(arraysOf()).toEqual({ characters: ['S'], talks: [sixths(5)], active: [true] })
        expect((DBState.db.characters as unknown as { chaId: string }[]).map((row) => row.chaId)).toEqual([GROUP_ID, 'S'])
    })
})
