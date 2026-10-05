import { bytesEqual } from './blockFrame'
import { HEAD_KEY, isGenerationId } from './blockKeys'
import type { ByteStore } from './store/contract'
import { StoreVersionConflictError } from './store/errors'

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
    /** Set once, when the head is created by a conversion: the fingerprint of the main file that conversion read. */
    convertedFrom?: string
}

export type HeadParse =
    | { status: 'ok', record: HeadRecord }
    | { status: 'invalid', detail: string }

export function encodeHead(record: HeadRecord): Uint8Array {
    const body: HeadRecord = record.convertedFrom === undefined
        ? { current: record.current }
        : { current: record.current, convertedFrom: record.convertedFrom }
    return new TextEncoder().encode(JSON.stringify(body))
}

export function parseHead(bytes: Uint8Array): HeadParse {
    let parsed: { current?: unknown, convertedFrom?: unknown } | null
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as { current?: unknown, convertedFrom?: unknown } | null
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
    const convertedFrom = parsed.convertedFrom
    return {
        status: 'ok',
        record: typeof convertedFrom === 'string' ? { current: parsed.current, convertedFrom } : { current: parsed.current },
    }
}

/** Exactly what a head read saw: its bytes (`null` when absent) and, on a versioned store, the key's revision. */
export interface HeadRead {
    bytes: Uint8Array | null
    version: number | null
}

export function sameHeadBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
    if (a === null || b === null) {
        return a === b
    }
    return bytesEqual(a, b)
}

export type SwapOutcome = 'won' | 'lost'

export interface HeadSwap {
    /** Reads the head. Rejects when it cannot be read; an absent head is `bytes: null`. */
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
        read: async () => {
            const result = await store.read(HEAD_KEY)
            return { bytes: result.bytes, version: result.version }
        },
        swap: async (expected, next) => {
            if (expected.version === null) {
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
 * other swap on the same store object in this process, which is all a
 * single-instance desktop app needs. It is not atomic against another process
 * or against a write that does not come through here.
 */
export function createMutexHeadSwap(store: ByteStore): HeadSwap {
    return {
        read: async () => {
            const result = await store.read(HEAD_KEY)
            return { bytes: result.bytes, version: result.version }
        },
        swap: async (expected, next) => {
            const previous = mutexChains.get(store) ?? Promise.resolve()
            let release!: () => void
            const mine = new Promise<void>((resolve) => { release = resolve })
            mutexChains.set(store, previous.then(() => mine))
            await previous
            try {
                const current = await store.read(HEAD_KEY)
                if (!sameHeadBytes(current.bytes, expected.bytes)) {
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
