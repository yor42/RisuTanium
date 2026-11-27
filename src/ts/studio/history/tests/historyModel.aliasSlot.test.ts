// Two registry paths on one holder property are one restore slot. The real registry holds the alias row `lowLevelAccessFix`
// over the base `lowLevelAccess`; each test drives the model with ops on both paths over the one property and expects one
// slot per property: one restore write, one working value, one stored revert op, one restore entry.
// Regression reproducers except T12, which is a compatibility guard and passes before and after.
import { describe, expect, test } from 'vitest'
import {
    deriveRestoreWrites,
    noteRestoreWrites,
    planReplay,
    planRestorePoint,
    planRevert,
    type OwnerRecord,
    type RestorePoint,
    type Step,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { B, BASE, FIX, FOREIGN_ONE, applyWrites, descStep, readerOf, recordOf, setStep } from './aliasRegistry.test-helpers'
import { createMemoryStudioStore, seedOwner } from './studioStoreDoubles'

const OWNER = characterOwnerKey('c1')

function sets(ops: Step['ops']): Step['ops'] {
    return ops.filter((op) => op.op === 'set' && op.path !== 'desc')
}

describe('restore writes and the restore point keep one entry per slot', () => {
    test('T5: ops on the alias and the base path derive one write on the slot path', () => {
        const writes = deriveRestoreWrites(
            [
                { op: 'set', path: FIX, before: FOREIGN_ONE, after: B(false) },
                { op: 'set', path: BASE, before: B(false), after: B(true) },
            ],
            null,
        )
        expect(writes).toEqual([{ path: FIX, before: FOREIGN_ONE, after: B(true) }])
    })

    test('T6: a base write updates the slot entry and adds no base key', () => {
        const point: RestorePoint = { visitId: 'v', at: 1, fields: { [FIX]: { before: B(true), last: B(false) } } }
        const next = noteRestoreWrites(point, 'v', 1, [{ path: BASE, before: B(false), after: B(true) }], false)
        expect(next?.fields).toEqual({ [FIX]: { before: B(true), last: B(true) } })
    })
})

describe('replays read and write one working value per slot', () => {
    test('T7: a revert over an alias step then a base step applies both', () => {
        const record = recordOf([descStep(), setStep('s1', FIX, FOREIGN_ONE, B(false)), setStep('s2', BASE, B(false), B(true))])
        const holder: Record<string, unknown> = { desc: 'b', lowLevelAccess: true }
        const plan = planRevert(record, 's0', readerOf(holder))
        expect(plan).toMatchObject({ ok: true, skipped: 0 })
        if (plan.ok !== true) {
            return
        }
        const lastSet = [...plan.writes].reverse().find((write) => write.op === 'set' && write.path !== 'desc')
        expect(lastSet).toMatchObject({ path: FIX, value: FOREIGN_ONE })
    })

    test('T8: a redo of a base op that expects absent does not overwrite a foreign value read through the slot', () => {
        const record = recordOf([], [setStep('u1', BASE, { had: false }, B(true))])
        const plan = planReplay(record, 'redo', readerOf({ lowLevelAccess: 1 }))
        expect(plan).toMatchObject({ ok: false, reason: 'precondition' })
    })
})

async function loadWithRestore(fields: Record<string, unknown>): Promise<RestorePoint | null> {
    const record = { ...recordOf([descStep()]), restore: { visitId: 'v', at: 1, fields } } as unknown as OwnerRecord
    const shared = new Map<string, string>()
    seedOwner(shared, record, 'w1')
    const loaded = await createMemoryStudioStore({ shared }).load(OWNER)
    return loaded.kind === 'ok' ? loaded.record.restore : null
}

const BASE_ENTRY = { before: { had: true, value: false }, last: { had: true, value: true } }
const FIX_ENTRY = { before: { had: true, value: true }, last: { had: 'foreign', value: 1 } }

describe('a stored restore point folds onto the slot key', () => {
    test('T9: a point keyed by the base path loads under the slot and restores through one op', async () => {
        const restore = await loadWithRestore({ lowLevelAccess: BASE_ENTRY })
        expect(restore).not.toBeNull()
        expect(Object.keys(restore?.fields ?? {})).toEqual([FIX])
        expect(restore?.fields[FIX]).toEqual(BASE_ENTRY)
        const plan = planRestorePoint(restore, readerOf({ lowLevelAccess: true }), new Set())
        expect(plan).toMatchObject({ ok: true })
        if (plan.ok !== true) {
            return
        }
        const slotOps = plan.writes.filter((write) => write.op === 'set')
        expect(slotOps).toHaveLength(1)
        expect(slotOps[0]).toMatchObject({ path: FIX, value: B(false) })
    })

    test('T11: a point with both keys loads with the slot entry only, in either key order', async () => {
        const baseFirst = await loadWithRestore({ lowLevelAccess: BASE_ENTRY, lowLevelAccessFix: FIX_ENTRY })
        const fixFirst = await loadWithRestore({ lowLevelAccessFix: FIX_ENTRY, lowLevelAccess: BASE_ENTRY })
        expect(baseFirst?.fields).toEqual({ [FIX]: FIX_ENTRY })
        expect(fixFirst?.fields).toEqual({ [FIX]: FIX_ENTRY })
    })

    test('T12 (compatibility guard): a slot entry whose live reading is foreign plans one op and reports nothing changed elsewhere', () => {
        const restore: RestorePoint = { visitId: 'v', at: 1, fields: { [FIX]: { before: B(true), last: FOREIGN_ONE } } }
        const plan = planRestorePoint(restore, readerOf({ lowLevelAccess: 1 }), new Set())
        expect(plan).toMatchObject({ ok: true, changedElsewhere: [] })
        if (plan.ok !== true) {
            return
        }
        const slotOps = plan.writes.filter((write) => write.op === 'set')
        expect(slotOps).toHaveLength(1)
        expect(slotOps[0]).toMatchObject({ path: FIX, value: B(true) })
    })
})

describe('a revert stores one value op per slot', () => {
    test('T14: a revert across base, alias and base steps applies, stores one slot op and replays both ways', () => {
        const record = recordOf([
            descStep(),
            setStep('s1', BASE, B(true), B(false)),
            setStep('s2', FIX, B(false), B(true)),
            setStep('s3', BASE, B(true), B(false)),
        ])
        const holder: Record<string, unknown> = { desc: 'b', lowLevelAccess: false }
        const plan = planRevert(record, 's0', readerOf(holder))
        expect(plan).toMatchObject({ ok: true, skipped: 0 })
        if (plan.ok !== true) {
            return
        }
        applyWrites(holder, plan.writes)
        expect(holder.lowLevelAccess).toBe(true)
        expect(sets(plan.ops)).toEqual([{ op: 'set', path: FIX, before: B(false), after: B(true) }])

        const revertStep: Step = { id: 'r', at: 2, label: plan.label, ops: plan.ops }
        const beforeRedo: Record<string, unknown> = { desc: 'b', lowLevelAccess: false }
        const redo = planReplay({ ...record, done: [], undone: [revertStep] }, 'redo', readerOf(beforeRedo))
        expect(redo).toMatchObject({ ok: true, skipped: 0 })
        if (redo.ok === true) {
            applyWrites(beforeRedo, redo.writes)
        }
        expect(beforeRedo.lowLevelAccess).toBe(true)

        const afterRevert: Record<string, unknown> = { desc: 'a', lowLevelAccess: true }
        const undo = planReplay({ ...record, done: [revertStep], undone: [] }, 'undo', readerOf(afterRevert))
        expect(undo).toMatchObject({ ok: true, skipped: 0 })
        if (undo.ok === true) {
            applyWrites(afterRevert, undo.writes)
        }
        expect(afterRevert.lowLevelAccess).toBe(false)
    })

    test('T14b: a revert that ends on a foreign reading stores its op on the slot path and the record reloads', async () => {
        const record = recordOf([descStep(), setStep('s1', BASE, B(false), B(true)), setStep('s2', FIX, B(true), FOREIGN_ONE)])
        const plan = planRevert(record, 's0', readerOf({ desc: 'b', lowLevelAccess: 1 }))
        expect(plan).toMatchObject({ ok: true, skipped: 0 })
        if (plan.ok !== true) {
            return
        }
        expect(sets(plan.ops)).toEqual([{ op: 'set', path: FIX, before: FOREIGN_ONE, after: B(false) }])
        const stored: OwnerRecord = { ...record, done: [...record.done, { id: 'r', at: 2, label: plan.label, ops: plan.ops }] }
        const shared = new Map<string, string>()
        seedOwner(shared, stored, 'w1')
        const loaded = await createMemoryStudioStore({ shared }).load(OWNER)
        expect(loaded.kind).toBe('ok')
        if (loaded.kind === 'ok') {
            expect(loaded.record.done.map((step) => step.id)).toContain('r')
        }
    })
})
