// Lockstep of the pure model with and without an element-hash cache.
import { describe, expect, test } from 'vitest'
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
    type StepLabel,
    type WriteOp,
} from '../historyModel'
import { createElementHashCache } from '../elementHashCache'
import type { ListElementHash } from '../listFingerprint'

function rng(seed: number): () => number {
    let s = seed >>> 0 || 1
    return () => {
        s ^= s << 13
        s >>>= 0
        s ^= s >>> 17
        s ^= s << 5
        s >>>= 0
        return s / 4294967296
    }
}

class Kit {
    list: string[]
    desc = 'd0'
    state: ModelState = createModelState(emptyRecord('character:c1', 0))
    n = 0
    readonly reader: LiveReader

    constructor(
        start: readonly string[],
        readonly elementHash: ListElementHash | undefined,
        readonly budget: number,
    ) {
        this.list = [...start]
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

    commitEdit(label: StepLabel, ops: Op[], writes: WriteOp[]) {
        const restoreWrites = deriveRestoreWrites(ops, [...this.list])
        this.apply(writes)
        this.n += 1
        this.state = commitStep(this.state, { id: `page:${this.n}`, at: this.n, visitId: 'v1', label, ops, restoreWrites, coalesceKey: null, replacesRestore: true }, this.elementHash)
        return 'committed'
    }

    replay(direction: 'undo' | 'redo'): PlanResult {
        const plan = planReplay(this.record, direction, this.reader, this.elementHash)
        if (plan.ok) {
            this.apply(plan.writes)
            this.n += 1
            this.state = applyReplayMove(this.state, direction, plan, this.n, 'v1', this.elementHash)
        }
        return plan
    }

    commitPlan(plan: PlanResult): PlanResult {
        if (plan.ok) {
            this.apply(plan.writes)
            this.n += 1
            this.state = commitStep(
                this.state,
                {
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
                },
                this.elementHash,
            )
        }
        return plan
    }
}

type Action = (kit: Kit) => unknown

function textMaker(next: () => number) {
    let salt = 0
    const bases: string[] = []
    return (): string => {
        salt += 1
        const pick = next()
        // Equal-length near-equal variants of an earlier text: same length, one unit differs.
        if (pick < 0.3 && bases.length > 0) {
            const base = bases[Math.floor(next() * bases.length)]
            const at = next() < 0.5 ? base.length - 1 : Math.floor(next() * base.length)
            return base.slice(0, at) + String.fromCharCode(0xac00 + (salt % 11172)) + base.slice(at + 1)
        }
        // A duplicate of an earlier text, built as a separate string.
        if (pick < 0.4 && bases.length > 0) {
            return bases[Math.floor(next() * bases.length)].split('').join('')
        }
        const length = pick < 0.43 ? 16_380 + Math.floor(next() * 8) : pick < 0.5 ? 0 : 1 + Math.floor(next() * 60)
        const text = `t${salt}:`.padEnd(Math.max(length, 1), String.fromCharCode(0xac00 + (salt % 50))).slice(0, length)
        bases.push(text)
        return text
    }
}

function runLockstep(seed: number, steps: number) {
    const next = rng(seed)
    const text = textMaker(next)
    const budget = [REVERT_HASH_BUDGET_UNITS, 2_000, 300, 0][seed % 4]
    const start = Array.from({ length: 2 + Math.floor(next() * 8) }, () => text())
    const shared = createElementHashCache()
    const tiny = createElementHashCache({ maxUnits: 64, maxEntries: 3, maxEntryUnits: 40 })
    // Outside any pass, and a list-size rule that never applies: refused stores.
    const stingy = createElementHashCache({ maxUnits: 200, maxEntries: 6, maxEntryUnits: 120 })
    // One card at a time: each pass names one of three scopes at random, so the cache empties often.
    const scoped = createElementHashCache({ maxUnits: 200, maxEntries: 6, maxEntryUnits: 120 })
    const scopeNext = rng(seed + 1_000)
    const kits = [
        new Kit(start, undefined, budget),
        new Kit(start, (list) => shared.forList(list, 'c'), budget),
        new Kit(start, (list) => tiny.forList(list, 'c'), budget),
        new Kit(start, (list) => createElementHashCache().forList(list, 'c'), budget),
        new Kit(start, () => stingy.hash, budget),
        new Kit(start, (list) => scoped.forList(list, `c${Math.floor(scopeNext() * 3)}`), budget),
    ]
    const problems: string[] = []
    for (let i = 0; i < steps; i++) {
        const ref = kits[0]
        const pick = next()
        const len = ref.list.length
        let action: Action
        if (pick < 0.12) {
            const value = text()
            const index = Math.floor(next() * (len + 1))
            action = (k) => k.commitEdit({ kind: 'greetingAdd' }, [{ op: 'listInsert', index, value }], [{ op: 'listInsert', index, value }])
        } else if (pick < 0.24 && len > 0) {
            const index = Math.floor(next() * len)
            action = (k) => {
                const deletedId = `del${k.n + 1}`
                return k.commitEdit(
                    { kind: 'greetingRemove' },
                    [
                        { op: 'listRemove', index, value: k.list[index], deletedId },
                        { op: 'chatFm', chatId: null, before: { had: true, value: 0 }, after: { had: true, value: -1 } },
                    ],
                    [{ op: 'listRemove', index }],
                )
            }
        } else if (pick < 0.34 && len > 0) {
            const index = Math.floor(next() * len)
            const value = text()
            action = (k) => k.commitEdit({ kind: 'greetingEdit' }, [{ op: 'listSet', index, before: k.list[index], after: value }], [{ op: 'listSet', index, value }])
        } else if (pick < 0.38) {
            const value = `d${i}`
            action = (k) => k.commitEdit({ kind: 'field', field: 'desc' }, [{ op: 'set', path: 'desc', before: { had: true, value: k.desc }, after: { had: true, value } }], [{ op: 'set', path: 'desc', value: { had: true, value } }])
        } else if (pick < 0.52) {
            action = (k) => k.replay('undo')
        } else if (pick < 0.6) {
            action = (k) => k.replay('redo')
        } else if (pick < 0.7 && ref.record.done.length > 0) {
            const target = ref.record.done[Math.floor(next() * ref.record.done.length)].id
            action = (k) => k.commitPlan(planRevert(k.record, target, k.reader, k.budget, k.elementHash))
        } else if (pick < 0.76 && ref.record.deleted.length > 0) {
            const id = ref.record.deleted[Math.floor(next() * ref.record.deleted.length)].id
            action = (k) => k.commitPlan(planRestoreDeleted(k.record, id, k.reader))
        } else if (pick < 0.8) {
            action = (k) => k.commitPlan(planRestorePoint(k.record.restore, k.reader, new Set()))
        } else if (pick < 0.92) {
            // Outside edit: the live list changes without a step (a lost save or another writer).
            const kind = next()
            const index = Math.floor(next() * Math.max(len, 1))
            const value = text()
            action = (k) => {
                if (kind < 0.4 && k.list.length > 0) k.list[index % k.list.length] = value
                else if (kind < 0.7) k.list.splice(Math.min(index, k.list.length), 0, value)
                else if (k.list.length > 0) k.list.splice(index % k.list.length, 1)
                return 'outside'
            }
        } else {
            // A record written before S1: no step carries a fingerprint.
            action = (k) => {
                const strip = <T extends { listFingerprint?: unknown }>(step: T) => {
                    const { listFingerprint: _drop, ...rest } = step
                    return rest
                }
                k.state = { record: { ...k.record, done: k.record.done.map(strip), undone: k.record.undone.map(strip) }, open: null }
                return 'stripped'
            }
        }
        const results = kits.map((k) => action(k))
        for (let j = 1; j < kits.length; j++) {
            try {
                expect(results[j]).toStrictEqual(results[0])
                expect(kits[j].state).toStrictEqual(kits[0].state)
                expect(kits[j].list).toStrictEqual(kits[0].list)
            } catch {
                problems.push(`seed ${seed} step ${i} kit ${j}`)
            }
        }
        if (problems.length > 0) break
    }
    const stats = { shared: shared.stats(), tiny: tiny.stats(), stingy: stingy.stats(), scoped: scoped.stats() }
    return { problems, stats }
}

describe('L1 cache state changes no plan, count, budget decision or stored value', () => {
    test('generated histories with outside edits, old records and every budget', () => {
        const problems: string[] = []
        let tinyMax = 0
        let stingyMax = 0
        let scopedMax = 0
        for (let seed = 1; seed <= 160; seed++) {
            const run = runLockstep(seed, 80)
            problems.push(...run.problems)
            tinyMax = Math.max(tinyMax, run.stats.tiny.units)
            stingyMax = Math.max(stingyMax, run.stats.stingy.units)
            scopedMax = Math.max(scopedMax, run.stats.scoped.units)
        }
        expect(problems).toEqual([])
        expect(tinyMax).toBeLessThanOrEqual(64)
        expect(stingyMax).toBeLessThanOrEqual(200)
        expect(scopedMax).toBeLessThanOrEqual(200)
        // About 11 s alone on a desktop PC; a full parallel suite can double it.
    }, 60_000)
})
