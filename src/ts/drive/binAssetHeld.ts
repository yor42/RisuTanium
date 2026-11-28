/**
 * The decision of a `.bin` restore to skip an asset the store already holds.
 * An entry is skipped only when the held value has the entry's length and
 * exactly the entry's bytes; every doubt, and every failure on the held side,
 * means "write", so a skip never leaves other bytes in the store than a write
 * of the entry would have. The module is pure: the store, the listing and the
 * backup file arrive as injected functions.
 */
import { foldAssetKey } from './assetBatchPipeline'

/** A held value opened for reading: its length and its pieces, iterated once. */
export interface HeldSource {
    readonly total: number
    readonly pieces: AsyncIterable<Uint8Array>
}

export type HeldOutcome = 'held' | 'write' | 'source' | 'stopped'

export interface HeldListingEntry {
    key: string
    size: number
}

export interface HeldAssetJudgeDeps {
    /** The store's sized listing, fetched before the import's point of no return. */
    listing: ReadonlyArray<HeldListingEntry>
    /** Opens the held value of a key; `null` when it is absent. */
    openHeld?: (key: string) => Promise<HeldSource | null>
    /** The whole held value, for a page with no piece reads; used only when `openHeld` is absent. */
    readWholeSmall?: (key: string) => Promise<Uint8Array | null>
    /** Node only: keeps the held value and moves its version; a skip requires `kept: true`. */
    touch?: (key: string) => Promise<{ kept: boolean }>
    /** The largest entry the small route compares; larger entries never cause a held read there. */
    smallLimit: number
}

export interface HeldAssetJudge {
    /**
     * Called for every asset entry of both routes, in file order, before any
     * size or listing test. Records the entry's fold when the fold is listed.
     * Answers true only when the exact key is listed and no earlier entry of
     * the same fold was seen; only then may the entry be compared.
     */
    observe(key: string): boolean
    /** The small route: the entry's bytes are in memory. Answers `held` or `write`. */
    judgeBytes(key: string, data: Uint8Array): Promise<'held' | 'write'>
    /** The large route: slices of the backup file are read as the held pieces arrive. */
    judgeStreamed(
        key: string,
        size: number,
        readFile: (start: number, end: number) => Promise<Uint8Array> | Uint8Array,
        halted: () => boolean,
    ): Promise<HeldOutcome>
}

async function closeQuietly(iterator: AsyncIterator<Uint8Array>): Promise<void> {
    try {
        await iterator.return?.()
    } catch {
        // The iterator is being abandoned; a failure to close it changes no decision.
    }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/**
 * Joins a piece already taken from a held read with the iterator that
 * continues it. `return()` is forwarded to the inner iterator even when no
 * piece was pulled from the chain, so an early exit never leaves the reader
 * suspended.
 */
export function chainHeldPieces(first: Uint8Array, rest: AsyncIterator<Uint8Array>): AsyncIterable<Uint8Array> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
            let firstPending = true
            return {
                async next(): Promise<IteratorResult<Uint8Array>> {
                    if (firstPending) {
                        firstPending = false
                        return { done: false, value: first }
                    }
                    return rest.next()
                },
                async return(): Promise<IteratorResult<Uint8Array>> {
                    firstPending = false
                    await rest.return?.()
                    return { done: true, value: undefined }
                },
            }
        },
    }
}

/**
 * Compares a held value with `size` bytes of the backup file, piece by piece.
 * `held` requires all of: C1 the held total equals `size`; C2 no piece runs
 * past `size`; C3 every byte equals the file's; C4 the pieces add up to
 * `size`. A held-side failure means `write`; a failure of `readFile` means
 * `source`; `halted()` between pieces means `stopped`. The iterator is drained
 * to its end and closed on every early exit.
 */
export async function equalPieces(
    held: HeldSource,
    readFile: (start: number, end: number) => Promise<Uint8Array> | Uint8Array,
    size: number,
    halted: () => boolean,
): Promise<HeldOutcome> {
    let iterator: AsyncIterator<Uint8Array>
    try {
        iterator = held.pieces[Symbol.asyncIterator]()
    } catch {
        return 'write'
    }
    if (held.total !== size) {
        await closeQuietly(iterator)
        return 'write'
    }
    let ended = false
    let offset = 0
    try {
        for (;;) {
            if (halted()) {
                return 'stopped'
            }
            let step: IteratorResult<Uint8Array>
            try {
                step = await iterator.next()
            } catch {
                ended = true
                return 'write'
            }
            if (step.done) {
                ended = true
                break
            }
            const piece = step.value
            if (offset + piece.length > size) {
                return 'write'
            }
            let slice: Uint8Array
            try {
                slice = await readFile(offset, offset + piece.length)
            } catch {
                return 'source'
            }
            if (slice.length !== piece.length) {
                return 'source'
            }
            if (!sameBytes(piece, slice)) {
                return 'write'
            }
            offset += piece.length
        }
        return offset === size ? 'held' : 'write'
    } finally {
        if (!ended) {
            await closeQuietly(iterator)
        }
    }
}

export function createHeldAssetJudge(deps: HeldAssetJudgeDeps): HeldAssetJudge {
    const sizes = new Map<string, number>()
    const listedFolds = new Set<string>()
    for (const entry of deps.listing) {
        sizes.set(entry.key, entry.size)
        listedFolds.add(foldAssetKey(entry.key))
    }
    const seenFolds = new Set<string>()

    async function open(key: string): Promise<HeldSource | null> {
        if (deps.openHeld === undefined) {
            return null
        }
        try {
            return await deps.openHeld(key)
        } catch {
            return null
        }
    }

    async function kept(key: string): Promise<boolean> {
        if (deps.touch === undefined) {
            return true
        }
        try {
            return (await deps.touch(key)).kept === true
        } catch {
            return false
        }
    }

    return {
        observe(key) {
            const fold = foldAssetKey(key)
            const mayCompare = sizes.has(key) && !seenFolds.has(fold)
            if (listedFolds.has(fold)) {
                seenFolds.add(fold)
            }
            return mayCompare
        },

        async judgeBytes(key, data) {
            if (data.length > deps.smallLimit || sizes.get(key) !== data.length) {
                return 'write'
            }
            if (deps.openHeld !== undefined) {
                const held = await open(key)
                if (held === null) {
                    return 'write'
                }
                const outcome = await equalPieces(held, (start, end) => data.subarray(start, end), data.length, () => false)
                return outcome === 'held' && await kept(key) ? 'held' : 'write'
            }
            if (deps.readWholeSmall === undefined) {
                return 'write'
            }
            let bytes: Uint8Array | null
            try {
                bytes = await deps.readWholeSmall(key)
            } catch {
                return 'write'
            }
            if (bytes === null || bytes.length !== data.length || !sameBytes(bytes, data)) {
                return 'write'
            }
            return await kept(key) ? 'held' : 'write'
        },

        async judgeStreamed(key, size, readFile, halted) {
            if (sizes.get(key) !== size) {
                return 'write'
            }
            const held = await open(key)
            if (held === null) {
                return 'write'
            }
            const outcome = await equalPieces(held, readFile, size, halted)
            if (outcome !== 'held') {
                return outcome
            }
            return await kept(key) ? 'held' : 'write'
        },
    }
}
