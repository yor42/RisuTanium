import { Store2UnknownOutcomeError, type Store2Backend, type Store2WriteResult } from './backend'

/**
 * Flush tracking of the two Tauri top-level keys after boot. A write of
 * `store2-commit` or `store2-fence` that resolves without `flushed === true`, or
 * whose outcome is unknown, leaves that key not known to be on stable storage;
 * the flag stays set until a later write of the same key reports `flushed === true`.
 * Conflicts and definite failures change nothing, and a fence delete neither sets
 * nor clears (a delete reports no flush status). Only the Tauri session decorates
 * its backend: every other backend reports `flushed: undefined`, which is not a
 * failure there.
 */

export interface FlushSeed {
    commit: boolean
    fence: boolean
}

export interface FlushTracker {
    /** The backend every protocol write of the page goes through. */
    backend: Store2Backend
    /** Whether either top-level key is not known to be flushed right now. */
    unflushed(): boolean
}

export function trackFlushes(inner: Store2Backend, seed: FlushSeed): FlushTracker {
    const flags = { commit: seed.commit, fence: seed.fence }

    async function tracked(key: keyof FlushSeed, write: () => Promise<Store2WriteResult>): Promise<Store2WriteResult> {
        let result: Store2WriteResult
        try {
            result = await write()
        } catch (error) {
            if (error instanceof Store2UnknownOutcomeError) {
                flags[key] = true
            }
            throw error
        }
        flags[key] = result.flushed !== true
        return result
    }

    const backend: Store2Backend = {
        readCommit: () => inner.readCommit(),
        readFence: () => inner.readFence(),
        casCommit: (expected, next) => tracked('commit', () => inner.casCommit(expected, next)),
        casFence: (expected, next) => next === null
            ? inner.casFence(expected, next)
            : tracked('fence', () => inner.casFence(expected, next)),
        readUnits: (keys) => inner.readUnits(keys),
        listStore2: () => inner.listStore2(),
        countPrefix: (prefix) => inner.countPrefix(prefix),
        commitOrdinary: (expectedCommit, units, nextCommit) => tracked('commit', () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => inner.putUnit(key, bytes),
        removeBatch: (keys, expectedCommit, expectedFence) => inner.removeBatch(keys, expectedCommit, expectedFence),
    }
    return { backend, unflushed: () => flags.commit || flags.fence }
}
