import { bytesEqual } from './blockFrame'
import { HEAD_KEY, isGenerationId } from './blockKeys'
import type { ByteStore } from './store/contract'
import { StoreNotBinaryError, StoreVersionConflictError } from './store/errors'

/**
 * The head pointer and its compare-and-swap, per adapter.
 *
 * The head (`blocks/head`) names the live generation. It is written by exactly
 * one operation, a whole-state replace's flip, and only by a compare-and-swap
 * against the value that replace read. Nothing else in the application writes
 * that key, LocalForage `setItem` included: a plain put loses a concurrent flip.
 *
 * Each adapter provides the swap in the way its backend can be atomic:
 * - Node: `ifVersion` on the head's revision (`createNodeHeadSwap`).
 * - IndexedDB: one read-write transaction on the raw connection
 *   (`createIndexedDbHeadSwap` in `store/indexedDbStore.ts`).
 * - Desktop files: an in-process mutex (`createMutexHeadSwap`). The app runs
 *   as one process there. It is never correct for IndexedDB, where several
 *   tabs share the database, so no factory chooses a swap from a store: the
 *   caller names the adapter it runs on.
 */

export interface HeadRecord {
    /** The live generation. */
    current: string
    /** Set when the head is created by a conversion: the fingerprint of the main file that conversion read. Every later head carries it on. */
    convertedFrom?: string
    /** Set beside `convertedFrom`: the time of the conversion, in milliseconds since the epoch. */
    convertedAt?: number
}

export type HeadParse =
    | { status: 'ok', record: HeadRecord }
    | { status: 'invalid', detail: string }

export function encodeHead(record: HeadRecord): Uint8Array {
    const body: HeadRecord = { current: record.current }
    if (record.convertedFrom !== undefined) {
        body.convertedFrom = record.convertedFrom
    }
    if (record.convertedAt !== undefined) {
        body.convertedAt = record.convertedAt
    }
    return new TextEncoder().encode(JSON.stringify(body))
}

export function parseHead(bytes: Uint8Array): HeadParse {
    let parsed: { current?: unknown, convertedFrom?: unknown, convertedAt?: unknown } | null
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as { current?: unknown, convertedFrom?: unknown, convertedAt?: unknown } | null
    } catch {
        return { status: 'invalid', detail: 'The head is not JSON.' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'invalid', detail: 'The head is not a JSON object.' }
    }
    if (!isGenerationId(parsed.current)) {
        return { status: 'invalid', detail: 'The head does not name a generation.' }
    }
    if (parsed.convertedFrom !== undefined && typeof parsed.convertedFrom !== 'string') {
        return { status: 'invalid', detail: 'The head\'s convertedFrom is not a string.' }
    }
    if (parsed.convertedAt !== undefined && (typeof parsed.convertedAt !== 'number' || !Number.isFinite(parsed.convertedAt) || parsed.convertedAt < 0)) {
        return { status: 'invalid', detail: 'The head\'s convertedAt is not a time.' }
    }
    const record: HeadRecord = { current: parsed.current }
    if (typeof parsed.convertedFrom === 'string') {
        record.convertedFrom = parsed.convertedFrom
    }
    if (typeof parsed.convertedAt === 'number') {
        record.convertedAt = parsed.convertedAt
    }
    return { status: 'ok', record }
}

/**
 * Exactly what a head read saw. `absent`: no entry (with the key's revision on
 * a versioned store). `bytes`: the entry's bytes. `not-binary`: an entry that
 * holds something that is not bytes (possible on IndexedDB only); it is a
 * present head that names no generation (a value stored as `null` or
 * `undefined` included), and it is never read as absent.
 */
export type HeadRead =
    | { kind: 'absent', version: number | null }
    | { kind: 'bytes', bytes: Uint8Array, version: number | null }
    | { kind: 'not-binary' }

export function sameHeadBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
    if (a === null || b === null) {
        return a === b
    }
    return bytesEqual(a, b)
}

/** Whether two head reads saw the same entry: both absent, both not binary, or both the same bytes. Revisions are not compared. */
export function sameHeadRead(a: HeadRead, b: HeadRead): boolean {
    if (a.kind === 'bytes' && b.kind === 'bytes') {
        return bytesEqual(a.bytes, b.bytes)
    }
    return a.kind === b.kind
}

/** The head read of a store `read` of the head key; an entry that is not binary data is a `not-binary` read, not a failure. */
async function readHeadOf(store: ByteStore): Promise<HeadRead> {
    try {
        const result = await store.read(HEAD_KEY)
        return result.bytes === null
            ? { kind: 'absent', version: result.version }
            : { kind: 'bytes', bytes: result.bytes, version: result.version }
    } catch (error) {
        if (error instanceof StoreNotBinaryError) {
            return { kind: 'not-binary' }
        }
        throw error
    }
}

export type SwapOutcome = 'won' | 'lost'

export interface HeadSwap {
    /** Reads the head. Rejects when it cannot be read; an absent head is `kind: 'absent'` and one that is not binary data is `kind: 'not-binary'`. */
    read(): Promise<HeadRead>
    /**
     * Replaces the head with `next` only while it is still exactly `expected`.
     * `'won'`: the swap took effect. `'lost'`: a definite mismatch, nothing
     * changed. A rejection is an unknown outcome: the swap may or may not have
     * taken effect.
     */
    swap(expected: HeadRead, next: Uint8Array): Promise<SwapOutcome>
}

/** Node: the head's revision is the condition. An absent head presents the revision `read` reported for it. */
export function createNodeHeadSwap(store: ByteStore): HeadSwap {
    return {
        read: () => readHeadOf(store),
        swap: async (expected, next) => {
            if (expected.kind === 'not-binary' || expected.version === null) {
                throw new TypeError('A Node head swap needs the revision the head read reported.')
            }
            try {
                await store.write(HEAD_KEY, next, { ifVersion: expected.version })
                return 'won'
            } catch (error) {
                if (error instanceof StoreVersionConflictError) {
                    return 'lost'
                }
                throw error
            }
        },
    }
}

const mutexChains = new WeakMap<object, Promise<void>>()

/**
 * An in-process mutex that wraps read, compare and write. Atomic against every
 * other swap on the same store object in this process, which is all a Tauri
 * app with exactly one live page on its data directory needs. It is not atomic
 * against another process, another page or a write that does not come through here.
 */
export function createMutexHeadSwap(store: ByteStore): HeadSwap {
    return {
        read: () => readHeadOf(store),
        swap: async (expected, next) => {
            const previous = mutexChains.get(store) ?? Promise.resolve()
            let release!: () => void
            const mine = new Promise<void>((resolve) => { release = resolve })
            mutexChains.set(store, previous.then(() => mine))
            await previous
            try {
                if (!sameHeadRead(await readHeadOf(store), expected)) {
                    return 'lost'
                }
                await store.write(HEAD_KEY, next, 'unconditional')
                return 'won'
            } finally {
                release()
            }
        },
    }
}
