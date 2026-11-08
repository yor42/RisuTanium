import { describe, expect, test } from 'vitest'
import type { OwnerRecord, Step } from '../historyModel'
import { characterOwnerKey, chatOwnerKey, type OwnerKey } from '../ownerPhase'
import {
    CAP_BYTES,
    ENTRY_OVERHEAD,
    OWNER_CAP_BYTES,
    OWNER_OVERHEAD,
    asideMarkKey,
    classifyLoad,
    entryKey,
    evictionPlan,
    genBounds,
    headerKey,
    ownerCapFor,
    planFull,
    readHeader,
    serializeHeader,
    storedSizeOf,
    type StoredHeader,
} from '../studioHistoryStore'
import {
    createClaimDouble,
    createClaimWorld,
    createGate,
    createMemoryStudioStore,
    expectedOwnerKeys,
    keysInBounds,
    seedOwner,
    storedRecord,
    type MemoryStudioStore,
} from './studioStoreDoubles'
import { drainMicrotasks } from './historyTestKit.test-helpers'

// ---------------------------------------------------------------- fixtures (built by the real writers)

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

// The untrimmed stored size of a record, from the store's own sizing.
function sizeOf(record: OwnerRecord): number {
    return storedSizeOf(record, record.ownerKey, Infinity)
}

// A record of one `set desc` step whose before and after are `fill` characters each.
function filled(ownerKey: OwnerKey, touchedAt: number, fill: number, letter = 'a'): OwnerRecord {
    return recordOf(ownerKey, touchedAt, [descStep('p:1', letter.repeat(fill), 'z'.repeat(fill))])
}

// Solves the filler length from the measured per-owner overhead so the stored size is about `target`
// bytes. Each filler character appears twice in the entry (before and after) and counts 2 bytes.
function fillFor(ownerKey: OwnerKey, target: number): number {
    const overhead = sizeOf(filled(ownerKey, 0, 0))
    return Math.max(0, Math.round((target - overhead) / 4))
}

function sized(ownerKey: OwnerKey, touchedAt: number, target: number, letter = 'a'): OwnerRecord {
    return filled(ownerKey, touchedAt, fillFor(ownerKey, target), letter)
}

function snapshot(map: Map<string, string>): Map<string, string> {
    return new Map(map)
}

function header(ownerKey: OwnerKey, size: number, touchedAt: number): StoredHeader {
    return { wid: 'h', gen: 'g', ownerKey, size, touchedAt }
}

async function loadThenSave(store: MemoryStudioStore, record: OwnerRecord, protect: ReadonlySet<OwnerKey> = new Set([record.ownerKey])) {
    await store.load(record.ownerKey)
    return store.save(record.ownerKey, record, protect)
}

// Every key and value that belongs to the owner: its header and its generation.
function ownerEntries(shared: Map<string, string>, owner: OwnerKey): [string, string][] {
    const stored = storedRecord(shared, owner)
    if (!stored) {
        return []
    }
    return [headerKey(owner), ...stored.keys].map((key) => [key, shared.get(key) as string])
}

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const X = characterOwnerKey('X')
const Y = characterOwnerKey('Y')
const Z = characterOwnerKey('Z')
const P = characterOwnerKey('P')
const Q = characterOwnerKey('Q')

// ---------------------------------------------------------------- the v1 layout

describe('stored layout', () => {
    test('T-S1 a record written by the store reads back equal, with its header, its keys and its size', () => {
        const record = recordOf(A, 9, [descStep('p:1', 'a', 'b')], {
            undone: [descStep('p:2', 'b', 'c')],
            deleted: [{ id: 'd1', at: 2, index: 1, value: 'g', sideChat: { chatId: 'chatA', before: { had: true, value: 2 } } }],
            restore: { visitId: 'v', at: 1, fields: { desc: { before: { had: true, value: 'a' }, last: { had: true, value: 'b' } } } },
        })
        const shared = new Map<string, string>()
        const written = seedOwner(shared, record, 'w:1')
        const stored = storedRecord(shared, A)
        expect(stored?.record).toEqual(record)
        expect(stored?.header).toEqual({ wid: 'w:1', gen: 'w:1', ownerKey: A, size: sizeOf(record), touchedAt: 9 })
        expect(written).toEqual(stored?.header)
        expect([...shared.keys()].sort()).toEqual(expectedOwnerKeys(written, record))
        expect(readHeader(shared.get(headerKey(A)), A)).toEqual(written)
    })

    test('T-S2 the header reader needs v 1, a valid owner key equal to the expected one, finite numbers and a gen without a bar', () => {
        const record = recordOf(A, 1, [descStep('p:1', 'a', 'b')])
        const good = JSON.parse(serializeHeader(seedOwner(new Map(), record, 'w:1')))
        // These values are hand-written on purpose: they stand for a later or a broken producer.
        for (const bad of [
            { ...good, v: 2 },
            { ...good, ownerKey: 'nonsense' },
            { ...good, size: 'big' },
            { ...good, size: -1 },
            { ...good, touchedAt: null },
            { ...good, wid: 1 },
            { ...good, gen: '' },
            { ...good, gen: 'a|b' },
            { ...good, gen: undefined },
        ]) {
            expect(readHeader(JSON.stringify(bad), A)).toBeNull()
        }
        expect(readHeader(JSON.stringify(good), B)).toBeNull()
        expect(readHeader(JSON.stringify(good))).not.toBeNull()
        expect(readHeader('{', A)).toBeNull()
        expect(readHeader(undefined, A)).toBeNull()
    })

    test('classifyLoad maps every stored state to a result, an expectation and a baseline', () => {
        const record = recordOf(A, 1, [descStep('p:1', 'a', 'b')])
        const shared = new Map<string, string>()
        const stored = seedOwner(shared, record, 'w:1')
        const headerText = shared.get(headerKey(A))
        const keys = keysInBounds(shared, genBounds(A, stored.gen))
        const values = keys.map((key) => shared.get(key))

        expect(classifyLoad(A, undefined, false, [], [])).toEqual({ result: { kind: 'absent' }, expectation: { kind: 'none' }, baseline: null })
        const ok = classifyLoad(A, headerText, false, keys, values)
        expect(ok.result).toEqual({ kind: 'ok', record })
        expect(ok.expectation).toEqual({ kind: 'wid', wid: 'w:1' })
        expect([...(ok.baseline?.parts.keys() ?? [])]).toEqual(['s:p:1'])
        // A hand-written v2 header stands for a later producer.
        const later = classifyLoad(A, '{"v":2}', false, [], [])
        expect(later).toEqual({ result: { kind: 'unreadable' }, expectation: { kind: 'foreign' }, baseline: null })
        expect(classifyLoad(A, '{"v":2}', true, [], []).result).toEqual({ kind: 'keptUnreadable' })
        // A good header whose generation lacks a listed key does not read.
        const short = classifyLoad(A, headerText, false, keys.slice(1), values.slice(1))
        expect(short.result).toEqual({ kind: 'unreadable' })
        expect(short.baseline).toBeNull()
        expect(classifyLoad(A, headerText, true, keys.slice(1), values.slice(1)).result).toEqual({ kind: 'keptUnreadable' })
    })

    test('a single step larger than the owner cap is stored as an empty owner, never partly', () => {
        const record = filled(A, 1, 5000)
        const plan = planFull(record, 'w:1', ownerCapFor(2000), new WeakMap())
        expect(plan.trimmed).toBe(true)
        expect(plan.header.size).toBe(OWNER_OVERHEAD)
    })
})

// ---------------------------------------------------------------- eviction plan (pure)

describe('T-EP1 evictionPlan', () => {
    const CAP = 10000
    const owners = (plan: StoredHeader[]) => plan.map((entry) => entry.ownerKey)

    test('a protected owner counts toward the total but is never picked', () => {
        // P is the oldest candidate and is protected: Q is picked instead.
        const plan = evictionPlan([header(P, 3000, 50), header(Q, 3000, 100)], X, 5000, CAP, new Set([P]))
        expect(owners(plan)).toEqual([Q])
    })

    test('the plan returns the victims headers, each with its current gen', () => {
        const victim: StoredHeader = { wid: 'w', gen: 'gen-of-q', ownerKey: Q, size: 6000, touchedAt: 1 }
        expect(evictionPlan([victim], X, 5000, CAP, new Set([X]))).toEqual([victim])
    })

    test('when only protected owners remain, the plan stops and returns what it has', () => {
        expect(evictionPlan([header(P, 6000, 50)], X, 5000, CAP, new Set([P]))).toEqual([])
    })

    test('the written owner is never picked and is counted once, by its new size', () => {
        // X re-saved at about the same size: 6000 new + 3000 for Y = 9000, not over 10000.
        expect(evictionPlan([header(X, 6000, 200), header(Y, 3000, 100)], X, 6000, CAP, new Set([X]))).toEqual([])
        // X grows to 8000: 8000 + 3000 is over, and Y is the only candidate.
        expect(owners(evictionPlan([header(X, 6000, 200), header(Y, 3000, 100)], X, 8000, CAP, new Set([X])))).toEqual([Y])
    })

    test('candidates go oldest first, ties by key, and picking stops as soon as the total fits', () => {
        const headers = [header(P, 3000, 10), header(Q, 3000, 10), header(Y, 3000, 5)]
        // 5000 + 9000 = 14000; Y (oldest) -> 11000; then the tie P/Q by key picks P -> 8000.
        expect(owners(evictionPlan(headers, X, 5000, CAP, new Set([X])))).toEqual([Y, P])
    })

    test('equal touch times are broken by key whatever the input order', () => {
        // 5000 + 6000 = 11000: one victim is enough, and of the tie it is the lower key.
        expect(owners(evictionPlan([header(Q, 3000, 10), header(P, 3000, 10)], X, 5000, CAP, new Set([X])))).toEqual([P])
        expect(owners(evictionPlan([header(P, 3000, 10), header(Q, 3000, 10)], X, 5000, CAP, new Set([X])))).toEqual([P])
    })

    test('exactly at the cap is not over', () => {
        expect(evictionPlan([header(P, 5000, 1)], X, 5000, CAP, new Set([X]))).toEqual([])
        expect(owners(evictionPlan([header(P, 5001, 1)], X, 5000, CAP, new Set([X])))).toEqual([P])
    })

    test('it does not mutate its input', () => {
        const headers = [header(Q, 3000, 100), header(P, 3000, 50)]
        const copy = JSON.stringify(headers)
        evictionPlan(headers, X, 9000, CAP, new Set([X]))
        expect(JSON.stringify(headers)).toBe(copy)
    })
})

// ---------------------------------------------------------------- the memory double: S4, S5, S6

describe('memory double: save transaction', () => {
    test('T-S5b the written owner is counted once: an unchanged re-save deletes nothing, growth evicts the oldest owner and its generation', async () => {
        const CAP = 10000
        const store = createMemoryStudioStore({ capBytes: CAP })
        const recY = sized(Y, 100, CAP * 0.3, 'c')
        const recZ = sized(Z, 150, CAP * 0.45, 'd')
        const recX = sized(X, 200, CAP * 0.2)
        const recXBig = sized(X, 300, CAP * 0.45)
        const [sY, sZ, sX, sXBig] = [recY, recZ, recX, recXBig].map(sizeOf)
        // The fixture states its own preconditions, so a mis-tuned fixture cannot pass vacuously.
        for (const record of [recY, recZ, recX, recXBig]) {
            expect(sizeOf(record)).toBeLessThanOrEqual(ownerCapFor(CAP))
        }
        expect(sX + sY + sZ).toBeLessThanOrEqual(CAP)
        expect(2 * sX + sY + sZ).toBeGreaterThan(CAP)
        expect(sXBig + sY + sZ).toBeGreaterThan(CAP)
        expect(sXBig + sZ).toBeLessThanOrEqual(CAP)

        await loadThenSave(store, recY)
        await loadThenSave(store, recZ)
        await loadThenSave(store, recX)
        const yEntries = ownerEntries(store.shared, Y)
        expect(yEntries.length).toBeGreaterThan(2)

        // Re-save X unchanged: the total is about 9500, which is not over the cap.
        const result = await store.save(X, recX, new Set([X]))
        expect(result).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(ownerEntries(store.shared, Y)).toEqual(yEntries)

        // X grows: the total is over the cap and Y, the oldest owner, goes with its generation.
        await store.save(X, recXBig, new Set([X]))
        expect(store.shared.has(headerKey(Y))).toBe(false)
        expect(ownerEntries(store.shared, Y)).toEqual([])
        expect([...store.shared.keys()].some((key) => key.startsWith(`e:${Y.length}:${Y}|`))).toBe(false)
        expect(ownerEntries(store.shared, Z).length).toBeGreaterThan(2)
        expect(storedRecord(store.shared, X)?.record).toEqual(recXBig)
    })

    test('T-S5c a header whose value names another owner is not counted and never deleted', async () => {
        const CAP = 10000
        const store = createMemoryStudioStore({ capBytes: CAP })
        const recB = sized(B, 100, CAP * 0.45, 'b')
        const recX = sized(X, 200, CAP * 0.45)
        const sB = sizeOf(recB)
        const sX = sizeOf(recX)
        expect(sX + 2 * sB).toBeGreaterThan(CAP)
        expect(CAP).toBeGreaterThanOrEqual(sX + sB)

        await loadThenSave(store, recB)
        // Hand-written stand-in for a broken producer: a header under key A that names owner B,
        // older than B's own header.
        const stray = serializeHeader({ wid: 'stray:1', gen: 'stray', ownerKey: B, size: sB, touchedAt: 50 })
        store.shared.set(headerKey(A), stray)
        const before = snapshot(store.shared)

        await loadThenSave(store, recX)
        for (const [key, value] of before) {
            expect(store.shared.get(key), key).toBe(value)
        }
        const xKeys = expectedOwnerKeys(storedRecord(store.shared, X)!.header, recX)
        expect([...store.shared.keys()].sort()).toEqual([...before.keys(), ...xKeys].sort())
    })

    test('T-S6b an owner over the owner cap is stored trimmed from a copy; the argument keeps every step', async () => {
        const CAP = 10000
        const store = createMemoryStudioStore({ capBytes: CAP })
        const steps: Step[] = Array.from({ length: 40 }, (_, i) => descStep(`p:${i}`, `${'a'.repeat(60)}${i}`, `${'b'.repeat(60)}${i}`))
        const record = recordOf(X, 5, steps)
        expect(sizeOf(record)).toBeGreaterThan(ownerCapFor(CAP))
        const frozen = JSON.stringify(record)

        const result = await loadThenSave(store, record)
        expect(result).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(JSON.stringify(record)).toBe(frozen)
        expect(record.done).toHaveLength(40)

        const stored = storedRecord(store.shared, X)
        expect(stored).not.toBeNull()
        expect(stored!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
        // The oldest steps went first; the newest survives.
        expect(stored!.record.done.length).toBeGreaterThan(0)
        expect(stored!.record.done.length).toBeLessThan(40)
        expect(stored!.record.done.at(-1)?.id).toBe('p:39')
    })

    test('T-S8 unreadable, orphan, foreign, retired and unknown keys are never counted nor deleted; eviction removes a header and its generation together', async () => {
        const CAP = 10000
        const store = createMemoryStudioStore({ capBytes: CAP })
        const recP = sized(P, 10, CAP * 0.4, 'p')
        const recQ = sized(Q, 20, CAP * 0.3, 'q')
        const recW = sized(X, 30, CAP * 0.45)
        await loadThenSave(store, recP)
        await loadThenSave(store, recQ)
        const hugeValue = 'junk'.repeat(5000)
        const zOrphan = characterOwnerKey('orphan')
        const zBad = characterOwnerKey('badheader')
        const zV2 = characterOwnerKey('v2')
        const bystanders: [string, string][] = [
            // Entries with no header: orphans.
            [entryKey(zOrphan, 'zz-foreign:1', 's:x'), hugeValue],
            // A header that does not parse, and an entry under it.
            [headerKey(zBad), '{not json'],
            [entryKey(zBad, 'zz-foreign:1', 'i'), hugeValue],
            // A hand-written later-producer header with a huge size, and an entry under it.
            [headerKey(zV2), JSON.stringify({ v: 2, wid: 'w', gen: 'zz-foreign:2', ownerKey: zV2, size: 999999, touchedAt: 1 })],
            [entryKey(zV2, 'zz-foreign:2', 'i'), hugeValue],
            // The aside marker of another owner.
            [asideMarkKey(A), hugeValue],
            // The retired prefixes of an earlier layout, and an unknown one.
            ['rec:' + A, hugeValue],
            ['hdr:' + A, hugeValue],
            ['aside:' + A, hugeValue],
            ['asideh:' + A, hugeValue],
            ['zzz:unknown', hugeValue],
        ]
        for (const [key, value] of bystanders) {
            store.shared.set(key, value)
        }
        const qEntries = ownerEntries(store.shared, Q)

        await loadThenSave(store, recW)
        // 4000 + 3000 + 4500 = 11500 > cap: the oldest counted owner (P) goes with its generation.
        expect(ownerEntries(store.shared, P)).toEqual([])
        expect(store.shared.has(headerKey(P))).toBe(false)
        expect(ownerEntries(store.shared, Q)).toEqual(qEntries)
        for (const [key, value] of bystanders) {
            expect(store.shared.get(key), key).toBe(value)
        }
    })

    test('T-S8 a save on the match path writes no aside marker, and a load reads the entries of the header generation only', async () => {
        const store = createMemoryStudioStore()
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        await store.save(X, { ...record, touchedAt: 2 }, new Set([X]))
        await store.save(X, { ...record, touchedAt: 3 }, new Set([X]))
        expect(store.shared.has(asideMarkKey(X))).toBe(false)
        // A load reads the entries of the header's generation, nothing else.
        const other = createMemoryStudioStore({ shared: store.shared })
        await other.load(X)
        expect(other.counts.entryValueReads).toBe(keysInBounds(store.shared, genBounds(X, storedRecord(store.shared, X)!.header.gen)).length)
    })

    test('protect keeps an older owner out of the plan, in the double as in the pure function', async () => {
        const CAP = 10000
        const store = createMemoryStudioStore({ capBytes: CAP })
        const recP = sized(P, 10, CAP * 0.4, 'p')
        const recQ = sized(Q, 20, CAP * 0.3, 'q')
        await loadThenSave(store, recP)
        await loadThenSave(store, recQ)
        await loadThenSave(store, sized(X, 30, CAP * 0.45), new Set([X, P]))
        expect(storedRecord(store.shared, P)).not.toBeNull()
        expect(store.shared.has(headerKey(Q))).toBe(false)
    })

    test('F6 a record evicted by another tab is recreated by the next save from memory', async () => {
        const shared = new Map<string, string>()
        const tabA = createMemoryStudioStore({ shared })
        const record = sized(X, 1, 600)
        await loadThenSave(tabA, record)
        for (const key of [...shared.keys()]) {
            shared.delete(key)
        }
        const result = await tabA.save(X, record, new Set([X]))
        expect(result).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(storedRecord(shared, X)?.record).toEqual(record)
    })

    test('a quota failure leaves the Map untouched and the expectation standing, so the next save retries', async () => {
        const store = createMemoryStudioStore()
        const record = sized(X, 1, 600)
        await store.load(X)
        store.forcedSave = { kind: 'unwritable' }
        const before = snapshot(store.shared)
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(store.shared).toEqual(before)
        store.forcedSave = null
        expect(await store.save(X, record, new Set([X]))).toMatchObject({ kind: 'ok' })
    })

    test('a record that breaks the id rule is unwritable and writes nothing', async () => {
        const store = createMemoryStudioStore()
        await store.load(X)
        const twice = recordOf(X, 1, [descStep('p:1', 'a', 'b')], { undone: [descStep('p:1', 'b', 'c')] })
        const empty = recordOf(X, 1, [descStep('', 'a', 'b')])
        const twiceDeleted = recordOf(X, 1, [], {
            deleted: [
                { id: 'd', at: 1, index: 0, value: 'a', sideChat: null },
                { id: 'd', at: 2, index: 1, value: 'b', sideChat: null },
            ],
        })
        for (const record of [twice, empty, twiceDeleted]) {
            expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'unwritable' })
        }
        expect(store.shared.size).toBe(0)
        // A deleted item may carry the id of a step.
        const shared = recordOf(X, 1, [descStep('p:1', 'a', 'b')], { deleted: [{ id: 'p:1', at: 1, index: 0, value: 'a', sideChat: null }] })
        expect(await store.save(X, shared, new Set([X]))).toMatchObject({ kind: 'ok' })
    })

    test('the default store cap is 4 MiB, the owner cap is half of it, and the sizing constants are pinned', () => {
        expect(CAP_BYTES).toBe(4 * 1024 * 1024)
        expect(OWNER_CAP_BYTES).toBe(CAP_BYTES / 2)
        expect(ownerCapFor(CAP_BYTES)).toBe(OWNER_CAP_BYTES)
        // Part of the v1 format: a stored header's size is checked against them when it is read.
        expect(ENTRY_OVERHEAD).toBe(144)
        expect(OWNER_OVERHEAD).toBe(512)
    })

    test('a page session with a bar is refused at construction', () => {
        expect(() => createMemoryStudioStore({ pageSession: 'a|b' })).toThrow()
    })
})

// ---------------------------------------------------------------- never write what was not read (S4)

describe('memory double: S4 guard and aside rule', () => {
    test('T-S15 a state written by another page is copied aside once, its generation stays, then this page puts its own', async () => {
        const shared = new Map<string, string>()
        const pageA = createMemoryStudioStore({ shared, pageSession: 'a' })
        const pageB = createMemoryStudioStore({ shared, pageSession: 'b' })
        await pageA.load(X)
        expect(pageA.expectationOf(X)).toEqual({ kind: 'none' })
        await loadThenSave(pageB, sized(X, 5, 800, 'b'))
        const bHeader = shared.get(headerKey(X)) as string
        const bGen = storedRecord(shared, X)!.header.gen
        const bEntries = keysInBounds(shared, genBounds(X, bGen)).map((key) => [key, shared.get(key)])

        const mine = sized(X, 9, 800, 'm')
        expect(await pageA.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        expect(shared.get(asideMarkKey(X))).toBe(bHeader)
        expect(storedRecord(shared, X)?.record).toEqual(mine)
        // The foreign generation is kept, byte for byte.
        expect(keysInBounds(shared, genBounds(X, bGen)).map((key) => [key, shared.get(key)])).toEqual(bEntries)

        // Now A's expectation is its own wid: the next save is on the match path and the marker stays put.
        expect(await pageA.save(X, { ...mine, touchedAt: 10 }, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(shared.get(asideMarkKey(X))).toBe(bHeader)
    })

    test('T-S15 with the aside marker already taken, nothing is written and the answer is kept', async () => {
        const shared = new Map<string, string>()
        const pageA = createMemoryStudioStore({ shared })
        const pageB = createMemoryStudioStore({ shared })
        await pageA.load(X)
        await loadThenSave(pageB, sized(X, 5, 800, 'b'))
        shared.set(asideMarkKey(X), 'taken earlier')
        const before = snapshot(shared)
        expect(await pageA.save(X, sized(X, 9, 800, 'm'), new Set([X]))).toEqual({ kind: 'kept' })
        expect(shared).toEqual(before)
    })

    test('T-S15 a save without a prior load is notLoaded and writes nothing', async () => {
        const store = createMemoryStudioStore()
        expect(await store.save(X, sized(X, 5, 800), new Set([X]))).toEqual({ kind: 'notLoaded' })
        expect(store.shared.size).toBe(0)
    })

    test('T-S15c entries with no header are orphans: load says absent, the save writes a fresh generation and leaves them byte-identical', async () => {
        const shared = new Map<string, string>()
        const store = createMemoryStudioStore({ shared })
        // Entries of an earlier generation whose header is gone, written by the store's own writer.
        seedOwner(shared, sized(X, 5, 800, 'o'), 'zz-foreign:1')
        shared.delete(headerKey(X))
        const orphans = snapshot(shared)

        expect(await store.load(X)).toEqual({ kind: 'absent' })
        const mine = sized(X, 9, 800, 'm')
        expect(await store.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        for (const [key, value] of orphans) {
            expect(shared.get(key), key).toBe(value)
        }
        expect(storedRecord(shared, X)?.record).toEqual(mine)
        expect(shared.has(asideMarkKey(X))).toBe(false)
    })

    test('T-S3 an unreadable v2 header is copied aside byte-equal, later saves persist, a new page loads the v1 record', async () => {
        const shared = new Map<string, string>()
        const first = createMemoryStudioStore({ shared })
        // Hand-written v2 header: stands for a later producer.
        const v2Header = JSON.stringify({ v: 2, wid: 'later:1', ownerKey: X, size: 5, touchedAt: 1 })
        shared.set(headerKey(X), v2Header)

        expect(await first.load(X)).toEqual({ kind: 'unreadable' })
        const mine = sized(X, 9, 800, 'm')
        expect(await first.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        expect(shared.get(asideMarkKey(X))).toBe(v2Header)
        const later = { ...mine, touchedAt: 12 }
        expect(await first.save(X, later, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })

        const second = createMemoryStudioStore({ shared })
        // The marker being taken does not matter once the owner is readable again.
        expect(await second.load(X)).toEqual({ kind: 'ok', record: later })
        expect(shared.get(asideMarkKey(X))).toBe(v2Header)
    })

    test('T-S3b an unreadable header with the marker present is kept: both values stay byte-identical', async () => {
        const shared = new Map<string, string>()
        const store = createMemoryStudioStore({ shared })
        shared.set(headerKey(X), JSON.stringify({ v: 2, wid: 'later:1', ownerKey: X, size: 5, touchedAt: 1 }))
        shared.set(asideMarkKey(X), 'earlier header')
        const before = snapshot(shared)

        expect(await store.load(X)).toEqual({ kind: 'keptUnreadable' })
        for (let i = 0; i < 3; i++) {
            expect(await store.save(X, sized(X, 9 + i, 800, 'm'), new Set([X]))).toEqual({ kind: 'kept' })
        }
        expect(shared).toEqual(before)
    })

    test('R5-12 a header under one key that names another owner is unreadable for the key it sits under: nothing is deleted', async () => {
        const shared = new Map<string, string>()
        const store = createMemoryStudioStore({ shared })
        await loadThenSave(store, sized(B, 3, 600, 'b'))
        const bEntries = ownerEntries(shared, B)
        const stray = shared.get(headerKey(B)) as string
        shared.set(headerKey(A), stray)
        const before = snapshot(shared)

        expect(await store.load(A)).toEqual({ kind: 'unreadable' })
        expect(ownerEntries(shared, B)).toEqual(bEntries)
        expect(shared).toEqual(before)
    })

    test('T-D2 a deleted item and the restore point survive a save and a load by a new page', async () => {
        const shared = new Map<string, string>()
        const record = recordOf(X, 4, [descStep('p:1', 'a', 'b')], {
            deleted: [{ id: 'd1', at: 2, index: 0, value: 'gone', sideChat: null }],
            restore: { visitId: 'v', at: 1, fields: { desc: { before: { had: true, value: 'a' }, last: { had: true, value: 'b' } } } },
        })
        await loadThenSave(createMemoryStudioStore({ shared }), record)
        expect(await createMemoryStudioStore({ shared }).load(X)).toEqual({ kind: 'ok', record })
    })

    test('a chat owner round-trips through the store', async () => {
        const chat = chatOwnerKey('c1', 'chatA')
        const record = recordOf(chat, 3, [
            { id: 'p:1', at: 1, label: { kind: 'field', field: 'note' }, ops: [{ op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'n' } }] },
        ])
        const shared = new Map<string, string>()
        await loadThenSave(createMemoryStudioStore({ shared }), record)
        expect(await createMemoryStudioStore({ shared }).load(chat)).toEqual({ kind: 'ok', record })
    })

    test('every key the double writes uses the pinned v1 forms', async () => {
        const store = createMemoryStudioStore()
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        const stored = storedRecord(store.shared, X)!
        expect([...store.shared.keys()].sort()).toEqual(expectedOwnerKeys(stored.header, record))
        for (const key of store.shared.keys()) {
            expect(key.startsWith('h:') || key.startsWith('e:')).toBe(true)
        }
        expect(store.shared.has(asideMarkKey(X))).toBe(false)
    })
})

// ---------------------------------------------------------------- close, hooks and counters

describe('memory double: close, hooks and counters', () => {
    test('T-S17 simulateClose fires onClosed once; save and load then answer without touching the Map', async () => {
        const store = createMemoryStudioStore()
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        let closed = 0
        store.onClosed(() => (closed += 1))
        const before = snapshot(store.shared)

        store.simulateClose()
        store.simulateClose()
        expect(closed).toBe(1)
        expect(store.isClosed()).toBe(true)
        expect(await store.save(X, { ...record, touchedAt: 9 }, new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(await store.load(Y)).toEqual({ kind: 'failed' })
        expect(await store.open()).toBe('unavailable')
        expect(store.shared).toEqual(before)
    })

    test('a gated hook holds the call until released, and a call that never settles stays pending', async () => {
        const store = createMemoryStudioStore()
        const gate = createGate()
        store.hooks.open = () => gate.promise
        store.hooks.load = () => new Promise<void>(() => undefined)
        let opened: string | null = null
        let loaded: string | null = null
        void store.open().then((r) => (opened = r))
        void store.load(X).then((r) => (loaded = r.kind))
        await drainMicrotasks()
        expect(opened).toBeNull()
        gate.release()
        await drainMicrotasks()
        expect(opened).toBe('ok')
        expect(loaded).toBeNull()
        expect(store.counts.open).toBe(1)
        expect(store.counts.load).toBe(1)
    })

    test('a gated save writes only when released, so the Map is untouched meanwhile', async () => {
        const store = createMemoryStudioStore()
        await store.load(X)
        const gate = createGate()
        store.hooks.save = () => gate.promise
        const record = sized(X, 1, 600)
        const pending = store.save(X, record, new Set([X]))
        await drainMicrotasks()
        expect(store.shared.size).toBe(0)
        gate.release()
        expect(await pending).toMatchObject({ kind: 'ok' })
        // The header and the generation's index and step.
        expect(store.shared.size).toBe(3)
    })

    test('a throwing or rejecting hook makes the double reject (input for the service defence in depth)', async () => {
        const store = createMemoryStudioStore()
        store.hooks.open = () => {
            throw new Error('open boom')
        }
        store.hooks.load = () => Promise.reject(new Error('load boom'))
        await expect(store.open()).rejects.toThrow('open boom')
        await expect(store.load(X)).rejects.toThrow('load boom')
    })

    test('every save request is logged with the record it carried, and every write with its requests', async () => {
        const store = createMemoryStudioStore()
        const record = sized(X, 1, 600)
        const protect = new Set([X])
        await loadThenSave(store, record, protect)
        expect(store.saves).toHaveLength(1)
        expect(store.saves[0].record).toBe(record)
        expect(store.saves[0].protect).toBe(protect)
        expect(store.writes).toHaveLength(1)
        expect(store.writes[0].requests.at(-1)).toMatchObject({ op: 'put', key: headerKey(X) })
    })

    test('two instances over one Map count their own calls separately', async () => {
        const shared = new Map<string, string>()
        const one = createMemoryStudioStore({ shared })
        const two = createMemoryStudioStore({ shared })
        await one.load(X)
        await one.load(X)
        await two.load(X)
        expect(one.counts.load).toBe(2)
        expect(two.counts.load).toBe(1)
    })
})

// ---------------------------------------------------------------- claim double

describe('claim double', () => {
    test('T-C4b a second request for a name this page holds is held (not re-entrant)', async () => {
        const page = createClaimDouble()
        expect(await page.tryClaim('c1')).toBe('granted')
        expect(await page.tryClaim('c1')).toBe('held')
        expect(await page.tryClaim('c2')).toBe('granted')
        expect(page.calls).toEqual(['c1', 'c1', 'c2'])
        expect(page.holds('c1')).toBe(true)
    })

    test('another page is held until the holder page ends', async () => {
        const world = createClaimWorld()
        const first = world.createPage()
        const second = world.createPage()
        expect(await first.tryClaim('c1')).toBe('granted')
        expect(await second.tryClaim('c1')).toBe('held')
        first.endPage()
        expect(first.holds('c1')).toBe(false)
        const third = world.createPage()
        expect(await third.tryClaim('c1')).toBe('granted')
    })

    test('a page without Web Locks answers unsupported and takes nothing', async () => {
        const page = createClaimDouble()
        page.unsupported = true
        expect(await page.tryClaim('c1')).toBe('unsupported')
        expect(page.holds('c1')).toBe(false)
    })

    test('a gated claim answers only when released; a late grant still takes the lock', async () => {
        const page = createClaimDouble()
        const gate = createGate()
        page.hook = () => gate.promise
        let answer: string | null = null
        void page.tryClaim('c1').then((r) => (answer = r))
        await drainMicrotasks()
        expect(answer).toBeNull()
        gate.release()
        await drainMicrotasks()
        expect(answer).toBe('granted')
        expect(page.holds('c1')).toBe(true)
    })

    test('a rejecting hook makes tryClaim reject, and a forced answer is returned as is', async () => {
        const page = createClaimDouble()
        page.hook = () => {
            throw new Error('claim boom')
        }
        await expect(page.tryClaim('c1')).rejects.toThrow('claim boom')
        page.hook = null
        page.forced = 'failed'
        expect(await page.tryClaim('c1')).toBe('failed')
        expect(page.holds('c1')).toBe(false)
    })
})
