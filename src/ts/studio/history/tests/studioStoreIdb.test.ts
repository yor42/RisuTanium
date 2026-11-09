// The IndexedDB adapter of the Studio history store over fake-indexeddb: the pinned v1 layout (a header
// per owner and an index plus one entry per step under one owner/generation key range), load, the S4
// never-put-over-unread-data guard, the S5 total and eviction, the per-owner cap, the S6 errors and the
// closed connection. Stored bytes come from the store's own writers (the adapter itself, or
// `seedOwner`); a hand-written value stands only for a later or broken producer and says so. Every
// case uses a fresh factory, so no database leaks from one case to the next.
import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore, forceCloseDatabase, IDBDatabase } from 'fake-indexeddb'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DeletedItem, OwnerRecord, RestorePoint, Step } from '../historyModel'
import { characterOwnerKey, chatOwnerKey, type OwnerKey } from '../ownerPhase'
import {
    CAP_BYTES,
    ENTRY_OVERHEAD,
    OWNER_CAP_BYTES,
    OWNER_OVERHEAD,
    asideMarkKey,
    entryKey,
    genBounds,
    genPrefix,
    headerKey,
    ownerBounds,
    ownerCapFor,
    readHeader,
    serializeHeader,
    storedSizeOf,
    type StudioHistoryStore,
} from '../studioHistoryStore'
import { STUDIO_DB_NAME, STUDIO_DB_VERSION, STUDIO_STORE_NAME, createStudioStoreIdb } from '../studioStoreIdb'
import { expectedOwnerKeys, keysInBounds, seedOwner, storedRecord, walkOracle } from './studioStoreDoubles'

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

function filled(ownerKey: OwnerKey, touchedAt: number, fill: number, letter = 'a'): OwnerRecord {
    return recordOf(ownerKey, touchedAt, [descStep('p:1', letter.repeat(fill), 'z'.repeat(fill))])
}

// Solves the filler length from the measured per-owner overhead so the stored size is about `target` bytes.
function fillFor(ownerKey: OwnerKey, target: number): number {
    const overhead = sizeOf(filled(ownerKey, 0, 0))
    return Math.max(0, Math.round((target - overhead) / 4))
}

function sized(ownerKey: OwnerKey, touchedAt: number, target: number, letter = 'a'): OwnerRecord {
    return filled(ownerKey, touchedAt, fillFor(ownerKey, target), letter)
}

// `count` steps of `fill` characters each way: an owner whose memory can exceed the owner cap while
// every step stays small enough to be kept or dropped on its own.
function stepsRecord(ownerKey: OwnerKey, touchedAt: number, count: number, fill = 100, extra: Partial<OwnerRecord> = {}): OwnerRecord {
    const steps = Array.from({ length: count }, (_, i) => descStep(`${ownerKey.slice(10)}:${i}`, `${'a'.repeat(fill)}${i}`, `${'b'.repeat(fill)}${i}`))
    return recordOf(ownerKey, touchedAt, steps, extra)
}

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const C = characterOwnerKey('C')
const D = characterOwnerKey('D')
const X = characterOwnerKey('X')
const Y = characterOwnerKey('Y')
const Z = characterOwnerKey('Z')
const P = characterOwnerKey('P')
const Q = characterOwnerKey('Q')

// ---------------------------------------------------------------- raw access to the same database

function rawOpen(factory: IDBFactory, version = STUDIO_DB_VERSION): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open(STUDIO_DB_NAME, version)
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STUDIO_STORE_NAME)) {
                request.result.createObjectStore(STUDIO_STORE_NAME)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
    })
}

async function dump(factory: IDBFactory, version = STUDIO_DB_VERSION): Promise<Map<string, string>> {
    const db = await rawOpen(factory, version)
    const tx = db.transaction(STUDIO_STORE_NAME, 'readonly')
    const finished = done(tx)
    const objects = tx.objectStore(STUDIO_STORE_NAME)
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = objects.getAllKeys()
        request.onsuccess = () => resolve(request.result)
    })
    const values = await new Promise<unknown[]>((resolve) => {
        const request = objects.getAll()
        request.onsuccess = () => resolve(request.result)
    })
    await finished
    db.close()
    return new Map(keys.map((key, index) => [String(key), String(values[index])]))
}

async function seed(factory: IDBFactory, entries: Iterable<[string, string]>, version = STUDIO_DB_VERSION): Promise<void> {
    const db = await rawOpen(factory, version)
    const tx = db.transaction(STUDIO_STORE_NAME, 'readwrite')
    const finished = done(tx)
    for (const [key, value] of entries) {
        tx.objectStore(STUDIO_STORE_NAME).put(value, key)
    }
    await finished
    db.close()
}

async function removeKeys(factory: IDBFactory, keys: Iterable<string>): Promise<void> {
    const db = await rawOpen(factory)
    const tx = db.transaction(STUDIO_STORE_NAME, 'readwrite')
    const finished = done(tx)
    for (const key of keys) {
        tx.objectStore(STUDIO_STORE_NAME).delete(key)
    }
    await finished
    db.close()
}

function newStore(factory: IDBFactory, options: { capBytes?: number; pageSession?: string } = {}): StudioHistoryStore {
    return createStudioStoreIdb({ factory, ...options })
}

async function loadThenSave(store: StudioHistoryStore, record: OwnerRecord, protect: ReadonlySet<OwnerKey> = new Set([record.ownerKey])) {
    await store.load(record.ownerKey)
    return store.save(record.ownerKey, record, protect)
}

// Every key and value that belongs to the owner: its header and its generation.
function ownerEntries(stored: Map<string, string>, owner: OwnerKey): [string, string][] {
    const view = storedRecord(stored, owner)
    if (!view) {
        return []
    }
    return [headerKey(owner), ...view.keys].map((key) => [key, stored.get(key) as string])
}

function entriesUnder(stored: Map<string, string>, owner: OwnerKey): string[] {
    return keysInBounds(stored, ownerBounds(owner))
}

// Records every write request the adapter issues, in order: puts by key, deletes by key or by the
// lower bound of a range (`range:<lower>`).
interface WriteLog {
    puts: string[]
    deletes: string[]
    requests: IDBRequest[]
}

function spyOnWrites(): WriteLog {
    const log: WriteLog = { puts: [], deletes: [], requests: [] }
    const nativePut = IDBObjectStore.prototype.put
    const nativeDelete = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        log.puts.push(String(key))
        const request = nativePut.call(this, value, key)
        log.requests.push(request)
        return request
    })
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        log.deletes.push(query instanceof IDBKeyRange ? `range:${String(query.lower)}` : String(query))
        const request = nativeDelete.call(this, query)
        log.requests.push(request)
        return request
    })
    return log
}

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------- the pinned v1 layout

describe('layout and open', () => {
    test('S1 the database is risuStudio, version 1, one store records, and nothing else exists', async () => {
        const factory = new IDBFactory()
        const requested: [string, number | undefined][] = []
        const watching = {
            open(name: string, version?: number) {
                requested.push([name, version])
                return factory.open(name, version)
            },
        }
        const store = createStudioStoreIdb({ factory: watching })
        expect(await store.open()).toBe('ok')
        expect(await store.open()).toBe('ok')
        expect(requested).toEqual([['risuStudio', 1]])
        expect(await factory.databases()).toEqual([{ name: 'risuStudio', version: 1 }])
        const db = await rawOpen(factory)
        expect([...db.objectStoreNames]).toEqual(['records'])
        db.close()
    })

    test('S2 every key a save writes uses the pinned v1 forms, and the header describes the generation', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'pg' })
        const record = sized(X, 7, 600)
        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const stored = await dump(factory)
        const view = storedRecord(stored, X)!
        expect([...stored.keys()].sort()).toEqual(expectedOwnerKeys(view.header, record))
        expect(view.header).toEqual({ wid: 'pg:1', gen: 'pg:1', ownerKey: X, size: sizeOf(record), touchedAt: 7 })
        expect(readHeader(stored.get(headerKey(X)), X)).toEqual(view.header)
        expect(view.record).toEqual(record)
        expect(entryKey(X, 'pg:1', 's:p:1')).toBe(`e:${X.length}:${X}|pg:1|s:p:1`)
        for (const key of stored.keys()) {
            expect(key.startsWith('h:') || key.startsWith('e:')).toBe(true)
        }
    })

    test('a chat owner and a deleted item with its restore point round-trip through a new adapter instance (T-D2)', async () => {
        const factory = new IDBFactory()
        const chat = chatOwnerKey('c1', 'chatA')
        const chatRecord = recordOf(chat, 3, [
            { id: 'p:1', at: 1, label: { kind: 'field', field: 'note' }, ops: [{ op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'n' } }] },
        ])
        const deleted: DeletedItem = { id: 'd1', at: 2, index: 0, value: 'gone', sideChat: null }
        const withExtras = recordOf(X, 4, [descStep('p:2', 'a', 'b')], {
            deleted: [deleted],
            restore: { visitId: 'v', at: 1, fields: { desc: { before: { had: true, value: 'a' }, last: { had: true, value: 'b' } } } },
        })
        const first = newStore(factory)
        await loadThenSave(first, chatRecord)
        await loadThenSave(first, withExtras)
        const second = newStore(factory)
        expect(await second.load(chat)).toEqual({ kind: 'ok', record: chatRecord })
        expect(await second.load(X)).toEqual({ kind: 'ok', record: withExtras })
        expect(await second.load(Y)).toEqual({ kind: 'absent' })
    })

    test('a page without IndexedDB, or a factory that throws, is unavailable and never throws', async () => {
        const none = createStudioStoreIdb({ factory: null })
        expect(await none.open()).toBe('unavailable')
        expect(await none.load(X)).toEqual({ kind: 'failed' })
        expect(await none.save(X, sized(X, 1, 600), new Set([X]))).toEqual({ kind: 'unwritable' })

        const throwing = createStudioStoreIdb({
            factory: {
                open() {
                    throw new DOMException('blocked', 'SecurityError')
                },
            },
        })
        expect(await throwing.open()).toBe('unavailable')
        expect(await throwing.load(X)).toEqual({ kind: 'failed' })
        expect(await throwing.save(X, sized(X, 1, 600), new Set([X]))).toEqual({ kind: 'unwritable' })
    })

    test('a database of this name without the records store is left alone and unavailable', async () => {
        const factory = new IDBFactory()
        await new Promise<void>((resolve) => {
            const request = factory.open(STUDIO_DB_NAME, 1)
            request.onupgradeneeded = () => request.result.createObjectStore('somethingElse')
            request.onsuccess = () => {
                request.result.close()
                resolve()
            }
        })
        const store = newStore(factory)
        expect(await store.open()).toBe('unavailable')
        expect(await store.load(X)).toEqual({ kind: 'failed' })
        const db = await new Promise<IDBDatabase>((resolve) => {
            const request = factory.open(STUDIO_DB_NAME, 1)
            request.onsuccess = () => resolve(request.result)
        })
        expect([...db.objectStoreNames]).toEqual(['somethingElse'])
        db.close()
    })

    test('the default store cap is the named constant, the owner cap is half of it, and the sizing constants are pinned', () => {
        expect(CAP_BYTES).toBe(4 * 1024 * 1024)
        expect(OWNER_CAP_BYTES).toBe(CAP_BYTES / 2)
        expect(ENTRY_OVERHEAD).toBe(144)
        expect(OWNER_OVERHEAD).toBe(512)
    })

    test('a page session with a bar is refused at construction', () => {
        expect(() => createStudioStoreIdb({ factory: new IDBFactory(), pageSession: 'a|b' })).toThrow()
    })
})

// ---------------------------------------------------------------- S9 and S17: version clash, closed connection

describe('version clash and closed connection', () => {
    test('T-S9 a database already at version 2 is unavailable; its data stays and nothing is deleted or re-created', async () => {
        const factory = new IDBFactory()
        await seed(factory, [['zzz:later', 'later producer']], 2)
        const deleteDatabase = vi.spyOn(factory, 'deleteDatabase')
        const requested: [string, number | undefined][] = []
        const store = createStudioStoreIdb({
            factory: {
                open(name, version) {
                    requested.push([name, version])
                    return factory.open(name, version)
                },
            },
        })
        expect(await store.open()).toBe('unavailable')
        expect(await store.load(X)).toEqual({ kind: 'failed' })
        expect(await store.save(X, sized(X, 1, 600), new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(requested).toEqual([['risuStudio', 1]])
        expect(deleteDatabase).not.toHaveBeenCalled()
        expect(await dump(factory, 2)).toEqual(new Map([['zzz:later', 'later producer']]))
    })

    test('T-S9 a versionchange from another connection closes this one, fires onClosed once and leaves the data alone', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        let closed = 0
        store.onClosed(() => (closed += 1))
        const before = await dump(factory)

        // The upgrade can only proceed if the adapter stepped aside.
        await seed(factory, [['zzz:later', 'later producer']], 2)
        expect(closed).toBe(1)
        expect(await store.save(X, { ...record, touchedAt: 9 }, new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(await store.load(X)).toEqual({ kind: 'failed' })
        expect(await store.open()).toBe('unavailable')
        const after = await dump(factory, 2)
        for (const [key, value] of before) {
            expect(after.get(key), key).toBe(value)
        }
    })

    test('T-S17 adapter: a forced close event fires onClosed once; later save and load answer without touching IndexedDB', async () => {
        const factory = new IDBFactory()
        const connections: IDBDatabase[] = []
        const store = createStudioStoreIdb({
            factory: {
                open(name, version) {
                    const request = factory.open(name, version)
                    request.addEventListener('success', () => connections.push(request.result))
                    return request
                },
            },
        })
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        let closed = 0
        store.onClosed(() => (closed += 1))
        const before = await dump(factory)
        expect(connections).toHaveLength(1)

        const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
        forceCloseDatabase(connections[0] as unknown as Parameters<typeof forceCloseDatabase>[0])
        forceCloseDatabase(connections[0] as unknown as Parameters<typeof forceCloseDatabase>[0])
        expect(closed).toBe(1)
        expect(await store.save(X, { ...record, touchedAt: 9 }, new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(await store.load(Y)).toEqual({ kind: 'failed' })
        expect(await store.open()).toBe('unavailable')
        expect(transaction).not.toHaveBeenCalled()
        expect(await dump(factory)).toEqual(before)
        // A callback registered after the close is told at once.
        let late = 0
        store.onClosed(() => (late += 1))
        expect(late).toBe(1)
    })
})

// ---------------------------------------------------------------- S5 and S6: the cap

describe('save transaction: total, eviction, trim, errors', () => {
    test('T-S5b the written owner is counted once: an unchanged re-save deletes nothing, growth evicts the oldest owner and its generation', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
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
        const yEntries = ownerEntries(await dump(factory), Y)
        expect(yEntries.length).toBeGreaterThan(2)
        // A generation the victim's header does not name: an eviction removes the named generation only.
        const foreignKey = entryKey(Y, 'zz-foreign:1', 's:x')
        await seed(factory, [[foreignKey, 'junk']])

        expect(await store.save(X, recX, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(ownerEntries(await dump(factory), Y)).toEqual(yEntries)

        await store.save(X, recXBig, new Set([X]))
        const afterGrowth = await dump(factory)
        expect(afterGrowth.has(headerKey(Y))).toBe(false)
        expect(entriesUnder(afterGrowth, Y)).toEqual([foreignKey])
        expect(afterGrowth.get(foreignKey)).toBe('junk')
        expect(ownerEntries(afterGrowth, Z).length).toBeGreaterThan(2)
        expect(storedRecord(afterGrowth, X)?.record).toEqual(recXBig)
    })

    test('T-S5c a header whose value names another owner is not counted and never deleted', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
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
        await seed(factory, [[headerKey(A), stray]])
        const before = await dump(factory)

        await loadThenSave(store, recX)
        const after = await dump(factory)
        for (const [key, value] of before) {
            expect(after.get(key), key).toBe(value)
        }
        const xKeys = expectedOwnerKeys(storedRecord(after, X)!.header, recX)
        expect([...after.keys()].sort()).toEqual([...before.keys(), ...xKeys].sort())
    })

    test('T-S6 an owner over the owner cap is stored trimmed from a copy; the record argument is unchanged', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
        const steps: Step[] = Array.from({ length: 40 }, (_, i) => descStep(`p:${i}`, `${'a'.repeat(60)}${i}`, `${'b'.repeat(60)}${i}`))
        const record = recordOf(X, 5, steps)
        expect(sizeOf(record)).toBeGreaterThan(ownerCapFor(CAP))
        const frozen = JSON.stringify(record)

        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(JSON.stringify(record)).toBe(frozen)
        expect(record.done).toHaveLength(40)

        const stored = storedRecord(await dump(factory), X)
        expect(stored).not.toBeNull()
        expect(stored!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(stored!.record.done.length).toBeGreaterThan(0)
        expect(stored!.record.done.length).toBeLessThan(40)
        // The oldest steps went first; the newest survives.
        expect(stored!.record.done.at(-1)?.id).toBe('p:39')
    })

    test('T-S8 unreadable, orphan, foreign, retired and unknown keys are never counted nor deleted; eviction removes a header and its generation together', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
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
            [entryKey(zOrphan, 'zz-foreign:1', 's:x'), hugeValue],
            [headerKey(zBad), '{not json'],
            [entryKey(zBad, 'zz-foreign:1', 'i'), hugeValue],
            [headerKey(zV2), JSON.stringify({ v: 2, wid: 'w', gen: 'zz-foreign:2', ownerKey: zV2, size: 999999, touchedAt: 1 })],
            [entryKey(zV2, 'zz-foreign:2', 'i'), hugeValue],
            [asideMarkKey(A), hugeValue],
            ['rec:' + A, hugeValue],
            ['hdr:' + A, hugeValue],
            ['aside:' + A, hugeValue],
            ['asideh:' + A, hugeValue],
            ['zzz:unknown', hugeValue],
        ]
        await seed(factory, bystanders)
        const qEntries = ownerEntries(await dump(factory), Q)

        await loadThenSave(store, recW)
        const after = await dump(factory)
        // 4000 + 3000 + 4500 = 11500 > cap: the oldest counted owner (P) goes with its generation.
        expect(after.has(headerKey(P))).toBe(false)
        expect(entriesUnder(after, P)).toEqual([])
        expect(ownerEntries(after, Q)).toEqual(qEntries)
        for (const [key, value] of bystanders) {
            expect(after.get(key), key).toBe(value)
        }
    })

    test('T-S8 no save reads an entry value or the owner range; a load reads only the header generation range', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        const gen = storedRecord(await dump(factory), X)!.header.gen

        const get = vi.spyOn(IDBObjectStore.prototype, 'get')
        const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
        const getAllKeys = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')
        const getKey = vi.spyOn(IDBObjectStore.prototype, 'getKey')
        await store.save(X, { ...record, touchedAt: 2 }, new Set([X]))
        await store.save(X, { ...record, touchedAt: 3 }, new Set([X]))
        expect(get).not.toHaveBeenCalled()
        // Two saves, one header-range read each (values and keys); nothing under `e:`.
        expect(getAll.mock.calls.map(([range]) => (range as IDBKeyRange).lower)).toEqual(['h:', 'h:'])
        expect(getAllKeys.mock.calls.map(([range]) => (range as IDBKeyRange).lower)).toEqual(['h:', 'h:'])
        expect(getKey.mock.calls.map(([key]) => key)).toEqual([asideMarkKey(X), asideMarkKey(X)])

        get.mockClear()
        getAll.mockClear()
        getAllKeys.mockClear()
        await newStore(factory).load(X)
        expect(get.mock.calls.map(([key]) => key)).toEqual([headerKey(X)])
        const bounds = genBounds(X, gen)
        expect(getAll.mock.calls.map(([range]) => (range as IDBKeyRange).lower)).toEqual([bounds.lower])
        expect(getAllKeys.mock.calls.map(([range]) => (range as IDBKeyRange).upper)).toEqual([bounds.upper])

        // The aside save and the full rewrite through Absent read the header range and the marker only too.
        const one = newStore(factory, { pageSession: 'one' })
        const two = newStore(factory, { pageSession: 'two' })
        await one.load(X)
        await two.load(X)
        expect(await two.save(X, { ...record, touchedAt: 4 }, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })
        const fresh = newStore(factory, { pageSession: 'fresh' })
        await fresh.load(Y)
        for (const spy of [get, getAll, getAllKeys, getKey]) {
            spy.mockClear()
        }
        expect(await one.save(X, { ...record, touchedAt: 5 }, new Set([X]))).toMatchObject({ kind: 'ok', asided: true })
        expect(await fresh.save(Y, sized(Y, 6, 600), new Set([Y]))).toMatchObject({ kind: 'ok', asided: false })
        expect(get).not.toHaveBeenCalled()
        expect(getAll.mock.calls.map(([range]) => (range as IDBKeyRange).lower)).toEqual(['h:', 'h:'])
        expect(getAllKeys.mock.calls.map(([range]) => (range as IDBKeyRange).lower)).toEqual(['h:', 'h:'])
        expect(getKey.mock.calls.map(([key]) => key)).toEqual([asideMarkKey(X), asideMarkKey(Y)])
    })

    test('protect keeps an older owner out of the plan', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
        await loadThenSave(store, sized(P, 10, CAP * 0.4, 'p'))
        await loadThenSave(store, sized(Q, 20, CAP * 0.3, 'q'))
        await loadThenSave(store, sized(X, 30, CAP * 0.45), new Set([X, P]))
        const after = await dump(factory)
        expect(after.has(headerKey(P))).toBe(true)
        expect(after.has(headerKey(Q))).toBe(false)
    })

    test('F6 / T-S10 a record evicted by another tab is recreated by the next save from memory', async () => {
        const factory = new IDBFactory()
        const tab = newStore(factory)
        const record = sized(X, 1, 600)
        await loadThenSave(tab, record)
        await removeKeys(factory, (await dump(factory)).keys())
        expect(await tab.save(X, record, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(storedRecord(await dump(factory), X)?.record).toEqual(record)
    })

    test('T-S4b a quota failure on the last put gives unwritable, reverts the evictions and every earlier write, and the next save retries', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
        await loadThenSave(store, sized(P, 10, CAP * 0.4, 'p'))
        await loadThenSave(store, sized(Q, 20, CAP * 0.3, 'q'))
        const record = sized(X, 30, CAP * 0.45)
        const frozen = JSON.stringify(record)
        await store.load(X)
        const before = await dump(factory)

        const nativePut = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            if (key === headerKey(X)) {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
            }
            return nativePut.call(this, value, key)
        })
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'unwritable' })
        expect(JSON.stringify(record)).toBe(frozen)
        // The eviction of P and the entry puts were part of the same transaction, so they went away with the header.
        expect(await dump(factory)).toEqual(before)

        put.mockRestore()
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const after = await dump(factory)
        expect(after.has(headerKey(P))).toBe(false)
        expect(storedRecord(after, X)?.record).toEqual(record)
    })

    test('T-S4b a failed save over an owner with a stored state keeps the expectation and the baseline: the retry is a patch, not copied aside', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'tab' })
        const record = sized(X, 1, 600)
        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const first = readHeader((await dump(factory)).get(headerKey(X)), X)
        expect(first?.wid).toBe('tab:1')

        const nativePut = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            if (key === headerKey(X)) {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
            }
            return nativePut.call(this, value, key)
        })
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'unwritable' })
        put.mockRestore()
        // The failed save changed nothing, so the stored header is still the one this page wrote.
        expect(readHeader((await dump(factory)).get(headerKey(X)), X)?.wid).toBe('tab:1')

        const writes = spyOnWrites()
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        // Nothing changed against the baseline: the index and the header are the whole patch, in the old generation.
        expect(writes.puts).toEqual([entryKey(X, 'tab:1', 'i'), headerKey(X)])
        const after = await dump(factory)
        expect(after.has(asideMarkKey(X))).toBe(false)
        expect(readHeader(after.get(headerKey(X)), X)).toMatchObject({ wid: 'tab:3', gen: 'tab:1' })
    })

    test('T-S6 an aborted transaction gives unwritable and writes nothing', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        const record = sized(X, 1, 600)
        await store.load(X)
        const nativePut = IDBObjectStore.prototype.put
        // The header put aborts the transaction after the entry puts were accepted.
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            const request = nativePut.call(this, value, key)
            if (key === headerKey(X)) {
                this.transaction.abort()
            }
            return request
        })
        expect(await store.save(X, record, new Set([X]))).toEqual({ kind: 'unwritable' })
        vi.restoreAllMocks()
        expect((await dump(factory)).size).toBe(0)
        expect(await store.save(X, record, new Set([X]))).toMatchObject({ kind: 'ok' })
    })

    test('T-S4b an asynchronous abort after every write was accepted leaves the expectation and the baseline where they were: the retry is a patch', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'tab' })
        const base = stepsRecord(X, 1, 1)
        expect(await loadThenSave(store, base)).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect(storedRecord(await dump(factory), X)?.header.gen).toBe('tab:1')

        const second = { ...base, touchedAt: 2, done: [...base.done, descStep('X:1', 'a', 'b')] }
        const nativePut = IDBObjectStore.prototype.put
        // The header put is the last write; the abort arrives after the request was accepted, so the failure
        // is seen only at the end of the transaction, never as a throw from a write.
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            const request = nativePut.call(this, value, key)
            if (key === headerKey(X)) {
                this.transaction.abort()
            }
            return request
        })
        expect(await store.save(X, second, new Set([X]))).toEqual({ kind: 'unwritable' })
        vi.restoreAllMocks()

        // Had the baseline moved to `second`, the retry would put only the third step and the stored index
        // would list a second step that no save ever wrote.
        const third = { ...second, touchedAt: 3, done: [...second.done, descStep('X:2', 'b', 'c')] }
        expect(await store.save(X, third, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const after = await dump(factory)
        expect(after.has(asideMarkKey(X))).toBe(false)
        expect(storedRecord(after, X)?.record).toEqual(third)
        expect(storedRecord(after, X)?.header.gen).toBe('tab:1')
    })

    test('R7-9 the k-th write request fails, for every k: the store is byte-identical, the result is unwritable and the retry puts the same plan', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const writer = newStore(factory, { capBytes: CAP, pageSession: 'atomic' })
        const recP = sized(P, 10, CAP * 0.35, 'p')
        const recQ = sized(Q, 20, CAP * 0.3, 'q')
        await loadThenSave(writer, recP)
        await loadThenSave(writer, recQ)
        const base = stepsRecord(X, 30, 3, 40, { restore: { visitId: 'v', at: 1, fields: { desc: { before: { had: false }, last: { had: false } } } } })
        await loadThenSave(writer, base)
        // One more step, a changed restore point and the oldest step dropped: puts, deletes and a victim.
        const next = {
            ...base,
            touchedAt: 40,
            done: [...base.done.slice(1), descStep('X:new', 'n'.repeat(300), 'm'.repeat(300))],
            restore: { visitId: 'v2', at: 2, fields: {} } satisfies RestorePoint,
        }
        expect(sizeOf(next)).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(sizeOf(base) + sizeOf(recP) + sizeOf(recQ)).toBeLessThanOrEqual(CAP)
        expect(sizeOf(next) + sizeOf(recP) + sizeOf(recQ)).toBeGreaterThan(CAP)
        const before = await dump(factory)

        const probe = spyOnWrites()
        const reference = await writer.save(X, next, new Set([X]))
        expect(reference).toMatchObject({ kind: 'ok' })
        const planned = { puts: [...probe.puts], deletes: [...probe.deletes] }
        const count = planned.puts.length + planned.deletes.length
        expect(planned.deletes.length).toBeGreaterThanOrEqual(3)
        expect(planned.puts.length).toBeGreaterThanOrEqual(3)
        vi.restoreAllMocks()
        // Put the database back to its state before the reference save, and let a new instance read it.
        await removeKeys(factory, (await dump(factory)).keys())
        await seed(factory, before)
        const store = newStore(factory, { capBytes: CAP, pageSession: 'atomic2' })
        const loaded = await store.load(X)
        expect(loaded).toEqual({ kind: 'ok', record: base })
        if (loaded.kind !== 'ok') return
        // The model builds the next record from the objects it holds: here the ones the load returned.
        const retried = { ...loaded.record, touchedAt: next.touchedAt, done: [...loaded.record.done.slice(1), next.done.at(-1)!], restore: next.restore }

        for (let k = 1; k <= count; k++) {
            let seen = 0
            const nativePut = IDBObjectStore.prototype.put
            const nativeDelete = IDBObjectStore.prototype.delete
            vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
                seen += 1
                if (seen === k) {
                    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
                }
                return nativePut.call(this, value, key)
            })
            vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
                seen += 1
                if (seen === k) {
                    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
                }
                return nativeDelete.call(this, query)
            })
            expect(await store.save(X, retried, new Set([X])), `k=${k}`).toEqual({ kind: 'unwritable' })
            vi.restoreAllMocks()
            expect(await dump(factory), `k=${k}`).toEqual(before)
        }

        const retry = spyOnWrites()
        expect(await store.save(X, retried, new Set([X]))).toMatchObject({ kind: 'ok' })
        expect({ puts: retry.puts, deletes: retry.deletes }).toEqual(planned)
        expect(storedRecord(await dump(factory), X)?.record).toEqual(next)
    })
})

// ---------------------------------------------------------------- S4: never put over unread data

describe('S4 guard and the aside rule', () => {
    test('T-S15b a state written by another page is copied aside once, its generation stays, then this page puts its own', async () => {
        const factory = new IDBFactory()
        const pageA = newStore(factory, { pageSession: 'a' })
        const pageB = newStore(factory, { pageSession: 'b' })
        await pageA.load(X)
        await loadThenSave(pageB, sized(X, 5, 800, 'b'))
        const stored = await dump(factory)
        const bHeader = stored.get(headerKey(X))
        const bGen = storedRecord(stored, X)!.header.gen
        const bEntries = keysInBounds(stored, genBounds(X, bGen)).map((key) => [key, stored.get(key)])

        const mine = sized(X, 9, 800, 'm')
        expect(await pageA.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        const after = await dump(factory)
        expect(after.get(asideMarkKey(X))).toBe(bHeader)
        expect(storedRecord(after, X)?.record).toEqual(mine)
        expect(keysInBounds(after, genBounds(X, bGen)).map((key) => [key, after.get(key)])).toEqual(bEntries)

        // Now A's expectation is its own write id: the next save is on the match path and the marker stays put.
        expect(await pageA.save(X, { ...mine, touchedAt: 10 }, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        expect((await dump(factory)).get(asideMarkKey(X))).toBe(bHeader)
    })

    test('T-S15b with the aside marker already taken, nothing is written and the answer is kept', async () => {
        const factory = new IDBFactory()
        const pageA = newStore(factory)
        const pageB = newStore(factory)
        await pageA.load(X)
        await loadThenSave(pageB, sized(X, 5, 800, 'b'))
        await seed(factory, [[asideMarkKey(X), 'taken earlier']])
        const before = await dump(factory)
        expect(await pageA.save(X, sized(X, 9, 800, 'm'), new Set([X]))).toEqual({ kind: 'kept' })
        expect(await dump(factory)).toEqual(before)
    })

    test('T-S15b a save without a prior load is notLoaded and writes nothing', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        expect(await store.open()).toBe('ok')
        expect(await store.save(X, sized(X, 5, 800), new Set([X]))).toEqual({ kind: 'notLoaded' })
        expect((await dump(factory)).size).toBe(0)
    })

    test('T-S15c entries with no header are orphans: load says absent, the save writes a fresh generation and leaves them byte-identical', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        // Entries of an earlier generation whose header is gone, written by the store's own writer.
        const scratch = new Map<string, string>()
        seedOwner(scratch, sized(X, 5, 800, 'o'), 'zz-foreign:1')
        scratch.delete(headerKey(X))
        await seed(factory, scratch)
        const orphans = await dump(factory)

        expect(await store.load(X)).toEqual({ kind: 'absent' })
        const mine = sized(X, 9, 800, 'm')
        expect(await store.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const after = await dump(factory)
        for (const [key, value] of orphans) {
            expect(after.get(key), key).toBe(value)
        }
        expect(storedRecord(after, X)?.record).toEqual(mine)
        expect(after.has(asideMarkKey(X))).toBe(false)
    })

    test('T-S3 an unreadable v2 header is copied aside byte-equal, later saves persist, a new instance loads the v1 record', async () => {
        const factory = new IDBFactory()
        const first = newStore(factory)
        // Hand-written v2 header: stands for a later producer.
        const v2Header = JSON.stringify({ v: 2, wid: 'later:1', ownerKey: X, size: 5, touchedAt: 1 })
        await seed(factory, [[headerKey(X), v2Header]])

        expect(await first.load(X)).toEqual({ kind: 'unreadable' })
        const mine = sized(X, 9, 800, 'm')
        expect(await first.save(X, mine, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        const stored = await dump(factory)
        expect(stored.get(asideMarkKey(X))).toBe(v2Header)
        const later = { ...mine, touchedAt: 12 }
        expect(await first.save(X, later, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })

        const second = newStore(factory)
        expect(await second.load(X)).toEqual({ kind: 'ok', record: later })
        expect((await dump(factory)).get(asideMarkKey(X))).toBe(v2Header)
    })

    test('T-S3b an unreadable header with the marker present is kept: both values stay byte-identical', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        await seed(factory, [
            [headerKey(X), JSON.stringify({ v: 2, wid: 'later:1', ownerKey: X, size: 5, touchedAt: 1 })],
            [asideMarkKey(X), 'earlier header'],
        ])
        const before = await dump(factory)

        expect(await store.load(X)).toEqual({ kind: 'keptUnreadable' })
        for (let i = 0; i < 3; i++) {
            expect(await store.save(X, sized(X, 9 + i, 800, 'm'), new Set([X]))).toEqual({ kind: 'kept' })
        }
        expect(await dump(factory)).toEqual(before)
    })

    test('load classifies an absent owner, an intact one and one whose generation lost a key', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        expect(await store.load(X)).toEqual({ kind: 'absent' })
        const record = sized(X, 3, 600)
        await store.save(X, record, new Set([X]))
        expect(await newStore(factory).load(X)).toEqual({ kind: 'ok', record })

        const stored = await dump(factory)
        const dropped = storedRecord(stored, X)!.keys.find((key) => key.endsWith('|s:p:1'))!
        await removeKeys(factory, [dropped])
        expect(await newStore(factory).load(X)).toEqual({ kind: 'unreadable' })
    })

    test('write ids differ for every put, so another page can tell its own write from a later one', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'pg' })
        const record = sized(X, 1, 600)
        await loadThenSave(store, record)
        const first = readHeader((await dump(factory)).get(headerKey(X)), X)
        await store.save(X, { ...record, touchedAt: 2 }, new Set([X]))
        const second = readHeader((await dump(factory)).get(headerKey(X)), X)
        expect([first?.wid, second?.wid]).toEqual(['pg:1', 'pg:2'])
        // A patch keeps the generation; only a full rewrite makes a new one.
        expect([first?.gen, second?.gen]).toEqual(['pg:1', 'pg:1'])
    })
})

// ---------------------------------------------------------------- delta saves and full rewrites on the adapter

describe('patch saves write only what changed', () => {
    const restoreOf = (visitId: string): RestorePoint => ({ visitId, at: 1, fields: { desc: { before: { had: false }, last: { had: true, value: visitId } } } })

    test('T-PD1 (a) one new step after three stored ones puts the step, the restore point, the index and the header, and nothing is deleted', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'pg' })
        let record = recordOf(X, 1, [], { restore: restoreOf('v1') })
        await store.load(X)
        for (let i = 0; i < 3; i++) {
            record = { ...record, touchedAt: i + 1, done: [...record.done, descStep(`s:${i}`, 'a', 'b')], restore: restoreOf(`v${i + 1}`) }
            expect(await store.save(X, record, new Set([X]))).toMatchObject({ kind: 'ok' })
        }
        const gen = storedRecord(await dump(factory), X)!.header.gen
        const writes = spyOnWrites()
        record = { ...record, touchedAt: 9, done: [...record.done, descStep('s:new', 'b', 'c')], restore: restoreOf('v9') }
        expect(await store.save(X, record, new Set([X]))).toMatchObject({ kind: 'ok' })
        expect(writes.puts.sort()).toEqual([entryKey(X, gen, 's:s:new'), entryKey(X, gen, 'r'), entryKey(X, gen, 'i'), headerKey(X)].sort())
        expect(writes.puts.at(-1)).toBe(headerKey(X))
        expect(writes.deletes).toEqual([])
        // Write requests carry no success handler: the save awaits the transaction only.
        expect(writes.requests.length).toBe(4)
        for (const request of writes.requests) {
            expect(request.onsuccess).toBeNull()
        }
        expect(await newStore(factory).load(X)).toEqual({ kind: 'ok', record })
    })

    test('T-PD1 (b) the first save after a load of the same shape puts the same set (the baseline holds the objects the service keeps)', async () => {
        const factory = new IDBFactory()
        const writer = newStore(factory, { pageSession: 'w' })
        let record = recordOf(X, 1, [], { restore: restoreOf('v1') })
        await writer.load(X)
        for (let i = 0; i < 3; i++) {
            record = { ...record, touchedAt: i + 1, done: [...record.done, descStep(`s:${i}`, 'a', 'b')], restore: restoreOf(`v${i + 1}`) }
            await writer.save(X, record, new Set([X]))
        }
        const gen = storedRecord(await dump(factory), X)!.header.gen

        const reader = newStore(factory, { pageSession: 'r' })
        const loaded = await reader.load(X)
        expect(loaded.kind).toBe('ok')
        if (loaded.kind !== 'ok') return
        const writes = spyOnWrites()
        // The model builds the next record from the objects it holds: new objects only for what changed.
        const next = { ...loaded.record, touchedAt: 9, done: [...loaded.record.done, descStep('s:new', 'b', 'c')], restore: restoreOf('v9') }
        expect(await reader.save(X, next, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })
        expect(writes.puts.sort()).toEqual([entryKey(X, gen, 's:s:new'), entryKey(X, gen, 'r'), entryKey(X, gen, 'i'), headerKey(X)].sort())
        expect(writes.deletes).toEqual([])
        expect(await newStore(factory).load(X)).toEqual({ kind: 'ok', record: next })
    })

    test('T-PD1 a step the model drops at its own cap is deleted, and only that key', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'pg' })
        const steps = Array.from({ length: 100 }, (_, i) => descStep(`s:${i}`, 'a', 'b'))
        await store.load(X)
        const record = recordOf(X, 1, steps)
        await store.save(X, record, new Set([X]))
        const gen = storedRecord(await dump(factory), X)!.header.gen
        const writes = spyOnWrites()
        const next = { ...record, touchedAt: 2, done: [...record.done.slice(1), descStep('s:100', 'b', 'c')] }
        await store.save(X, next, new Set([X]))
        expect(writes.deletes).toEqual([entryKey(X, gen, 's:s:0')])
        expect(writes.puts.sort()).toEqual([entryKey(X, gen, 's:s:100'), entryKey(X, gen, 'i'), headerKey(X)].sort())
        expect(storedRecord(await dump(factory), X)?.record).toEqual(next)
    })

    test('T-PF1 after another instance evicted the owner, the save is a full rewrite under a fresh generation and touches no other key of the owner range', async () => {
        const factory = new IDBFactory()
        const tab = newStore(factory, { pageSession: 'tab' })
        const other = newStore(factory, { pageSession: 'other' })
        const record = stepsRecord(X, 1, 4)
        await loadThenSave(tab, record)
        const oldGen = storedRecord(await dump(factory), X)!.header.gen
        // Another page drops the header: the owner is evicted from its point of view.
        await removeKeys(factory, [headerKey(X)])
        const orphans = await dump(factory)
        await other.load(Y)

        const writes = spyOnWrites()
        const next = { ...record, touchedAt: 5, done: [...record.done, descStep('X:4', 'x', 'y')] }
        expect(await tab.save(X, next, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        const newGen = storedRecord(await dump(factory), X)!.header.gen
        expect(newGen).not.toBe(oldGen)
        expect(writes.deletes).toEqual([])
        // Every kept entry is put again, plus the index and the header.
        expect(writes.puts).toHaveLength(5 + 2)
        const after = await dump(factory)
        for (const [key, value] of orphans) {
            expect(after.get(key), key).toBe(value)
        }
        expect(await newStore(factory).load(X)).toEqual({ kind: 'ok', record: next })
    })

    test('T-PF2 a stale baseline never decides a rewrite: the owner evicted by a save of another owner is written whole by its next save', async () => {
        const CAP = 10000
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP, pageSession: 'one' })
        // A is the oldest, D is touched after it, and C's save makes A the victim; each owner fits half the cap.
        const recA = stepsRecord(A, 10, 3, 80)
        const recD = sized(D, 20, CAP * 0.45, 'd')
        const recC = sized(C, 30, CAP * 0.45, 'c')
        for (const record of [recA, recD, recC]) {
            expect(sizeOf(record)).toBeLessThanOrEqual(ownerCapFor(CAP))
        }
        expect(sizeOf(recA) + sizeOf(recD) + sizeOf(recC)).toBeGreaterThan(CAP)
        expect(sizeOf(recD) + sizeOf(recC)).toBeLessThanOrEqual(CAP)

        await loadThenSave(store, recA)
        await loadThenSave(store, recD)
        await loadThenSave(store, recC)
        expect((await dump(factory)).has(headerKey(A))).toBe(false)

        const storedRecordGen = storedRecord(await dump(factory), D)!.header.gen
        const writes = spyOnWrites()
        const next = { ...recA, touchedAt: 40, done: [...recA.done, descStep('A:3', 'x', 'y')] }
        const result = await store.save(A, next, new Set([A]))
        expect(result).toMatchObject({ kind: 'ok' })
        // The whole owner is put under a fresh generation: all four steps, the index and the header.
        expect(sizeOf(next)).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(writes.puts.filter((key) => key.includes('|s:'))).toHaveLength(4)
        // A's own save now evicts D, the oldest of the others, with its generation.
        expect(writes.deletes).toEqual([headerKey(D), `range:${genBounds(D, storedRecordGen).lower}`])
        const reloaded = await newStore(factory).load(A)
        expect(reloaded).toEqual({ kind: 'ok', record: next })
    })

    test('an inconsistent match (the stored header is this instance own, but a failed load cleared its baseline) replaces its own generation in one transaction', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { pageSession: 'pg' })
        const record = stepsRecord(X, 1, 3, 20)
        await loadThenSave(store, record)
        const oldGen = storedRecord(await dump(factory), X)!.header.gen
        vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
            throw new DOMException('boom', 'UnknownError')
        })
        expect(await store.load(X)).toEqual({ kind: 'failed' })
        vi.restoreAllMocks()

        const writes = spyOnWrites()
        const next = { ...record, touchedAt: 2, done: [...record.done, descStep('X:3', 'a', 'b')] }
        expect(await store.save(X, next, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: false })
        // The expectation matched the stored header, so no marker; the baseline was gone, so the whole owner was put.
        expect(writes.deletes).toEqual([`range:${genBounds(X, oldGen).lower}`])
        expect(writes.puts).toHaveLength(4 + 2)
        const after = await dump(factory)
        expect(after.has(asideMarkKey(X))).toBe(false)
        const view = storedRecord(after, X)!
        expect(view.header.gen).not.toBe(oldGen)
        expect(view.record).toEqual(next)
        expect(entriesUnder(after, X).every((key) => key.startsWith(genPrefix(X, view.header.gen)))).toBe(true)
    })

    test('R7-8 a full rewrite never deletes the generation its own baseline named: the other instance patched it, so it stays byte-identical', async () => {
        const factory = new IDBFactory()
        const one = newStore(factory, { pageSession: 'one' })
        const two = newStore(factory, { pageSession: 'two' })
        const base = stepsRecord(X, 1, 3)
        await loadThenSave(one, base)
        const g1 = storedRecord(await dump(factory), X)!.header.gen

        // Instance two loads instance one's state and patches it into g1 under a new write id.
        const loaded = await two.load(X)
        if (loaded.kind !== 'ok') throw new Error('expected ok')
        const twoNext = { ...loaded.record, touchedAt: 5, done: [...loaded.record.done, descStep('X:two', 'q', 'r')] }
        expect(await two.save(X, twoNext, new Set([X]))).toMatchObject({ kind: 'ok', asided: false })
        const patched = await dump(factory)
        const twoHeader = patched.get(headerKey(X))
        const g1Entries = keysInBounds(patched, genBounds(X, g1)).map((key) => [key, patched.get(key)])

        // Instance one saves again: a mismatch. It asides the header once and rewrites under a fresh generation.
        const writes = spyOnWrites()
        const oneNext = { ...base, touchedAt: 8, done: [...base.done, descStep('X:one', 's', 't')] }
        expect(await one.save(X, oneNext, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        expect(writes.puts.filter((key) => key === asideMarkKey(X))).toHaveLength(1)
        expect(writes.deletes).toEqual([])
        const after = await dump(factory)
        expect(after.get(asideMarkKey(X))).toBe(twoHeader)
        expect(keysInBounds(after, genBounds(X, g1)).map((key) => [key, after.get(key)])).toEqual(g1Entries)
        expect(await newStore(factory).load(X)).toEqual({ kind: 'ok', record: oneNext })
        // A second mismatch finds the marker taken: nothing is written and the answer is kept.
        const beforeSecond = await dump(factory)
        expect(await two.save(X, { ...twoNext, touchedAt: 9 }, new Set([X]))).toEqual({ kind: 'kept' })
        expect(await dump(factory)).toEqual(beforeSecond)
        expect(await one.save(X, { ...oneNext, touchedAt: 10 }, new Set([X]))).toMatchObject({ kind: 'ok' })
    })
})

// ---------------------------------------------------------------- the per-owner cap

describe('each owner keeps at most half the store', () => {
    const CAP = 10000

    test('T-OC1 (i) a match save of a record over the owner cap stores the walk oracle and says trimmed', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
        const small = stepsRecord(X, 1, 1)
        await loadThenSave(store, small)
        const big = stepsRecord(X, 2, 7)
        expect(sizeOf(big)).toBeGreaterThan(ownerCapFor(CAP))
        expect(sizeOf(big)).toBeLessThan(CAP)
        const frozen = JSON.stringify(big)

        expect(await store.save(X, big, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(JSON.stringify(big)).toBe(frozen)
        const stored = storedRecord(await dump(factory), X)!
        expect(stored.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(stored.record).toEqual(walkOracle(big, ownerCapFor(CAP)))
        expect(stored.record.done.length).toBeGreaterThan(0)
        expect(stored.record.done.length).toBeLessThan(7)
    })

    test('T-OC1 (ii) a full rewrite through the Absent path and through the aside path stores the oracle too', async () => {
        const factory = new IDBFactory()
        const big = stepsRecord(X, 2, 7)
        expect(sizeOf(big)).toBeGreaterThan(ownerCapFor(CAP))
        const oracle = walkOracle(big, ownerCapFor(CAP))

        const absent = newStore(factory, { capBytes: CAP, pageSession: 'abs' })
        expect(await loadThenSave(absent, big)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        let stored = storedRecord(await dump(factory), X)!
        expect(stored.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(stored.record).toEqual(oracle)

        // Aside: another page wrote a state this instance never read.
        const factory2 = new IDBFactory()
        const early = newStore(factory2, { capBytes: CAP, pageSession: 'early' })
        const late = newStore(factory2, { capBytes: CAP, pageSession: 'late' })
        await early.load(X)
        await loadThenSave(late, stepsRecord(X, 1, 1))
        expect(await early.save(X, big, new Set([X]))).toEqual({ kind: 'ok', asided: true, trimmed: true })
        stored = storedRecord(await dump(factory2), X)!
        expect(stored.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(stored.record).toEqual(oracle)
    })

    test('T-OC1 the production default stores at most OWNER_CAP_BYTES for a record of about 3 MiB', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory)
        const chunk = 'q'.repeat(20000)
        const steps = Array.from({ length: 38 }, (_, i) => descStep(`p:${i}`, `${chunk}${i}`, `${chunk}${i + 1}`))
        const record = recordOf(X, 1, steps)
        const untrimmed = sizeOf(record)
        expect(untrimmed).toBeGreaterThan(OWNER_CAP_BYTES)
        expect(untrimmed).toBeLessThan(CAP_BYTES)
        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        const stored = storedRecord(await dump(factory), X)!
        expect(stored.header.size).toBeLessThanOrEqual(OWNER_CAP_BYTES)
        expect(stored.header.size).toBeGreaterThan(OWNER_CAP_BYTES * 0.9)
    })

    test('T-PM1 adapter: a repeated trimmed save serializes nothing again, because the stop entry measured by the first save is remembered', async () => {
        let calls = 0
        const wrap = (step: Step): Step =>
            Object.defineProperty({ ...step }, 'toJSON', {
                enumerable: false,
                value: () => {
                    calls += 1
                    return { ...step }
                },
            })
        const base = stepsRecord(X, 1, 30, 80)
        const record = { ...base, done: base.done.map(wrap) }
        expect(sizeOf(base)).toBeGreaterThan(ownerCapFor(CAP))
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP })
        expect(await loadThenSave(store, record)).toEqual({ kind: 'ok', asided: false, trimmed: true })
        const gen = storedRecord(await dump(factory), X)!.header.gen
        const writes = spyOnWrites()
        calls = 0
        expect(await store.save(X, { ...record, touchedAt: 2 }, new Set([X]))).toEqual({ kind: 'ok', asided: false, trimmed: true })
        expect(writes.puts).toEqual([entryKey(X, gen, 'i'), headerKey(X)])
        expect(calls).toBe(0)
    })

    test('T-OC2 two alternately edited owners over the owner cap never evict each other', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP, pageSession: 'alt' })
        let a = stepsRecord(A, 1, 8)
        let b = stepsRecord(B, 2, 8)
        for (const record of [a, b]) {
            // Each owner's memory is over the owner cap, so a full-store layout would push the pair over the store.
            expect(storedSizeOf(record, record.ownerKey, Infinity)).toBeGreaterThan(ownerCapFor(CAP))
        }
        await store.load(A)
        await store.load(B)
        let time = 10
        const saved = new Set<OwnerKey>()
        for (let round = 0; round < 3; round++) {
            for (const owner of [A, B]) {
                time += 10
                const current = owner === A ? a : b
                const stepId = `${owner}:${round}`
                const next = { ...current, touchedAt: time, done: [...current.done, descStep(stepId, 'x'.repeat(100), 'y'.repeat(100))] }
                if (owner === A) a = next
                else b = next
                const writes = spyOnWrites()
                expect(await store.save(owner, next, new Set([owner])), `${owner} ${round}`).toMatchObject({ kind: 'ok', trimmed: true })
                saved.add(owner)
                const stored = await dump(factory)
                // Every owner saved so far is still stored, within the owner cap.
                for (const resident of saved) {
                    const view = storedRecord(stored, resident)
                    expect(view, `${resident} after ${owner} ${round}`).not.toBeNull()
                    expect(view!.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
                }
                // No save issues a victim delete (a header or a generation range of another owner).
                expect(writes.deletes.filter((key) => key.startsWith('range:') || key.startsWith('h:')), `${owner} ${round}`).toEqual([])
                // After an owner's first save every save is a patch: the new step, the index and the header.
                if (round > 0) {
                    const gen = storedRecord(stored, owner)!.header.gen
                    expect(writes.puts.sort(), `${owner} ${round}`).toEqual([entryKey(owner, gen, `s:${stepId}`), entryKey(owner, gen, 'i'), headerKey(owner)].sort())
                }
                vi.restoreAllMocks()
            }
        }
        const fresh = newStore(factory)
        const loadedA = await fresh.load(A)
        const loadedB = await fresh.load(B)
        expect(loadedA).toMatchObject({ kind: 'ok' })
        expect(loadedB).toMatchObject({ kind: 'ok' })
        expect(loadedA.kind === 'ok' && loadedA.record).toEqual(walkOracle(a, ownerCapFor(CAP)))
        expect(loadedB.kind === 'ok' && loadedB.record).toEqual(walkOracle(b, ownerCapFor(CAP)))
    })

    test('T-OC3 three owners rotating: each return is a full rewrite of at most the owner cap that evicts exactly the owner saved two saves earlier', async () => {
        const factory = new IDBFactory()
        const store = newStore(factory, { capBytes: CAP, pageSession: 'rot' })
        const owners = [A, B, C]
        const records = new Map<OwnerKey, OwnerRecord>(owners.map((owner, at) => [owner, stepsRecord(owner, at, 8)]))
        for (const record of records.values()) {
            expect(storedSizeOf(record, record.ownerKey, Infinity)).toBeGreaterThan(ownerCapFor(CAP))
        }
        for (const owner of owners) {
            await store.load(owner)
        }
        const saved: OwnerKey[] = []
        for (let save = 0; save < 8; save++) {
            const owner = owners[save % 3]
            const previous = records.get(owner)!
            const next = { ...previous, touchedAt: 100 + save, done: [...previous.done, descStep(`${owner}:r${save}`, 'm'.repeat(100), 'n'.repeat(100))] }
            records.set(owner, next)
            const priorGen = storedRecord(await dump(factory), owner)?.header.gen
            expect(await store.save(owner, next, new Set([owner])), `save ${save}`).toMatchObject({ kind: 'ok', trimmed: true })
            saved.push(owner)
            const stored = await dump(factory)
            const view = storedRecord(stored, owner)!
            expect(view.header.size).toBeLessThanOrEqual(ownerCapFor(CAP))
            expect(view.record).toEqual(walkOracle(next, ownerCapFor(CAP)))
            if (save >= 3) {
                // The owner was evicted since its last save: a fresh generation, and exactly the last two saved owners stay.
                expect(view.header.gen).not.toBe(priorGen)
                const resident = owners.filter((candidate) => stored.has(headerKey(candidate)))
                expect(resident.sort(), `after save ${save}`).toEqual([saved[save], saved[save - 1]].sort())
            }
        }
        const fresh = newStore(factory)
        for (const owner of saved.slice(-2)) {
            const loaded = await fresh.load(owner)
            expect(loaded.kind === 'ok' && loaded.record).toEqual(walkOracle(records.get(owner)!, ownerCapFor(CAP)))
        }
    })
})
