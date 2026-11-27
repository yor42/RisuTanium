// @vitest-environment jsdom
// The group member list through the real owner service with the real group adapter: one user action is one step over the
// three parallel arrays, and every undo, redo, revert and restore either keeps the arrays aligned or refuses. The history
// of the group owner is memory-only, so no store is ever written.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { buildAddMember, buildRemoveMember, buildSetActive, buildSetTalk, DEFAULT_MEMBER_TALK } from 'src/ts/studio/edit/groupMembers'
import { applyCharacterWrites, resolveLiveTarget } from 'src/ts/studio/edit/studioSetters'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { planObjStep } from '../objectListOps'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { characterOwnerKey, groupOwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'
import { clone, deleteRows, liveCharacter, makeCharacter, putCharacter, rows, textEdit } from './objService.test-helpers'
import {
    DEFAULT_MEMBERS,
    GROUP_ID,
    archivedStub,
    arraysOf,
    corrupt,
    draftBuild,
    insertOutsideStudio,
    liveGroup,
    loadedCharacter,
    makeGroup,
    member,
    putWorld,
    removeOutsideStudio,
    sixths,
    type Arrays,
} from './group.test-helpers'

const h = vi.hoisted(() => ({ marks: 0, restores: [] as string[] }))

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
vi.mock('src/ts/process/coldCharacterAccess', () => ({ restoreArchivedForWrite: async (chaId: string) => { h.restores.push(`access:${chaId}`); return { status: 'gone' } } }))
vi.mock('src/ts/process/coldCharacterRestore', () => ({ restoreColdCharacter: async () => { h.restores.push('restore'); return null } }))
vi.mock('src/ts/process/coldMemberRestore', () => ({ restoreColdCharacterByChaId: async (chaId: string) => { h.restores.push(`member:${chaId}`); return false } }))

const G = groupOwnerKey(GROUP_ID)
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService
let sessions = 0

function createService(): OwnerHistoryService {
    store = createMemoryStudioStore()
    sessions += 1
    return createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: `p${sessions}`,
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
}

async function start(world: readonly unknown[] = [makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), loadedCharacter('X')]): Promise<void> {
    putWorld(world)
    clock = createFakeClock()
    service = createService()
    await service.whenReady(G)
}

beforeEach(() => {
    h.marks = 0
    h.restores.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = GROUP_ID
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

const START: Arrays = {
    characters: ['A', 'B', 'C'],
    talks: [sixths(1), sixths(2), sixths(3)],
    active: [true, false, true],
}
const lastStepId = (): string => service.view(G).done.at(-1)?.id ?? ''
const firstStepId = (): string => service.view(G).done[0]?.id ?? ''

describe('T7: add', () => {
    test('is one step: all three arrays grow, classic\'s defaults, the chat untouched, one mark', async () => {
        await start()
        const chatBefore = JSON.stringify(liveGroup().chats)
        const result = service.objEdit(G, buildAddMember('X', 'Name X'))
        expect(result).toEqual({ ok: true })
        expect(arraysOf()).toEqual({
            characters: ['A', 'B', 'C', 'X'],
            talks: [...START.talks, DEFAULT_MEMBER_TALK],
            active: [...START.active, true],
        })
        // 1 / 6 * 4: never 4/6 written differently, never 1 or 0.
        expect(liveGroup().characterTalks[3]).toBe((1 / 6) * 4)
        expect(JSON.stringify(liveGroup().chats)).toBe(chatBefore)
        expect(service.view(G).done).toHaveLength(1)
        expect(service.view(G).deleted).toEqual([])
        expect(h.marks).toBe(1)
    })
})

describe('T8: a duplicate add is refused', () => {
    test('objEdit refuses precondition and records, writes and marks nothing', async () => {
        await start()
        const result = service.objEdit(G, buildAddMember('B', 'Name B'))
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('a continuation built before an outside add of the same character writes nothing', async () => {
        await start()
        const continuation = buildAddMember('X', 'Name X')
        insertOutsideStudio(3, member('X', sixths(5)))
        const before = arraysOf()
        expect(service.objEdit(G, continuation)).toEqual({ ok: false, reason: 'precondition' })
        expect(arraysOf()).toEqual(before)
        expect(service.view(G).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })
})

describe('T9 and T10: remove', () => {
    test('removes the one row from all three arrays and lists no deleted item', async () => {
        await start()
        expect(service.objEdit(G, buildRemoveMember('B', 'Name B')).ok).toBe(true)
        expect(arraysOf()).toEqual({ characters: ['A', 'C'], talks: [sixths(1), sixths(3)], active: [true, true] })
        expect(service.view(G).deleted).toEqual([])
        expect(h.marks).toBe(1)
    })

    test('undo reinserts the member at its index with its own values, redo removes it again, and the restore line returns the whole arrays', async () => {
        await start()
        service.objEdit(G, buildRemoveMember('B', 'Name B'))
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf()).toEqual(START)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'C'])
        service.objEdit(G, buildSetTalk('A', 'Name A', sixths(6)))
        // A revert keeps its target step and undoes the steps above it.
        expect(service.revertTo(G, firstStepId())).toMatchObject({ ok: true })
        expect(arraysOf()).toEqual({ characters: ['A', 'C'], talks: [sixths(1), sixths(3)], active: [true, true] })
        expect(service.restore(G, new Set(), { lines: ['members'] })).toMatchObject({ ok: true })
        expect(arraysOf()).toEqual(START)
    })
})

describe('T11: add and the other steps replay exactly', () => {
    test('undo and redo of an add', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf()).toEqual(START)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'X'])
    })

    test('a revert over remove, talk and active returns the arrays the add left, and the restore line the initial ones', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        service.objEdit(G, buildRemoveMember('A', 'Name A'))
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(6)))
        service.objEdit(G, buildSetActive('C', 'Name C', false))
        expect(service.view(G).done.length).toBeGreaterThanOrEqual(4)
        expect(arraysOf()).not.toEqual(START)
        expect(service.revertTo(G, firstStepId())).toMatchObject({ ok: true })
        expect(arraysOf()).toEqual({ characters: ['A', 'B', 'C', 'X'], talks: [...START.talks, DEFAULT_MEMBER_TALK], active: [...START.active, true] })
        expect(service.restore(G, new Set(), { lines: ['members'] })).toMatchObject({ ok: true })
        expect(arraysOf()).toEqual(START)
    })
})

describe('T12 to T16: outside changes between a step and its replay (strict index)', () => {
    test('T12: an outside removal shifts the added member: undo refuses changed and writes nothing', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        removeOutsideStudio(0)
        const before = arraysOf()
        h.marks = 0
        const result = service.undo(G)
        expect(result).toMatchObject({ ok: false, reason: 'precondition', obj: { kind: 'changed' } })
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
        expect(service.view(G).done).toHaveLength(1)
        expect(service.view(G).undone).toHaveLength(0)
    })

    test('T13: the added member was removed outside: undo is already (no write), redo re-adds while the index is in range', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        removeOutsideStudio(3)
        h.marks = 0
        expect(service.undo(G)).toMatchObject({ ok: true, already: 'undo' })
        expect(arraysOf()).toEqual(START)
        expect(h.marks).toBe(0)
        expect(service.view(G).undone).toHaveLength(1)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'X'])
    })

    test('T13: redo of an add whose index is now out of range refuses changed', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        service.undo(G)
        removeOutsideStudio(2)
        removeOutsideStudio(1)
        const before = arraysOf()
        expect(service.redo(G)).toMatchObject({ ok: false, reason: 'precondition', obj: { kind: 'changed' } })
        expect(arraysOf()).toEqual(before)
    })

    test('T14: an identical row already sits at the recorded index: undo of the remove is already, no write', async () => {
        await start()
        service.objEdit(G, buildRemoveMember('B', 'Name B'))
        insertOutsideStudio(1, member('B', sixths(2), false))
        const before = arraysOf()
        h.marks = 0
        expect(service.undo(G)).toMatchObject({ ok: true, already: 'undo' })
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
    })

    test('T15a: the removed member was re-added elsewhere with default values: undo refuses changed, one B', async () => {
        await start()
        service.objEdit(G, buildRemoveMember('B', 'Name B'))
        insertOutsideStudio(2, member('B', DEFAULT_MEMBER_TALK, true))
        const before = arraysOf()
        const result = service.undo(G)
        expect(result).toMatchObject({ ok: false, reason: 'precondition' })
        expect(arraysOf()).toEqual(before)
        expect(arraysOf().characters.filter((id) => id === 'B')).toHaveLength(1)
    })

    test('T15b: re-added with the recorded values but at another index: changed, no duplicate', async () => {
        await start()
        service.objEdit(G, buildRemoveMember('B', 'Name B'))
        insertOutsideStudio(2, member('B', sixths(2), false))
        const before = arraysOf()
        expect(service.undo(G)).toMatchObject({ ok: false, reason: 'precondition', obj: { kind: 'changed' } })
        expect(arraysOf()).toEqual(before)
        expect(arraysOf().characters.filter((id) => id === 'B')).toHaveLength(1)
    })

    test('T16: a replayed step whose row and index match applies even when the chaId occurs twice', async () => {
        await start()
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(5)))
        insertOutsideStudio(3, member('B', sixths(4), true))
        const result = service.undo(G)
        // The set replays by index and the row there is the one the step recorded.
        expect(result).toEqual({ ok: true })
        expect(liveGroup().characterTalks[1]).toBe(sixths(2))
        expect(liveGroup().characterTalks[3]).toBe(sixths(4))
    })

    test('T16: a duplicated chaId refuses the real builders and writes nothing', async () => {
        await start([makeGroup([member('A', sixths(1)), member('B', sixths(2)), member('A', sixths(3))]), loadedCharacter('A'), loadedCharacter('B')])
        const before = arraysOf()
        for (const build of [buildAddMember('A', null), buildRemoveMember('A', null), buildSetTalk('A', null, 0.5), buildSetActive('A', null, false)]) {
            expect(service.objEdit(G, build)).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
    })
})

describe('T17: talk and active', () => {
    test('one index per step; undo and redo are exact', async () => {
        await start()
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(5)))
        expect(arraysOf().talks).toEqual([sixths(1), sixths(5), sixths(3)])
        expect(arraysOf().active).toEqual(START.active)
        service.objEdit(G, buildSetActive('B', 'Name B', true))
        expect(arraysOf().active).toEqual([true, true, true])
        expect(service.undo(G)).toEqual({ ok: true })
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf()).toEqual(START)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().talks[1]).toBe(sixths(5))
    })

    test('an undo is already when the live value equals the step\'s before, and changed when it differs from both', async () => {
        await start()
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(5)))
        liveGroup().characterTalks[1] = sixths(2)
        h.marks = 0
        expect(service.undo(G)).toMatchObject({ ok: true, already: 'undo' })
        expect(h.marks).toBe(0)
        service.redo(G)
        liveGroup().characterTalks[1] = sixths(4)
        expect(service.undo(G)).toMatchObject({ ok: false, reason: 'precondition', obj: { kind: 'changed' } })
        expect(liveGroup().characterTalks[1]).toBe(sixths(4))
    })

    test('consecutive taps on one member and field merge in the visit journal', async () => {
        await start()
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(3)))
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(4)))
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(6)))
        expect(service.view(G).done).toHaveLength(1)
        expect(service.journalForTests(G).get('members')).toHaveLength(1)
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf()).toEqual(START)
    })
})

describe('T18 and T19: missing and archived members', () => {
    test('T18: a member with no character row can be removed, undone and redone', async () => {
        await start([makeGroup([member('A', sixths(1)), member('GONE', sixths(2), false)]), loadedCharacter('A')])
        expect(service.objEdit(G, buildRemoveMember('GONE', null)).ok).toBe(true)
        expect(arraysOf().characters).toEqual(['A'])
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'GONE'])
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A'])
    })

    test('T19: an archived member takes remove, talk and active and its stub is never restored or dropped', async () => {
        await start([makeGroup([member('A', sixths(1)), member('S', sixths(2), false)]), loadedCharacter('A'), archivedStub('S')])
        const world = (): string[] => (DBState.db.characters as unknown as { chaId: string }[]).map((row) => row.chaId)
        expect(service.objEdit(G, buildSetTalk('S', null, sixths(6))).ok).toBe(true)
        expect(service.objEdit(G, buildSetActive('S', null, true)).ok).toBe(true)
        expect(world()).toEqual([GROUP_ID, 'A', 'S'])
        expect(service.undo(G)).toEqual({ ok: true })
        expect(service.undo(G)).toEqual({ ok: true })
        expect(service.redo(G)).toEqual({ ok: true })
        expect(world()).toEqual([GROUP_ID, 'A', 'S'])
        expect(arraysOf().characters).toEqual(['A', 'S'])
        expect(service.objEdit(G, buildRemoveMember('S', null)).ok).toBe(true)
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'S'])
        expect(h.restores).toEqual([])
        expect((DBState.db.characters as unknown as { coldstorage?: string }[])[2].coldstorage).toBe('cold-S')
    })
})

describe('T20 and T21: an add that was started for another visit writes nothing', () => {
    test('T20: adding a candidate that is an archived stub is one ordinary step, with no restore and no chat message', async () => {
        await start([makeGroup(), loadedCharacter('A'), archivedStub('Q')])
        const chatBefore = JSON.stringify(liveGroup().chats)
        expect(service.objEdit(G, buildAddMember('Q', 'Name Q')).ok).toBe(true)
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'Q'])
        expect(h.restores).toEqual([])
        expect(JSON.stringify(liveGroup().chats)).toBe(chatBefore)
    })

    test('T21: the selection moved to another group or the visit closed: the service refuses the write', async () => {
        await start([makeGroup(), makeGroup(DEFAULT_MEMBERS, { chaId: 'H' }), loadedCharacter('X')])
        const continuation = buildAddMember('X', 'Name X')
        // Another group is selected.
        selIdState.selId = 1
        studioScreen.chaId = 'H'
        const before = arraysOf()
        const moved = service.objEdit(G, continuation)
        expect(moved.ok).toBe(false)
        expect(arraysOf()).toEqual(before)
        // The visit closed: no id is bound.
        selIdState.selId = 0
        studioScreen.chaId = ''
        expect(service.objEdit(G, continuation).ok).toBe(false)
        expect(arraysOf()).toEqual(before)
        expect(h.marks).toBe(0)
        expect(service.view(G).done).toHaveLength(0)
    })
})

describe('T22: the restore line', () => {
    test('a visit with member steps offers a members line, and restore applies it', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        service.objEdit(G, buildSetTalk('B', 'Name B', sixths(6)))
        expect(service.view(G).restoreLines).toEqual([{ list: 'members', n: 2 }])
        const result = service.restore(G, new Set(), { lines: ['members'] })
        expect(result).toMatchObject({ ok: true })
        expect(arraysOf()).toEqual(START)
    })

    test('an outside change refuses only that line', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', 'Name X'))
        removeOutsideStudio(0)
        const before = arraysOf()
        const result = service.restore(G, new Set(), { lines: ['members'] })
        expect(result).toMatchObject({ ok: false, linesRefused: ['members'] })
        expect(arraysOf()).toEqual(before)
    })
})

describe('T23: name and the order flag', () => {
    test('the name is a text step; undo restores it', async () => {
        await start()
        expect(service.editText(G, 'name', 'Renamed', 'single')).toMatchObject({ ok: true })
        expect(liveGroup().name).toBe('Renamed')
        expect(service.undo(G)).toEqual({ ok: true })
        expect(liveGroup().name).toBe('Group')
    })

    test('the first edit of an absent order flag undoes by deleting the key, never by writing false', async () => {
        await start()
        expect('orderByOrder' in liveGroup()).toBe(false)
        expect(service.editValue(G, 'orderByOrder', true)).toMatchObject({ ok: true })
        expect(liveGroup().orderByOrder).toBe(true)
        expect(service.undo(G)).toEqual({ ok: true })
        expect('orderByOrder' in liveGroup()).toBe(false)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(liveGroup().orderByOrder).toBe(true)
        expect(service.editValue(G, 'orderByOrder', false)).toMatchObject({ ok: true })
        expect(liveGroup().orderByOrder).toBe(false)
    })

    test('T6: a name edit succeeds on a group whose arrays are foreign', async () => {
        await start()
        corrupt('characterTalks', 'nope')
        expect(service.editText(G, 'name', 'Still editable', 'single')).toMatchObject({ ok: true })
        expect(liveGroup().name).toBe('Still editable')
        expect(liveGroup().characterTalks as unknown).toBe('nope')
    })
})

describe('T6: foreign arrays refuse every member op', () => {
    const damages: [string, () => void][] = [
        ['talks 3/2/3', () => liveGroup().characterTalks.pop()],
        ['a non-array talks', () => corrupt('characterTalks', 'nope')],
        ['a hole', () => delete liveGroup().characterActive[0]],
    ]
    test.each(damages)('%s: builders and raw drafts are refused precondition, nothing is written, marked or recorded', async (_title, damage) => {
        await start()
        damage()
        const snapshot = JSON.stringify(arraysOf())
        const raw = [
            draftBuild([{ op: 'objInsert', list: 'members', index: 0, entry: { chaId: 'X', talk: 0.5, active: true } }], 'add'),
            draftBuild([{ op: 'objRemove', list: 'members', index: 0 }], 'delete'),
            draftBuild([{ op: 'objSet', list: 'members', index: 0, field: 'talk', after: { had: true, value: 0.1 } }], 'edit', 'talk'),
        ]
        for (const build of [buildAddMember('X', null), buildRemoveMember('A', null), buildSetTalk('A', null, 0.5), buildSetActive('A', null, false), ...raw]) {
            expect(service.objEdit(G, build)).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(JSON.stringify(arraysOf())).toBe(snapshot)
        expect(h.marks).toBe(0)
        expect(service.view(G).done).toHaveLength(0)
    })
})

describe('T6c: an entry lacking a key replays totally', () => {
    test('an insert without talk, then undo and redo, stays aligned and ok', async () => {
        await start()
        const build = draftBuild([{ op: 'objInsert', list: 'members', index: 3, entry: { chaId: 'X', active: true } }], 'add')
        expect(service.objEdit(G, build)).toEqual({ ok: true })
        expect(liveGroup().characterTalks[3]).toBeUndefined()
        expect(3 in liveGroup().characterTalks).toBe(true)
        expect(service.undo(G)).toEqual({ ok: true })
        expect(arraysOf()).toEqual(START)
        expect(service.redo(G)).toEqual({ ok: true })
        expect(arraysOf().characters).toEqual(['A', 'B', 'C', 'X'])
        expect(arraysOf().talks[3]).toBeUndefined()
        expect(arraysOf().active[3]).toBe(true)
    })
})

describe('T24: a seeded property test over the whole action surface', () => {
    function rng(seed: number): () => number {
        let state = seed >>> 0
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            return state / 2 ** 32
        }
    }

    const ALLOWED_REFUSALS = new Set(['precondition', 'empty', 'unknown'])

    function assertAligned(): void {
        const group = liveGroup()
        expect(Array.isArray(group.characters)).toBe(true)
        expect(group.characterTalks).toHaveLength(group.characters.length)
        expect(group.characterActive).toHaveLength(group.characters.length)
        for (let index = 0; index < group.characters.length; index++) {
            expect(index in group.characters && index in group.characterTalks && index in group.characterActive).toBe(true)
        }
        expect(new Set(group.characters).size).toBe(group.characters.length)
    }

    test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: the arrays keep one length and result kinds stay in the closed set', async (seed) => {
        await start()
        const random = rng(seed)
        const pick = (n: number): number => Math.floor(random() * n)
        let fresh = 0
        for (let step = 0; step < 90; step++) {
            const before = arraysOf()
            const marksBefore = h.marks
            const roll = random()
            let result: StudioResult | null = null
            let expected: Arrays | null = null
            const ids = before.characters as string[]
            if (roll < 0.18) {
                const id = `N${fresh++}`
                result = service.objEdit(G, buildAddMember(id, id))
                expected = { characters: [...before.characters, id], talks: [...before.talks, DEFAULT_MEMBER_TALK], active: [...before.active, true] }
            } else if (roll < 0.32 && ids.length > 0) {
                const index = pick(ids.length)
                result = service.objEdit(G, buildRemoveMember(ids[index], ids[index]))
                expected = {
                    characters: before.characters.filter((_v, i) => i !== index),
                    talks: before.talks.filter((_v, i) => i !== index),
                    active: before.active.filter((_v, i) => i !== index),
                }
            } else if (roll < 0.45 && ids.length > 0) {
                const index = pick(ids.length)
                const value = sixths(1 + pick(6))
                result = service.objEdit(G, buildSetTalk(ids[index], null, value))
                expected = { ...before, talks: before.talks.map((v, i) => (i === index ? value : v)) }
            } else if (roll < 0.55 && ids.length > 0) {
                const index = pick(ids.length)
                const value = !before.active[index]
                result = service.objEdit(G, buildSetActive(ids[index], null, value))
                expected = { ...before, active: before.active.map((v, i) => (i === index ? value : v)) }
            } else if (roll < 0.68) {
                result = service.undo(G)
            } else if (roll < 0.78) {
                result = service.redo(G)
            } else if (roll < 0.84) {
                const done = service.view(G).done
                result = done.length === 0 ? null : service.revertTo(G, done[pick(done.length)].id)
            } else if (roll < 0.92 && ids.length > 0) {
                removeOutsideStudio(pick(ids.length))
            } else {
                insertOutsideStudio(pick(ids.length + 1), member(`O${fresh++}`, sixths(1 + pick(6)), random() < 0.5))
            }
            assertAligned()
            if (result === null) {
                continue
            }
            const after = arraysOf()
            if (result.ok === false) {
                expect(ALLOWED_REFUSALS.has(result.reason), `${step}: ${result.reason}`).toBe(true)
                expect(after, `${step}: a refusal writes nothing`).toEqual(before)
                expect(h.marks - marksBefore).toBe(0)
                continue
            }
            if (result.already !== undefined || result.unchanged === true) {
                expect(after, `${step}: already or unchanged writes nothing`).toEqual(before)
                expect(h.marks - marksBefore).toBe(0)
                continue
            }
            expect(h.marks - marksBefore, `${step}: one landed action marks once`).toBe(1)
            if (expected !== null) {
                expect(after, `${step}: the independent model`).toEqual(expected)
            }
        }
    })
})

describe('T25: dirty tracking', () => {
    test('each landed step marks the group id once and a refused write marks nothing', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', null))
        expect(h.marks).toBe(1)
        expect(tracker.character).toContain(GROUP_ID)
        service.objEdit(G, buildSetTalk('A', null, sixths(6)))
        expect(h.marks).toBe(2)
        service.undo(G)
        expect(h.marks).toBe(3)
        service.objEdit(G, buildAddMember('A', null))
        service.objEdit(G, buildRemoveMember('nobody', null))
        expect(h.marks).toBe(3)
    })
})

describe('T27: the stored group key stays restricted and no group history reaches the store', () => {
    test('a stored character key for a group is restricted and resolves as a group refusal', async () => {
        await start()
        service.useOwner(characterOwnerKey(GROUP_ID))
        expect(service.view(characterOwnerKey(GROUP_ID)).restricted).toBe(true)
        expect(resolveLiveTarget(characterOwnerKey(GROUP_ID))).toEqual({ ok: false, reason: 'group' })
    })

    test('member steps open, load and save nothing in the store', async () => {
        await start()
        service.objEdit(G, buildAddMember('X', null))
        service.objEdit(G, buildRemoveMember('A', null))
        service.undo(G)
        clock.tick(60_000)
        expect(store.counts).toEqual({ open: 0, load: 0, save: 0, entryValueReads: 0 })
        expect(store.shared.size).toBe(0)
        expect(store.saves).toHaveLength(0)
        expect(service.view(G).persisted).toBe(false)
    })

    test('the stored character writer returns before it touches a group', async () => {
        await start()
        const before = JSON.stringify(liveGroup())
        applyCharacterWrites(liveGroup() as unknown as Parameters<typeof applyCharacterWrites>[0], [{ op: 'set', path: 'desc', value: { had: true, value: 'x' } }], null)
        expect(JSON.stringify(liveGroup())).toBe(before)
    })
})

describe('T26: the shared planner is unchanged for lore (compatibility guard, passes before and after)', () => {
    async function startCharacter(): Promise<{ owner: ReturnType<typeof characterOwnerKey> }> {
        putCharacter(makeCharacter({ globalLore: rows(3) }))
        studioScreen.chaId = 'A'
        clock = createFakeClock()
        service = createService()
        const owner = characterOwnerKey('A')
        await service.whenReady(owner)
        return { owner }
    }

    test('a unique-id lore entry with unchanged content at a shifted index is not relocated', async () => {
        const { owner } = await startCharacter()
        expect(service.objEdit(owner, textEdit(1, 'comment', 'edited')).ok).toBe(true)
        // An outside insert above shifts the row the step recorded.
        const lore = liveCharacter().globalLore as unknown[]
        lore.splice(0, 0, clone(rows(1)[0]))
        expect(service.undo(owner)).toMatchObject({ ok: false, reason: 'precondition' })
    })

    test('a lore insert above the current length is refused, not clamped', async () => {
        const { owner } = await startCharacter()
        expect(service.objEdit(owner, deleteRows([2], 'd2')).ok).toBe(true)
        const lore = liveCharacter().globalLore as unknown[]
        lore.splice(0, lore.length)
        expect(service.undo(owner)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(lore).toHaveLength(0)
    })

    test('planObjStep of a lore edit still plans against a plain lore reader', () => {
        const live = { field: () => ({ had: false } as const), greetings: () => null, fmIndex: () => null, objList: () => rows(2) }
        const plan = planObjStep([], live, new Set())
        expect(plan.ok).toBe(true)
    })
})
