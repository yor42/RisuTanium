// @vitest-environment jsdom
// The regex list through the object-list history: character `customscript` and module `regex` records of every shape
// the regex editor produces are saved through the real history store and read back whole; a chat key never holds one;
// a field outside the table and a deletion of a required field are refused at every gate (the service build, the stored
// record after `readOwner`, the strict parse). Entries are built like the producers write them: the classic add shape
// and the `RegexData` shape, one of them carrying an unknown upstream key.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { parseOwnerRecord, type OwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type ObjBuildResult, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { ObjAction, ObjFieldValue } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord, type MemoryStudioStore } from './studioStoreDoubles'
import { build, clone, fieldEdit, makeCharacter, putCharacter, rows } from './objService.test-helpers'

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

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService

// The classic add shape with an unknown upstream key, and the shape `RegexData` writes.
const classicEntry = (): Entry => ({ comment: 'c0', in: 'a', out: 'b', type: 'editinput', x_future: { a: 1 } })
const flaggedEntry = (): Entry => ({ comment: 'c1', in: 'a1', out: 'b1', type: 'editoutput', flag: 'g', ableFlag: true })
const regexList = (): Entry[] => [classicEntry(), flaggedEntry()]

function liveRegex(owner: OwnerKey): Entry[] {
    if (owner === M1) {
        return (DBState.db.modules as unknown as { regex: Entry[] }[])[0].regex
    }
    return (DBState.db.characters as unknown as { customscript: Entry[] }[])[0].customscript
}

async function start(): Promise<void> {
    putCharacter({ ...makeCharacter({ globalLore: rows(2) }), customscript: regexList() })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: regexList() }] as unknown as typeof DBState.db.modules
    clock = createFakeClock()
    store = createMemoryStudioStore()
    service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    await service.whenReady(A)
    await service.whenReady(M1)
}

beforeEach(() => {
    h.marks = 0
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

function regexSet(index: number, field: string, after: ObjFieldValue, name = 'n'): ReturnType<typeof build> {
    return build([{ op: 'objSet', list: 'regex', index, field, after }], { kind: 'obj', list: 'regex', action: 'edit', name, field })
}

function regexInsert(index: number, entry: Entry, action: ObjAction): ReturnType<typeof build> {
    return build([{ op: 'objInsert', list: 'regex', index, entry }], { kind: 'obj', list: 'regex', action, name: null })
}

const OTHER_ACTIONS: ObjAction[] = ['add', 'move', 'duplicate', 'import', 'folderCreate', 'folderRename', 'folderDelete', 'folderActive', 'bulkActive', 'newId', 'link', 'unlink']

// One step per shape the regex editor can record: every settable field (the absent flag and ableFlag included), an
// insert and a remove with content counts, and each label action.
function driveEveryShape(owner: OwnerKey): void {
    const text = (i: number, field: string, value: string) => expect(service.objEdit(owner, regexSet(i, field, { had: true, value }))).toEqual({ ok: true })
    text(0, 'comment', 'c0 edited')
    text(0, 'in', 'a edited')
    text(0, 'out', 'b edited')
    text(0, 'type', 'editoutput')
    expect(service.objEdit(owner, regexSet(0, 'flag', { had: true, value: 'gi' }))).toEqual({ ok: true })
    expect(service.objEdit(owner, regexSet(0, 'ableFlag', { had: true, value: true }))).toEqual({ ok: true })
    expect(service.objEdit(owner, regexSet(1, 'flag', { had: false }))).toEqual({ ok: true })
    expect(service.objEdit(owner, regexSet(1, 'ableFlag', { had: false }))).toEqual({ ok: true })
    for (const action of OTHER_ACTIONS) {
        const at = liveRegex(owner).length
        expect(service.objEdit(owner, regexInsert(at, { comment: `n-${action}`, in: '', out: '', type: 'editinput' }, action))).toEqual({ ok: true })
    }
    const last = liveRegex(owner).length - 1
    expect(service.objEdit(owner, build([{ op: 'objRemove', list: 'regex', index: last, deletedId: 'D1' }], { kind: 'obj', list: 'regex', action: 'delete', name: null, count: 1 }))).toEqual({ ok: true })
}

function recordOf(owner: OwnerKey, only?: number): OwnerRecord {
    const view = service.view(owner)
    const done = only === undefined ? [...view.done] : [view.done[only]]
    return clone({ ownerKey: owner, touchedAt: 1, done, undone: [], deleted: [...view.deleted], restore: null }) as unknown as OwnerRecord
}

describe('T38: character and module regex records survive the store', () => {
    for (const [name, owner] of [['character', A], ['module', M1]] as const) {
        test(`the ${name} record holds every shape, keeps unknown keys and reads back whole after readOwner`, async () => {
            await start()
            driveEveryShape(owner)
            expect(liveRegex(owner)[0].x_future).toEqual({ a: 1 })
            const view = service.view(owner)
            expect(view.done).toHaveLength(8 + OTHER_ACTIONS.length + 1)
            expect(view.deleted).toHaveLength(1)
            expect(view.deleted[0]).toMatchObject({ id: 'D1', list: 'regex' })
            const flagOps = view.done.slice(6, 8).flatMap((step) => step.ops)
            expect(flagOps.map((op) => (op as { after: ObjFieldValue }).after)).toEqual([{ had: false }, { had: false }])
            expect(view.done.map((step) => (step.label as { action?: string }).action)).toEqual(expect.arrayContaining(['edit', 'delete', ...OTHER_ACTIONS]))
            await clock.advance(SAVE_DEBOUNCE_MS + 1)
            const stored = storedRecord(store.shared, owner)
            expect(stored).not.toBeNull()
            expect(stored?.record.done).toEqual(view.done)
            expect(stored?.record.deleted).toEqual(view.deleted)
        })
    }

    test('an upstream-shaped list is never rewritten by opening or reading it', async () => {
        await start()
        const before = JSON.stringify(liveRegex(A))
        service.view(A)
        expect(JSON.stringify(liveRegex(A))).toBe(before)
        expect(service.view(A).done).toEqual([])
    })

    test('a chat key refuses every shape: each step and the deleted item parse to null under a chat owner and to a record under the holder', async () => {
        await start()
        driveEveryShape(A)
        const count = service.view(A).done.length
        for (let i = 0; i < count; i++) {
            const record = recordOf(A, i)
            expect(parseOwnerRecord(record, A)).not.toBeNull()
            expect(parseOwnerRecord({ ...record, ownerKey: C1 }, C1)).toBeNull()
        }
        const withItem = recordOf(A)
        expect(parseOwnerRecord(withItem, A)).not.toBeNull()
        expect(parseOwnerRecord({ ...withItem, ownerKey: C1 }, C1)).toBeNull()
        const itemOnly = { ...recordOf(A, count - 1), done: [] }
        expect(parseOwnerRecord({ ...itemOnly, ownerKey: C1 }, C1)).toBeNull()
    })

    test('a field outside the table is refused: a service objSet on x_future, a stored objSet on x_future and a label field x_future', async () => {
        await start()
        const before = JSON.stringify(liveRegex(A))
        expect(service.objEdit(A, regexSet(0, 'x_future', { had: true, value: 'v' }))).toMatchObject({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(liveRegex(A))).toBe(before)
        expect(service.view(A).done).toEqual([])

        expect(service.objEdit(A, regexSet(0, 'out', { had: true, value: 'changed' }))).toEqual({ ok: true })
        const good = recordOf(A)
        expect(parseOwnerRecord(good, A)).not.toBeNull()
        const stepOf = (record: OwnerRecord) => record.done[0] as unknown as { ops: { field: string }[]; label: { field: string } }
        const onOp = clone(good)
        stepOf(onOp).ops[0].field = 'x_future'
        expect(parseOwnerRecord(onOp, A)).toBeNull()
        const onLabel = clone(good)
        stepOf(onLabel).label.field = 'x_future'
        expect(parseOwnerRecord(onLabel, A)).toBeNull()
    })
})

describe('T-R2: a required regex field is never deleted', () => {
    test('a service draft of {had:false} on out, comment, in and type is refused and leaves the entry', async () => {
        await start()
        for (const owner of [A, M1]) {
            const before = JSON.stringify(liveRegex(owner))
            for (const field of ['out', 'comment', 'in', 'type']) {
                expect(service.objEdit(owner, regexSet(0, field, { had: false }))).toMatchObject({ ok: false, reason: 'precondition' })
            }
            expect(JSON.stringify(liveRegex(owner))).toBe(before)
            expect(service.view(owner).done).toEqual([])
        }
    })

    test('a stored objSet with after {had:false} on out is refused whole after readOwner; the same record with a text value reads back', async () => {
        await start()
        expect(service.objEdit(A, regexSet(0, 'out', { had: true, value: 'changed' }))).toEqual({ ok: true })
        const good = recordOf(A)
        const tampered = clone(good) as unknown as { done: { ops: { after: ObjFieldValue }[] }[] }
        tampered.done[0].ops[0].after = { had: false }
        const shared = new Map<string, string>()
        seedOwner(shared, good as never, 'w-good')
        expect(storedRecord(shared, A as never)).not.toBeNull()
        const shared2 = new Map<string, string>()
        seedOwner(shared2, tampered as unknown as OwnerRecord as never, 'w-bad')
        expect(storedRecord(shared2, A as never)).toBeNull()
    })

    test('an optional field may still be deleted, and a lore {had:false} is still accepted', async () => {
        await start()
        expect(service.objEdit(A, regexSet(1, 'flag', { had: false }))).toEqual({ ok: true })
        expect(Object.hasOwn(liveRegex(A)[1], 'flag')).toBe(false)
        expect(service.objEdit(A, fieldEdit(0, 'secondkey', { had: false }))).toEqual({ ok: true })
        const record = recordOf(A)
        expect(parseOwnerRecord(record, A)).not.toBeNull()
    })
})
