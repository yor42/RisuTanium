// @vitest-environment jsdom
// The object-list edit through the real service: the character and chat hosts, the marked write, Rule K (op, label and
// produced items), MC-4090 (a wrong-kind stored value is not editable), the deleted-item lifecycle on every route and
// the restore point's identity reuse.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { COALESCE_MS, parseOwnerRecord, type OwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type ObjBuildResult, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { ObjFamilyOp } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'
import { addRow, build, clone, deleteRows, fieldEdit, golden, liveCharacter, makeCharacter, putCharacter, row, rows, textEdit } from './objService.test-helpers'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService

async function start(character = makeCharacter({ globalLore: rows(3) }), existing?: Map<string, string>): Promise<void> {
    putCharacter(character)
    clock = createFakeClock()
    store = createMemoryStudioStore({ shared: existing })
    service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
    await service.whenReady(C1)
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
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function lore(): unknown[] {
    return liveCharacter().globalLore as unknown[]
}

function recordOf(owner = A): OwnerRecord {
    const view = service.view(owner)
    return { ownerKey: owner, touchedAt: 0, done: [...view.done], undone: [...view.undone], deleted: [...view.deleted], restore: view.restore } as OwnerRecord
}

describe('edit, undo, redo on the character', () => {
    test('a field edit lands as one obj step, keeps unknown keys, marks once, and undo and redo restore it', async () => {
        const rowsWithUnknown = rows(3).map((entry, i) => (i === 1 ? { ...entry, loreCache: { k: 1 }, unknownKey: 'u' } : entry))
        await start(makeCharacter({ globalLore: clone(rowsWithUnknown) }))
        const before = JSON.stringify(lore())
        expect(service.objEdit(A, textEdit(1, 'comment', 'Edited'))).toEqual({ ok: true })
        expect(h.marks).toBe(1)
        expect((lore()[1] as Record<string, unknown>).comment).toBe('Edited')
        expect((lore()[1] as Record<string, unknown>).loreCache).toEqual({ k: 1 })
        const [step] = service.view(A).done
        expect(step.label).toEqual({ kind: 'obj', list: 'lore', action: 'edit', name: null, field: 'comment' })
        expect(step.ops).toHaveLength(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(JSON.stringify(lore())).toBe(before)
        expect(service.redo(A)).toEqual({ ok: true })
        expect((lore()[1] as Record<string, unknown>).comment).toBe('Edited')
    })

    test('an edit that changes nothing is unchanged: nothing is written, marked or recorded', async () => {
        await start()
        expect(service.objEdit(A, textEdit(0, 'comment', 'Row 0'))).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toEqual([])
    })

    test('an outside change to the row refuses the undo with nothing written', async () => {
        await start()
        service.objEdit(A, textEdit(1, 'comment', 'Edited'))
        ;(lore()[1] as Record<string, unknown>).content = 'moved elsewhere'
        const snapshot = JSON.stringify(lore())
        const marks = h.marks
        expect(service.undo(A)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
        expect(JSON.stringify(lore())).toBe(snapshot)
        expect(h.marks).toBe(marks)
        expect(service.view(A).done).toHaveLength(1)
    })

    test('reportStep adds the id of the step the edit landed as', async () => {
        await start()
        const result = service.objEdit(A, textEdit(0, 'comment', 'X'), { reportStep: true })
        expect(result).toEqual({ ok: true, stepId: service.view(A).done[0].id })
    })
})

describe('the chat host (T21) and the reactive proxy (N1)', () => {
    test('a chat owner writes its own localLore and never reads the character list', async () => {
        const chat = { id: 'c1', note: '', fmIndex: -1, localLore: [row(7)] }
        await start(makeCharacter({ globalLore: rows(2), chats: [chat] }))
        expect(service.objEdit(C1, addRow(1, row(8)))).toEqual({ ok: true })
        expect((liveCharacter().chats[0].localLore as { comment: string }[]).map((e) => e.comment)).toEqual(['Row 7', 'Row 8'])
        expect(lore()).toEqual(rows(2))
        expect(h.marks).toBe(1)
        // The chat owner's reader has no view of the character's list: an index that only the character list holds is refused.
        expect(service.objEdit(C1, textEdit(1, 'comment', 'z', null)).ok).toBe(true)
        expect(service.objEdit(C1, textEdit(2, 'comment', 'z', null))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('N1: a chat with no localLore key under a reactive proxy gets the insert; the live chat and its JSON hold it; undo removes it', async () => {
        const character = makeCharacter({ globalLore: rows(1) })
        await start(character)
        // A $state declaration deep-proxies the database the service writes into, as the running app's DBState.db is.
        const reactive = $state({ characters: [character] })
        DBState.db = reactive as unknown as typeof DBState.db
        expect(service.objEdit(C1, addRow(0, row(5)))).toEqual({ ok: true })
        const liveChat = liveCharacter().chats[0]
        expect(liveChat.localLore).toHaveLength(1)
        expect((liveChat.localLore?.[0] as { comment: string }).comment).toBe('Row 5')
        expect(JSON.parse(JSON.stringify(liveChat)).localLore).toEqual([row(5)])
        expect(service.undo(C1)).toEqual({ ok: true })
        expect(liveChat.localLore ?? []).toHaveLength(0)
        expect(JSON.parse(JSON.stringify(liveChat)).localLore ?? []).toEqual([])
    })
})

describe('props (T23)', () => {
    test('loreSettings and loreExt change in one step; undo restores both, absent included', async () => {
        await start(makeCharacter({ globalLore: rows(1) }))
        const label = { kind: 'prop' as const, prop: 'loreSettings' as const }
        const result = service.objEdit(A, build([
            { op: 'propSet', prop: 'loreSettings', after: { had: true, value: { tokenBudget: 500 } } },
            { op: 'propSet', prop: 'loreExt', after: { had: true, value: { x: 1 } } },
        ], label))
        expect(result).toEqual({ ok: true })
        expect(liveCharacter().loreSettings).toEqual({ tokenBudget: 500 })
        expect(liveCharacter().loreExt).toEqual({ x: 1 })
        expect(service.view(A).done).toHaveLength(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect('loreSettings' in liveCharacter()).toBe(false)
        expect('loreExt' in liveCharacter()).toBe(false)
    })

    test('a chat owner refuses a propSet', async () => {
        await start()
        const result = service.objEdit(C1, build([{ op: 'propSet', prop: 'loreSettings', after: { had: true, value: { a: 1 } } }], { kind: 'prop', prop: 'loreSettings' }))
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
    })
})

describe('Rule K (T-RK)', () => {
    test('an op the strict parse refuses (a non-integer insert index) is never written, marked or recorded', async () => {
        await start()
        const before = JSON.stringify(lore())
        expect(service.objEdit(A, addRow(1.5, row(9)))).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(lore())).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toEqual([])
    })

    test('a label the strict parse refuses (an unknown action) is refused the same way', async () => {
        await start()
        const before = JSON.stringify(lore())
        const bad = build([{ op: 'objInsert', list: 'lore', index: 0, entry: row(9) }], { kind: 'obj', list: 'lore', action: 'bogus', name: null } as unknown as Extract<ObjBuildResult, { ok: true }>['label'])
        expect(service.objEdit(A, bad)).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(lore())).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toEqual([])
    })
})

describe('MC-4090: a wrong-kind stored value is not editable (T-WK)', () => {
    const wrong = golden.wrongKinds.globalLore[0]

    test.each(['insertorder', 'content', 'alwaysActive'])('an edit of the wrong-kind field %s is refused precondition and writes nothing', async (field) => {
        await start(makeCharacter({ globalLore: [clone(wrong)] }))
        const before = JSON.stringify(lore())
        const after = field === 'insertorder' ? { had: true as const, value: 5 } : field === 'content' ? { had: true as const, value: 'text' } : { had: true as const, value: true }
        expect(service.objEdit(A, fieldEdit(0, field, after))).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(lore())).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toEqual([])
    })

    test('another field of the row stays editable, the wrong-kind values stay byte-equal, and undo restores the row', async () => {
        await start(makeCharacter({ globalLore: [clone(wrong)] }))
        const before = JSON.stringify(lore())
        expect(service.objEdit(A, textEdit(0, 'comment', 'Renamed'))).toEqual({ ok: true })
        const edited = lore()[0] as Record<string, unknown>
        for (const field of ['insertorder', 'content', 'alwaysActive']) {
            expect(edited[field]).toEqual((wrong as Record<string, unknown>)[field])
        }
        expect(service.undo(A)).toEqual({ ok: true })
        expect(JSON.stringify(lore())).toBe(before)
    })

    test('deleting the row and restoring it from History puts it back byte-equal', async () => {
        await start(makeCharacter({ globalLore: [clone(wrong)] }))
        const before = JSON.stringify(lore())
        expect(service.objEdit(A, deleteRows([0], 'D1'))).toEqual({ ok: true })
        expect(lore()).toEqual([])
        expect(service.restoreDeleted(A, 'D1')).toEqual({ ok: true })
        expect(JSON.stringify(lore())).toBe(before)
    })
})

describe('the deleted-item lifecycle (T45 service half, T-S2)', () => {
    test('a delete lists one item; Restore from History consumes it; a revert across the restore lists it again', async () => {
        await start()
        service.objEdit(A, deleteRows([1], 'D1'))
        const item = service.view(A).deleted[0]
        expect(item).toMatchObject({ id: 'D1', list: 'lore' })
        expect(service.restoreDeleted(A, 'D1')).toEqual({ ok: true })
        expect(service.view(A).deleted).toEqual([])
        const deleteStep = service.view(A).done[0]
        expect(service.revertTo(A, deleteStep.id)).toEqual({ ok: true })
        expect(lore()).toHaveLength(2)
        expect(service.view(A).deleted.map((entry) => entry.id)).toEqual(['D1'])
    })

    test('undo of a delete consumes its item and a redo lists it again', async () => {
        await start()
        service.objEdit(A, deleteRows([1], 'D1'))
        expect(service.undo(A)).toEqual({ ok: true })
        expect(service.view(A).deleted).toEqual([])
        expect(lore()).toHaveLength(3)
        expect(service.redo(A)).toEqual({ ok: true })
        expect(service.view(A).deleted.map((entry) => entry.id)).toEqual(['D1'])
    })

    test('a run of removes that does not descend is refused with nothing written, marked or recorded', async () => {
        const twin = golden.twins.globalLore[0]
        await start(makeCharacter({ globalLore: [row(0), clone(twin), clone(twin), row(3)] }))
        const before = JSON.stringify(lore())
        const result = service.objEdit(A, build([
            { op: 'objRemove', list: 'lore', index: 1, deletedId: 'D1' },
            { op: 'objRemove', list: 'lore', index: 1, deletedId: 'D1' },
        ], { kind: 'obj', list: 'lore', action: 'delete', name: null, count: 2 }))
        expect(result).toMatchObject({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(lore())).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(A).deleted).toEqual([])
        expect(service.view(A).done).toEqual([])
    })

    test('every item the service lists parses back through the owner record', async () => {
        await start(makeCharacter({ globalLore: rows(5) }))
        service.objEdit(A, deleteRows([1, 3], 'D1'))
        const deleted = service.view(A).deleted
        expect(deleted).toHaveLength(1)
        const reread = parseOwnerRecord(JSON.parse(JSON.stringify({ ...recordOf(), touchedAt: 1, restore: null })), A)
        expect(reread).not.toBeNull()
        expect(reread?.deleted).toEqual(deleted)
    })

    test('T51(c): after a reload that kept the data save but not the history save, undo moves as already and writes no second copy', async () => {
        await start()
        service.objEdit(A, deleteRows([1], 'D1'))
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const saved = new Map(store.shared)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(lore()).toHaveLength(3)
        // The page reloads: the data save holds the undone list, the history save is the one made after the delete.
        const dataAfterUndo = clone(lore())
        await start(makeCharacter({ globalLore: dataAfterUndo }), saved)
        expect(service.view(A).done).toHaveLength(1)
        expect(service.view(A).deleted.map((item) => item.id)).toEqual(['D1'])
        expect(service.undo(A)).toEqual({ ok: true, already: 'undo' })
        expect(lore()).toHaveLength(3)
        expect(service.view(A).deleted).toEqual([])
    })
})

describe('restore point identity (MD6)', () => {
    test('a second lore edit in the same visit reuses the restore point object', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'one'))
        const first = service.view(A).restore
        expect(first).not.toBeNull()
        clock.tick(COALESCE_MS + 1)
        service.objEdit(A, textEdit(1, 'comment', 'two'))
        expect(service.view(A).restore).toBe(first)
    })
})

describe('editing types', () => {
    test('the ops recorded by one edit are deep-equal to a copy taken right after the commit', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'content', 'a'))
        const ops = clone(service.view(A).done[0].ops) as ObjFamilyOp[]
        clock.tick(COALESCE_MS + 1)
        service.objEdit(A, textEdit(0, 'content', 'ab'))
        service.objEdit(A, textEdit(1, 'content', 'z'))
        expect(service.view(A).done[0].ops).toEqual(ops)
    })
})
