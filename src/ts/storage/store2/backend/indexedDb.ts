import { bytesOfStoredValue, type HeadOpen, openDatabaseForHead, prefixRange, syncBytesOfStoredValue } from '../../store/indexedDbStore'
import { isStore2Key } from '../../store/keyRules'
import { COMMIT_KEY, FENCE_KEY } from '../format/keys'
import { Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, Store2NotBinaryError, Store2OverwriteRefusedError, Store2UnknownOutcomeError } from './errors'
import { bytesTokenOf, checkRemoveBatch, checkUnitKey, checkUnitKeys, tokenMatches, type CompareToken, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite } from './types'
import { armWatchdog, DEFAULT_TRANSACTION_WATCHDOG_MS } from './watchdog'

/**
 * The store2 backend on IndexedDB: the shared database `risuai`, object store
 * `keyvaluepairs`, on a raw connection of its own. Bytes are stored as a plain
 * `Uint8Array` under the key, the form the byte store reads back.
 *
 * Every multi-key step is one `readwrite` transaction with `durability: 'strict'`
 * (a hint some engines ignore). Read-write transactions on one object store run
 * one at a time across the connections and tabs of the origin, so the compare and
 * the writes of a step cannot interleave with another step; this needs no Web
 * Lock. Inside a transaction only IndexedDB requests are issued, and each
 * follow-up request is issued from the callback of the request that decides it:
 * awaiting anything else would let the transaction auto-commit and the next
 * request fail with `TransactionInactiveError`. All bytes are copied before a
 * transaction opens.
 *
 * The backend never creates the database or its object store (LocalForage
 * creates them with the upstream schema). While they do not exist, reads report
 * absence and every write fails with `Store2BackendFailureError`.
 */

const OBJECT_STORE_NAME = 'keyvaluepairs'
const READ_PARALLELISM = 8

export interface IndexedDbBackendOptions {
    /** How long a transaction may run before the step is reported as an unknown outcome. */
    watchdogMs?: number
}

export interface IndexedDbBackend extends Store2Backend {
    /** Closes the connection; a later step opens a new one. */
    close(): void
}

function isInvalidStateError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'InvalidStateError'
}

/** IndexedDB reports no flush status, so a write never claims one. */
function unreported(): Store2WriteResult {
    return { flushed: undefined }
}

function copyOf(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(bytes)
}

/** The entry of a key as a transaction saw it: `get` answers undefined for both no entry and an entry stored as undefined, so presence comes from `count`. */
interface Entry {
    present: boolean
    value: unknown
}

/** The bytes of an entry inside a transaction (null when absent), or `'unreadable'` when it is not binary or needs an asynchronous read (a Blob). */
function bytesInTransaction(entry: Entry): { bytes: Uint8Array | null } | 'unreadable' {
    if (!entry.present) {
        return { bytes: null }
    }
    if (entry.value === undefined) {
        return 'unreadable'
    }
    const decoded = syncBytesOfStoredValue(entry.value)
    return decoded === undefined || decoded === null ? 'unreadable' : { bytes: copyOf(decoded) }
}

function readOf(bytes: Uint8Array | null): Store2Read {
    return { bytes, token: { kind: 'bytes', bytes: bytes === null ? null : copyOf(bytes) } }
}

/** Handed to the code that issues a transaction's requests. */
interface TransactionControl<T> {
    /** Records the result; the transaction commits when its requests drain and the step resolves then. */
    succeed(value: T): void
    /** Records a definite failure and aborts the transaction, so nothing it wrote persists. The first failure wins. */
    fail(error: Error): void
}

/**
 * Issues `GET` and `COUNT` on one key from a transaction and calls `then` once
 * the count answers (the count is issued second, so the get has answered too).
 */
function readEntry(objects: IDBObjectStore, key: string, then: (entry: Entry) => void): void {
    const get = objects.get(key)
    const counted = objects.count(key)
    counted.onsuccess = () => then({ present: counted.result > 0, value: get.result })
}

export function createIndexedDbBackend(options: IndexedDbBackendOptions = {}): IndexedDbBackend {
    const watchdogMs = options.watchdogMs ?? DEFAULT_TRANSACTION_WATCHDOG_MS
    let connection: IDBDatabase | undefined
    let opening: Promise<HeadOpen> | undefined

    function connect(): Promise<HeadOpen> {
        if (connection !== undefined) {
            return Promise.resolve<HeadOpen>({ kind: 'open', database: connection })
        }
        opening ??= openDatabaseForHead((closed) => {
            if (connection === closed) {
                connection = undefined
            }
        }).then((opened) => {
            connection = opened.kind === 'open' ? opened.database : undefined
            opening = undefined
            return opened
        })
        return opening
    }

    /** `null` when the database or its object store does not exist; a connection the browser closed is replaced once. */
    async function withConnection<T>(run: (database: IDBDatabase) => Promise<T>): Promise<T | null> {
        for (let attempt = 0; ; attempt++) {
            const opened = await connect()
            if (opened.kind === 'missing') {
                return null
            }
            if (opened.kind === 'failed') {
                throw new Store2BackendFailureError('The IndexedDB database could not be opened.')
            }
            const database = opened.database
            try {
                return await run(database)
            } catch (error) {
                // Only a rejection before any request ran may be retried; a step that started reports its own outcome.
                if (attempt > 0 || !isInvalidStateError(error)) {
                    throw error
                }
                if (connection === database) {
                    connection = undefined
                }
                try {
                    database.close()
                } catch {
                    // Already closed.
                }
            }
        }
    }

    async function withWriteConnection<T>(run: (database: IDBDatabase) => Promise<T>): Promise<T> {
        const result = await withConnection(run)
        if (result === null) {
            throw new Store2BackendFailureError('The IndexedDB database does not exist yet, so nothing can be written.')
        }
        return result
    }

    /**
     * One transaction over the object store. `start` issues the first requests
     * synchronously and every later request from a request callback. A step the
     * transaction never settles is reported as an unknown outcome by the watchdog.
     */
    function runTransaction<T>(database: IDBDatabase, mode: IDBTransactionMode, start: (objects: IDBObjectStore, control: TransactionControl<T>) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const transaction = mode === 'readwrite'
                ? database.transaction(OBJECT_STORE_NAME, mode, { durability: 'strict' })
                : database.transaction(OBJECT_STORE_NAME, mode)
            let settled = false
            let decision: { kind: 'ok', value: T } | { kind: 'error', error: Error } | undefined
            const disarm = armWatchdog(watchdogMs, () => {
                if (settled) {
                    return
                }
                settled = true
                try {
                    transaction.abort()
                } catch {
                    // Already finishing; the outcome is reported as unknown either way.
                }
                reject(new Store2UnknownOutcomeError(`The IndexedDB transaction neither completed nor failed within ${watchdogMs} ms.`))
            })
            const settle = (action: () => void): void => {
                if (settled) {
                    return
                }
                settled = true
                disarm()
                action()
            }
            transaction.oncomplete = () => settle(() => {
                if (decision?.kind === 'ok') {
                    resolve(decision.value)
                } else {
                    reject(new Store2UnknownOutcomeError('The IndexedDB transaction completed without a decision.'))
                }
            })
            transaction.onabort = () => settle(() => {
                reject(decision?.kind === 'error'
                    ? decision.error
                    : new Store2BackendFailureError('The IndexedDB transaction was aborted.', { cause: transaction.error }))
            })
            const control: TransactionControl<T> = {
                succeed(value) {
                    decision ??= { kind: 'ok', value }
                },
                fail(error) {
                    if (decision?.kind === 'error') {
                        return
                    }
                    decision = { kind: 'error', error }
                    try {
                        transaction.abort()
                    } catch {
                        // Already finished.
                    }
                },
            }
            try {
                start(transaction.objectStore(OBJECT_STORE_NAME), control)
            } catch (error) {
                control.fail(error instanceof Error ? error : new Store2BackendFailureError('A request could not be issued.', { cause: error }))
            }
        })
    }

    /** Creates `key` with `add`; a ConstraintError (the key exists) fails the step as a refused overwrite. */
    function addFresh(objects: IDBObjectStore, control: TransactionControl<Store2WriteResult>, key: string, bytes: Uint8Array): void {
        const request = objects.add(bytes, key)
        request.onerror = (event) => {
            if (request.error?.name === 'ConstraintError') {
                event.preventDefault()
                control.fail(new Store2OverwriteRefusedError(key))
            }
        }
    }

    /** Bytes of one key read in a transaction of its own; null when absent or when there is no database. */
    async function readBytes(key: string): Promise<Uint8Array | null> {
        const entry = await withConnection((database) => runTransaction<Entry>(database, 'readonly', (objects, control) => {
            readEntry(objects, key, (read) => control.succeed(read))
        }))
        if (entry === null || !entry.present) {
            return null
        }
        const decoded = await bytesOfStoredValue(entry.value)
        if (decoded === null) {
            throw new Store2NotBinaryError(key)
        }
        return decoded
    }

    /** The first-life create (expected absent) or the compare-and-replace or compare-and-delete of one top-level key, in one transaction. */
    function compareAndSet(key: string, expected: CompareToken, next: Uint8Array | null, conflict: (current: Store2Read) => Error): Promise<Store2WriteResult> {
        bytesTokenOf(expected)
        const owned = next === null ? null : copyOf(next)
        return withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {
            readEntry(objects, key, (entry) => {
                const stored = bytesInTransaction(entry)
                if (stored === 'unreadable') {
                    control.fail(new Store2NotBinaryError(key))
                    return
                }
                if (!tokenMatches(expected, stored.bytes)) {
                    control.fail(conflict(readOf(stored.bytes)))
                    return
                }
                if (owned === null) {
                    if (stored.bytes !== null) {
                        objects.delete(key)
                    }
                } else if (stored.bytes === null) {
                    addFresh(objects, control, key, owned)
                } else {
                    objects.put(owned, key)
                }
                control.succeed(unreported())
            })
        }))
    }

    return {
        async readCommit() {
            return readOf(await readBytes(COMMIT_KEY))
        },

        async readFence() {
            return readOf(await readBytes(FENCE_KEY))
        },

        casCommit: async (expected, next) => compareAndSet(COMMIT_KEY, expected, next, (current) => new Store2CommitConflictError(current)),

        casFence: async (expected, next) => compareAndSet(FENCE_KEY, expected, next, (current) => new Store2FenceConflictError(current)),

        async readUnits(keys) {
            checkUnitKeys(keys)
            const out = new Map<string, Uint8Array | null>()
            let next = 0
            const worker = async (): Promise<void> => {
                while (next < keys.length) {
                    const key = keys[next++]
                    out.set(key, await readBytes(key))
                }
            }
            await Promise.all(Array.from({ length: Math.min(READ_PARALLELISM, keys.length) }, worker))
            return new Map(keys.map((key) => [key, out.get(key) ?? null]))
        },

        async listStore2() {
            const range = prefixRange('store2/')
            const found = await withConnection((database) => runTransaction<IDBValidKey[]>(database, 'readonly', (objects, control) => {
                const request = objects.getAllKeys(range)
                request.onsuccess = () => control.succeed(request.result)
            }))
            // Only a well-formed unit key under `store2/` is a unit, which also leaves out the three top-level keys.
            return [...new Set((found ?? []).filter((key): key is string => typeof key === 'string' && isStore2Key(key)))].sort()
        },

        async countPrefix(prefix) {
            const range = prefixRange(prefix)
            const counted = await withConnection((database) => runTransaction<number>(database, 'readonly', (objects, control) => {
                const request = objects.count(range)
                request.onsuccess = () => control.succeed(request.result)
            }))
            return counted ?? 0
        },

        async commitOrdinary(expectedCommit, units: readonly UnitWrite[], nextCommit) {
            checkUnitKeys(units.map((unit) => unit.key))
            bytesTokenOf(expectedCommit)
            const owned = units.map((unit) => ({ key: unit.key, bytes: copyOf(unit.bytes) }))
            const ownedCommit = copyOf(nextCommit)
            return withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {
                readEntry(objects, COMMIT_KEY, (entry) => {
                    const stored = bytesInTransaction(entry)
                    if (stored === 'unreadable') {
                        control.fail(new Store2NotBinaryError(COMMIT_KEY))
                        return
                    }
                    if (!tokenMatches(expectedCommit, stored.bytes)) {
                        control.fail(new Store2CommitConflictError(readOf(stored.bytes)))
                        return
                    }
                    for (const unit of owned) {
                        addFresh(objects, control, unit.key, unit.bytes)
                    }
                    if (stored.bytes === null) {
                        addFresh(objects, control, COMMIT_KEY, ownedCommit)
                    } else {
                        objects.put(ownedCommit, COMMIT_KEY)
                    }
                    control.succeed(unreported())
                })
            }))
        },

        async putUnit(key, bytes) {
            checkUnitKey(key)
            const owned = copyOf(bytes)
            return withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {
                addFresh(objects, control, key, owned)
                control.succeed(unreported())
            }))
        },

        async removeBatch(keys, expectedCommit, expectedFence) {
            checkRemoveBatch(keys)
            bytesTokenOf(expectedCommit)
            bytesTokenOf(expectedFence)
            const owned = [...keys]
            return withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {
                // The commit key, and the fence by `count` first, then its body only when present.
                const commitGet = objects.get(COMMIT_KEY)
                const commitCount = objects.count(COMMIT_KEY)
                const fenceCount = objects.count(FENCE_KEY)
                const decide = (fenceBytes: Uint8Array | null): void => {
                    if (!tokenMatches(expectedFence, fenceBytes)) {
                        control.fail(new Store2FenceConflictError(readOf(fenceBytes)))
                        return
                    }
                    for (const key of owned) {
                        objects.delete(key)
                    }
                    control.succeed(unreported())
                }
                fenceCount.onsuccess = () => {
                    const commit = bytesInTransaction({ present: commitCount.result > 0, value: commitGet.result })
                    if (commit === 'unreadable') {
                        control.fail(new Store2NotBinaryError(COMMIT_KEY))
                        return
                    }
                    if (!tokenMatches(expectedCommit, commit.bytes)) {
                        control.fail(new Store2CommitConflictError(readOf(commit.bytes)))
                        return
                    }
                    if (fenceCount.result === 0) {
                        decide(null)
                        return
                    }
                    const fenceGet = objects.get(FENCE_KEY)
                    fenceGet.onsuccess = () => {
                        const fence = bytesInTransaction({ present: true, value: fenceGet.result })
                        if (fence === 'unreadable') {
                            control.fail(new Store2NotBinaryError(FENCE_KEY))
                            return
                        }
                        decide(fence.bytes)
                    }
                }
            }))
        },

        close() {
            const database = connection
            connection = undefined
            try {
                database?.close()
            } catch {
                // Already closed.
            }
        },
    }
}
