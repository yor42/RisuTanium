import { COMMIT_KEY, FENCE_KEY } from '../format/keys'
import { Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, Store2OverwriteRefusedError, Store2UnknownOutcomeError } from './errors'
import { checkRemoveBatch, checkUnitKey, checkUnitKeys, tokenMatches, type CompareToken, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite } from './types'

/** What an injected fault does to the call it hits. */
export type MemoryFaultMode =
    /** The call fails before it changes anything (a definite failure). */
    | 'fail'
    /** The call is applied, then reports an unknown outcome (the response was lost). A call that would have thrown a backend error reports an unknown outcome too: the caller cannot tell what happened. */
    | 'lose-response'

export interface MemoryBackend extends Store2Backend {
    /**
     * Makes the `call`-th backend call from now (1 is the next call, every method
     * counts) fail or lose its response. One fault per call; a later injection
     * replaces an unfired one. The number is an integer of at least 1.
     */
    injectFault(call: number, mode: MemoryFaultMode): void
    /** A copy of every entry, for assertions. */
    snapshot(): Map<string, Uint8Array>
    /** Writes an entry directly, the way a damaged or foreign writer would. */
    poke(key: string, bytes: Uint8Array | null): void
}

/** In-memory reference backend with the semantics every real backend must match; it is what the protocol tests run against. */
export function createMemoryBackend(): MemoryBackend {
    const entries = new Map<string, Uint8Array>()
    let fault: { remaining: number, mode: MemoryFaultMode } | null = null

    /** Memory has no flush to report, so it never claims one. */
    function unreported(): Store2WriteResult {
        return { flushed: undefined }
    }

    function copy(bytes: Uint8Array): Uint8Array {
        return new Uint8Array(bytes)
    }

    function readOf(key: string): Store2Read {
        const stored = entries.get(key)
        const bytes = stored === undefined ? null : copy(stored)
        return { bytes, token: { kind: 'bytes', bytes: bytes === null ? null : copy(bytes) } }
    }

    /** Runs one call under the fault hook: a hit call either fails first or is applied and then loses its response. */
    async function call<T>(body: () => T): Promise<T> {
        let hit: MemoryFaultMode | null = null
        if (fault !== null && --fault.remaining === 0) {
            hit = fault.mode
            fault = null
        }
        if (hit === 'fail') {
            throw new Store2BackendFailureError('Injected failure.')
        }
        let result: T
        try {
            result = body()
        } catch (error) {
            if (hit === 'lose-response' && error instanceof Store2BackendError) {
                throw new Store2UnknownOutcomeError('Injected lost response.', { cause: error })
            }
            throw error
        }
        if (hit === 'lose-response') {
            throw new Store2UnknownOutcomeError('Injected lost response.')
        }
        return result
    }

    function compareAndSet(key: string, expected: CompareToken, next: Uint8Array | null, conflict: (current: Store2Read) => Error): void {
        const current = readOf(key)
        if (!tokenMatches(expected, current.bytes)) {
            throw conflict(current)
        }
        if (next === null) {
            entries.delete(key)
        } else {
            entries.set(key, copy(next))
        }
    }

    return {
        readCommit: () => call(() => readOf(COMMIT_KEY)),
        readFence: () => call(() => readOf(FENCE_KEY)),

        casCommit: (expected, next) => call(() => {
            compareAndSet(COMMIT_KEY, expected, next, (current) => new Store2CommitConflictError(current))
            return unreported()
        }),

        casFence: (expected, next) => call(() => {
            compareAndSet(FENCE_KEY, expected, next, (current) => new Store2FenceConflictError(current))
            return unreported()
        }),

        readUnits: (keys) => call(() => {
            checkUnitKeys(keys)
            const out = new Map<string, Uint8Array | null>()
            for (const key of keys) {
                const stored = entries.get(key)
                out.set(key, stored === undefined ? null : copy(stored))
            }
            return out
        }),

        listStore2: () => call(() => [...entries.keys()].filter((key) => key.startsWith('store2/')).sort()),

        countPrefix: (prefix) => call(() => [...entries.keys()].filter((key) => key.startsWith(prefix)).length),

        commitOrdinary: (expectedCommit, units: readonly UnitWrite[], nextCommit) => call(() => {
            checkUnitKeys(units.map((unit) => unit.key))
            const current = readOf(COMMIT_KEY)
            if (!tokenMatches(expectedCommit, current.bytes)) {
                throw new Store2CommitConflictError(current)
            }
            for (const unit of units) {
                if (entries.has(unit.key)) {
                    throw new Store2OverwriteRefusedError(unit.key)
                }
            }
            for (const unit of units) {
                entries.set(unit.key, copy(unit.bytes))
            }
            entries.set(COMMIT_KEY, copy(nextCommit))
            return unreported()
        }),

        putUnit: (key, bytes) => call(() => {
            checkUnitKey(key)
            if (entries.has(key)) {
                throw new Store2OverwriteRefusedError(key)
            }
            entries.set(key, copy(bytes))
            return unreported()
        }),

        removeBatch: (keys, expectedCommit, expectedFence) => call(() => {
            checkRemoveBatch(keys)
            const commit = readOf(COMMIT_KEY)
            if (!tokenMatches(expectedCommit, commit.bytes)) {
                throw new Store2CommitConflictError(commit)
            }
            const fence = readOf(FENCE_KEY)
            if (!tokenMatches(expectedFence, fence.bytes)) {
                throw new Store2FenceConflictError(fence)
            }
            for (const key of keys) {
                entries.delete(key)
            }
            return unreported()
        }),

        injectFault(callNumber, mode) {
            if (!Number.isInteger(callNumber) || callNumber < 1) {
                throw new RangeError('A fault is injected at call 1 or later.')
            }
            fault = { remaining: callNumber, mode }
        },

        snapshot: () => new Map([...entries].map(([key, bytes]) => [key, copy(bytes)])),

        poke(key, bytes) {
            if (bytes === null) {
                entries.delete(key)
            } else {
                entries.set(key, copy(bytes))
            }
        },
    }
}
