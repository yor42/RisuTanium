// The pure pieces of the per-step store and the memory double that runs them: the keep walk against its
// oracle, the planners (what they put and delete, and that they never touch their input), the S4
// decision table, the strict owner reader, the measurement budget and the per-owner cap. The same
// scenarios run over the IndexedDB adapter in studioStoreIdb.test.ts and over the real service in
// ownerHistory.storeDelta.svelte.test.ts.
import { describe, expect, test } from 'vitest'
import type { DeletedItem, OwnerRecord, RestorePoint, Step } from '../historyModel'
import { characterOwnerKey, type Expectation, type OwnerKey } from '../ownerPhase'
import {
    CAP_BYTES,
    ENTRY_OVERHEAD,
    INDEX_PART,
    OWNER_CAP_BYTES,
    OWNER_OVERHEAD,
    RESTORE_PART,
    asideMarkKey,
    decideSave,
    entryKey,
    genBounds,
    genPrefix,
    headerKey,
    ownerCapFor,
    planDelta,
    planFull,
    readOwner,
    readOwnHeader,
    serializeHeader,
    storedSizeOf,
    type Baseline,
    type HeaderRead,
    type PlannedSave,
    type WriteRequest,
} from '../studioHistoryStore'
import {
    createMemoryStudioStore,
    keysInBounds,
    seedOwner,
    storedRecord,
    walkOracle,
    type MemoryStudioStore,
} from './studioStoreDoubles'

// ---------------------------------------------------------------- fixtures (the model's shapes, built by hand)

function descStep(id: string, before: string, after: string): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: 'desc' },
        ops: [{ op: 'set', path: 'desc', before: { had: true, value: before }, after: { had: true, value: after } }],
    }
}

function recordOf(ownerKey: OwnerKey, touchedAt: number, done: Step[], extra: Partial<OwnerRecord> = {}): OwnerRecord {
    return { ownerKey, touchedAt, done, undone: [], deleted: [], restore: null, ...extra }
}

function sizeOf(record: OwnerRecord): number {
    return storedSizeOf(record, record.ownerKey, Infinity)
}

function steps(prefix: string, count: number, fill: number): Step[] {
    return Array.from({ length: count }, (_, i) => descStep(`${prefix}${i}`, `${'a'.repeat(fill)}${i}`, `${'b'.repeat(fill)}${i}`))
}

function deletedItems(prefix: string, count: number, fill: number): DeletedItem[] {
    return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, at: i, index: i, value: `${'g'.repeat(fill)}${i}`, sideChat: null }))
}

function restoreOf(visitId: string, fill: number, greetings = 0): RestorePoint {
    const fields: RestorePoint['fields'] = { desc: { before: { had: true, value: 'r'.repeat(fill) }, last: { had: true, value: visitId } } }
    if (greetings > 0) {
        fields.alternateGreetings = { before: { list: Array.from({ length: greetings }, (_, i) => `${'l'.repeat(fill)}${i}`) }, last: { list: ['x'] } }
    }
    return { visitId, at: 1, fields }
}

// All four parts populated.
function fullRecord(owner: OwnerKey, touchedAt: number, counts = { done: 6, undone: 3, deleted: 3 }, fill = 60): OwnerRecord {
    return recordOf(owner, touchedAt, steps('d', counts.done, fill), {
        undone: steps('u', counts.undone, fill),
        deleted: deletedItems('x', counts.deleted, fill),
        restore: restoreOf('v1', fill),
    })
}

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const child of Object.values(value)) {
            deepFreeze(child)
        }
    }
    return value
}

async function loadThenSave(store: MemoryStudioStore, record: OwnerRecord, protect: ReadonlySet<OwnerKey> = new Set([record.ownerKey])) {
    await store.load(record.ownerKey)
    return store.save(record.ownerKey, record, protect)
}

// The parts a record's stored form holds, as they appear after the generation prefix.
function partsOf(record: OwnerRecord): string[] {
    return [
        ...record.done.map((step) => `s:${step.id}`),
        ...record.undone.map((step) => `s:${step.id}`),
        ...record.deleted.map((item) => `d:${item.id}`),
        ...(record.restore ? [RESTORE_PART] : []),
    ].sort()
}

// What a request list does, as parts: puts (the header as `h`) and deletes (a range as `range`).
function summarize(requests: readonly WriteRequest[], owner: OwnerKey): { puts: string[]; deletes: string[] } {
    const strip = (key: string): string => {
        if (key === headerKey(owner)) return 'h'
        const at = key.indexOf('|', key.indexOf('|') + 1)
        return key.slice(at + 1)
    }
    return {
        puts: requests.filter((r) => r.op === 'put').map((r) => strip((r as { key: string }).key)).sort(),
        deletes: requests.filter((r) => r.op !== 'put').map((r) => (r.op === 'delete' ? strip(r.key) : 'range')).sort(),
    }
}

function lastWrite(store: MemoryStudioStore, owner: OwnerKey) {
    return summarize(store.writes.at(-1)!.requests, owner)
}

function without(list: string[], drop: string[]): string[] {
    return list.filter((part) => !drop.includes(part))
}

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const C = characterOwnerKey('C')
const D = characterOwnerKey('D')
const X = characterOwnerKey('X')

// ---------------------------------------------------------------- planners: what they put and delete

describe('T-PD4 / T-PD6 planDelta puts exactly the entries whose object changed', () => {
    const base = recordOf(X, 1, [descStep('B', 'a', 'b'), descStep('A', 'b', 'c')], {
        deleted: [
            { id: 'X', at: 1, index: 2, value: 'gone', sideChat: null },
            { id: 'Y', at: 2, index: 0, value: 'other', sideChat: null },
        ],
        restore: restoreOf('v1', 5),
    })

    function planned(record: OwnerRecord): PlannedSave {
        const full = planFull(base, 'w:1', Infinity, new WeakMap())
        return planDelta(record, full.baseline, 'w:2', Infinity, new WeakMap())
    }

    test('a record of the same objects puts the index and the header only', () => {
        const plan = planned({ ...base, touchedAt: 2 })
        expect(summarize(plan.requests, X)).toEqual({ puts: ['h', 'i'], deletes: [] })
    })

    test('a step below the top that is a new object with the same id is put, with the top step that was rebuilt too', () => {
        const [lower, top] = base.done
        const plan = planned({ ...base, done: [{ ...lower, ops: [...lower.ops] }, { ...top }] })
        expect(summarize(plan.requests, X).puts).toEqual(['h', 'i', 's:A', 's:B'])
    })

    test('only the lower step changing puts only that step (a tops-only rule would miss it)', () => {
        const [lower, top] = base.done
        const plan = planned({ ...base, done: [{ ...lower }, top] })
        expect(summarize(plan.requests, X).puts).toEqual(['h', 'i', 's:B'])
    })

    test('a deleted item that moved (a new object, a new index) is put', () => {
        const [first, second] = base.deleted
        const plan = planned({ ...base, deleted: [{ ...first, index: 1 }, second] })
        expect(summarize(plan.requests, X).puts).toEqual(['d:X', 'h', 'i'])
    })

    test('the restore point is put after a visit change and not put when its object is the same', () => {
        expect(summarize(planned({ ...base, restore: restoreOf('v2', 5) }).requests, X).puts).toEqual(['h', 'i', 'r'])
        expect(summarize(planned({ ...base }).requests, X).puts).toEqual(['h', 'i'])
    })

    test('a dropped, cleared or restored part is deleted from the baseline gen, and the header is the last request', () => {
        const [lower, top] = base.done
        const plan = planned({ ...base, done: [top], deleted: [base.deleted[1]], restore: null, touchedAt: 3 })
        expect(lower.id).toBe('B')
        expect(summarize(plan.requests, X)).toEqual({ puts: ['h', 'i'], deletes: ['d:X', 'r', 's:B'] })
        expect(plan.requests.at(-1)).toMatchObject({ op: 'put', key: headerKey(X) })
        expect(plan.requests.at(-2)).toMatchObject({ op: 'put', key: entryKey(X, 'w:1', INDEX_PART) })
        for (const request of plan.requests) {
            if (request.op === 'delete') {
                expect(request.key.startsWith(genPrefix(X, 'w:1'))).toBe(true)
            }
        }
    })
})

describe('T-PF1 / T-PF3 a full rewrite ignores the baseline; the decision table', () => {
    const record = fullRecord(X, 5, { done: 3, undone: 1, deleted: 1 })

    test('planFull puts every kept entry under the fresh gen and deletes the stale gen only when asked to', () => {
        const stale = planFull(record, 'g2:1', Infinity, new WeakMap(), 'g1:1')
        const parts = partsOf(record)
        expect(summarize(stale.requests, X)).toEqual({ puts: [...parts, 'h', 'i'].sort(), deletes: ['range'] })
        const range = stale.requests[0]
        expect(range).toEqual({ op: 'deleteRange', ...genBounds(X, 'g1:1') })
        expect(stale.baseline.gen).toBe('g2:1')
        for (const request of stale.requests) {
            if (request.op === 'put' && request.key !== headerKey(X)) {
                expect(request.key.startsWith(genPrefix(X, 'g2:1'))).toBe(true)
            }
        }
        const plain = planFull(record, 'g2:1', Infinity, new WeakMap())
        expect(plain.requests.some((r) => r.op !== 'put')).toBe(false)
    })

    function headerRead(): { read: HeaderRead; baseline: Baseline; wid: string } {
        const shared = new Map<string, string>()
        const header = seedOwner(shared, record, 'w:1')
        return {
            read: readOwnHeader(X, shared.get(headerKey(X))),
            baseline: planFull(record, header.wid, Infinity, new WeakMap()).baseline,
            wid: header.wid,
        }
    }

    test('T-PF3 decideSave answers every row of the S4 table', () => {
        const { read, baseline, wid } = headerRead()
        const matching: Expectation = { kind: 'wid', wid }
        // No expectation: nothing is written.
        expect(decideSave(read, false, undefined, baseline)).toEqual({ kind: 'notLoaded' })
        // An absent header is absence, whatever was expected and whatever the baseline holds.
        for (const expectation of [{ kind: 'none' }, matching, { kind: 'foreign' }] as Expectation[]) {
            expect(decideSave({ kind: 'absent' }, false, expectation, baseline)).toEqual({ kind: 'full', staleGen: null })
            expect(decideSave({ kind: 'absent' }, true, expectation, null)).toEqual({ kind: 'full', staleGen: null })
        }
        // The stored header is the one this instance last saw and the baseline agrees: a patch.
        expect(decideSave(read, false, matching, baseline)).toEqual({ kind: 'delta' })
        // Matching wid, but no baseline or a baseline of another wid or gen: a full rewrite that replaces its own gen.
        expect(decideSave(read, false, matching, null)).toEqual({ kind: 'full', staleGen: 'w:1' })
        expect(decideSave(read, false, matching, { ...baseline, wid: 'other' })).toEqual({ kind: 'full', staleGen: 'w:1' })
        expect(decideSave(read, false, matching, { ...baseline, gen: 'other-gen' })).toEqual({ kind: 'full', staleGen: 'w:1' })
        // A header this instance never saw: aside once, then kept.
        const value = read.kind === 'passes' ? read.value : undefined
        for (const expectation of [{ kind: 'none' }, { kind: 'foreign' }, { kind: 'wid', wid: 'elsewhere' }] as Expectation[]) {
            expect(decideSave(read, false, expectation, baseline)).toEqual({ kind: 'aside', headerValue: value })
            expect(decideSave(read, true, expectation, baseline)).toEqual({ kind: 'kept' })
        }
        // A header that does not read is foreign too.
        const broken = readOwnHeader(X, '{"v":2}')
        expect(broken.kind).toBe('fails')
        expect(decideSave(broken, false, matching, baseline)).toEqual({ kind: 'aside', headerValue: '{"v":2}' })
        expect(decideSave(broken, true, matching, baseline)).toEqual({ kind: 'kept' })
    })
})

// ---------------------------------------------------------------- the keep walk against its oracle

describe('T-S6b the walk keeps what the oracle keeps, at every cap', () => {
    test('a sweep of owner caps, all four parts populated: the stored owner equals the oracle and trimmed says whether anything went', () => {
        const record = fullRecord(A, 1, { done: 6, undone: 3, deleted: 3 })
        const full = sizeOf(record)
        let trimmedCases = 0
        let restoreDropped = 0
        let deletedDropped = 0
        let undoneDropped = 0
        for (let cap = OWNER_OVERHEAD - 6; cap <= full + 6; cap += 37) {
            const shared = new Map<string, string>()
            seedOwner(shared, record, 'w:1', cap)
            const oracle = walkOracle(record, cap)
            const stored = storedRecord(shared, A)
            expect(stored?.record, `cap ${cap}`).toEqual(oracle)
            expect(stored!.header.size, `cap ${cap}`).toBeLessThanOrEqual(Math.max(cap, OWNER_OVERHEAD))
            const plan = planFull(record, 'w:1', cap, new WeakMap())
            const wasTrimmed = JSON.stringify(oracle) !== JSON.stringify(record)
            expect(plan.trimmed, `cap ${cap}`).toBe(wasTrimmed)
            trimmedCases += wasTrimmed ? 1 : 0
            restoreDropped += wasTrimmed && oracle.restore === null ? 1 : 0
            deletedDropped += oracle.deleted.length < record.deleted.length ? 1 : 0
            undoneDropped += oracle.undone.length < record.undone.length ? 1 : 0
        }
        // The sweep reaches the untouched, partly trimmed and fully trimmed shapes.
        expect(trimmedCases).toBeGreaterThan(10)
        expect(restoreDropped).toBeGreaterThan(0)
        expect(deletedDropped).toBeGreaterThan(0)
        expect(undoneDropped).toBeGreaterThan(0)
    })

    test('an owner whose stored size equals the owner cap exactly keeps its oldest step and is not trimmed; one byte less trims', () => {
        const record = fullRecord(A, 1, { done: 6, undone: 3, deleted: 3 })
        const full = sizeOf(record)
        const shared = new Map<string, string>()
        seedOwner(shared, record, 'w:1', full)
        const stored = storedRecord(shared, A)
        expect(stored?.record).toEqual(record)
        expect(stored!.header.size).toBe(full)
        expect(planFull(record, 'w:1', full, new WeakMap()).trimmed).toBe(false)
        expect(planFull(record, 'w:1', full - 1, new WeakMap()).trimmed).toBe(true)
    })

    test('the stop is at the first entry that does not fit: a later, smaller entry is never kept in its place', () => {
        // The newest step is large, the older ones small: skip-and-continue would keep the older ones.
        const big = descStep('big', 'q'.repeat(400), 'q'.repeat(400))
        const record = recordOf(A, 1, [descStep('s0', 'a', 'b'), descStep('s1', 'a', 'b'), big])
        const cap = OWNER_OVERHEAD + 600
        const shared = new Map<string, string>()
        seedOwner(shared, record, 'w:1', cap)
        expect(storedRecord(shared, A)!.record.done).toEqual([])
        expect(walkOracle(record, cap).done).toEqual([])
    })

    function doubleAt(ownerCap: number): MemoryStudioStore {
        return createMemoryStudioStore({ capBytes: ownerCap * 2 })
    }

    test('a growth save puts the new step, the index and the header, deletes exactly the oldest kept ids that no longer fit, and puts no dropped id', async () => {
        const ownerCap = 5000
        const store = doubleAt(ownerCap)
        const restore = restoreOf('v1', 20)
        const first = recordOf(A, 1, steps('g', 14, 60), { restore })
        expect(sizeOf(first)).toBeGreaterThan(ownerCap)
        await loadThenSave(store, first)
        const firstKept = walkOracle(first, ownerCap)
        expect(firstKept.done.length).toBeGreaterThan(2)
        expect(firstKept.done.length).toBeLessThan(14)

        // The new step is larger than the ones it pushes out.
        const second = { ...first, touchedAt: 2, done: [...first.done, descStep('g14', 'n'.repeat(400), 'm'.repeat(400))] }
        expect(await store.save(A, second, new Set([A]))).toMatchObject({ kind: 'ok', trimmed: true })
        const secondKept = walkOracle(second, ownerCap)
        const summary = lastWrite(store, A)
        const before = partsOf(firstKept)
        const after = partsOf(secondKept)
        expect(summary.puts).toEqual([...without(after, before), 'h', 'i'].sort())
        expect(summary.puts).toContain('s:g14')
        expect(summary.deletes).toEqual(without(before, after))
        expect(summary.deletes.length).toBeGreaterThan(0)
        // No id the walk dropped is put.
        const dropped = partsOf(second).filter((part) => !after.includes(part))
        expect(dropped.length).toBeGreaterThan(0)
        for (const part of dropped) {
            expect(summary.puts).not.toContain(part)
        }
        expect(storedRecord(store.shared, A)!.record).toEqual(secondKept)
    })

    test('a shrink save (an edit that clears the undone steps) puts the older steps that fit again', async () => {
        const ownerCap = 5000
        const store = doubleAt(ownerCap)
        const first = recordOf(A, 1, steps('g', 8, 60), { undone: steps('u', 3, 60), restore: restoreOf('v1', 20) })
        expect(sizeOf(first)).toBeGreaterThan(ownerCap)
        await loadThenSave(store, first)
        const firstKept = walkOracle(first, ownerCap)

        const second = { ...first, touchedAt: 2, done: [...first.done, descStep('g8', 'x', 'y')], undone: [] }
        expect(await store.save(A, second, new Set([A]))).toMatchObject({ kind: 'ok' })
        const secondKept = walkOracle(second, ownerCap)
        const summary = lastWrite(store, A)
        const before = partsOf(firstKept)
        const after = partsOf(secondKept)
        const returning = without(after, before).filter((part) => part !== 's:g8')
        // Older steps come back: they were never in the baseline, so they are put.
        expect(returning.length).toBeGreaterThan(0)
        expect(summary.puts).toEqual([...without(after, before), 'h', 'i'].sort())
        expect(summary.deletes).toEqual(without(before, after))
        expect(storedRecord(store.shared, A)!.record).toEqual(secondKept)
    })

    test('a new visit with a smaller restore point puts the steps that fit again', async () => {
        const ownerCap = 6000
        const store = doubleAt(ownerCap)
        const first = recordOf(A, 1, steps('g', 8, 60), { restore: restoreOf('v1', 40, 6) })
        await loadThenSave(store, first)
        const firstKept = walkOracle(first, ownerCap)
        expect(firstKept.restore).not.toBeNull()

        const second = { ...first, touchedAt: 2, restore: restoreOf('v2', 5) }
        expect(await store.save(A, second, new Set([A]))).toMatchObject({ kind: 'ok' })
        const secondKept = walkOracle(second, ownerCap)
        const summary = lastWrite(store, A)
        const before = partsOf(firstKept)
        const after = partsOf(secondKept)
        expect(without(after, before).filter((part) => part !== RESTORE_PART).length).toBeGreaterThan(0)
        expect(summary.puts).toEqual([...without(after, before), 'h', 'i', 'r'].sort())
        expect(storedRecord(store.shared, A)!.record).toEqual(secondKept)
    })

    test('a restore point larger than the owner cap leaves the owner stored empty; a later smaller one puts everything that fits again', async () => {
        const ownerCap = 2000
        const store = doubleAt(ownerCap)
        const first = recordOf(A, 1, steps('g', 4, 20), { restore: restoreOf('v1', 40, 12) })
        expect(storedSizeOf({ ...first, done: [], undone: [], deleted: [] }, A, Infinity)).toBeGreaterThan(ownerCap)
        expect(await loadThenSave(store, first)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        const empty = storedRecord(store.shared, A)!
        expect(empty.record).toEqual({ ownerKey: A, touchedAt: 1, done: [], undone: [], deleted: [], restore: null })
        expect(empty.record).toEqual(walkOracle(first, ownerCap))
        expect(await createMemoryStudioStore({ shared: store.shared, capBytes: ownerCap * 2 }).load(A)).toEqual({ kind: 'ok', record: empty.record })

        const second = { ...first, touchedAt: 2, restore: restoreOf('v2', 3) }
        expect(await store.save(A, second, new Set([A]))).toMatchObject({ kind: 'ok' })
        const kept = walkOracle(second, ownerCap)
        expect(kept.done.length).toBeGreaterThan(0)
        expect(lastWrite(store, A).puts).toEqual([...partsOf(kept), 'h', 'i'].sort())
        expect(storedRecord(store.shared, A)!.record).toEqual(kept)
    })
})

// ---------------------------------------------------------------- the planners never touch their input

describe('T-F1 no planner changes the record, in any of its four parts', () => {
    test('planDelta and planFull on a deep-frozen record over the cap, at every cap, leave a JSON snapshot unchanged', () => {
        const record = deepFreeze(fullRecord(A, 7, { done: 6, undone: 3, deleted: 3 }))
        const snapshot = JSON.stringify(record)
        const smaller = fullRecord(A, 6, { done: 2, undone: 1, deleted: 1 })
        const baseline = planFull(smaller, 'w:0', Infinity, new WeakMap()).baseline
        const full = sizeOf(record)
        for (let cap = 0; cap <= full + 40; cap += 53) {
            planFull(record, 'w:1', cap, new WeakMap())
            planFull(record, 'w:1', cap, new WeakMap(), 'stale')
            planDelta(record, baseline, 'w:2', cap, new WeakMap())
            expect(JSON.stringify(record), `cap ${cap}`).toBe(snapshot)
        }
    })

    test('a store save of a record with every part populated, over the cap, leaves it untouched whether it is frozen or not', async () => {
        const record = fullRecord(A, 3, { done: 10, undone: 4, deleted: 4 })
        const frozen = deepFreeze(fullRecord(B, 4, { done: 10, undone: 4, deleted: 4 }))
        const snapshots = [JSON.stringify(record), JSON.stringify(frozen)]
        const store = createMemoryStudioStore({ capBytes: 8000 })
        expect(sizeOf(record)).toBeGreaterThan(ownerCapFor(8000))
        expect(await loadThenSave(store, record)).toMatchObject({ kind: 'ok', trimmed: true })
        expect(await loadThenSave(store, frozen)).toMatchObject({ kind: 'ok', trimmed: true })
        expect(await store.save(A, { ...record, touchedAt: 9 }, new Set([A]))).toMatchObject({ kind: 'ok', trimmed: true })
        expect([JSON.stringify(record), JSON.stringify(frozen)]).toEqual(snapshots)
        expect(record.done).toHaveLength(10)
        expect(record.undone).toHaveLength(4)
        expect(record.deleted).toHaveLength(4)
        expect(record.restore).not.toBeNull()
    })
})

// ---------------------------------------------------------------- the measurement budget

describe('T-PM1 every entry is serialized at most once per save', () => {
    function counted(): { record: OwnerRecord; calls: () => number; reset: () => void } {
        let calls = 0
        const wrap = <T extends object>(value: T): T =>
            Object.defineProperty({ ...value }, 'toJSON', {
                enumerable: false,
                value: () => {
                    calls += 1
                    return { ...value }
                },
            })
        const record = recordOf(A, 1, steps('d', 10, 80).map(wrap), {
            undone: steps('u', 3, 80).map(wrap),
            deleted: deletedItems('x', 2, 80).map(wrap),
            restore: wrap(restoreOf('v1', 40)),
        })
        return { record, calls: () => calls, reset: () => (calls = 0) }
    }

    test('calls equal the entries put plus at most one measured stop entry, and a repeated save makes none', async () => {
        const ownerCap = 5000
        const store = createMemoryStudioStore({ capBytes: ownerCap * 2 })
        const { record, calls, reset } = counted()
        await store.load(A)
        reset()
        expect(await store.save(A, record, new Set([A]))).toMatchObject({ kind: 'ok', trimmed: true })
        const putEntries = lastWrite(store, A).puts.filter((part) => part !== 'h' && part !== 'i').length
        expect(putEntries).toBeGreaterThan(3)
        // Each put entry once, and the entry the walk stopped at once (measured, not stored).
        expect(calls()).toBe(putEntries + 1)

        reset()
        expect(await store.save(A, { ...record, touchedAt: 2 }, new Set([A]))).toMatchObject({ kind: 'ok', trimmed: true })
        expect(calls()).toBe(0)
        expect(lastWrite(store, A).puts).toEqual(['h', 'i'])
    })

    test('a single changed entry costs one call', async () => {
        const store = createMemoryStudioStore({ capBytes: 100000 })
        const { record, calls, reset } = counted()
        await loadThenSave(store, record)
        reset()
        const top = record.done.at(-1)!
        let changedCalls = 0
        const changed = Object.defineProperty({ ...top, at: 5 }, 'toJSON', {
            enumerable: false,
            value: () => {
                changedCalls += 1
                return { ...top, at: 5 }
            },
        })
        await store.save(A, { ...record, touchedAt: 2, done: [...record.done.slice(0, -1), changed] }, new Set([A]))
        expect(lastWrite(store, A).puts).toEqual(['h', 'i', `s:${top.id}`])
        // Only the new object is serialized; every other entry is unchanged against the baseline.
        expect(changedCalls).toBe(1)
        expect(calls()).toBe(0)
    })
})

// ---------------------------------------------------------------- the strict owner reader

describe('T-S2b readOwner rejects every shape a strict reader must', () => {
    function written(record: OwnerRecord = fullRecord(A, 4, { done: 3, undone: 1, deleted: 1 })): { headerText: string; keys: string[]; values: string[]; record: OwnerRecord } {
        const shared = new Map<string, string>()
        const header = seedOwner(shared, record, 'w:1')
        const keys = keysInBounds(shared, genBounds(A, header.gen))
        return { headerText: shared.get(headerKey(A)) as string, keys, values: keys.map((key) => shared.get(key) as string), record }
    }

    const read = (w: ReturnType<typeof written>, headerText = w.headerText, keys: readonly unknown[] = w.keys, values: readonly unknown[] = w.values) => readOwner(A, headerText, keys, values)

    test('writer output reads, including an owner larger than the owner cap that a larger cap wrote', () => {
        const w = written()
        expect(read(w)?.record).toEqual(w.record)
        const big = recordOf(A, 1, steps('b', 40, 15000))
        const bigWritten = written(big)
        expect(sizeOf(big)).toBeGreaterThan(OWNER_CAP_BYTES)
        expect(read(bigWritten)?.record).toEqual(big)
    })

    test('an extra key in the generation', () => {
        const w = written()
        expect(read(w, w.headerText, [...w.keys, `${genPrefix(A, 'w:1')}s:stray`], [...w.values, '{}'])).toBeNull()
    })

    test('a missing listed key', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|s:d1'))
        expect(read(w, w.headerText, w.keys.filter((_, i) => i !== at), w.values.filter((_, i) => i !== at))).toBeNull()
    })

    test('a value whose length differs from the index', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|s:d1'))
        const values = w.values.map((value, i) => (i === at ? `${value} ` : value))
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })

    test('an entry whose kind, id or owner key does not match its key', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|s:d1'))
        const mutate = (change: (value: string) => string) => w.values.map((value, i) => (i === at ? change(value) : value))
        // Same length on purpose, so only the field check can reject it.
        expect(read(w, w.headerText, w.keys, mutate((v) => v.replace('"k":"s"', '"k":"d"')))).toBeNull()
        expect(read(w, w.headerText, w.keys, mutate((v) => v.replace('"id":"d1"', '"id":"d9"')))).toBeNull()
        expect(read(w, w.headerText, w.keys, mutate((v) => v.replace('"ownerKey":"character:A"', '"ownerKey":"character:Z"')))).toBeNull()
    })

    // The next cases hand-mutate the writer's output. No writer in this build stores these. A range read can never return the prefix or length cases; the other two need a broken or foreign producer.
    test('an index whose owner key is another owner', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|i'))
        const values = w.values.map((value, i) => (i === at ? value.replace('"ownerKey":"character:A"', '"ownerKey":"character:Z"') : value))
        expect(values[at]).not.toBe(w.values[at])
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })

    test('a key outside the header generation prefix, even one whose tail names a listed part', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|s:d1'))
        const foreign = `${genPrefix(A, 'w:9')}s:d1`
        expect(foreign.length).toBe(w.keys[at].length)
        expect(read(w, w.headerText, w.keys.map((key, i) => (i === at ? foreign : key)))).toBeNull()
    })

    test('keys and values of different lengths', () => {
        const w = written()
        expect(read(w, w.headerText, w.keys, [...w.values, '{}'])).toBeNull()
        expect(read(w, w.headerText, [...w.keys, `${genPrefix(A, 'w:1')}s:stray`], w.values)).toBeNull()
    })

    test('a value that is not a string, even one that reads like the stored text', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|s:d1'))
        // A String object has the right length and coerces to the stored text, so only a type check rejects it.
        const values = w.values.map((value, i) => (i === at ? new String(value) : value))
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })

    test('an index whose write id differs from the header', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|i'))
        const values = w.values.map((value, i) => (i === at ? value.replace('"wid":"w:1"', '"wid":"w:9"') : value))
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })

    test('a header size that differs from the size of the index', () => {
        const w = written()
        const header = JSON.parse(w.headerText) as { size: number }
        expect(read(w, JSON.stringify({ ...header, size: header.size + 1 }))).toBeNull()
        expect(read(w, JSON.stringify({ ...header, size: header.size - 1 }))).toBeNull()
    })

    test('duplicate ids in the index', () => {
        const w = written()
        const at = w.keys.findIndex((key) => key.endsWith('|i'))
        const index = JSON.parse(w.values[at]) as { done: [string, number][]; undone: [string, number][] }
        // A step id that sits in done and in undone breaks the rule, whatever the lengths say.
        const duplicated = { ...index, undone: [[index.done[0][0], index.done[0][1]]] }
        const values = w.values.map((value, i) => (i === at ? JSON.stringify(duplicated) : value))
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })

    test('a generation that contains a bar, or a header that names another owner', () => {
        const w = written()
        const header = JSON.parse(w.headerText) as Record<string, unknown>
        expect(read(w, JSON.stringify({ ...header, gen: 'w|1' }))).toBeNull()
        expect(readOwner(characterOwnerKey('B'), w.headerText, w.keys, w.values)).toBeNull()
    })

    test('a record the model does not accept makes the owner unreadable', () => {
        const w = written(recordOf(A, 1, [descStep('d0', 'a', 'b')]))
        const at = w.keys.findIndex((key) => key.endsWith('|s:d0'))
        const values = w.values.map((value, i) => (i === at ? value.replace('"op":"set"', '"op":"wipe"') : value))
        expect(read(w, w.headerText, w.keys, values)).toBeNull()
    })
})

// ---------------------------------------------------------------- the per-owner cap on the double

describe('each owner keeps at most half the store (double)', () => {
    const CAP = 10000
    const owned = (owner: OwnerKey, touchedAt: number, count = 8, fill = 100) => recordOf(owner, touchedAt, steps(`${owner.slice(10)}:`, count, fill))

    test('T-OC1 the cap pins: the owner cap is half the store and the sizing constants are the pinned v1 numbers', () => {
        expect(OWNER_CAP_BYTES).toBe(CAP_BYTES / 2)
        expect(ownerCapFor(CAP_BYTES)).toBe(OWNER_CAP_BYTES)
        expect(ENTRY_OVERHEAD).toBe(144)
        expect(OWNER_OVERHEAD).toBe(512)
    })

    test('T-OC1 (i) a match save and (ii) a full rewrite, through Absent and through aside, store the oracle at half the cap', async () => {
        const big = owned(A, 2, 7)
        expect(sizeOf(big)).toBeGreaterThan(ownerCapFor(CAP))
        expect(sizeOf(big)).toBeLessThan(CAP)
        const oracle = walkOracle(big, ownerCapFor(CAP))
        expect(oracle.done.length).toBeLessThan(7)

        const matched = createMemoryStudioStore({ capBytes: CAP })
        await loadThenSave(matched, owned(A, 1, 1))
        expect(await matched.save(A, big, new Set([A]))).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(storedRecord(matched.shared, A)!.record).toEqual(oracle)
        expect(storedRecord(matched.shared, A)!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))

        const absent = createMemoryStudioStore({ capBytes: CAP })
        expect(await loadThenSave(absent, big)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(storedRecord(absent.shared, A)!.record).toEqual(oracle)

        const shared = new Map<string, string>()
        const early = createMemoryStudioStore({ shared, capBytes: CAP, pageSession: 'early' })
        await early.load(A)
        await loadThenSave(createMemoryStudioStore({ shared, capBytes: CAP, pageSession: 'late' }), owned(A, 1, 1))
        expect(await early.save(A, big, new Set([A]))).toEqual({ kind: 'ok', asided: true, trimmed: true })
        expect(storedRecord(shared, A)!.record).toEqual(oracle)
        expect(storedRecord(shared, A)!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
    })

    test('T-OC1 the production default adapter stores at most OWNER_CAP_BYTES for about 3 MiB', async () => {
        const store = createMemoryStudioStore()
        const chunk = 'q'.repeat(20000)
        const record = recordOf(A, 1, Array.from({ length: 38 }, (_, i) => descStep(`p:${i}`, `${chunk}${i}`, `${chunk}${i + 1}`)))
        expect(sizeOf(record)).toBeGreaterThan(OWNER_CAP_BYTES)
        expect(sizeOf(record)).toBeLessThan(CAP_BYTES)
        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(storedRecord(store.shared, A)!.header.size).toBeLessThanOrEqual(OWNER_CAP_BYTES)
    })

    test('T-OC2 two alternately edited owners, each over the owner cap, never evict each other and every save after the first is a patch', async () => {
        const store = createMemoryStudioStore({ capBytes: CAP })
        let a = owned(A, 1)
        let b = owned(B, 2)
        // Each owner's memory is over the owner cap, so a layout without it would push the pair over the store.
        expect(sizeOf(a)).toBeGreaterThan(ownerCapFor(CAP))
        expect(sizeOf(b)).toBeGreaterThan(ownerCapFor(CAP))
        await store.load(A)
        await store.load(B)
        let time = 10
        const saved = new Set<OwnerKey>()
        for (let round = 0; round < 3; round++) {
            for (const owner of [A, B]) {
                time += 10
                const current = owner === A ? a : b
                const id = `${owner.slice(10)}:new${round}`
                const next = { ...current, touchedAt: time, done: [...current.done, descStep(id, 'x'.repeat(100), 'y'.repeat(100))] }
                if (owner === A) a = next
                else b = next
                expect(await store.save(owner, next, new Set([owner])), `${owner} ${round}`).toMatchObject({ kind: 'ok', trimmed: true })
                saved.add(owner)
                for (const resident of saved) {
                    const view = storedRecord(store.shared, resident)
                    expect(view, `${resident} after ${owner} ${round}`).not.toBeNull()
                    expect(view!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
                }
                const summary = lastWrite(store, owner)
                expect(summary.deletes.includes('range'), `${owner} ${round}`).toBe(false)
                if (round > 0) {
                    expect(summary.puts, `${owner} ${round}`).toEqual([`s:${id}`, 'h', 'i'].sort())
                }
            }
        }
        expect(storedRecord(store.shared, A)!.record).toEqual(walkOracle(a, ownerCapFor(CAP)))
        expect(storedRecord(store.shared, B)!.record).toEqual(walkOracle(b, ownerCapFor(CAP)))
    })

    test('T-OC3 three owners rotating: each return is a full rewrite within the owner cap that evicts exactly the owner saved two saves earlier', async () => {
        const store = createMemoryStudioStore({ capBytes: CAP })
        const owners = [A, B, C]
        const records = new Map<OwnerKey, OwnerRecord>(owners.map((owner, at) => [owner, owned(owner, at)]))
        for (const owner of owners) {
            expect(sizeOf(records.get(owner)!)).toBeGreaterThan(ownerCapFor(CAP))
            await store.load(owner)
        }
        const saved: OwnerKey[] = []
        for (let save = 0; save < 8; save++) {
            const owner = owners[save % 3]
            const previous = records.get(owner)!
            const next = { ...previous, touchedAt: 100 + save, done: [...previous.done, descStep(`${owner.slice(10)}:r${save}`, 'm'.repeat(100), 'n'.repeat(100))] }
            records.set(owner, next)
            const priorGen = storedRecord(store.shared, owner)?.header.gen
            expect(await store.save(owner, next, new Set([owner])), `save ${save}`).toMatchObject({ kind: 'ok', trimmed: true })
            saved.push(owner)
            const view = storedRecord(store.shared, owner)!
            expect(view.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
            expect(view.record).toEqual(walkOracle(next, ownerCapFor(CAP)))
            if (save >= 3) {
                expect(view.header.gen).not.toBe(priorGen)
                const resident = owners.filter((candidate) => store.shared.has(headerKey(candidate)))
                expect(resident.sort(), `after save ${save}`).toEqual([saved[save], saved[save - 1]].sort())
                expect(lastWrite(store, owner).deletes.filter((part) => part === 'range')).toHaveLength(1)
            }
        }
    })
})

// ---------------------------------------------------------------- stale baselines and foreign generations (double)

describe('a stale baseline never decides a rewrite (double)', () => {
    const CAP = 10000

    test('R8-1 (i) another instance evicts A, then A saves a fourth step: the whole owner is put under a fresh generation', async () => {
        const shared = new Map<string, string>()
        const one = createMemoryStudioStore({ shared, capBytes: CAP, pageSession: 'one' })
        const two = createMemoryStudioStore({ shared, capBytes: CAP, pageSession: 'two' })
        const base = recordOf(A, 10, steps('A:', 3, 80), { restore: restoreOf('v1', 5) })
        await loadThenSave(one, base)
        const oldGen = storedRecord(shared, A)!.header.gen
        // Instance two writes two owners of about the owner cap: A is the oldest and goes.
        await loadThenSave(two, recordOf(C, 20, steps('C:', 30, 100)))
        await loadThenSave(two, recordOf(D, 30, steps('D:', 30, 100)))
        expect(shared.has(headerKey(A))).toBe(false)

        const next = { ...base, touchedAt: 40, done: [...base.done, descStep('A:3', 'a', 'b')], restore: restoreOf('v2', 5) }
        expect(await one.save(A, next, new Set([A]))).toMatchObject({ kind: 'ok', asided: false })
        const summary = lastWrite(one, A)
        expect(summary.puts).toEqual([...partsOf(next), 'h', 'i'].sort())
        // A's own save evicts C (the oldest of the others) and nothing of A's old generation.
        expect(summary.deletes).toEqual([headerKey(C), 'range'].sort())
        const view = storedRecord(shared, A)!
        expect(view.header.gen).not.toBe(oldGen)
        expect(view.record).toEqual(next)
        expect(await createMemoryStudioStore({ shared }).load(A)).toEqual({ kind: 'ok', record: next })
    })

    test('R8-1 (ii) the owner evicted by this instance own save of another owner: A, D touched after A, and C with A + D + C over the cap', async () => {
        const store = createMemoryStudioStore({ capBytes: CAP, pageSession: 'one' })
        const recA = recordOf(A, 10, steps('A:', 3, 80))
        const recD = recordOf(D, 20, steps('D:', 30, 100))
        const recC = recordOf(C, 30, steps('C:', 30, 100))
        // The fixture states its own preconditions: each owner fits half the cap, the three do not fit the store.
        for (const record of [recA, recD, recC]) {
            expect(storedSizeOf(record, record.ownerKey, ownerCapFor(CAP) * 2)).toBeLessThanOrEqual(ownerCapFor(CAP))
        }
        const stored = [recA, recD, recC].map((record) => storedSizeOf(record, record.ownerKey, CAP))
        expect(stored[0] + stored[1] + stored[2]).toBeGreaterThan(CAP)
        expect(stored[1] + stored[2]).toBeLessThanOrEqual(CAP)
        await loadThenSave(store, recA)
        await loadThenSave(store, recD)
        await loadThenSave(store, recC)
        expect(store.shared.has(headerKey(A))).toBe(false)

        const next = { ...recA, touchedAt: 40, done: [...recA.done, descStep('A:3', 'a', 'b')] }
        expect(await store.save(A, next, new Set([A]))).toMatchObject({ kind: 'ok' })
        expect(lastWrite(store, A).puts).toEqual([...partsOf(next), 'h', 'i'].sort())
        expect(await createMemoryStudioStore({ shared: store.shared }).load(A)).toEqual({ kind: 'ok', record: next })
    })

    test('R7-8 an aside never deletes the generation its own baseline named: the other instance patched it, so it stays byte-identical', async () => {
        const shared = new Map<string, string>()
        const one = createMemoryStudioStore({ shared, pageSession: 'one' })
        const two = createMemoryStudioStore({ shared, pageSession: 'two' })
        const base = recordOf(X, 1, steps('X:', 3, 20))
        await loadThenSave(one, base)
        const g1 = storedRecord(shared, X)!.header.gen
        const loaded = await two.load(X)
        if (loaded.kind !== 'ok') throw new Error('expected ok')
        const twoNext = { ...loaded.record, touchedAt: 5, done: [...loaded.record.done, descStep('X:two', 'q', 'r')] }
        expect(await two.save(X, twoNext, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })
        const twoHeader = shared.get(headerKey(X))
        const g1Entries = keysInBounds(shared, genBounds(X, g1)).map((key) => [key, shared.get(key)])

        const oneNext = { ...base, touchedAt: 8, done: [...base.done, descStep('X:one', 's', 't')] }
        expect(await one.save(X, oneNext, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        const requests = one.writes.at(-1)!.requests
        expect(requests.filter((r) => r.op === 'put' && r.key === asideMarkKey(X))).toHaveLength(1)
        expect(requests.some((r) => r.op !== 'put')).toBe(false)
        expect(shared.get(asideMarkKey(X))).toBe(twoHeader)
        expect(keysInBounds(shared, genBounds(X, g1)).map((key) => [key, shared.get(key)])).toEqual(g1Entries)
        expect(await createMemoryStudioStore({ shared }).load(X)).toEqual({ kind: 'ok', record: oneNext })
        // The next mismatch (instance two never saw instance one's state) finds the marker taken, and keeps.
        const afterOne = new Map(shared)
        expect(await two.save(X, { ...twoNext, touchedAt: 9 }, new Set([X]))).toEqual({ kind: 'kept' })
        expect(shared).toEqual(afterOne)
        expect(await one.save(X, { ...oneNext, touchedAt: 10 }, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })
    })
})

// ---------------------------------------------------------------- the first save after a load

describe('T-PD1 the double: a patch whatever the baseline came from', () => {
    const restoreAt = (visit: string): RestorePoint => restoreOf(visit, 5)

    test('(a) three stored steps reached by saves in the same instance, then one new step', async () => {
        const store = createMemoryStudioStore()
        let record = recordOf(X, 1, [], { restore: restoreAt('v1') })
        await store.load(X)
        for (let i = 0; i < 3; i++) {
            record = { ...record, touchedAt: i + 1, done: [...record.done, descStep(`s${i}`, 'a', 'b')], restore: restoreAt(`v${i + 1}`) }
            await store.save(X, record, new Set([X]))
        }
        record = { ...record, touchedAt: 9, done: [...record.done, descStep('snew', 'b', 'c')], restore: restoreAt('v9') }
        await store.save(X, record, new Set([X]))
        expect(lastWrite(store, X)).toEqual({ puts: ['h', 'i', 'r', 's:snew'].sort(), deletes: [] })
        expect(await createMemoryStudioStore({ shared: store.shared }).load(X)).toEqual({ kind: 'ok', record })
    })

    test('T-PD6 the restore point is put when its object changed and not put when it is the same object', async () => {
        const store = createMemoryStudioStore()
        const restore = restoreAt('v1')
        const record = recordOf(X, 1, [descStep('s0', 'a', 'b')], { restore })
        await loadThenSave(store, record)
        await store.save(X, { ...record, touchedAt: 2, done: [...record.done, descStep('s1', 'b', 'c')] }, new Set([X]))
        expect(lastWrite(store, X)).toEqual({ puts: ['h', 'i', 's:s1'].sort(), deletes: [] })
        await store.save(X, { ...record, touchedAt: 3, done: [...record.done], restore: restoreAt('v2') }, new Set([X]))
        expect(lastWrite(store, X).puts).toEqual(['h', 'i', 'r'].sort())
    })

    test('(b) three stored steps loaded by a new instance, then one new step built from the loaded objects', async () => {
        const shared = new Map<string, string>()
        const writer = createMemoryStudioStore({ shared })
        let record = recordOf(X, 1, [], { restore: restoreAt('v1') })
        await writer.load(X)
        for (let i = 0; i < 3; i++) {
            record = { ...record, touchedAt: i + 1, done: [...record.done, descStep(`s${i}`, 'a', 'b')], restore: restoreAt(`v${i + 1}`) }
            await writer.save(X, record, new Set([X]))
        }
        const reader = createMemoryStudioStore({ shared })
        const loaded = await reader.load(X)
        if (loaded.kind !== 'ok') throw new Error('expected ok')
        const next = { ...loaded.record, touchedAt: 9, done: [...loaded.record.done, descStep('snew', 'b', 'c')], restore: restoreAt('v9') }
        await reader.save(X, next, new Set([X]))
        expect(lastWrite(reader, X)).toEqual({ puts: ['h', 'i', 'r', 's:snew'].sort(), deletes: [] })
        expect(await createMemoryStudioStore({ shared }).load(X)).toEqual({ kind: 'ok', record: next })
    })
})

describe('the sizing the stored header carries', () => {
    test('a header written by a save equals the sum its index implies, and storedSizeOf with Infinity is the untrimmed size', async () => {
        const store = createMemoryStudioStore({ capBytes: 10000 })
        const record = fullRecord(A, 1, { done: 12, undone: 4, deleted: 3 })
        await loadThenSave(store, record)
        const stored = storedRecord(store.shared, A)!
        expect(stored.header.size).toBe(storedSizeOf(stored.record, A, Infinity))
        expect(stored.header.size).toBeLessThan(sizeOf(record))
        expect(serializeHeader(stored.header)).toBe(store.shared.get(headerKey(A)))
    })
})
