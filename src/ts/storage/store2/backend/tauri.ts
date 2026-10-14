import type { ByteStore } from '../../store/contract'
import { StoreDeleteManyError, StoreInvalidKeyError } from '../../store/errors'
import { isStore2Key } from '../../store/keyRules'
import { COMMIT_KEY, FENCE_KEY } from '../format/keys'
import { Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, Store2OverwriteRefusedError, Store2UnknownOutcomeError } from './errors'
import { bytesTokenOf, checkRemoveBatch, checkUnitKey, checkUnitKeys, tokenMatches, type CompareToken, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite } from './types'

/**
 * The store2 backend on the Tauri byte store (desktop and Android): one file per
 * key, written atomically, with the store2 kinds written durably (`store2/`,
 * `store2-commit`, `store2-fence`). The byte store has no conditional write, so
 * every compare-and-write is a read, a compare and a write under one in-process
 * mutex per store object. That is atomic against every other step of this
 * backend on the same store, which is all a Tauri app with exactly one live page
 * on its data directory needs (the premise of the head swap and the commit lock
 * as well); it is not atomic against a write that does not come through here.
 *
 * Compare tokens are byte tokens, compared in full under the mutex.
 *
 * Outcomes. The store's own refusal of a key (`StoreInvalidKeyError`) happens
 * before anything is applied and is a definite failure. Any other rejection of a
 * decisive write (a commit key, a fence, a fence delete, a removal) may have
 * come after the file system applied it (a lost reply, a retired page), so it is
 * an unknown outcome and the caller reads back. A unit write that rejects inside
 * `commitOrdinary` is a definite failure of the commit, because the commit key
 * is not written after it.
 *
 * Durability. A write of `store2-commit` or `store2-fence` whose native command
 * reports no flush status resolves `flushed: false`, never `undefined`; units keep
 * the store's own report. `commitOrdinary` writes the commit key only after every unit write
 * reported `flushed === true`: a commit key must never name a unit whose
 * directory entry may not survive power loss. Unit writes run concurrently, and
 * the commit key is considered only after every write that started has settled.
 * A unit write that rejects, reports `false` or reports nothing stops the step
 * before the commit key, and the commit key is untouched. Units written before
 * the stop remain on disk, named by no commit,
 * so this backend is not atomic across units. The re-flush of an unflushed unit
 * and of the commit key belongs to the protocol layer.
 */

const READ_PARALLELISM = 8
/** Unit writes of one commit in flight at once: a whole append (three or four units) in parallel, and few base64 payloads at a time on Android. */
const UNIT_WRITE_PARALLELISM = 4
const STORE2_PREFIX = 'store2/'

type UnitOutcome = { status: 'written', flushed: boolean | undefined } | { status: 'failed', error: unknown } | { status: 'skipped' }

const mutexChains = new WeakMap<ByteStore, Promise<void>>()

/** Runs `run` after every earlier step on `store` has finished, and holds the store until it settles. */
async function underMutex<T>(store: ByteStore, run: () => Promise<T>): Promise<T> {
    const previous = mutexChains.get(store) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((resolve) => { release = resolve })
    mutexChains.set(store, previous.then(() => mine))
    await previous
    try {
        return await run()
    } finally {
        release()
    }
}

function copyOf(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(bytes)
}

function readOf(bytes: Uint8Array | null): Store2Read {
    return { bytes, token: { kind: 'bytes', bytes: bytes === null ? null : copyOf(bytes) } }
}

/** A step that did nothing: a read, or a refusal before any request was made. */
function failureOf(error: unknown, what: string): Error {
    return error instanceof Store2BackendError ? error : new Store2BackendFailureError(`${what} failed.`, { cause: error })
}

/** The error of a decisive write: refused up front is a failure, anything else may have been applied. */
function writeFailureOf(error: unknown, what: string): Error {
    if (error instanceof Store2BackendError) {
        return error
    }
    if (error instanceof StoreInvalidKeyError) {
        return new Store2BackendFailureError(`${what} was refused.`, { cause: error })
    }
    return new Store2UnknownOutcomeError(`${what} may or may not have been applied.`, { cause: error })
}

export function createTauriBackend(store: ByteStore): Store2Backend {
    async function readKey(key: string): Promise<Uint8Array | null> {
        try {
            return (await store.read(key)).bytes
        } catch (error) {
            throw failureOf(error, `Reading ${key}`)
        }
    }

    async function hasKey(key: string): Promise<boolean> {
        try {
            return await store.has(key)
        } catch (error) {
            throw failureOf(error, `Checking ${key}`)
        }
    }

    async function writeKey(key: string, bytes: Uint8Array, report: (error: unknown, what: string) => Error): Promise<Store2WriteResult> {
        try {
            const written = await store.write(key, bytes, 'unconditional')
            // A top-level write that reports no flush status is not known to be durable: the boot re-flush and the exit's
            // marker ordering rely on `true` meaning the native command said so.
            return { flushed: key === COMMIT_KEY || key === FENCE_KEY ? written.flushed === true : written.flushed }
        } catch (error) {
            throw report(error, `Writing ${key}`)
        }
    }

    /**
     * Writes `units` `UNIT_WRITE_PARALLELISM` at a time and resolves only after every write that started has settled.
     * After the first rejection or unflushed report no further write starts; a unit that never started is `skipped`.
     * The outcomes are in unit order, and a unit before the first non-written one has always started.
     * A rejection is a definite failure of the commit, because the commit key is not written after it.
     */
    async function writeUnits(units: readonly UnitWrite[]): Promise<UnitOutcome[]> {
        const outcomes: UnitOutcome[] = units.map(() => ({ status: 'skipped' as const }))
        let next = 0
        let stopped = false
        const worker = async (): Promise<void> => {
            while (!stopped && next < units.length) {
                const index = next++
                try {
                    const written = await writeKey(units[index].key, units[index].bytes, (error, what) => failureOf(error, what))
                    outcomes[index] = { status: 'written', flushed: written.flushed }
                    if (written.flushed !== true) {
                        stopped = true
                    }
                } catch (error) {
                    stopped = true
                    outcomes[index] = { status: 'failed', error }
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(UNIT_WRITE_PARALLELISM, units.length) }, worker))
        return outcomes
    }

    /** The compare-and-write (or compare-and-delete when `next` is null) of one top-level key, under the mutex. */
    function compareAndSet(key: string, expected: CompareToken, next: Uint8Array | null, conflict: (current: Store2Read) => Error): Promise<Store2WriteResult> {
        bytesTokenOf(expected)
        const owned = next === null ? null : copyOf(next)
        return underMutex(store, async () => {
            const current = await readKey(key)
            if (!tokenMatches(expected, current)) {
                throw conflict(readOf(current))
            }
            if (owned !== null) {
                return writeKey(key, owned, writeFailureOf)
            }
            if (current !== null) {
                try {
                    await store.delete(key, 'unconditional')
                } catch (error) {
                    throw writeFailureOf(error, `Deleting ${key}`)
                }
            }
            return { flushed: undefined }
        })
    }

    return {
        async readCommit() {
            return readOf(await readKey(COMMIT_KEY))
        },

        async readFence() {
            return readOf(await readKey(FENCE_KEY))
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
                    out.set(key, await readKey(key))
                }
            }
            await Promise.all(Array.from({ length: Math.min(READ_PARALLELISM, keys.length) }, worker))
            return new Map(keys.map((key) => [key, out.get(key) ?? null]))
        },

        async listStore2() {
            let names: string[]
            try {
                names = await store.list(STORE2_PREFIX)
            } catch (error) {
                throw failureOf(error, 'Listing store2')
            }
            // Only a well-formed unit key under `store2/` is a unit, which also leaves out the three top-level keys.
            return [...new Set(names.filter((name) => isStore2Key(name)))].sort()
        },

        async countPrefix(prefix) {
            try {
                return new Set((await store.list(prefix)).filter((name) => name.startsWith(prefix))).size
            } catch (error) {
                throw failureOf(error, `Counting ${prefix}`)
            }
        },

        async commitOrdinary(expectedCommit, units: readonly UnitWrite[], nextCommit) {
            checkUnitKeys(units.map((unit) => unit.key))
            bytesTokenOf(expectedCommit)
            const owned = units.map((unit) => ({ key: unit.key, bytes: copyOf(unit.bytes) }))
            const ownedCommit = copyOf(nextCommit)
            return underMutex(store, async () => {
                const current = await readKey(COMMIT_KEY)
                if (!tokenMatches(expectedCommit, current)) {
                    throw new Store2CommitConflictError(readOf(current))
                }
                for (const unit of owned) {
                    if (await hasKey(unit.key)) {
                        throw new Store2OverwriteRefusedError(unit.key)
                    }
                }
                // The mutex stays held until every started write has settled, so no other step sees a write still in flight.
                const outcomes = await writeUnits(owned)
                for (const [index, outcome] of outcomes.entries()) {
                    if (outcome.status === 'failed') {
                        throw outcome.error
                    }
                    if (outcome.status === 'written' && outcome.flushed !== true) {
                        throw new Store2BackendFailureError(`The unit ${owned[index].key} was written but its flush ${outcome.flushed === false ? 'failed' : 'was not reported'}, so the commit key was not written.`)
                    }
                }
                return writeKey(COMMIT_KEY, ownedCommit, writeFailureOf)
            })
        },

        async putUnit(key, bytes) {
            checkUnitKey(key)
            const owned = copyOf(bytes)
            return underMutex(store, async () => {
                if (await hasKey(key)) {
                    throw new Store2OverwriteRefusedError(key)
                }
                return writeKey(key, owned, writeFailureOf)
            })
        },

        async removeBatch(keys, expectedCommit, expectedFence) {
            checkRemoveBatch(keys)
            bytesTokenOf(expectedCommit)
            bytesTokenOf(expectedFence)
            const owned = [...keys]
            return underMutex(store, async () => {
                const commit = await readKey(COMMIT_KEY)
                if (!tokenMatches(expectedCommit, commit)) {
                    throw new Store2CommitConflictError(readOf(commit))
                }
                const fence = await readKey(FENCE_KEY)
                if (!tokenMatches(expectedFence, fence)) {
                    throw new Store2FenceConflictError(readOf(fence))
                }
                if (owned.length > 0) {
                    try {
                        await store.deleteMany(owned.map((key) => ({ key, condition: 'unconditional' as const })))
                    } catch (error) {
                        // A partial removal is reported by the store as its own error; either way some keys may be gone.
                        throw error instanceof StoreDeleteManyError ? new Store2UnknownOutcomeError('Some units may or may not have been removed.', { cause: error }) : failureOf(error, 'Removing units')
                    }
                }
                return { flushed: undefined }
            })
        },
    }
}
