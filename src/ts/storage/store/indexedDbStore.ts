import localforage from 'localforage'
import { HEAD_KEY } from '../blockKeys'
import { sameHeadBytes, type HeadRead, type HeadSwap, type SwapOutcome } from '../headSwap'
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreDeleteManyError, StoreError, StoreInvalidKeyError, StoreNotBinaryError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, ownBytes } from './guards'
import { indexedDbAddressableViolation, indexedDbCreatableViolation } from './keyRules'

/**
 * The byte store on the browser's IndexedDB, in the database upstream already
 * uses: LocalForage database `risuai`, object store `keyvaluepairs`, each value
 * a plain `Uint8Array` under its key. No object store is added and no database
 * version is forced, so data upstream wrote is read where it lies and data this
 * store writes is read by upstream's own LocalForage code.
 *
 * The driver is pinned to IndexedDB: where IndexedDB is missing every
 * operation rejects, instead of LocalForage silently falling back to WebSQL or
 * localStorage. The LocalForage instance is created on first use, so loading
 * this module opens nothing.
 *
 * An entry is absent, holds bytes (possibly none), or holds something that is
 * not bytes: the shared store also holds flags such as `migrated`. `read`
 * rejects with `StoreNotBinaryError` for the last; `has` and `list` report it
 * like any other entry, and `list` never loads a value.
 *
 * That a key holds no value is settled by a point lookup on a second, plain
 * connection to the same database, so a read of an absent key does not list
 * every key. That connection never creates or upgrades anything and closes the
 * moment another connection changes the schema.
 *
 * The browser store keeps no version, so `conditionalWrites` is false.
 */

const DATABASE_NAME = 'risuai'
const OBJECT_STORE_NAME = 'keyvaluepairs'

/**
 * A plain connection to the existing database, opened without a version so it
 * neither upgrades nor downgrades anything: if the database or its object store
 * is missing it creates nothing and reports `null`. It closes itself when any
 * other connection asks for a schema change, so it never blocks LocalForage's
 * own open or a database delete.
 */
function openExistingDatabase(onClosed: (database: IDBDatabase) => void): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        let request: IDBOpenDBRequest
        try {
            request = indexedDB.open(DATABASE_NAME)
        } catch {
            resolve(null)
            return
        }
        request.onupgradeneeded = () => {
            // Only an open of a database that does not exist gets here, since no
            // version was asked for. Aborting the upgrade removes the database
            // again.
            try {
                request.transaction?.abort()
            } catch {
                // The open then fails or succeeds on its own below.
            }
        }
        request.onerror = (event) => {
            event.preventDefault()
            resolve(null)
        }
        request.onsuccess = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
                database.close()
                resolve(null)
                return
            }
            database.onversionchange = () => {
                database.close()
                onClosed(database)
            }
            database.onclose = () => onClosed(database)
            resolve(database)
        }
    })
}

function isInvalidStateError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'InvalidStateError'
}

/** The bytes of a stored value, or `null` when it is not binary data. Checks by tag so a value from another realm is still recognised. */
async function bytesOfStoredValue(value: unknown): Promise<Uint8Array | null> {
    if (value instanceof Uint8Array) {
        return ownBytes(value)
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    }
    const tag = Object.prototype.toString.call(value)
    if (tag === '[object ArrayBuffer]') {
        return new Uint8Array(new Uint8Array(value as ArrayBuffer))
    }
    if (tag === '[object Blob]') {
        return new Uint8Array(await (value as Blob).arrayBuffer())
    }
    return null
}

/** Point lookups of whether a key has an entry, on a connection of their own. */
export interface EntryProbe {
    /**
     * Whether `key` has an entry, answered by one point lookup instead of a
     * list of every key, whatever the entry holds. `null` when the lookup could
     * not be made, so the caller takes the slower route: an unavailable
     * connection is never read as "absent". A connection the browser closed is
     * replaced once.
     */
    exists(key: string): Promise<boolean | null>
    /** Closes the connection; a later lookup opens a new one. */
    close(): void
}

export function createEntryProbe(): EntryProbe {
    let connection: IDBDatabase | undefined
    let opening: Promise<IDBDatabase | null> | undefined

    function connect(): Promise<IDBDatabase | null> {
        if (connection !== undefined) {
            return Promise.resolve(connection)
        }
        opening ??= openExistingDatabase((closed) => {
            if (connection === closed) {
                connection = undefined
            }
        }).then((database) => {
            connection = database ?? undefined
            opening = undefined
            return database
        })
        return opening
    }

    return {
        async exists(key: string): Promise<boolean | null> {
            for (let attempt = 0; attempt < 2; attempt++) {
                const database = await connect()
                if (database === null) {
                    return null
                }
                try {
                    return await new Promise<boolean>((resolve, reject) => {
                        const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
                        const request = transaction.objectStore(OBJECT_STORE_NAME).count(key)
                        request.onsuccess = () => resolve(request.result > 0)
                        request.onerror = () => reject(request.error)
                        transaction.onabort = () => reject(transaction.error)
                    })
                } catch (error) {
                    if (!isInvalidStateError(error)) {
                        return null
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
            return null
        },

        close(): void {
            const database = connection
            connection = undefined
            if (database !== undefined) {
                try {
                    database.close()
                } catch {
                    // Already closed.
                }
            }
        },
    }
}

export function createIndexedDbStore(): ByteStore {
    let instance: LocalForage | undefined

    function forage(): LocalForage {
        instance ??= localforage.createInstance({ name: DATABASE_NAME, driver: localforage.INDEXEDDB })
        return instance
    }

    function checkAddressable(key: string): void {
        const reason = indexedDbAddressableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    async function removeKey(key: string): Promise<void> {
        await forage().removeItem(key)
    }

    const probe = createEntryProbe()
    const entryExists = (key: string): Promise<boolean | null> => probe.exists(key)

    return {
        capabilities: { conditionalWrites: false },

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            const store = forage()
            let value = await store.getItem<unknown>(key)
            if (value === null) {
                // `getItem` answers null both for an absent key and for an entry
                // stored as null or undefined, so absence is settled by a point
                // lookup of the key, which loads no value, or when that cannot be
                // made by the key list, which loads none either. Another tab may
                // write the key in between, hence one more read before the entry
                // is called non-binary.
                const present = await entryExists(key) ?? (await store.keys()).includes(key)
                if (!present) {
                    return { bytes: null, version: null }
                }
                value = await store.getItem<unknown>(key)
            }
            const bytes = value === null ? null : await bytesOfStoredValue(value)
            if (bytes === null) {
                throw new StoreNotBinaryError(key)
            }
            return { bytes, version: null }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = indexedDbAddressableViolation(key) ?? indexedDbCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, false)
            checkBytes(bytes)
            // Structured clone stores a view with the whole buffer behind it, so
            // the value handed over owns exactly its bytes.
            await forage().setItem(key, ownBytes(bytes))
            return { version: null }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, false)
            await removeKey(key)
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                checkAddressable(entry.key)
                checkCondition(entry.condition, false)
            }
            checkNoDuplicateKeys(entries)
            const report: DeleteReportEntry[] = []
            for (const entry of entries) {
                try {
                    await removeKey(entry.key)
                    report.push({ key: entry.key, outcome: 'removed' })
                } catch (error) {
                    report.push({ key: entry.key, outcome: 'failed', error })
                }
            }
            if (report.some((entry) => entry.outcome !== 'removed')) {
                throw new StoreDeleteManyError(report)
            }
        },

        async list(prefix: string): Promise<string[]> {
            checkAddressable(prefix)
            return (await forage().keys()).filter((key) => key.startsWith(prefix))
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return (await forage().keys()).includes(key)
        },
    }
}

/** The bytes of a stored value when they can be had without waiting, `undefined` when the value is not binary data or needs an asynchronous read. */
function syncBytesOfStoredValue(value: unknown): Uint8Array | null | undefined {
    if (value === undefined) {
        return null
    }
    if (value instanceof Uint8Array) {
        return value
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        return new Uint8Array(value as ArrayBuffer)
    }
    return undefined
}

/**
 * The head's compare-and-swap on IndexedDB: one read-write transaction on a
 * raw connection to the shared database reads the head, compares it with what
 * the caller read, and puts the new value, with nothing but IndexedDB requests
 * awaited in between. Read-write transactions on one object store serialise
 * across connections and tabs, so exactly one of two racing swaps sees the old
 * value; this does not need Web Locks.
 *
 * The head is stored in the form `write` stores and `read` returns (a plain
 * `Uint8Array` under the key). The connection reopens once after a
 * `versionchange` close or an `InvalidStateError`, as the entry probe's does.
 * A compare that fails aborts the transaction and is the definite `'lost'`;
 * any other abort or failure rejects, which is an unknown outcome.
 *
 * The swap never creates the database or its object store: those are created
 * by LocalForage, with the schema upstream uses. While the database or its
 * object store does not exist, `read` reports an absent head
 * (`bytes: null`), and `swap` rejects (an unknown outcome) because there is
 * nowhere to put the head yet; a replace writes its values through the store
 * first, which creates the database, before it flips the head. An open that
 * fails for any other reason rejects from both.
 */
export function createIndexedDbHeadSwap(): HeadSwap {
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

    /** `null` when the database or its object store does not exist yet. */
    async function withConnection<T>(run: (database: IDBDatabase) => Promise<T>): Promise<T | null> {
        for (let attempt = 0; ; attempt++) {
            const opened = await connect()
            if (opened.kind === 'missing') {
                return null
            }
            if (opened.kind === 'failed') {
                throw new StoreError('The IndexedDB database could not be opened for the head.')
            }
            const database = opened.database
            try {
                return await run(database)
            } catch (error) {
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

    return {
        read: async () => (await withConnection(async (database) => {
            const value = await new Promise<unknown>((resolve, reject) => {
                const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
                const request = transaction.objectStore(OBJECT_STORE_NAME).get(HEAD_KEY)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
                transaction.onabort = () => reject(transaction.error)
            })
            if (value === undefined) {
                return { bytes: null, version: null } satisfies HeadRead
            }
            const bytes = await bytesOfStoredValue(value)
            if (bytes === null) {
                throw new StoreNotBinaryError(HEAD_KEY)
            }
            return { bytes, version: null } satisfies HeadRead
        })) ?? { bytes: null, version: null },

        swap: async (expected, next) => {
            const swapped = await withConnection((database) => new Promise<SwapOutcome>((resolve, reject) => {
                const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
                const objects = transaction.objectStore(OBJECT_STORE_NAME)
                let outcome: SwapOutcome | 'unreadable' | undefined
                const request = objects.get(HEAD_KEY)
                request.onsuccess = () => {
                    const current = syncBytesOfStoredValue(request.result)
                    if (current === undefined) {
                        outcome = 'unreadable'
                        transaction.abort()
                        return
                    }
                    if (!sameHeadBytes(current, expected.bytes)) {
                        outcome = 'lost'
                        transaction.abort()
                        return
                    }
                    objects.put(ownBytes(next), HEAD_KEY)
                    outcome = 'won'
                }
                transaction.oncomplete = () => {
                    if (outcome === 'won') {
                        resolve('won')
                    } else {
                        reject(new StoreError('The head transaction completed without a decision.'))
                    }
                }
                transaction.onabort = () => {
                    if (outcome === 'lost') {
                        resolve('lost')
                    } else if (outcome === 'unreadable') {
                        reject(new StoreNotBinaryError(HEAD_KEY))
                    } else {
                        reject(transaction.error ?? new StoreError('The head transaction was aborted.'))
                    }
                }
            }))
            if (swapped === null) {
                throw new StoreError('The IndexedDB database does not exist yet, so the head cannot be swapped.')
            }
            return swapped
        },
    }
}

type HeadOpen =
    | { kind: 'open', database: IDBDatabase }
    /** The database, or its object store, does not exist. Nothing was created. */
    | { kind: 'missing' }
    /** The open itself failed or could not be made. */
    | { kind: 'failed' }

/**
 * Opens the existing database for the head swap, like `openExistingDatabase`
 * but telling a database that does not exist (an open that has to upgrade, or
 * a database without the object store) apart from an open that failed. It
 * creates nothing: the upgrade an open of a missing database starts is
 * aborted.
 */
function openDatabaseForHead(onClosed: (database: IDBDatabase) => void): Promise<HeadOpen> {
    return new Promise((resolve) => {
        let request: IDBOpenDBRequest
        try {
            request = indexedDB.open(DATABASE_NAME)
        } catch {
            resolve({ kind: 'failed' })
            return
        }
        let missing = false
        request.onupgradeneeded = () => {
            missing = true
            try {
                request.transaction?.abort()
            } catch {
                // The open then fails or succeeds on its own below.
            }
        }
        request.onerror = (event) => {
            event.preventDefault()
            resolve(missing ? { kind: 'missing' } : { kind: 'failed' })
        }
        request.onsuccess = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
                database.close()
                resolve({ kind: 'missing' })
                return
            }
            database.onversionchange = () => {
                database.close()
                onClosed(database)
            }
            database.onclose = () => onClosed(database)
            resolve({ kind: 'open', database })
        }
    })
}