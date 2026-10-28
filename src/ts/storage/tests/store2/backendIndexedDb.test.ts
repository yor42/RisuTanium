// @vitest-environment node
/**
 * The store2 IndexedDB backend against `fake-indexeddb`: the shared conformance
 * suite, then what is specific to IndexedDB (one strict transaction per
 * multi-key step, no foreign await inside it, the watchdog, a missing database).
 * A pass says nothing about a real browser's durability or timing.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    Store2BackendFailureError,
    Store2CommitConflictError,
    Store2FenceConflictError,
    Store2NotBinaryError,
    Store2UnknownOutcomeError,
    createIndexedDbBackend,
    type IndexedDbBackend,
    type IndexedDbBackendOptions,
} from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { absentCommit, absentFence, bytesOf, runBackendConformance, tokenOf, unit, unitKey } from './backendConformance'

const DATABASE = 'risuai'
const STORE = 'keyvaluepairs'

const created: IndexedDbBackend[] = []

function backendOf(options?: IndexedDbBackendOptions): IndexedDbBackend {
    const backend = createIndexedDbBackend(options)
    created.push(backend)
    return backend
}

function request<T>(pending: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        pending.onsuccess = () => resolve(pending.result)
        pending.onerror = () => reject(pending.error)
    })
}

function openRaw(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const opening = version === undefined ? indexedDB.open(DATABASE) : indexedDB.open(DATABASE, version)
        opening.onupgradeneeded = () => {
            if (!opening.result.objectStoreNames.contains(STORE)) {
                opening.result.createObjectStore(STORE)
            }
        }
        opening.onsuccess = () => resolve(opening.result)
        opening.onerror = () => reject(opening.error)
    })
}

async function dropDatabase(): Promise<void> {
    for (const backend of created.splice(0)) {
        backend.close()
    }
    await new Promise<void>((resolve, reject) => {
        const deleting = indexedDB.deleteDatabase(DATABASE)
        deleting.onsuccess = () => resolve()
        deleting.onerror = () => reject(deleting.error)
    })
}

/** An empty database with the upstream object store, as LocalForage creates it. */
async function freshDatabase(): Promise<void> {
    await dropDatabase()
    const database = await openRaw(1)
    database.close()
}

async function plantRaw(key: string, value: unknown): Promise<void> {
    const database = await openRaw()
    try {
        const transaction = database.transaction(STORE, 'readwrite')
        await request(transaction.objectStore(STORE).put(value, key))
        await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve() })
    } finally {
        database.close()
    }
}

async function readRaw(key: string): Promise<unknown> {
    const database = await openRaw()
    try {
        return await request(database.transaction(STORE, 'readonly').objectStore(STORE).get(key))
    } finally {
        database.close()
    }
}

afterEach(async () => {
    vi.restoreAllMocks()
    await dropDatabase()
})

runBackendConformance('indexedDb', async () => {
    await freshDatabase()
    return { backend: backendOf(), plant: (key, bytes) => plantRaw(key, bytes) }
}, { compare: 'bytes', atomicUnits: true })

describe('IndexedDB backend: listing', () => {
    test('a key under store2/ that is not a well-formed unit key is not listed', async () => {
        await freshDatabase()
        const backend = backendOf()
        await backend.putUnit(unitKey(1), bytesOf(1))
        // A lone surrogate is not well-formed UTF-16, and the bare prefix names no unit.
        await plantRaw('store2/\ud800', bytesOf(1))
        await plantRaw('store2/', bytesOf(1))
        expect(await backend.listStore2()).toEqual([unitKey(1)])
    })
})

describe('IndexedDB backend: transactions', () => {
    test('the hazard is real here: a macrotask await inside a transaction leaves it inactive', async () => {
        await freshDatabase()
        const database = await openRaw()
        try {
            const transaction = database.transaction(STORE, 'readwrite')
            const objects = transaction.objectStore(STORE)
            await request(objects.put(bytesOf(1), 'a'))
            // setImmediate is a macrotask queued after fake-indexeddb's own queued transaction step, so it runs after that step; a timer could run first.
            await new Promise((resolve) => setImmediate(resolve))
            expect(() => objects.put(bytesOf(2), 'b')).toThrowError(expect.objectContaining({ name: 'TransactionInactiveError' }))
        } finally {
            database.close()
        }
    })

    test('an ordinary commit is exactly one strict readwrite transaction holding the compare, every unit and the commit key', async () => {
        await freshDatabase()
        const backend = backendOf()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const base = await backend.readCommit()
        const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction')
        const addSpy = vi.spyOn(IDBObjectStore.prototype, 'add')
        const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put')
        const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get')
        const countSpy = vi.spyOn(IDBObjectStore.prototype, 'count')
        await backend.commitOrdinary(base.token, [unit(1), unit(2), unit(3)], bytesOf(2))

        expect(transactionSpy).toHaveBeenCalledTimes(1)
        expect(transactionSpy.mock.calls[0][1]).toBe('readwrite')
        expect(transactionSpy.mock.calls[0][2]).toEqual({ durability: 'strict' })
        const transaction = transactionSpy.mock.results[0].value as IDBTransaction
        const writers = [...addSpy.mock.contexts, ...putSpy.mock.contexts, ...getSpy.mock.contexts, ...countSpy.mock.contexts] as IDBObjectStore[]
        expect(writers.length).toBe(3 + 1 + 1 + 1)
        expect(writers.every((objects) => objects.transaction === transaction)).toBe(true)
        expect(addSpy.mock.calls.map((call) => call[1])).toEqual([unitKey(1), unitKey(2), unitKey(3)])
        expect(putSpy.mock.calls.map((call) => call[1])).toEqual([COMMIT_KEY])
        expect(getSpy.mock.calls.map((call) => call[0])).toEqual([COMMIT_KEY])
    })

    test('first-life creates of the commit key and the fence use add', async () => {
        await freshDatabase()
        const backend = backendOf()
        const noCommit = await absentCommit(backend)
        const noFence = await absentFence(backend)
        const addSpy = vi.spyOn(IDBObjectStore.prototype, 'add')
        const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put')
        await backend.casCommit(noCommit, bytesOf(1))
        await backend.casFence(noFence, bytesOf(1))
        expect(addSpy.mock.calls.map((call) => call[1])).toEqual([COMMIT_KEY, FENCE_KEY])
        expect(putSpy).not.toHaveBeenCalled()
    })

    test('a removal batch is one transaction that reads the commit key and the fence, the fence body only when present', async () => {
        await freshDatabase()
        const backend = backendOf()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        await backend.putUnit(unitKey(1), bytesOf(1))
        const commit = await backend.readCommit()
        const noFence = await absentFence(backend)

        const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction')
        const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get')
        const countSpy = vi.spyOn(IDBObjectStore.prototype, 'count')
        const deleteSpy = vi.spyOn(IDBObjectStore.prototype, 'delete')
        await backend.removeBatch([unitKey(1)], commit.token, noFence)
        expect(transactionSpy).toHaveBeenCalledTimes(1)
        expect(transactionSpy.mock.calls[0][2]).toEqual({ durability: 'strict' })
        expect(countSpy.mock.calls.map((call) => call[0])).toContain(FENCE_KEY)
        expect(getSpy.mock.calls.map((call) => call[0])).toEqual([COMMIT_KEY])
        expect(deleteSpy.mock.calls.map((call) => call[0])).toEqual([unitKey(1)])

        await backend.casFence(noFence, bytesOf(5))
        await backend.putUnit(unitKey(2), bytesOf(1))
        const fence = await backend.readFence()
        transactionSpy.mockClear()
        getSpy.mockClear()
        await backend.removeBatch([unitKey(2)], commit.token, fence.token)
        expect(transactionSpy).toHaveBeenCalledTimes(1)
        const removeGets = getSpy.mock.calls.map((call) => call[0])
        expect(removeGets).toContain(FENCE_KEY)
    })

    test('a removal batch racing a fence write deletes everything or nothing, never a fenced batch', async () => {
        await freshDatabase()
        const backend = backendOf()
        const other = backendOf()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = [unitKey(1), unitKey(2), unitKey(3)]
        for (const key of keys) {
            await backend.putUnit(key, bytesOf(1))
        }
        const commit = await backend.readCommit()
        const noFence = await absentFence(backend)
        const otherNoFence = await absentFence(other)
        const [removed, fenced] = await Promise.allSettled([
            backend.removeBatch(keys, commit.token, noFence),
            other.casFence(otherNoFence, bytesOf(1)),
        ])
        const left = await backend.listStore2()
        expect(fenced.status).toBe('fulfilled')
        if (removed.status === 'fulfilled') {
            expect(left).toEqual([])
        } else {
            expect(removed.reason).toBeInstanceOf(Store2FenceConflictError)
            expect(left).toEqual(keys)
        }
    })

    test('two connections racing the first-life create of the commit key: exactly one wins', async () => {
        await freshDatabase()
        const contenders = [backendOf(), backendOf(), backendOf()]
        const tokens = await Promise.all(contenders.map((contender) => absentCommit(contender)))
        const results = await Promise.allSettled(contenders.map((contender, i) => contender.casCommit(tokens[i], bytesOf(i + 1))))
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        for (const result of results) {
            if (result.status === 'rejected') {
                expect(result.reason).toBeInstanceOf(Store2CommitConflictError)
            }
        }
    })

    test('the compare is of the full bytes, so equal sequence numbers with different bytes conflict', async () => {
        await freshDatabase()
        const backend = backendOf()
        // The leading bytes stand for a shared sequence number; only the tail differs.
        const stored = bytesOf(0, 0, 0, 7, 1, 1, 1, 1)
        const lookalike = bytesOf(0, 0, 0, 7, 2, 2, 2, 2)
        await backend.casCommit(await absentCommit(backend), stored)
        await expect(backend.casCommit(tokenOf(lookalike), bytesOf(9))).rejects.toBeInstanceOf(Store2CommitConflictError)
        await expect(backend.commitOrdinary(tokenOf(lookalike), [unit(1)], bytesOf(9))).rejects.toBeInstanceOf(Store2CommitConflictError)
        expect(await backend.listStore2()).toEqual([])
    })
})

describe('IndexedDB backend: watchdog', () => {
    /** A transaction that never completes nor errors, with request stubs nothing ever answers. */
    function hangingTransaction() {
        const never = () => ({} as IDBRequest)
        const objects = { get: never, count: never, add: never, put: never, delete: never, getAllKeys: never }
        const aborted = vi.fn()
        const transaction = { objectStore: () => objects, abort: aborted }
        return { transaction: transaction as unknown as IDBTransaction, aborted }
    }

    test('a transaction that neither completes nor fails is an unknown outcome, never success', async () => {
        await freshDatabase()
        const backend = backendOf({ watchdogMs: 20 })
        const noCommit = await absentCommit(backend)
        const noFence = await absentFence(backend)
        const { transaction } = hangingTransaction()
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockReturnValue(transaction)
        await expect(backend.commitOrdinary(noCommit, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.removeBatch([unitKey(1)], noCommit, noFence)).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.casFence(noFence, bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('the watchdog does not fire on a step that completes', async () => {
        await freshDatabase()
        const backend = backendOf({ watchdogMs: 5000 })
        const noCommit = await absentCommit(backend)
        const timers = vi.spyOn(globalThis, 'clearTimeout')
        await backend.casCommit(noCommit, bytesOf(1))
        expect(timers).toHaveBeenCalled()
        expect([...(await backend.readCommit()).bytes!]).toEqual([1])
    })
})

describe('IndexedDB backend: outcomes', () => {
    test('a transaction aborted without a decision of its own is a definite failure that wrote nothing', async () => {
        await freshDatabase()
        const backend = backendOf()
        const noCommit = await absentCommit(backend)
        const original = IDBObjectStore.prototype.count
        vi.spyOn(IDBObjectStore.prototype, 'count').mockImplementation(function (this: IDBObjectStore, query?: IDBValidKey | IDBKeyRange) {
            const counted = original.call(this, query)
            const transaction = this.transaction
            // The abort lands after the step's handlers issued their writes and recorded success.
            counted.addEventListener('success', () => queueMicrotask(() => {
                try {
                    transaction.abort()
                } catch {
                    // Already finished.
                }
            }))
            return counted
        })
        const error = await backend.commitOrdinary(noCommit, [unit(1)], bytesOf(1)).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2BackendFailureError)
        expect(error).not.toBeInstanceOf(Store2UnknownOutcomeError)
        vi.restoreAllMocks()
        expect(await backend.listStore2()).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('IndexedDB backend: tokens', () => {
    test('a revision token belongs to the Node backend and is refused with a RangeError, writing nothing', async () => {
        await freshDatabase()
        const backend = backendOf()
        const revision = { kind: 'revision', revision: 0, present: false } as const
        await expect(backend.casCommit(revision, bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.casFence(revision, null)).rejects.toBeInstanceOf(RangeError)
        await expect(backend.commitOrdinary(revision, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.removeBatch([unitKey(1)], revision, revision)).rejects.toBeInstanceOf(RangeError)
        expect(await backend.listStore2()).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('IndexedDB backend: write results', () => {
    test('every writing method reports no flush status, never true', async () => {
        await freshDatabase()
        const backend = backendOf()
        const results = [
            await backend.casCommit(await absentCommit(backend), bytesOf(1)),
            await backend.casFence(await absentFence(backend), bytesOf(1)),
            await backend.putUnit(unitKey(1), bytesOf(1)),
            await backend.commitOrdinary((await backend.readCommit()).token, [unit(2)], bytesOf(2)),
            await backend.removeBatch([unitKey(1)], (await backend.readCommit()).token, (await backend.readFence()).token),
        ]
        for (const result of results) {
            expect(result).toEqual({ flushed: undefined })
            expect('flushed' in result).toBe(true)
        }
    })
})

describe('IndexedDB backend: database and entries', () => {
    test('a missing database reads as empty, refuses writes with a definite failure, and is not created', async () => {
        await dropDatabase()
        const backend = backendOf()
        expect((await backend.readCommit()).bytes).toBeNull()
        expect((await backend.readFence()).bytes).toBeNull()
        expect(await backend.listStore2()).toEqual([])
        expect(await backend.countPrefix('store2/')).toBe(0)
        expect([...(await backend.readUnits([unitKey(1)])).values()]).toEqual([null])
        const noCommit = await absentCommit(backend)
        await expect(backend.casCommit(noCommit, bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        await expect(backend.commitOrdinary(noCommit, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        await expect(backend.putUnit(unitKey(1), bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        const names = (await indexedDB.databases()).map((database) => database.name)
        expect(names).not.toContain(DATABASE)
    })

    test('bytes are stored as a plain Uint8Array under the key and read back from any binary form', async () => {
        await freshDatabase()
        const backend = backendOf()
        await backend.putUnit(unitKey(1), bytesOf(1, 2))
        expect(await readRaw(unitKey(1))).toBeInstanceOf(Uint8Array)
        await plantRaw(unitKey(2), new Uint8Array([3, 4]).buffer)
        await plantRaw(unitKey(3), new Blob([new Uint8Array([5])]))
        const read = await backend.readUnits([unitKey(2), unitKey(3)])
        expect([...read.get(unitKey(2))!]).toEqual([3, 4])
        expect([...read.get(unitKey(3))!]).toEqual([5])
    })

    test('an entry that is not binary data is reported, never read as absent', async () => {
        await freshDatabase()
        const backend = backendOf()
        const noCommit = await absentCommit(backend)
        await plantRaw(COMMIT_KEY, 'not bytes')
        await plantRaw(unitKey(1), 12)
        await expect(backend.readCommit()).rejects.toBeInstanceOf(Store2NotBinaryError)
        await expect(backend.casCommit(noCommit, bytesOf(1))).rejects.toBeInstanceOf(Store2NotBinaryError)
        await expect(backend.readUnits([unitKey(1)])).rejects.toBeInstanceOf(Store2NotBinaryError)
        expect(await readRaw(COMMIT_KEY)).toBe('not bytes')
    })

    test('an entry stored as undefined is present, not absent', async () => {
        await freshDatabase()
        const backend = backendOf()
        const noFence = await absentFence(backend)
        await plantRaw(FENCE_KEY, undefined)
        await expect(backend.casFence(noFence, bytesOf(1))).rejects.toBeInstanceOf(Store2NotBinaryError)
    })

    test('a commit key stored as undefined is present: a removal batch expecting it absent deletes nothing', async () => {
        await freshDatabase()
        const backend = backendOf()
        const noCommit = await absentCommit(backend)
        const noFence = await absentFence(backend)
        await backend.putUnit(unitKey(1), bytesOf(1))
        await plantRaw(COMMIT_KEY, undefined)
        await expect(backend.removeBatch([unitKey(1)], noCommit, noFence)).rejects.toBeInstanceOf(Store2NotBinaryError)
        expect(await backend.listStore2()).toEqual([unitKey(1)])
    })
})
