import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'

/**
 * A `ByteStore` over a `Map` that records what was asked of it, with hooks to
 * make chosen calls fail. Synthetic data only.
 *
 * `blobs` and `urlFor` in the options make the store offer the optional Blob
 * members and `urlFor`, so a test can drive each delivery branch; without them
 * the store is bytes only, like a Node store without a token or the OPFS fallback store.
 */
export interface MemoryByteStoreOptions {
    /** Offer `writeBlob` and `readBlob`: a Blob is held as the very object handed over. */
    blobs?: boolean
    /** Offer `urlFor`: a function answers the URL of a key (and may reject); `true` answers `mem://<key>`. */
    urlFor?: boolean | ((key: string) => Promise<string>)
}

export interface MemoryByteStore extends ByteStore {
    readonly files: Map<string, Uint8Array>
    /** The Blobs held under keys written with `writeBlob`; such a key is not in `files`. */
    readonly blobs: Map<string, Blob>
    /** Every key `read` was asked for, in order. */
    readonly reads: string[]
    /** Every key `readBlob` was asked for, in order. */
    readonly blobReads: string[]
    /** Every prefix `list` was asked for, in order. */
    readonly lists: string[]
    /** Every key `write` or `writeBlob` stored, in order. */
    readonly writes: string[]
    /** Every key `writeBlob` stored, in order. */
    readonly blobWrites: string[]
    /** Every key `delete` removed, in order. */
    readonly deletes: string[]
    /** Every key `urlFor` was asked for, in order. */
    readonly urlRequests: string[]
    /** Called before `write` or `writeBlob`; a returned error is thrown and nothing is stored. */
    failWrite: ((key: string, size: number) => Error | null) | null
    /** Called before `delete`; a returned error is thrown and nothing is removed. */
    failDelete: ((key: string) => Error | null) | null
    /** Called before `read`; a returned error is thrown. */
    failRead: ((key: string) => Error | null) | null
}

export function createMemoryByteStore(options: MemoryByteStoreOptions = {}): MemoryByteStore {
    const files = new Map<string, Uint8Array>()
    const blobs = new Map<string, Blob>()
    const store: MemoryByteStore = {
        files,
        blobs,
        reads: [],
        blobReads: [],
        lists: [],
        writes: [],
        blobWrites: [],
        deletes: [],
        urlRequests: [],
        failWrite: null,
        failDelete: null,
        failRead: null,
        capabilities: { conditionalWrites: false },
        async read(key: string): Promise<ReadResult> {
            store.reads.push(key)
            const fault = store.failRead?.(key) ?? null
            if (fault) {
                throw fault
            }
            const blob = blobs.get(key)
            if (blob !== undefined) {
                return { bytes: new Uint8Array(await blob.arrayBuffer()), version: null }
            }
            const held = files.get(key)
            return { bytes: held ? held.slice() : null, version: null }
        },
        async write(key: string, bytes: Uint8Array, _condition: StoreCondition): Promise<WriteResult> {
            const fault = store.failWrite?.(key, bytes.length) ?? null
            if (fault) {
                throw fault
            }
            blobs.delete(key)
            files.set(key, bytes.slice())
            store.writes.push(key)
            return { version: null }
        },
        async delete(key: string, _condition: StoreCondition): Promise<void> {
            const fault = store.failDelete?.(key) ?? null
            if (fault) {
                throw fault
            }
            files.delete(key)
            blobs.delete(key)
            store.deletes.push(key)
        },
        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                await store.delete(entry.key, entry.condition)
            }
        },
        async list(prefix: string): Promise<string[]> {
            store.lists.push(prefix)
            return [...files.keys(), ...blobs.keys()].filter((key) => key.startsWith(prefix))
        },
        async has(key: string): Promise<boolean> {
            return files.has(key) || blobs.has(key)
        },
    }
    if (options.blobs === true) {
        store.writeBlob = async (key: string, blob: Blob, _condition: StoreCondition): Promise<WriteResult> => {
            const fault = store.failWrite?.(key, blob.size) ?? null
            if (fault) {
                throw fault
            }
            files.delete(key)
            blobs.set(key, blob)
            store.writes.push(key)
            store.blobWrites.push(key)
            return { version: null }
        }
        store.readBlob = async (key: string): Promise<Blob | null> => {
            store.blobReads.push(key)
            return blobs.get(key) ?? null
        }
    }
    if (options.urlFor !== undefined && options.urlFor !== false) {
        const answer = options.urlFor === true ? async (key: string) => `mem://${key}` : options.urlFor
        store.urlFor = async (key: string): Promise<string> => {
            store.urlRequests.push(key)
            return await answer(key)
        }
    }
    return store
}
