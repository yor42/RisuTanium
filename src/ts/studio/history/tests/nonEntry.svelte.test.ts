// @vitest-environment jsdom
// The undoable removal of a list element that is not an entry (#720) through the real service and history store:
// remove, undo and redo restore it in place, a neighbouring edit replays, the record round-trips through the store, and
// the regex list takes the same shape.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { parseOwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { ObjDraft } from '../objectListOps'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from './studioStoreDoubles'
import { build, clone, fieldEdit, makeCharacter, putCharacter, row } from './objService.test-helpers'

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

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService

const NON_ENTRIES: unknown[] = [null, 'x', 5, [1, { b: 2, a: 1 }]]
const mixed = (): unknown[] => [row(0), ...clone(NON_ENTRIES), row(1)]
const strayRegex = (): unknown[] => [{ comment: 'c', in: 'a', out: 'b', type: 'editinput' }, 'stray', null]

function live(owner: OwnerKey): unknown[] {
    if (owner === M1) {
        return (DBState.db.modules as unknown as { lorebook: unknown[] }[])[0].lorebook
    }
    return (DBState.db.characters as unknown as { globalLore: unknown[] }[])[0].globalLore
}

function liveRegex(): unknown[] {
    return (DBState.db.characters as unknown as { customscript: unknown[] }[])[0].customscript
}

async function start(): Promise<void> {
    putCharacter({ ...makeCharacter({ globalLore: mixed() }), customscript: strayRegex() })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], lorebook: mixed() }] as unknown as typeof DBState.db.modules
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

function removeAt(list: 'lore' | 'regex', index: number, nonEntry = true): ReturnType<typeof build> {
    const draft: ObjDraft = nonEntry ? { op: 'objRemove', list, index, nonEntry: true } : { op: 'objRemove', list, index }
    return build([draft], { kind: 'obj', list, action: 'delete', name: null, count: 1 })
}

describe('T59 history: removing an element that is not an entry', () => {
    for (const [name, owner] of [['character', A], ['module', M1]] as const) {
        test.each([1, 2, 3, 4])(`the ${name} list: remove, undo and redo of element %i restore it in place`, async (index) => {
            await start()
            const original = clone(live(owner))
            expect(service.objEdit(owner, removeAt('lore', index))).toEqual({ ok: true })
            const removed = clone(original)
            removed.splice(index, 1)
            expect(live(owner)).toEqual(removed)
            expect(service.undo(owner)).toEqual({ ok: true })
            expect(live(owner)).toEqual(original)
            expect(JSON.stringify(live(owner))).toBe(JSON.stringify(original))
            expect(service.redo(owner)).toEqual({ ok: true })
            expect(live(owner)).toEqual(removed)
            expect(service.undo(owner)).toEqual({ ok: true })
            expect(live(owner)).toEqual(original)
        })
    }

    test('a plain remove never takes a non-object, and a nonEntry remove never takes an entry', async () => {
        await start()
        const before = JSON.stringify(live(A))
        expect(service.objEdit(A, removeAt('lore', 1, false))).toMatchObject({ ok: false, reason: 'precondition' })
        expect(service.objEdit(A, removeAt('lore', 0))).toMatchObject({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(live(A))).toBe(before)
        expect(service.view(A).done).toEqual([])
    })

    test('a neighbouring edit before and after the removal still replays through undo and redo', async () => {
        await start()
        expect(service.objEdit(A, build([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'first' } }], { kind: 'obj', list: 'lore', action: 'edit', name: null, field: 'comment' }))).toEqual({ ok: true })
        expect(service.objEdit(A, removeAt('lore', 1))).toEqual({ ok: true })
        expect(service.objEdit(A, fieldEdit(4, 'comment', { had: true, value: 'last' }))).toEqual({ ok: true })
        const finalRows = clone(live(A))
        expect(service.undo(A)).toEqual({ ok: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(live(A)[1]).toBeNull()
        expect(service.undo(A)).toEqual({ ok: true })
        expect(service.redo(A)).toEqual({ ok: true })
        expect(service.redo(A)).toEqual({ ok: true })
        expect(service.redo(A)).toEqual({ ok: true })
        expect(live(A)).toEqual(finalRows)
    })

    test('a redo after the element moved elsewhere is refused, never reported as done', async () => {
        await start()
        expect(service.objEdit(A, removeAt('lore', 1))).toEqual({ ok: true })
        expect(service.undo(A)).toEqual({ ok: true })
        // Outside change: the null moves to the front, so index 1 no longer holds it.
        live(A).splice(1, 1)
        live(A).unshift(null)
        const before = JSON.stringify(live(A))
        expect(service.redo(A)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(live(A))).toBe(before)
    })

    test('the step is saved and read back whole: null stays null in the stored op, and the record parses', async () => {
        await start()
        expect(service.objEdit(A, removeAt('lore', 1))).toEqual({ ok: true })
        expect(service.objEdit(A, removeAt('lore', 1))).toEqual({ ok: true })
        const view = service.view(A)
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const stored = storedRecord(store.shared, A)
        expect(stored).not.toBeNull()
        expect(stored?.record.done).toEqual(view.done)
        const ops = view.done.flatMap((step) => step.ops) as unknown as { entry: unknown; counts: unknown }[]
        expect(ops.map((op) => op.entry)).toEqual([null, 'x'])
        expect(ops.map((op) => op.counts)).toEqual([{}, {}])
        const record = clone({ ownerKey: A, touchedAt: 1, done: [...view.done], undone: [], deleted: [], restore: null })
        expect(parseOwnerRecord(record, A)).not.toBeNull()
        expect(parseOwnerRecord(clone(record), M1)).toBeNull()
    })

    test('the regex list takes the same shape: a stray string is removed, undone and redone', async () => {
        await start()
        const original = clone(liveRegex())
        expect(service.objEdit(A, removeAt('regex', 1))).toEqual({ ok: true })
        expect(liveRegex()).toEqual([original[0], null])
        expect(service.undo(A)).toEqual({ ok: true })
        expect(liveRegex()).toEqual(original)
        expect(service.redo(A)).toEqual({ ok: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(liveRegex()).toEqual(original)
    })
})
