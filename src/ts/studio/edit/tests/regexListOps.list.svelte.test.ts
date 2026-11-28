// @vitest-environment jsdom
// The regex list operations (add, delete, move, duplicate) through the real owner history service (memory store, fake
// clock, a character owner and a module owner): T7 add, T8 move and duplicate, T11 delete and restore (with a save and a
// read-back between), the refusals the builders decide (T35 list parts, T41 totality, a list a JSON-shaped store would
// change), and the pick rule for rows that have no identity. Malformed lists come out of the real `importRegex`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'
import { importRegex } from 'src/ts/process/scripts'
import { newRegexEntry, regexAdd, regexDelete, regexDuplicate, regexFieldEdit, regexMove, regexTwinCount, type RegexMove, type RegexOp } from '../regexListOps'

const h = vi.hoisted(() => ({ marks: 0, picked: null as { name: string, data: Uint8Array } | null }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(),
    AppendableBuffer: class {},
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    return { getDatabase: () => state.db, getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn(), defaultSdDataFunc: () => [] }
})
vi.mock('src/ts/util', () => ({ selectSingleFile: vi.fn(async () => h.picked) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/ts/exportNotice', () => ({ downloadNotice: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({ assetRegex: {}, risuChatParser: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleAssets: vi.fn(() => []), getModuleRegexScripts: vi.fn(() => []) }))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaEditTrigger: vi.fn() }))
vi.mock('src/ts/plugins/plugins.svelte', () => ({ pluginV2: {} }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const OWNERS: readonly (readonly [string, OwnerKey])[] = [['character', A], ['module', M1]]
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let service: OwnerHistoryService
let clock: FakeClock
let store: MemoryStudioStore

const named = (n: number): Entry => ({ comment: `S${n}`, in: `in ${n}`, out: `out ${n}`, type: 'editinput' })
const upstreamEntry = (): Entry => JSON.parse('{"comment":"up","in":"a","out":"b","type":"editoutput","flag":"gi","ableFlag":true,"x_future":{"a":1},"__proto__":{"p":1}}')

function liveList(owner: OwnerKey): unknown[] {
    if (owner === M1) return (DBState.db.modules as unknown as { regex: unknown[] }[])[0].regex
    return (DBState.db.characters as unknown as { customscript: unknown[] }[])[0].customscript
}
const names = (owner: OwnerKey): unknown[] => liveList(owner).map((row) => (row !== null && typeof row === 'object' ? (row as Entry).comment : row))
const snapshot = (owner: OwnerKey): string => JSON.stringify(liveList(owner))
const doneOf = (owner: OwnerKey) => service.view(owner).done
const edit = (owner: OwnerKey, op: RegexOp) => service.objEdit(owner, op.build)

function newService(): OwnerHistoryService {
    return createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
}

async function start(list: unknown[]): Promise<void> {
    putCharacter({ ...makeCharacter(), customscript: structuredClone(list) })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: structuredClone(list) }] as unknown as typeof DBState.db.modules
    clock = createFakeClock()
    store = createMemoryStudioStore()
    service = newService()
    await service.whenReady(A)
    await service.whenReady(M1)
}

async function importedList(rows: unknown[]): Promise<unknown[]> {
    h.picked = { name: 'regex.json', data: new TextEncoder().encode(JSON.stringify({ type: 'regex', data: rows })) }
    return importRegex([])
}

beforeEach(() => {
    h.marks = 0
    h.picked = null
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe.each(OWNERS)('T7: add (%s owner)', (_name, owner) => {
    test('appends exactly the classic entry; undo removes it; redo adds it again', async () => {
        await start([named(0)])
        expect(edit(owner, regexAdd())).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(2)
        const added = liveList(owner)[1] as Entry
        expect(Object.keys(added)).toEqual(['comment', 'in', 'out', 'type'])
        expect(added).toEqual({ comment: '', in: '', out: '', type: 'editinput' })
        expect(added).toEqual(newRegexEntry())
        expect(doneOf(owner)).toHaveLength(1)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(1)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(liveList(owner)[1]).toEqual(newRegexEntry())
    })

    test('the landing is the new index; an absent list is created as an array', async () => {
        await start([])
        if (owner === M1) delete (DBState.db.modules as unknown as { regex?: unknown[] }[])[0].regex
        else delete (DBState.db.characters as unknown as { customscript?: unknown[] }[])[0].customscript
        const op = regexAdd()
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(op.landed()).toBe(0)
        expect(liveList(owner)).toEqual([newRegexEntry()])
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toEqual([])
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toEqual([newRegexEntry()])
    })

    test('a second add lands at the end of a list of two', async () => {
        await start([named(0), named(1)])
        const op = regexAdd()
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(op.landed()).toBe(2)
    })
})

describe.each(OWNERS)('T8: move (%s owner)', (_name, owner) => {
    const five = (): Entry[] => [named(0), named(1), upstreamEntry(), named(3), named(4)]
    const cases: [RegexMove, number, string[]][] = [
        ['up', 2, ['S0', 'up', 'S1', 'S3', 'S4']],
        ['down', 2, ['S0', 'S1', 'S3', 'up', 'S4']],
        ['top', 2, ['up', 'S0', 'S1', 'S3', 'S4']],
        ['bottom', 2, ['S0', 'S1', 'S3', 'S4', 'up']],
        [{ to: 3 }, 0, ['S1', 'up', 'S3', 'S0', 'S4']],
    ]
    test.each(cases)('move %j of row %i gives the post-removal order, undoes and redoes', async (move, from, order) => {
        await start(five())
        const original = snapshot(owner)
        const op = regexMove(liveList(owner)[from], from, move)
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(names(owner)).toEqual(order)
        expect(doneOf(owner)).toHaveLength(1)
        const moved = snapshot(owner)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(original)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(moved)
        expect(service.view(owner).deleted).toHaveLength(0)
    })

    test('the landing is the moved row, an unknown key and the own __proto__ ride along', async () => {
        await start(five())
        const op = regexMove(liveList(owner)[2], 2, 'top')
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(op.landed()).toBe(0)
        const moved = liveList(owner)[0] as Entry
        expect(moved.x_future).toEqual({ a: 1 })
        expect(Object.hasOwn(moved, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(moved)).toBe(Object.prototype)
    })

    test('a move that leaves the order as it is writes nothing', async () => {
        await start(five())
        const before = snapshot(owner)
        for (const [move, from] of [['up', 0], ['top', 0], ['down', 4], ['bottom', 4], [{ to: 1 }, 1]] as [RegexMove, number][]) {
            expect(edit(owner, regexMove(liveList(owner)[from], from, move))).toEqual({ ok: true, unchanged: true })
        }
        expect(snapshot(owner)).toBe(before)
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('a target outside the list is refused', async () => {
        await start(five())
        for (const to of [-1, 5, 1.5, Number.NaN]) {
            expect(edit(owner, regexMove(liveList(owner)[1], 1, { to }))).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('undo of the move still applies after an outside edit of another row, and an outside edit of the moved row blocks it', async () => {
        await start(five())
        expect(edit(owner, regexMove(liveList(owner)[0], 0, 'bottom'))).toEqual({ ok: true })
        ;(liveList(owner)[0] as Entry).in = 'other row'
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S0', 'S1', 'up', 'S3', 'S4'])
        expect((liveList(owner)[1] as Entry).in).toBe('other row')
        expect(service.redo(owner)).toEqual({ ok: true })
        const moved = liveList(owner).length - 1
        ;(liveList(owner)[moved] as Entry).in = 'moved row edited'
        const before = snapshot(owner)
        expect(service.undo(owner)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(snapshot(owner)).toBe(before)
    })
})

describe.each(OWNERS)('T8: duplicate (%s owner)', (_name, owner) => {
    test('inserts a deep-equal copy after the original; editing the copy leaves the original; undo and redo apply', async () => {
        await start([named(0), upstreamEntry(), named(2)])
        const op = regexDuplicate(liveList(owner)[1], 1)
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(op.landed()).toBe(2)
        const [, original, copy] = liveList(owner) as Entry[]
        expect(copy).toEqual(original)
        expect(copy).not.toBe(original)
        expect(copy.x_future).not.toBe(original.x_future)
        expect(Object.hasOwn(copy, '__proto__')).toBe(true)
        expect(JSON.stringify(copy)).toBe(JSON.stringify(original))
        expect(edit(owner, regexFieldEdit(2, 'in', 'edited copy', null))).toEqual({ ok: true })
        expect((liveList(owner)[1] as Entry).in).toBe('a')
        expect((liveList(owner)[2] as Entry).in).toBe('edited copy')
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(3)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(4)
    })

    test('undo of the duplicate, then of an edit of the original, both apply', async () => {
        await start([named(0), named(1)])
        expect(edit(owner, regexDuplicate(liveList(owner)[0], 0))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(0, 'out', 'edited original', null))).toEqual({ ok: true })
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S0', 'S1'])
        expect((liveList(owner)[0] as Entry).out).toBe('out 0')
    })

    test('a copy already removed elsewhere leaves the undo with nothing to write', async () => {
        await start([named(0)])
        expect(edit(owner, regexDuplicate(liveList(owner)[0], 0))).toEqual({ ok: true })
        liveList(owner).splice(1, 1)
        expect(service.undo(owner)).toMatchObject({ ok: true, already: 'undo' })
        expect(names(owner)).toEqual(['S0'])
    })
})

describe.each(OWNERS)('T11: delete and restore (%s owner)', (_name, owner) => {
    const list = (): Entry[] => [named(0), upstreamEntry(), named(2), named(3)]

    test('the deleted row returns at its old index, deep-equal, after three edits', async () => {
        await start(list())
        const original = JSON.stringify(liveList(owner)[1])
        const op = regexDelete(liveList(owner)[1], 1)
        expect(edit(owner, op)).toEqual({ ok: true })
        const id = op.landedDeletedId()
        expect(id).not.toBeNull()
        expect(names(owner)).toEqual(['S0', 'S2', 'S3'])
        expect(service.view(owner).deleted.map((item) => item.id)).toEqual([id])
        expect(edit(owner, regexFieldEdit(0, 'in', 'e1', null))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(1, 'in', 'e2', null))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(2, 'in', 'e3', null))).toEqual({ ok: true })
        expect(service.restoreDeleted(owner, id as string)).toMatchObject({ ok: true })
        expect(names(owner)).toEqual(['S0', 'up', 'S2', 'S3'])
        expect(JSON.stringify(liveList(owner)[1])).toBe(original)
        expect(Object.hasOwn(liveList(owner)[1] as Entry, '__proto__')).toBe(true)
        expect(service.view(owner).deleted).toHaveLength(0)
    })

    test('an index beyond the shortened list is clamped to the end', async () => {
        await start(list())
        const op = regexDelete(liveList(owner)[3], 3)
        expect(edit(owner, op)).toEqual({ ok: true })
        liveList(owner).splice(0, 2)
        expect(service.restoreDeleted(owner, op.landedDeletedId() as string)).toMatchObject({ ok: true })
        expect(names(owner)).toEqual(['S2', 'S3'])
    })

    test('undo of the delete puts the row back and ends the deleted item; redo removes it again', async () => {
        await start(list())
        const before = snapshot(owner)
        expect(edit(owner, regexDelete(liveList(owner)[2], 2))).toEqual({ ok: true })
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(before)
        expect(service.view(owner).deleted).toHaveLength(0)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S0', 'up', 'S3'])
    })

    test('the step and the deleted item are saved and survive a reload', async () => {
        await start(list())
        const original = JSON.stringify(liveList(owner)[1])
        const op = regexDelete(liveList(owner)[1], 1)
        expect(edit(owner, op)).toEqual({ ok: true })
        const id = op.landedDeletedId() as string
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const stored = storedRecord(store.shared, owner as never)
        expect(stored?.record.deleted.map((item) => item.id)).toEqual([id])
        expect(stored?.record.deleted[0]).toMatchObject({ list: 'regex' })
        const reloaded = newService()
        await reloaded.whenReady(owner)
        expect(reloaded.view(owner).deleted.map((item) => item.id)).toEqual([id])
        expect(reloaded.view(owner).done).toHaveLength(1)
        expect(reloaded.restoreDeleted(owner, id)).toMatchObject({ ok: true })
        expect(JSON.stringify(liveList(owner)[1])).toBe(original)
    })

    test('restore is refused with the list rule when more identical rows now stand than when it was deleted', async () => {
        await start([named(0), named(1)])
        const op = regexDelete(liveList(owner)[1], 1)
        expect(edit(owner, op)).toEqual({ ok: true })
        liveList(owner).push(structuredClone(named(1)))
        const result = service.restoreDeleted(owner, op.landedDeletedId() as string)
        expect(result).toMatchObject({ ok: false })
        expect(result).toMatchObject({ obj: { list: 'regex', kind: 'idTaken' } })
        expect(names(owner)).toEqual(['S0', 'S1'])
    })

    test('a delete never asks and writes one step with the entry and its counts', async () => {
        await start(list())
        expect(edit(owner, regexDelete(liveList(owner)[0], 0))).toEqual({ ok: true })
        const ops = doneOf(owner).flatMap((step) => step.ops) as unknown as { op: string, list: string, counts: Record<string, number>, deletedId?: string }[]
        expect(ops).toHaveLength(1)
        expect(ops[0]).toMatchObject({ op: 'objRemove', list: 'regex', counts: { content: 1 } })
        expect(typeof ops[0].deletedId).toBe('string')
    })
})

describe.each(OWNERS)('the pick rule for rows with no identity (%s owner)', (_name, owner) => {
    test('the row at the hint is used while it equals what the action began with', async () => {
        await start([named(0), named(1), named(0)])
        expect(edit(owner, regexDelete(named(0), 2))).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S0', 'S1'])
    })

    test('a moved row is followed to its only equal row; twins at a wrong hint refuse', async () => {
        await start([named(1), named(0), named(2)])
        expect(edit(owner, regexDelete(named(2), 0))).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S1', 'S0'])
        await start([named(0), named(1), named(0)])
        expect(edit(owner, regexDelete(named(0), 1))).toEqual({ ok: false, reason: 'precondition' })
        expect(names(owner)).toEqual(['S0', 'S1', 'S0'])
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('twins: a hint row changed since the snapshot refuses delete and every move kind instead of acting on the other twin', async () => {
        const kinds: RegexMove[] = ['up', 'down', 'top', 'bottom', { to: 0 }]
        for (const move of kinds) {
            await start([named(0), named(0)])
            const twins = regexTwinCount(liveList(owner), named(0))
            expect(twins).toBe(2)
            ;(liveList(owner)[1] as Entry).in = 'changed outside'
            expect(edit(owner, regexMove(named(0), 1, move, twins))).toEqual({ ok: false, reason: 'precondition' })
            expect(doneOf(owner)).toHaveLength(0)
        }
        await start([named(0), named(0)])
        ;(liveList(owner)[1] as Entry).in = 'changed outside'
        expect(edit(owner, regexDelete(named(0), 1, 2))).toEqual({ ok: false, reason: 'precondition' })
        expect(edit(owner, regexDuplicate(named(0), 1, 2))).toEqual({ ok: false, reason: 'precondition' })
        expect(names(owner)).toEqual(['S0', 'S0'])
    })

    test('no twin: a row inserted above is followed to its only equal row', async () => {
        await start([named(5), named(0)])
        expect(regexTwinCount(liveList(owner), named(0))).toBe(1)
        liveList(owner).unshift(named(9))
        expect(edit(owner, regexDelete(named(0), 1, 1))).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S9', 'S5'])
    })

    test('twins: the recorded remove index and the deleted item index are the hint', async () => {
        await start([named(0), named(0)])
        const op = regexDelete(named(0), 1, 2)
        expect(edit(owner, op)).toEqual({ ok: true })
        const ops = doneOf(owner).flatMap((step) => step.ops) as unknown as { op: string, index: number }[]
        expect(ops[0]).toMatchObject({ op: 'objRemove', index: 1 })
        const item = service.view(owner).deleted[0] as unknown as { entries: { index: number }[] }
        expect(item.entries[0].index).toBe(1)
    })

    test('twins: moving the third of [A, B, A] to the top records remove index 2', async () => {
        await start([named(0), named(1), named(0)])
        expect(edit(owner, regexMove(named(0), 2, 'top', 2))).toEqual({ ok: true })
        expect(names(owner)).toEqual(['S0', 'S0', 'S1'])
        const ops = doneOf(owner).flatMap((step) => step.ops) as unknown as { op: string, index: number }[]
        expect(ops[0]).toMatchObject({ op: 'objRemove', index: 2 })
    })

    test('a row moved past its identical neighbour changes nothing and records nothing', async () => {
        await start([named(0), named(0), named(1)])
        expect(edit(owner, regexMove(named(0), 0, 'down', 2))).toEqual({ ok: true, unchanged: true })
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('a row changed since the action began is refused for every operation', async () => {
        await start([named(0), named(1)])
        const stale = { ...named(1), in: 'changed outside' }
        for (const op of [regexDelete(stale, 1), regexDuplicate(stale, 1), regexMove(stale, 1, 'top')]) {
            expect(edit(owner, op)).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(doneOf(owner)).toHaveLength(0)
    })
})

describe.each(OWNERS)('T35, T41: unreadable and inert rows (%s owner)', (_name, owner) => {
    const rows = (): unknown[] => [
        named(0),
        { comment: 'x', in: 123, out: '', type: 'editinput' },
        { in: '', out: '', type: 'editinput' },
        null,
        'text',
        upstreamEntry(),
    ]

    test.each([3, 4])('an element that is not an object (row %i) gets no operation', async (index) => {
        await start(await importedList(rows()))
        const before = snapshot(owner)
        const target = liveList(owner)[index]
        for (const op of [regexDelete(target, index), regexDuplicate(target, index), regexMove(target, index, 'top')]) {
            expect(edit(owner, op)).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(snapshot(owner)).toBe(before)
        expect(doneOf(owner)).toHaveLength(0)
    })

    test.each([1, 2])('an unreadable object (row %i) is deleted and moved, never duplicated, and undo restores it exactly', async (index) => {
        await start(await importedList(rows()))
        const before = snapshot(owner)
        const target = liveList(owner)[index]
        expect(edit(owner, regexDuplicate(target, index))).toEqual({ ok: false, reason: 'precondition' })
        expect(edit(owner, regexMove(target, index, 'bottom'))).toEqual({ ok: true })
        expect(JSON.stringify(liveList(owner).at(-1))).toBe(JSON.stringify(target))
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(before)
        const op = regexDelete(target, index)
        expect(edit(owner, op)).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(5)
        expect(service.restoreDeleted(owner, op.landedDeletedId() as string)).toMatchObject({ ok: true })
        expect(snapshot(owner)).toBe(before)
    })

    test('T41: delete the first, move the last to the top, edit it, duplicate it: every plan applies and the elements that are not objects stay byte-equal', async () => {
        await start(await importedList([named(0), null, 'x', named(0)]))
        expect(edit(owner, regexDelete(named(0), 0))).toEqual({ ok: true })
        expect(liveList(owner)).toEqual([null, 'x', named(0)])
        expect(edit(owner, regexMove(named(0), 2, 'top'))).toEqual({ ok: true })
        expect(liveList(owner)).toEqual([named(0), null, 'x'])
        expect(edit(owner, regexFieldEdit(0, 'in', 'typed', null))).toEqual({ ok: true })
        const typed = liveList(owner)[0]
        expect(edit(owner, regexDuplicate(typed, 0))).toEqual({ ok: true })
        expect(JSON.stringify(liveList(owner))).toBe(JSON.stringify([{ ...named(0), in: 'typed' }, { ...named(0), in: 'typed' }, null, 'x']))
        for (let i = 0; i < 4; i++) expect(service.undo(owner)).toEqual({ ok: true })
        expect(JSON.stringify(liveList(owner))).toBe(JSON.stringify([named(0), null, 'x', named(0)]))
    })

    test('after a save and a read-back the record with a malformed object still parses and undo restores it exactly', async () => {
        await start(await importedList(rows()))
        const before = snapshot(owner)
        expect(edit(owner, regexDelete(liveList(owner)[1], 1))).toEqual({ ok: true })
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const reloaded = newService()
        await reloaded.whenReady(owner)
        expect(reloaded.view(owner).done).toHaveLength(1)
        expect(reloaded.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(before)
    })
})

describe.each(OWNERS)('a list a JSON-shaped store would change (%s owner)', (_name, owner) => {
    test('no list operation builds on it', async () => {
        await start([named(0), named(1)])
        liveList(owner).push({ comment: 'u', in: '', out: '', type: 'editinput', flag: undefined })
        const before = snapshot(owner)
        const target = liveList(owner)[0]
        for (const op of [regexAdd(), regexDelete(target, 0), regexDuplicate(target, 0), regexMove(target, 0, 'bottom')]) {
            expect(edit(owner, op)).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(snapshot(owner)).toBe(before)
        expect(doneOf(owner)).toHaveLength(0)
    })
})

describe('the builders on a list that is not an array', () => {
    test('a stored non-list is never replaced', async () => {
        await start([named(0)])
        ;(DBState.db.characters as unknown as { customscript: unknown }[])[0].customscript = 'broken'
        expect(edit(A, regexAdd())).toEqual({ ok: false, reason: 'precondition' })
        expect((DBState.db.characters as unknown as { customscript: unknown }[])[0].customscript).toBe('broken')
    })
})
