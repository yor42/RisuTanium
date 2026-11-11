import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Counting pass-through of the pure module: `full` = listFingerprintOf calls, `elem` = direct
// fingerprintElement calls, `units` = UTF-16 units over both (a list's elements for the full call),
// `mix` = direct mixElementHashes calls. The module's own internal calls are not counted.
const counts = vi.hoisted(() => ({ full: 0, elem: 0, units: 0, mix: 0 }))

vi.mock('../listFingerprint', async (importOriginal) => {
    const real = await importOriginal<typeof import('../listFingerprint')>()
    const unitsOf = (value: unknown) => (typeof value === 'string' ? value.length : 0)
    return {
        fingerprintElement: (value: unknown) => {
            counts.elem += 1
            counts.units += unitsOf(value)
            return real.fingerprintElement(value)
        },
        mixElementHashes: (hashes: readonly number[]) => {
            counts.mix += 1
            return real.mixElementHashes(hashes)
        },
        listFingerprintOf: (list: readonly unknown[]) => {
            counts.full += 1
            for (const value of list) {
                counts.units += unitsOf(value)
            }
            return real.listFingerprintOf(list)
        },
    }
})

import {
    REVERT_HASH_BUDGET_UNITS,
    applyReplayMove,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    planRestoreDeleted,
    planRestorePoint,
    planRevert,
    type LiveReader,
    type ModelState,
    type Op,
    type PlanResult,
    type WriteOp,
} from '../historyModel'
import { listFingerprintOf } from '../listFingerprint'

type Counted = readonly [full: number, elem: number, units: number, mix: number]

function counted(): Counted {
    return [counts.full, counts.elem, counts.units, counts.mix]
}

function resetCounts() {
    counts.full = 0
    counts.elem = 0
    counts.units = 0
    counts.mix = 0
}

let salt = 0
function fresh(length: number): string {
    salt += 1
    return `f${salt}:`.padEnd(length, 'y')
}

// A session over the pure model, as the service drives it: a revert's commit forwards the plan's hashes.
class Kit {
    list: string[]
    desc = 'd0'
    state: ModelState = createModelState(emptyRecord('character:c1', 0))
    n = 0
    readonly reader: LiveReader

    constructor(sizes: readonly number[]) {
        this.list = sizes.map((length, i) => `v${i}:`.padEnd(length, 'x'))
        this.reader = {
            field: (path) => (path === 'desc' ? { had: true, value: this.desc } : { had: false }),
            greetings: () => this.list,
            fmIndex: () => null,
        }
    }

    get record() {
        return this.state.record
    }

    private apply(writes: readonly WriteOp[]) {
        for (const write of writes) {
            if (write.op === 'set' && write.path === 'desc' && write.value.had && typeof write.value.value === 'string') {
                this.desc = write.value.value
            } else if (write.op === 'listSet') {
                this.list[write.index] = write.value
            } else if (write.op === 'listInsert') {
                this.list.splice(write.index, 0, write.value)
            } else if (write.op === 'listRemove') {
                this.list.splice(write.index, 1)
            }
        }
    }

    private commitEdit(label: Parameters<typeof commitStep>[1]['label'], ops: Op[], writes: WriteOp[]): string {
        const restoreWrites = deriveRestoreWrites(ops, [...this.list])
        this.apply(writes)
        this.n += 1
        const id = `page:${this.n}`
        this.state = commitStep(this.state, { id, at: this.n, visitId: 'v1', label, ops, restoreWrites, coalesceKey: null, replacesRestore: true })
        return id
    }

    editDesc(value: string): string {
        return this.commitEdit(
            { kind: 'field', field: 'desc' },
            [{ op: 'set', path: 'desc', before: { had: true, value: this.desc }, after: { had: true, value } }],
            [{ op: 'set', path: 'desc', value: { had: true, value } }],
        )
    }

    add(value: string) {
        const index = this.list.length
        this.commitEdit({ kind: 'greetingAdd' }, [{ op: 'listInsert', index, value }], [{ op: 'listInsert', index, value }])
    }

    edit(index: number, value: string) {
        const before = this.list[index]
        this.commitEdit({ kind: 'greetingEdit' }, [{ op: 'listSet', index, before, after: value }], [{ op: 'listSet', index, value }])
    }

    del(index: number) {
        const value = this.list[index]
        const deletedId = `del${this.n + 1}`
        this.commitEdit(
            { kind: 'greetingRemove' },
            [
                { op: 'listRemove', index, value, deletedId },
                { op: 'chatFm', chatId: null, before: { had: true, value: 0 }, after: { had: true, value: -1 } },
            ],
            [{ op: 'listRemove', index }],
        )
    }

    // The ops of a Studio greeting delete that names a chat; the reader has no chat, so on undo the
    // chat op fails while the list op applies.
    delNamed(index: number) {
        const value = this.list[index]
        const deletedId = `del${this.n + 1}`
        this.commitEdit(
            { kind: 'greetingRemove' },
            [
                { op: 'listRemove', index, value, deletedId },
                { op: 'chatFm', chatId: 'chatA', before: { had: true, value: index }, after: { had: true, value: -1 } },
            ],
            [{ op: 'listRemove', index }],
        )
    }

    replay(direction: 'undo' | 'redo'): PlanResult {
        const plan = planReplay(this.record, direction, this.reader)
        if (plan.ok) {
            this.apply(plan.writes)
            this.state = applyReplayMove(this.state, direction, plan, this.n, 'v1')
        }
        return plan
    }

    private commitPlan(plan: PlanResult): PlanResult {
        if (plan.ok) {
            this.apply(plan.writes)
            this.n += 1
            this.state = commitStep(this.state, {
                id: `page:${this.n}`,
                at: this.n,
                visitId: 'v1',
                label: plan.label,
                ops: plan.ops,
                restoreWrites: plan.restoreWrites,
                coalesceKey: null,
                replacesRestore: false,
                deletedRemove: plan.deletedRemove,
                liveListHash: plan.liveListHash,
                afterListHash: plan.afterListHash,
            })
        }
        return plan
    }

    revertTo(id: string, budgetUnits?: number): PlanResult {
        return this.commitPlan(planRevert(this.record, id, this.reader, budgetUnits))
    }

    restorePoint(): PlanResult {
        return this.commitPlan(planRestorePoint(this.record.restore, this.reader, new Set()))
    }

    restoreDeleted(id: string): PlanResult {
        return this.commitPlan(planRestoreDeleted(this.record, id, this.reader))
    }

    stripFingerprints() {
        const strip = (step: { id: string; at: number; label: Parameters<typeof commitStep>[1]['label']; ops: Op[] }) => ({ id: step.id, at: step.at, label: step.label, ops: step.ops })
        this.state = { record: { ...this.record, done: this.record.done.map(strip), undone: this.record.undone.map(strip) }, open: null }
    }
}

const uniform = (n: number, length = 50) => Array.from({ length: n }, () => length)
const half = (n: number) => Math.floor(n / 2)

type Shape = (kit: Kit, sizes: readonly number[]) => void

const shapes: Record<string, Shape> = {
    'RV-del': (kit, sizes) => {
        for (let i = 0; i < half(sizes.length); i++) kit.del(0)
    },
    'RV-mix': (kit, sizes) => {
        for (let i = 0; i < half(sizes.length); i++) {
            kit.del(0)
            kit.edit(0, fresh(50))
        }
    },
    'RV-edits': (kit, sizes) => {
        for (let i = 0; i < sizes.length; i++) kit.edit(i, fresh(50))
    },
    'RV-max': (kit, sizes) => {
        for (let c = 0; c < 9; c++) {
            for (let k = 0; k < 10; k++) kit.edit(1, fresh(sizes[1]))
            kit.del(0)
        }
    },
    B98a: (kit, sizes) => {
        kit.add(fresh(50))
        for (let k = 0; k < 98; k++) kit.edit(1, fresh(sizes[1]))
    },
    B98d: (kit, sizes) => {
        for (let k = 0; k < 98; k++) kit.edit(1, fresh(sizes[1]))
        kit.del(0)
    },
    ALT49: (kit, sizes) => {
        for (let c = 0; c < 49; c++) {
            kit.edit(1, fresh(sizes[1]))
            if (c % 2 === 0) kit.add(fresh(50))
            else kit.del(kit.list.length - 1)
        }
    },
    // Passes of "edit every slot, then delete slot 0 while more than two elements remain", to 99 steps.
    'RV-pp': (kit, sizes) => {
        let steps = 0
        while (steps < 99) {
            const length = kit.list.length
            for (let i = 0; i < length && steps < 99; i++) {
                kit.edit(i, fresh(i === 1 ? sizes[1] : 50))
                steps += 1
            }
            if (steps < 99 && kit.list.length > 2) {
                kit.del(0)
                steps += 1
            }
        }
    },
    'RV-rp3': (kit) => {
        for (let c = 0; c < 3; c++) {
            kit.del(0)
            kit.restorePoint()
        }
    },
}

// Builds the shape on an anchored session, then counts only the revert to the anchor.
function runRevert(sizes: readonly number[], shape: string, budget?: number, options: { old?: boolean } = {}) {
    const kit = new Kit(sizes)
    const anchor = kit.editDesc('E')
    const anchorList = [...kit.list]
    shapes[shape](kit, sizes)
    if (options.old) kit.stripFingerprints()
    resetCounts()
    const result = kit.revertTo(anchor, budget)
    return { counts: counted(), result, reachedAnchor: JSON.stringify(kit.list) === JSON.stringify(anchorList), kit }
}

beforeEach(() => {
    resetCounts()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('T64 non-revert hashing cost', () => {
    const twoList = () => {
        const kit = new Kit(uniform(2))
        kit.editDesc('E')
        return kit
    }

    test('typing, a field edit and an undo of typing hash nothing', () => {
        const kit = twoList()
        resetCounts()
        kit.editDesc('F')
        kit.edit(0, fresh(50))
        expect(counted()).toEqual([0, 0, 0, 0])
        resetCounts()
        kit.replay('undo')
        expect(counted()).toEqual([0, 0, 0, 0])
    })

    test('T64L1 a delete hashes one element pass; its undo and redo hash the live list once and keep the stored fingerprint', () => {
        const kit = twoList()
        resetCounts()
        kit.del(1)
        expect(counted()).toEqual([0, 2, 100, 2])
        const stored = kit.record.done[kit.record.done.length - 1].listFingerprint
        resetCounts()
        kit.replay('undo')
        expect(counted()).toEqual([1, 0, 50, 0])
        expect(kit.record.undone[kit.record.undone.length - 1].listFingerprint).toStrictEqual(stored)
        resetCounts()
        kit.replay('redo')
        expect(counted()).toEqual([1, 0, 100, 0])
        expect(kit.record.done[kit.record.done.length - 1].listFingerprint).toStrictEqual(stored)

        const drift = twoList()
        drift.del(1)
        drift.list.unshift(fresh(50))
        resetCounts()
        expect(drift.replay('undo').ok).toBe(false)
        expect(counted()).toEqual([1, 0, 100, 0])
    })

    test('an old-record undo of a delete hashes two lists', () => {
        const kit = twoList()
        kit.del(1)
        kit.stripFingerprints()
        resetCounts()
        expect(kit.replay('undo').ok).toBe(true)
        expect(counted()).toEqual([2, 0, 150, 0])
    })

    test('T64L3 Restore deleted, an add and a list-changing restore point hash one element pass plus the value put back', () => {
        const kit = twoList()
        kit.del(1)
        const id = kit.record.deleted[0].id
        resetCounts()
        kit.restoreDeleted(id)
        expect(counted()).toEqual([0, 2, 100, 2])
        resetCounts()
        kit.add(fresh(50))
        expect(counted()).toEqual([0, 3, 150, 2])
        kit.del(2)
        kit.del(1)
        resetCounts()
        expect(kit.restorePoint().ok).toBe(true)
        expect(counted()).toEqual([0, 2, 100, 2])
        expect(kit.list).toHaveLength(2)
    })

    test('T64L5 an undo whose chat op fails but whose list ops all apply still takes the stored fingerprint', () => {
        const kit = twoList()
        kit.delNamed(1)
        const stored = kit.record.done[kit.record.done.length - 1].listFingerprint
        resetCounts()
        const plan = kit.replay('undo')
        expect(plan.ok && plan.skipped).toBe(1)
        expect(counted()).toEqual([1, 0, 50, 0])
        expect(kit.record.undone[kit.record.undone.length - 1].listFingerprint).toStrictEqual(stored)
    })

    // An expected-side undo applies every list op, even for a delete whose Deleted entry aged out, so
    // it takes the stored other-side fingerprint and hashes the live list once.
    test('T64L6 an expected-side undo of an aged-out delete applies its list op and takes the stored fingerprint', () => {
        const kit = new Kit(uniform(56, 10))
        kit.editDesc('E')
        kit.del(5)
        const deleteId = kit.record.done[kit.record.done.length - 1].id
        kit.restoreDeleted(kit.record.deleted[0].id)
        kit.del(0)
        expect(kit.revertTo(deleteId).ok).toBe(true)
        // Fifty more deletes push the re-listed item out of the 50-entry list; undoing them keeps it out.
        for (let i = 0; i < 50; i++) kit.del(0)
        for (let i = 0; i < 50; i++) expect(kit.replay('undo').ok).toBe(true)
        const live = [...kit.list]
        const source = kit.record.done[kit.record.done.length - 1].listFingerprint
        resetCounts()
        const plan = kit.replay('undo')
        expect(plan.ok && plan.skipped).toBe(0)
        expect(plan.ok && plan.afterListHash).toBe(source?.before)
        expect(counted()).toEqual([1, 0, unitsOfList(live), 0])
        const moved = kit.record.undone[kit.record.undone.length - 1].listFingerprint
        expect(moved).toStrictEqual({ before: listFingerprintOf(kit.list), after: listFingerprintOf(live) })
    })
})

describe('T64 revert hashing cost at the default budget (full, elem, units, mix)', () => {
    const rows: Array<[string, number, Counted]> = [
        ['RV-del', 20, [0, 20, 1000, 12]],
        ['RV-del', 10, [0, 10, 500, 7]],
        ['RV-mix', 20, [0, 21, 1050, 12]],
        ['RV-mix', 10, [0, 11, 550, 7]],
        ['RV-edits', 20, [0, 0, 0, 0]],
        ['RV-edits', 10, [0, 0, 0, 0]],
        ['RV-max', 20, [0, 29, 1450, 11]],
        ['RV-max', 10, [0, 19, 950, 11]],
        ['B98a', 20, [0, 22, 1100, 3]],
        ['B98a', 10, [0, 12, 600, 3]],
        ['B98d', 20, [0, 21, 1050, 3]],
        ['B98d', 10, [0, 11, 550, 3]],
        ['ALT49', 20, [0, 94, 4700, 51]],
        ['ALT49', 10, [0, 84, 4200, 51]],
        ['RV-pp', 20, [0, 109, 5450, 7]],
        ['RV-pp', 10, [0, 56, 2800, 10]],
        ['RV-rp3', 20, [0, 80, 4000, 8]],
        ['RV-rp3', 10, [0, 40, 2000, 8]],
    ]
    test.each(rows)('%s n=%i', (shape, n, expected) => {
        const run = runRevert(uniform(n), shape)
        expect(run.counts).toEqual(expected)
        expect(run.result.ok).toBe(true)
        expect(run.reachedAnchor).toBe(true)
    })

    const oldRows: Array<[string, number, Counted]> = [
        ['RV-del', 20, [0, 20, 1000, 2]],
        ['RV-del', 10, [0, 10, 500, 2]],
        ['RV-max', 20, [0, 21, 1050, 2]],
        ['RV-max', 10, [0, 11, 550, 2]],
        ['RV-rp3', 20, [0, 40, 2000, 2]],
        ['RV-rp3', 10, [0, 20, 1000, 2]],
    ]
    test.each(oldRows)('old record %s n=%i', (shape, n, expected) => {
        const run = runRevert(uniform(n), shape, undefined, { old: true })
        expect(run.counts).toEqual(expected)
        expect(run.reachedAnchor).toBe(true)
    })

    test('RV-lostK2: a delete lands and two are lost; the revert stops at the first step that does not fit and is refused', () => {
        for (const [n, expected] of [[20, [0, 19, 950, 2]], [10, [0, 9, 450, 2]]] as Array<[number, Counted]>) {
            const kit = new Kit(uniform(n))
            const anchor = kit.editDesc('E')
            kit.del(0)
            const snapshot = [...kit.list]
            kit.del(0)
            kit.del(0)
            kit.list.splice(0, kit.list.length, ...snapshot)
            resetCounts()
            const result = kit.revertTo(anchor)
            expect(counted()).toEqual(expected)
            expect(result).toEqual({ ok: false, reason: 'precondition' })
            expect(kit.list).toEqual(snapshot)
        }
    })
})

describe('T64b suspension past the budget', () => {
    // Counts, then the skipped list ops and the final list length: a suspended fingerprinted step
    // skips its list ops, so the revert stops at the suspension point and reaches the anchor only
    // when nothing was skipped.
    const rows: Array<[string, number, number, Counted, number, number]> = [
        ['RV-max', 10, 100, [0, 5, 250, 4], 77, 3],
        ['ALT49', 10, 100, [0, 14, 700, 4], 47, 11],
        ['RV-del', 10, 100, [0, 8, 400, 5], 2, 8],
        ['RV-pp', 10, 100, [0, 7, 350, 3], 56, 3],
        ['B98a', 10, 100, [0, 12, 600, 3], 0, 10],
        ['RV-max', 20, 100, [0, 15, 750, 4], 77, 13],
        ['ALT49', 20, 100, [0, 24, 1200, 4], 47, 21],
        ['RV-del', 20, 100, [0, 13, 650, 5], 7, 13],
        ['RV-pp', 20, 100, [0, 19, 950, 2], 95, 15],
        ['B98a', 20, 100, [0, 22, 1100, 3], 0, 20],
        ['RV-max', 10, 0, [0, 3, 150, 3], 88, 2],
        ['RV-max', 20, 0, [0, 13, 650, 3], 88, 12],
        ['RV-del', 10, 0, [0, 6, 300, 3], 4, 6],
        ['RV-del', 20, 0, [0, 11, 550, 3], 9, 11],
    ]
    test.each(rows)('%s n=%i budget %i', (shape, n, budget, expected, skipped, length) => {
        const run = runRevert(uniform(n), shape, budget)
        expect(run.counts).toEqual(expected)
        expect(run.result.ok && run.result.skipped).toBe(skipped)
        expect(run.kit.list).toHaveLength(length)
        expect(run.reachedAnchor).toBe(skipped === 0)
    })
})

describe('T64e a dominant element at the default budget', () => {
    const dominant = (length: number) => {
        const sizes = uniform(10)
        sizes[1] = length
        return sizes
    }
    const rows: Array<[string, number, Counted]> = [
        ['RV-max', 200_000, [0, 7, 800_150, 5]],
        ['ALT49', 200_000, [0, 15, 800_550, 5]],
        ['RV-del', 200_000, [0, 10, 200_450, 7]],
    ]
    test.each(rows)('%s with a %i-unit slot 1', (shape, length, expected) => {
        const sizes = dominant(length)
        const run = runRevert(sizes, shape)
        expect(run.counts).toEqual(expected)
        // The hashing bound: the live list before, the budget, and the list after.
        const liveBefore = run.kit.record.done[run.kit.record.done.length - 1].listFingerprint
        expect(liveBefore).toBeDefined()
        expect(run.counts[2]).toBeLessThanOrEqual(sizes.reduce((a, b) => a + b, 0) + REVERT_HASH_BUDGET_UNITS + sizes.reduce((a, b) => a + b, 0))
    })

    test('with no budget the same shapes hash every fill', () => {
        expect(runRevert(dominant(200_000), 'RV-max', Infinity).counts).toEqual([0, 19, 2_000_450, 11])
        expect(runRevert(dominant(200_000), 'ALT49', Infinity).counts).toEqual([0, 84, 10_001_700, 51])
    })

    test('the budget is the MC-1239 figure', () => {
        expect(REVERT_HASH_BUDGET_UNITS).toBe(500_000)
    })
})

function mulberry(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const unitsOfList = (list: readonly string[]) => list.reduce((sum, value) => sum + value.length, 0)

const LIST_OP_KINDS = new Set(['listSet', 'listInsert', 'listRemove'])

// The suspension oracle. The counting mock records the mixes of the revert: one for the live list,
// one for the final fill of an applied plan and one per decision taken. A revert suspended when it
// took fewer decisions than the same revert without a budget; a stop on a step that does not fit
// ends the decisions in both runs, so it is not a suspension. A suspended revert must give the plan
// of the same record in which every undecided fingerprinted step carries a fingerprint no list
// equals, planned without a budget. That reference ends its list ops hard, while a suspension is
// soft for steps without a fingerprint; the two differ only when such a step with a list op lies
// below the cut, and those reverts are counted, not compared.
function suspensionOracleHolds(kit: Kit, targetId: string, budget: number): { holds: boolean; suspended: boolean; checked: boolean } {
    const record = kit.record
    const index = record.done.findIndex((step) => step.id === targetId)
    resetCounts()
    const actual = planRevert(record, targetId, kit.reader, budget)
    const taken = counts.mix - (actual.ok ? 2 : 1)
    resetCounts()
    const unlimited = planRevert(record, targetId, kit.reader, Infinity)
    const takenAll = counts.mix - (unlimited.ok ? 2 : 1)
    if (!actual.ok || actual.liveListHash === undefined || taken >= takenAll) {
        return { holds: true, suspended: false, checked: false }
    }
    const fingerprinted = record.done.slice(index + 1).filter((step) => step.listFingerprint !== undefined).length
    let kept = 0
    let cut = -1
    const done = record.done.map((step, i) => {
        if (i <= index || step.listFingerprint === undefined) return step
        kept += 1
        // The newest `taken` fingerprinted steps were decided by the two-way check.
        if (fingerprinted - kept < taken) return step
        cut = i
        return { id: step.id, at: step.at, label: step.label, ops: step.ops, listFingerprint: { before: Number.NaN, after: Number.NaN } }
    })
    let softOnly = false
    for (let i = index + 1; i < cut; i++) {
        const step = record.done[i]
        if (step.listFingerprint === undefined && step.ops.some((op) => LIST_OP_KINDS.has(op.op))) softOnly = true
    }
    if (softOnly) {
        return { holds: true, suspended: true, checked: false }
    }
    const reference = planRevert({ ...record, done }, targetId, kit.reader, Infinity)
    return { holds: samePlan(reference, actual), suspended: true, checked: true }
}

// Two ops or writes are equal when every own property is: strings by identity of value (no
// serialisation of a large element), small nested values field by field.
function sameRecord(a: object, b: object): boolean {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    for (const key of keys) {
        const x = left[key]
        const y = right[key]
        if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) {
            if (!sameRecord(x, y)) return false
        } else if (x !== y) {
            return false
        }
    }
    return true
}

// Plans compared without serialising the whole plan: op count and kind, then each op, each write,
// the skipped count, the consumed ids and the two hashes.
function samePlan(a: PlanResult, b: PlanResult): boolean {
    if (a.ok === false) return b.ok === false && a.reason === b.reason
    if (b.ok === false) return false
    if (a.ops.length !== b.ops.length || a.writes.length !== b.writes.length) return false
    for (let i = 0; i < a.ops.length; i++) {
        if (a.ops[i].op !== b.ops[i].op || !sameRecord(a.ops[i], b.ops[i])) return false
    }
    for (let i = 0; i < a.writes.length; i++) {
        if (!sameRecord(a.writes[i], b.writes[i])) return false
    }
    return (
        a.skipped === b.skipped &&
        a.deletedRemove.length === b.deletedRemove.length &&
        a.deletedRemove.every((id, i) => id === b.deletedRemove[i]) &&
        a.liveListHash === b.liveListHash &&
        a.afterListHash === b.afterListHash
    )
}

// Seeded histories: the cost bound, the stored values and the suspension oracle hold at every budget.
interface GuardOptions {
    // A dominant slot-1 length range: every history gets one, and 60% of its edits go to it.
    dominant: [number, number] | null
    // Half the histories get a dominant slot of 3,000-6,000 units (the base generator).
    halfDominant: boolean
}

function generatedGuard(seeds: number, budgets: number[], options: GuardOptions) {
    const failures: string[] = []
    let reverts = 0
    let suspendingReverts = 0
    let checkedSuspensions = 0
    for (const budget of budgets) {
        for (let seed = 1; seed <= seeds; seed++) {
            const next = mulberry(seed)
            // Heavy-tailed element sizes: 80% 1-60, 15% 200-1,000, 5% 1,000-3,000.
            const size = () => {
                const roll = next()
                return roll < 0.8 ? 1 + Math.floor(next() * 60) : roll < 0.95 ? 200 + Math.floor(next() * 800) : 1000 + Math.floor(next() * 2000)
            }
            let domLength = 0
            if (options.dominant) {
                domLength = options.dominant[0] + Math.floor(next() * (options.dominant[1] - options.dominant[0]))
            } else if (options.halfDominant && next() < 0.5) {
                domLength = 3000 + Math.floor(next() * 3000)
            }
            const sizes = Array.from({ length: 2 + Math.floor(next() * 5) }, size)
            if (domLength > 0) sizes[1] = domLength
            const kit = new Kit(sizes)
            kit.editDesc('E')
            const lostFrom: string[][] = []
            const actions = 5 + Math.floor(next() * 41)
            for (let a = 0; a < actions; a++) {
                const pick = next()
                const len = kit.list.length
                const slot = domLength > 0 && len > 1 && next() < 0.6 ? 1 : Math.floor(next() * len)
                if (pick < 0.12) kit.add(fresh(size()))
                else if (pick < 0.24 && len > 1) kit.del(Math.floor(next() * len))
                else if (pick < 0.3 && kit.record.deleted.length > 0) kit.restoreDeleted(kit.record.deleted[kit.record.deleted.length - 1].id)
                else if (pick < 0.52 && len > 0) kit.edit(slot, fresh(domLength > 0 && slot === 1 ? domLength : size()))
                else if (pick < 0.58) kit.replay('undo')
                else if (pick < 0.64) kit.replay('redo')
                else if (pick < 0.68) kit.restorePoint()
                else if (pick < 0.73) kit.list.unshift(fresh(size()))
                else if (pick < 0.77) lostFrom.push([...kit.list])
                else if (pick < 0.81 && lostFrom.length > 0) kit.list.splice(0, kit.list.length, ...lostFrom.pop()!)
                else if (kit.record.done.length > 2) {
                    const target = kit.record.done[Math.floor(next() * (kit.record.done.length - 1))].id
                    const before = [...kit.list]
                    const oracle = suspensionOracleHolds(kit, target, budget)
                    resetCounts()
                    const result = kit.revertTo(target, budget)
                    const spent = counts.units
                    if (result.ok) {
                        reverts += 1
                        if (spent > unitsOfList(before) + budget + unitsOfList(kit.list)) failures.push(`bound: seed ${seed} budget ${budget}`)
                        const top = kit.record.done[kit.record.done.length - 1]
                        if (top.listFingerprint) {
                            const exact = { before: listFingerprintOf(before), after: listFingerprintOf(kit.list) }
                            if (JSON.stringify(top.listFingerprint) !== JSON.stringify(exact)) failures.push(`stored value: seed ${seed} budget ${budget}`)
                        }
                        if (!oracle.holds) failures.push(`oracle: seed ${seed} budget ${budget}`)
                        if (oracle.suspended) suspendingReverts += 1
                        if (oracle.checked) checkedSuspensions += 1
                    }
                }
            }
        }
    }
    return { reverts, suspendingReverts, checkedSuspensions, failures }
}

describe('T64f bound, stored values and suspension oracle for any element-size distribution', () => {
    test('1,500 generated histories at budgets 500,000, 2,000, 300 and 0', () => {
        const { reverts, suspendingReverts, checkedSuspensions, failures } = generatedGuard(1500, [REVERT_HASH_BUDGET_UNITS, 2000, 300, 0], { dominant: null, halfDominant: true })
        expect(failures).toEqual([])
        expect(reverts).toBeGreaterThan(3000)
        // The lower budgets suspend; the default budget does not for this generator.
        expect(suspendingReverts).toBeGreaterThan(0)
        // The comparison is not vacuous: most suspensions are compared with the reference.
        expect(checkedSuspensions).toBeGreaterThan(1000)
    })

    test('T64f-dom 300 histories with a 150,000-300,000-unit dominant slot at the default budget', () => {
        const { reverts, suspendingReverts, failures } = generatedGuard(300, [REVERT_HASH_BUDGET_UNITS], { dominant: [150_000, 300_000], halfDominant: false })
        expect(failures).toEqual([])
        expect(reverts).toBeGreaterThan(100)
        expect(suspendingReverts).toBeGreaterThan(0)
        const unbudgeted = generatedGuard(300, [Infinity], { dominant: [150_000, 300_000], halfDominant: false })
        expect(unbudgeted.failures).toEqual([])
        expect(unbudgeted.suspendingReverts).toBe(0)
    }, 300_000)
})

// The hashing a revert does for a size vector and a shape, for the device check's hashing share:
// units hashed, the tier's units, and the decisions taken and suspended at the default budget.
function hashingShare(sizes: readonly number[], shape: string, budget = REVERT_HASH_BUDGET_UNITS) {
    const kit = new Kit(sizes)
    const anchor = kit.editDesc('E')
    shapes[shape](kit, sizes)
    const index = kit.record.done.findIndex((step) => step.id === anchor)
    const decisions = kit.record.done.slice(index + 1).filter((step) => step.listFingerprint !== undefined).length
    resetCounts()
    const plan = planRevert(kit.record, anchor, kit.reader, budget)
    const taken = plan.ok && plan.liveListHash !== undefined ? counts.mix - 2 : 0
    const tierUnits = sizes.reduce((sum, length) => sum + length, 0)
    return { units: counts.units, tierUnits, multiplier: counts.units / tierUnits, decisions, taken, suspended: decisions - taken }
}

describe('T64d diagnostic: hashing share for a size vector and a shape', () => {
    // Tier C of the device check: 20 elements, 1,111,490 units, slot 1 at 250,000.
    const tierC = [...uniform(20, 45_342)]
    tierC[19] = 45_334
    tierC[1] = 250_000

    test('tier C sizes add up and the shapes stay inside the units bound', () => {
        expect(tierC.reduce((sum, length) => sum + length, 0)).toBe(1_111_490)
        for (const shape of ['RV-max', 'ALT49', 'RV-del']) {
            const share = hashingShare(tierC, shape)
            console.info(`T64d tier C ${shape}: ${JSON.stringify(share)}`)
            expect(share.units).toBeLessThanOrEqual(2 * share.tierUnits + REVERT_HASH_BUDGET_UNITS)
            expect(share.taken + share.suspended).toBe(share.decisions)
        }
    })

    test('a uniform RV-del hashes the list once and suspends nothing', () => {
        const share = hashingShare(uniform(20), 'RV-del')
        expect(share).toMatchObject({ units: 1000, tierUnits: 1000, decisions: 10, taken: 10, suspended: 0 })
    })
})

describe('T64d diagnostic: stored values stay exact whatever the budget', () => {
    test('the committed revert fingerprint equals the full hashes at every budget', () => {
        for (const budget of [undefined, 100, 0, Infinity]) {
            const sizes = uniform(10)
            sizes[1] = 3000
            const kit = new Kit(sizes)
            const anchor = kit.editDesc('E')
            shapes['RV-max'](kit, sizes)
            const before = [...kit.list]
            expect(kit.revertTo(anchor, budget).ok).toBe(true)
            const top = kit.record.done[kit.record.done.length - 1]
            expect(top.listFingerprint).toStrictEqual({ before: listFingerprintOf(before), after: listFingerprintOf(kit.list) })
        }
    })
})

// Every fingerprint a step stores or a plan hands on equals the full hash of the list it names.
describe('T64v stored and derived fingerprints equal the full hashes', () => {
    test('generated histories with deletes past the deleted-list cap, old records and outside edits', () => {
        const failures: string[] = []
        const seen = { committed: 0, revertCommitted: 0, kept: 0, shortcut: 0, partialExpected: 0, noneSide: 0, planLive: 0 }
        const fp = (step: { listFingerprint?: { before: number; after: number } } | undefined) => step?.listFingerprint
        for (let seed = 1; seed <= 200; seed++) {
            const next = mulberry(seed)
            const size = () => (next() < 0.85 ? Math.floor(next() * 40) : 200 + Math.floor(next() * 800))
            const sizes = Array.from({ length: 2 + Math.floor(next() * (seed % 4 === 0 ? 70 : 8)) }, size)
            const kit = new Kit(sizes)
            kit.editDesc('E')
            const actions = 40 + Math.floor(next() * 60)
            for (let a = 0; a < actions; a++) {
                const pick = next()
                const len = kit.list.length
                const before = [...kit.list]
                const doneTop = kit.record.done[kit.record.done.length - 1]
                const undoneTop = kit.record.undone[kit.record.undone.length - 1]
                let plan: PlanResult | null = null
                let kind: 'commit' | 'undo' | 'redo' | 'none' = 'commit'
                if (pick < 0.1) kit.add(next() < 0.1 ? '' : fresh(size()))
                else if (pick < 0.3 && len > 1) {
                    const index = Math.floor(next() * len)
                    if (next() < 0.3) kit.delNamed(index)
                    else kit.del(index)
                } else if (pick < 0.35 && kit.record.deleted.length > 0) plan = kit.restoreDeleted(kit.record.deleted[Math.floor(next() * kit.record.deleted.length)].id)
                else if (pick < 0.47 && len > 0) kit.edit(Math.floor(next() * len), fresh(size()))
                else if (pick < 0.62) {
                    kind = 'undo'
                    plan = kit.replay('undo')
                } else if (pick < 0.72) {
                    kind = 'redo'
                    plan = kit.replay('redo')
                } else if (pick < 0.75) plan = kit.restorePoint()
                else if (pick < 0.78) {
                    kind = 'none'
                    kit.list.splice(Math.floor(next() * (len + 1)), 0, fresh(size()))
                } else if (pick < 0.8) {
                    kind = 'none'
                    kit.stripFingerprints()
                } else if (pick < 0.83) {
                    kind = 'none'
                    kit.editDesc(fresh(5))
                } else if (pick < 0.88 && kit.record.done.length > 2) {
                    plan = kit.revertTo(kit.record.done[Math.floor(next() * (kit.record.done.length - 1))].id, next() < 0.3 ? 0 : undefined)
                } else {
                    kind = 'none'
                }
                const exact = { before: listFingerprintOf(before), after: listFingerprintOf(kit.list) }
                if (plan && plan.ok) {
                    if (plan.liveListHash !== undefined) {
                        seen.planLive += 1
                        if (plan.liveListHash !== exact.before) failures.push(`plan live: seed ${seed} action ${a}`)
                    }
                    if (plan.afterListHash !== undefined && plan.afterListHash !== exact.after) failures.push(`plan after: seed ${seed} action ${a}`)
                }
                if (kind === 'commit') {
                    const top = kit.record.done[kit.record.done.length - 1]
                    if (top && top !== doneTop && fp(top)) {
                        seen.committed += 1
                        if (top.label.kind === 'revert') seen.revertCommitted += 1
                        if (JSON.stringify(fp(top)) !== JSON.stringify(exact)) failures.push(`commit: seed ${seed} action ${a} ${top.label.kind}`)
                    }
                } else if ((kind === 'undo' || kind === 'redo') && plan && plan.ok) {
                    const moved = kind === 'undo' ? kit.record.undone[kit.record.undone.length - 1] : kit.record.done[kit.record.done.length - 1]
                    const source = kind === 'undo' ? doneTop : undoneTop
                    const swapped = kind === 'undo' ? { before: exact.after, after: exact.before } : exact
                    if (fp(moved)) {
                        if (JSON.stringify(fp(moved)) !== JSON.stringify(swapped)) failures.push(`moved: seed ${seed} action ${a} ${kind}`)
                        if (JSON.stringify(fp(moved)) === JSON.stringify(fp(source))) seen.kept += 1
                        if (plan.afterListHash !== undefined) {
                            seen.shortcut += 1
                            if (JSON.stringify(fp(moved)) !== JSON.stringify(fp(source))) failures.push(`kept: seed ${seed} action ${a}`)
                        } else if (plan.liveListHash !== undefined) {
                            seen.partialExpected += 1
                        } else {
                            seen.noneSide += 1
                        }
                    }
                }
            }
        }
        console.info(`T64v counters: ${JSON.stringify(seen)}`)
        expect(failures).toEqual([])
        expect(seen.committed).toBeGreaterThan(1000)
        expect(seen.revertCommitted).toBeGreaterThan(50)
        expect(seen.kept).toBeGreaterThan(200)
        expect(seen.shortcut).toBeGreaterThan(200)
        expect(seen.noneSide).toBeGreaterThan(10)
        expect(seen.planLive).toBeGreaterThan(200)
    }, 120_000)
})
