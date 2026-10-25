import localforage from 'localforage'
import { HEAD_KEY } from '../blockKeys'
import { sameHeadBytes, type HeadRead, type HeadSwap, type SwapOutcome } from '../headSwap'
import { WEB_ASSET_LIMIT_BYTES } from '../nodeBodyLimit'
import type { ByteStore, DeleteEntry, PieceWriter, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreBlobUnsupportedError, StoreDeleteManyError, StoreError, StoreInvalidKeyError, StoreNotBinaryError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, ownBytes } from './guards'
import { assetOrInlayBodyKeyViolation, indexedDbAddressableViolation, indexedDbCreatableViolation } from './keyRules'

/**
 * The byte store on the browser's IndexedDB, in the database upstream already
 * uses: LocalForage database `risuai`, object store `keyvaluepairs`, each value
 * a plain `Uint8Array` under its key, except under an inlay body key or a key
 * under `assets/`, which may hold a Blob (`writeBlob`, or `openWriter`) that
 * `read` still returns as bytes. No object store is added and no database
 * version is forced, so data upstream wrote is read where it lies. Values that
 * are bytes are read by upstream's own LocalForage code; a Blob-valued asset or
 * inlay is stored as a plain Blob (LocalForage `getItem` returns it), but
 * upstream does not display it, and this fork does not promise that upstream
 * reads its own storage (MC-175).
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
/** The pieces a piece writer holds loose before it folds them into its Blob. */
const WRITER_FOLD_BYTES = 8 * 1024 * 1024

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
export async function bytesOfStoredValue(value: unknown): Promise<Uint8Array | null> {
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

/**
 * Reads the value stored under a key exactly as IndexedDB holds it, on a plain
 * connection of its own. LocalForage is not used because its `getItem` turns an
 * encoded string it stored for a Blob back into a fresh in-memory Blob, which is
 * indistinguishable from a Blob the browser stored. A connection the browser
 * closed is replaced once.
 */
function createRawReader(): { get(key: string): Promise<unknown> } {
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
        /** The stored value, or `undefined` when the key has none or the database does not exist. */
        async get(key: string): Promise<unknown> {
            for (let attempt = 0; ; attempt++) {
                const database = await connect()
                if (database === null) {
                    return undefined
                }
                try {
                    return await new Promise<unknown>((resolve, reject) => {
                        const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
                        const request = transaction.objectStore(OBJECT_STORE_NAME).get(key)
                        request.onsuccess = () => resolve(request.result)
                        request.onerror = () => reject(request.error)
                        transaction.onabort = () => reject(transaction.error)
                    })
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
        },
    }
}

/** The error names a browser raises when it cannot keep a Blob in IndexedDB. */
function isBlobUnsupportedError(error: unknown): boolean {
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
    return name === 'DataCloneError' || name === 'UnknownError'
}

/**
 * Puts a value under a key on a plain read-write connection of its own, so a
 * Blob is stored as the Blob it is. LocalForage's `setItem` is not used for a
 * Blob because, when its own support probe says the browser cannot store Blobs,
 * it encodes the whole Blob as a base64 string in memory first. The database is
 * created by LocalForage (`ready`), never by this connection.
 *
 * One put is one transaction, so a failed or aborted put leaves the previous
 * value. The default durability matches `setItem`. The connection is replaced
 * and the put retried once only when opening the transaction itself throws
 * `InvalidStateError` (the browser closed the connection, or a version change):
 * nothing was sent then, and the put is idempotent. An abort, a quota failure
 * and any request error reject as they are, except `DataCloneError` and
 * `UnknownError`, which become `StoreBlobUnsupportedError`: nothing was stored
 * and the caller writes the bytes whole. `UnknownError` is also what a disk
 * failure can raise, in which case the whole-bytes write fails again with its
 * own error; no other error is mapped to this one.
 */
function createRawWriter(ready: () => Promise<unknown>): { put(key: string, value: Blob): Promise<void> } {
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
        async put(key: string, value: Blob): Promise<void> {
            await ready()
            for (let attempt = 0; ; attempt++) {
                const database = await connect()
                if (database === null) {
                    throw new StoreError('The IndexedDB database could not be opened for a Blob write.')
                }
                let transaction: IDBTransaction
                try {
                    transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
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
                    continue
                }
                try {
                    await new Promise<void>((resolve, reject) => {
                        transaction.oncomplete = () => resolve()
                        transaction.onabort = () => reject(transaction.error ?? new StoreError('The Blob write was aborted.'))
                        transaction.objectStore(OBJECT_STORE_NAME).put(value, key)
                    })
                    return
                } catch (error) {
                    throw isBlobUnsupportedError(error) ? new StoreBlobUnsupportedError(key, error) : error
                }
            }
        },
    }
}

/**
 * The exclusive upper bound of the keys that start with `prefix`: the prefix
 * with its last UTF-16 code unit incremented, which is how IndexedDB orders
 * string keys. Trailing `U+FFFF` units cannot be incremented and are dropped
 * first, since every key starting with them sorts below the bound that
 * increments the unit before. `null` when no bound exists (empty prefix, or
 * only `U+FFFF` units): the range then has no upper end.
 */
export function prefixUpperBound(prefix: string): string | null {
    let end = prefix.length
    while (end > 0 && prefix.charCodeAt(end - 1) === 0xFFFF) {
        end--
    }
    if (end === 0) {
        return null
    }
    return prefix.slice(0, end - 1) + String.fromCharCode(prefix.charCodeAt(end - 1) + 1)
}

/** The key range of every key that starts with `prefix`, or `undefined` for the whole store. */
export function prefixRange(prefix: string): IDBKeyRange | undefined {
    if (prefix.length === 0) {
        return undefined
    }
    const upper = prefixUpperBound(prefix)
    return upper === null ? IDBKeyRange.lowerBound(prefix) : IDBKeyRange.bound(prefix, upper, false, true)
}

/** Ranged key reads and counts on a plain connection of their own; neither loads a value. */
interface RangeReader {
    /** The keys that start with `prefix`, or `null` when the database cannot be read this way (absent, or the open failed). */
    keys(prefix: string): Promise<string[] | null>
    /** How many keys start with `prefix`, or `null` when it cannot be counted this way. */
    count(prefix: string): Promise<number | null>
}

function createRangeReader(): RangeReader {
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

    /** A connection the browser closed is replaced once; any other failure is `null`. */
    async function run<T>(request: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const database = await connect()
            if (database === null) {
                return null
            }
            try {
                return await new Promise<T>((resolve, reject) => {
                    const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
                    const pending = request(transaction.objectStore(OBJECT_STORE_NAME))
                    pending.onsuccess = () => resolve(pending.result)
                    pending.onerror = () => reject(pending.error)
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
    }

    return {
        async keys(prefix: string): Promise<string[] | null> {
            const found = await run((objects) => objects.getAllKeys(prefixRange(prefix)))
            return found === null ? null : found.filter((key): key is string => typeof key === 'string')
        },

        count: (prefix: string) => run((objects) => objects.count(prefixRange(prefix))),
    }
}

function blobTag(value: unknown): '[object Blob]' | '[object File]' | null {
    const tag = Object.prototype.toString.call(value)
    return tag === '[object Blob]' || tag === '[object File]' ? tag : null
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
    const rawReader = createRawReader()
    const rangeReader = createRangeReader()

    const rawWriter = createRawWriter(() => forage().ready())

    function checkBlobKey(key: string): void {
        const reason = assetOrInlayBodyKeyViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    /** A key a piece writer may be opened for or finished under: only a key under `assets/` holds an accumulated Blob. */
    function checkAssetWriterKey(key: string): void {
        const reason = indexedDbAddressableViolation(key) ?? indexedDbCreatableViolation(key)
            ?? (key.startsWith('assets/') ? null : 'a piece writer stores only under assets/')
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    /** Stores the Blob under `key`: a plain Blob, whose type is dropped for an asset (display types an asset by its extension). */
    async function putBlob(key: string, blob: Blob): Promise<void> {
        const tag = blobTag(blob)
        if (tag === null) {
            throw new TypeError('writeBlob stores a Blob.')
        }
        // A File reads back as `[object File]`, which `bytesOfStoredValue` refuses; a slice is a plain Blob over the same bytes, copied by nobody.
        const isAsset = key.startsWith('assets/')
        await rawWriter.put(key, tag === '[object File]' || isAsset ? blob.slice(0, blob.size, isAsset ? '' : blob.type) : blob)
    }

    async function readWhole(key: string): Promise<ReadResult> {
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
    }

    /**
     * The one raw load of a value: the Blob or the bytes as IndexedDB holds them, `null` for no entry. Any other shape
     * (LocalForage's encoded Blob object, a flag, a string) goes to `read`, which decodes the encoded object and
     * throws `StoreNotBinaryError` for data that is not binary. Asset keys never reach that branch, because `write`
     * stores bytes as bytes and the raw writer never encodes.
     */
    async function readStoredValue(key: string): Promise<Blob | Uint8Array | null> {
        const value = await rawReader.get(key)
        if (blobTag(value) !== null) {
            return value as Blob
        }
        const bytes = syncBytesOfStoredValue(value)
        if (bytes !== undefined) {
            return bytes === null ? null : ownBytes(bytes)
        }
        return (await readWhole(key)).bytes
    }

    return {
        capabilities: { conditionalWrites: false },

        read: readWhole,

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

        async writeBlob(key: string, blob: Blob, condition: StoreCondition): Promise<WriteResult> {
            checkBlobKey(key)
            checkCondition(condition, false)
            await putBlob(key, blob)
            return { version: null }
        },

        async readBlob(key: string): Promise<Blob | null> {
            checkBlobKey(key)
            const value = await rawReader.get(key)
            return blobTag(value) === null ? null : value as Blob
        },

        async readValue(key: string): Promise<Blob | Uint8Array | null> {
            checkBlobKey(key)
            return await readStoredValue(key)
        },

        openWriter(key: string): PieceWriter {
            checkAssetWriterKey(key)
            // Nothing is ever written under `key` (it only names the writer), so an abandoned or crashed write leaves no
            // orphan. Pieces are folded into the Blob in batches so the Blob has few parts; a piece is never modified
            // after `write`, so it is held by reference until folded.
            let accumulated = new Blob([])
            let pending: BlobPart[] = []
            let pendingBytes = 0
            let closed = false

            function fold(): void {
                if (pending.length > 0) {
                    accumulated = new Blob([accumulated, ...pending])
                    pending = []
                    pendingBytes = 0
                }
            }

            function release(): void {
                closed = true
                pending = []
                pendingBytes = 0
                accumulated = new Blob([])
            }

            return {
                async write(data: Uint8Array): Promise<void> {
                    if (closed) {
                        throw new StoreError('The piece writer is closed.')
                    }
                    pending.push(data as Uint8Array<ArrayBuffer>)
                    pendingBytes += data.length
                    if (pendingBytes >= WRITER_FOLD_BYTES) {
                        fold()
                    }
                },

                async finish(finalKey?: string): Promise<void> {
                    if (closed) {
                        throw new StoreError('The piece writer is closed.')
                    }
                    try {
                        fold()
                        const target = finalKey ?? key
                        if (finalKey !== undefined) {
                            checkAssetWriterKey(finalKey)
                            // The kept value wins: nothing is written when the key already holds one.
                            if (await entryExists(finalKey) ?? (await forage().keys()).includes(finalKey)) {
                                return
                            }
                        }
                        try {
                            await putBlob(target, accumulated)
                        } catch (error) {
                            if (!(error instanceof StoreBlobUnsupportedError)) {
                                throw error
                            }
                            // The browser keeps no Blob: the pieces already held are stored as bytes, within the bound
                            // a whole value has always had on this store.
                            if (accumulated.size > WEB_ASSET_LIMIT_BYTES) {
                                throw error
                            }
                            await forage().setItem(target, new Uint8Array(await accumulated.arrayBuffer()))
                        }
                    } finally {
                        release()
                    }
                },

                async abort(): Promise<void> {
                    release()
                },
            }
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
            // A ranged key read. Only when no plain connection can be had (no
            // database yet, a failed open) does the whole key list answer,
            // filtered to the prefix: the result is the same either way.
            return await rangeReader.keys(prefix) ?? (await forage().keys()).filter((key) => key.startsWith(prefix))
        },

        async countPrefix(prefix: string): Promise<number | null> {
            return rangeReader.count(prefix)
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return await entryExists(key) ?? (await forage().keys()).includes(key)
        },
    }
}

function isBlob(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Blob]'
}

/**
 * The bytes of a stored value when they can be had without waiting, `null`
 * for no entry, and `undefined` when the value is not binary data or needs an
 * asynchronous read (a Blob; see `isBlob`).
 */
export function syncBytesOfStoredValue(value: unknown): Uint8Array | null | undefined {
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
 * An entry that is not binary data, a value stored as `null` or `undefined`
 * included, reads as `not-binary`; only a missing key reads as absent. A swap overwrites
 * such an entry only when the caller's read was `not-binary` and the entry
 * still is not binary; against any other expectation it is `'lost'` and the
 * entry is left alone.
 *
 * The swap never creates the database or its object store: those are created
 * by LocalForage, with the schema upstream uses. While the database or its
 * object store does not exist, `read` reports an absent head
 * (`kind: 'absent'`), and `swap` rejects (an unknown outcome) because there is
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
            const { value, present } = await new Promise<{ value: unknown, present: boolean }>((resolve, reject) => {
                const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
                const objects = transaction.objectStore(OBJECT_STORE_NAME)
                const request = objects.get(HEAD_KEY)
                // `get` answers `undefined` both for no entry and for an entry stored as `undefined`; the count tells them apart.
                const counted = objects.count(HEAD_KEY)
                counted.onsuccess = () => resolve({ value: request.result, present: counted.result > 0 })
                request.onerror = () => reject(request.error)
                counted.onerror = () => reject(counted.error)
                transaction.onabort = () => reject(transaction.error)
            })
            if (value === undefined && !present) {
                return { kind: 'absent', version: null } satisfies HeadRead
            }
            const bytes = await bytesOfStoredValue(value)
            if (bytes === null) {
                return { kind: 'not-binary' } satisfies HeadRead
            }
            return { kind: 'bytes', bytes, version: null } satisfies HeadRead
        })) ?? { kind: 'absent', version: null } satisfies HeadRead,

        swap: async (expected, next) => {
            const swapped = await withConnection((database) => new Promise<SwapOutcome>((resolve, reject) => {
                const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
                const objects = transaction.objectStore(OBJECT_STORE_NAME)
                let outcome: SwapOutcome | 'unreadable' | undefined
                const request = objects.get(HEAD_KEY)
                // `get` answers `undefined` both for no entry and for an entry stored as `undefined`; the count tells them apart.
                const counted = objects.count(HEAD_KEY)
                counted.onsuccess = () => {
                    const current = request.result === undefined && counted.result > 0
                        ? undefined
                        : syncBytesOfStoredValue(request.result)
                    if (current === undefined && isBlob(request.result)) {
                        // A Blob needs an asynchronous read, which this transaction cannot wait for.
                        outcome = 'unreadable'
                        transaction.abort()
                        return
                    }
                    // Only a head that was read as not binary and still is may be overwritten when it is not bytes.
                    const matches = current === undefined
                        ? expected.kind === 'not-binary'
                        : current === null
                            ? expected.kind === 'absent'
                            : expected.kind === 'bytes' && sameHeadBytes(current, expected.bytes)
                    if (!matches) {
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

export type HeadOpen =
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
export function openDatabaseForHead(onClosed: (database: IDBDatabase) => void): Promise<HeadOpen> {
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