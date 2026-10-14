import type { ByteStore, GuardedOperations } from '../../store/contract'
import { ServerLacksCapabilityError, StoreCheckListTooLongError, StoreOutcomeUnknownError, StoreVersionConflictError } from '../../store/errors'
import { isStore2Key, STORE2_PREFIX } from '../../store/keyRules'
import { NodeHttpError } from '../../store/nodeHttpStore'
import { COMMIT_KEY, FENCE_KEY } from '../format/keys'
import { Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, Store2OverwriteRefusedError, Store2UnitConflictError, Store2UnknownOutcomeError } from './errors'
import { checkRemoveBatch, checkUnitKey, checkUnitKeys, revisionTokenOf, type CompareToken, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite } from './types'

/**
 * The store2 backend over the self-hosted Node server's HTTP routes, through the
 * guarded operations of a `ByteStore` from `createNodeHttpStore`. Every write
 * goes through the guarded routes, which prove that the request was applied as
 * asked and tell a failure before the request left from one after it.
 *
 * The compare token is the server's revision of the key, reported with every
 * read (an absent key included: its revision is what a first create must
 * present, never a constant). Compare-and-write is one guarded request whose own
 * `ifVersion` is that revision.
 *
 * What the server cannot do is one atomic step across several keys' writes:
 * `commitOrdinary` uploads each unit as its own create-only request and then
 * writes the commit key in a request that also compares every uploaded unit's
 * revision. A step that fails after some uploads leaves fresh units that no
 * commit names; collection removes them.
 *
 * Failures are classified by whether the request may have reached the server: a
 * lost connection or an answer that does not prove the outcome after the request
 * was sent is `Store2UnknownOutcomeError`; a refusal before anything was applied
 * (no auth header, an invalid request, a 4xx that applies nothing) is
 * `Store2BackendFailureError`. A reading method changes nothing, so every one of
 * its failures is a `Store2BackendFailureError`.
 */

/** Units uploaded or read at the same time. */
const UNIT_PARALLELISM = 8

/** Statuses of a guarded request that the server answers before it applies anything. */
const NOTHING_APPLIED_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 429])

function unreported(): Store2WriteResult {
    return { flushed: undefined }
}

/** What went wrong in one request, as the backend error that says whether it may have been applied. */
function backendErrorOf(error: unknown, writing: boolean): Error {
    if (error instanceof Store2BackendError || error instanceof RangeError) {
        return error
    }
    if (writing) {
        if (error instanceof StoreOutcomeUnknownError) {
            return new Store2UnknownOutcomeError(error.message, { cause: error })
        }
        if (error instanceof ServerLacksCapabilityError || error instanceof StoreCheckListTooLongError) {
            return error.mayHaveApplied ? new Store2UnknownOutcomeError(error.message, { cause: error }) : new Store2BackendFailureError(error.message, { cause: error })
        }
        if (error instanceof NodeHttpError) {
            return NOTHING_APPLIED_STATUSES.has(error.status)
                ? new Store2BackendFailureError(error.message, { cause: error })
                : new Store2UnknownOutcomeError(error.message, { cause: error })
        }
    }
    const message = error instanceof Error ? error.message : 'The Node server request failed.'
    return new Store2BackendFailureError(message, { cause: error })
}

type Outcome<R> = { status: 'ok', value: R } | { status: 'failed', error: unknown } | { status: 'skipped' }

/**
 * Runs `run` over `items`, `UNIT_PARALLELISM` at a time. After the first failure
 * no further item starts; the outcomes of items that ran are in item order and an
 * item that never started is `{ status: 'skipped' }`.
 */
async function runPool<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<Outcome<R>[]> {
    const outcomes: Outcome<R>[] = items.map(() => ({ status: 'skipped' as const }))
    let next = 0
    let failed = false
    const worker = async (): Promise<void> => {
        while (!failed && next < items.length) {
            const index = next++
            try {
                outcomes[index] = { status: 'ok', value: await run(items[index]) }
            } catch (error) {
                failed = true
                outcomes[index] = { status: 'failed', error }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(UNIT_PARALLELISM, items.length) }, worker))
    return outcomes
}

export function createNodeBackend(store: ByteStore): Store2Backend {
    const guarded: GuardedOperations | undefined = store.guarded
    if (guarded === undefined) {
        throw new Store2BackendFailureError('The byte store has no guarded operations; the store2 Node backend needs them.')
    }

    async function readKey(key: string): Promise<Store2Read> {
        let result: Awaited<ReturnType<ByteStore['read']>>
        try {
            result = await store.read(key)
        } catch (error) {
            throw backendErrorOf(error, false)
        }
        if (result.version === null) {
            throw new Store2BackendFailureError(`The Node server reported no revision for ${key}.`)
        }
        return { bytes: result.bytes, token: { kind: 'revision', revision: result.version, present: result.bytes !== null } }
    }

    /** One compare-and-write (or compare-and-delete when `next` is null) of a top-level key. */
    async function casKey(key: string, expected: CompareToken, next: Uint8Array | null, conflict: (current: Store2Read) => Error): Promise<Store2WriteResult> {
        const token = revisionTokenOf(expected)
        if (next === null && !token.present) {
            // Deleting what is absent writes nothing: it holds only while the key is still absent at the same revision,
            // and the server is not asked, since a removal of an absent key would move the revision the token carries.
            const current = await readKey(key)
            if (current.bytes !== null || current.token.kind !== 'revision' || current.token.revision !== token.revision) {
                throw conflict(current)
            }
            return unreported()
        }
        try {
            if (next === null) {
                await guarded.removeChecked([{ key, condition: { ifVersion: token.revision } }], [])
            } else {
                await guarded.writeChecked(key, next, { ifVersion: token.revision }, [])
            }
        } catch (error) {
            if (error instanceof StoreVersionConflictError) {
                throw conflict(await readKey(key))
            }
            throw backendErrorOf(error, true)
        }
        return unreported()
    }

    async function putFresh(unit: UnitWrite): Promise<number> {
        const written = await guarded.writeChecked(unit.key, unit.bytes, { ifVersion: 0 }, [])
        if (written.version === null) {
            throw new Store2BackendFailureError(`The Node server reported no revision for ${unit.key}.`)
        }
        return written.version
    }

    return {
        readCommit: () => readKey(COMMIT_KEY),

        readFence: () => readKey(FENCE_KEY),

        casCommit: (expected, next) => casKey(COMMIT_KEY, expected, next, (current) => new Store2CommitConflictError(current)),

        casFence: (expected, next) => casKey(FENCE_KEY, expected, next, (current) => new Store2FenceConflictError(current)),

        async readUnits(keys) {
            checkUnitKeys(keys)
            const outcomes = await runPool(keys, async (key) => (await readKey(key)).bytes)
            const out = new Map<string, Uint8Array | null>()
            keys.forEach((key, index) => {
                const outcome = outcomes[index]
                if (outcome.status === 'failed') {
                    throw backendErrorOf(outcome.error, false)
                }
                out.set(key, outcome.status === 'ok' ? outcome.value : null)
            })
            return out
        },

        async listStore2() {
            let names: string[]
            try {
                names = await store.list(STORE2_PREFIX)
            } catch (error) {
                throw backendErrorOf(error, false)
            }
            // The answer is never trusted as the server filtered it: only a well-formed unit key under `store2/` is a unit,
            // which also leaves out the three top-level keys.
            return [...new Set(names.filter((name) => isStore2Key(name)))].sort()
        },

        async countPrefix(prefix) {
            try {
                const counted = store.countPrefix === undefined ? null : await store.countPrefix(prefix)
                if (counted !== null) {
                    return counted
                }
                // A server without the count route (or an answer that cannot be trusted) is counted by listing.
                return (await store.list(prefix)).length
            } catch (error) {
                throw backendErrorOf(error, false)
            }
        },

        async commitOrdinary(expectedCommit, units: readonly UnitWrite[], nextCommit) {
            checkUnitKeys(units.map((unit) => unit.key))
            const expected = revisionTokenOf(expectedCommit)

            const uploads = await runPool(units, putFresh)
            const failures: { index: number, error: unknown }[] = []
            uploads.forEach((outcome, index) => {
                if (outcome.status === 'failed') {
                    failures.push({ index, error: outcome.error })
                }
            })
            const conflicts = failures.filter((failure) => failure.error instanceof StoreVersionConflictError)
            const others = failures.filter((failure) => !(failure.error instanceof StoreVersionConflictError)).map((failure) => backendErrorOf(failure.error, true))
            if (others.length > 0) {
                throw others.find((error) => error instanceof Store2UnknownOutcomeError) ?? others[0]
            }
            if (conflicts.length > 0) {
                // A stale commit key is reported before a unit that already exists.
                const commit = await readKey(COMMIT_KEY)
                if (commit.token.kind !== 'revision' || commit.token.revision !== expected.revision) {
                    throw new Store2CommitConflictError(commit)
                }
                throw new Store2OverwriteRefusedError(units[conflicts[0].index].key)
            }

            const checkOnly = units.map((unit, index) => {
                const outcome = uploads[index]
                if (outcome.status !== 'ok') {
                    throw new Store2BackendFailureError(`The unit ${unit.key} was not uploaded.`)
                }
                return { key: unit.key, version: outcome.value }
            })
            try {
                await guarded.writeChecked(COMMIT_KEY, nextCommit, { ifVersion: expected.revision }, checkOnly)
            } catch (error) {
                if (error instanceof StoreVersionConflictError) {
                    if (error.key === COMMIT_KEY) {
                        throw new Store2CommitConflictError(await readKey(COMMIT_KEY))
                    }
                    if (units.some((unit) => unit.key === error.key)) {
                        throw new Store2UnitConflictError(error.key)
                    }
                    throw new Store2BackendFailureError('The Node server named a key the request did not send.', { cause: error })
                }
                throw backendErrorOf(error, true)
            }
            return unreported()
        },

        async putUnit(key, bytes) {
            checkUnitKey(key)
            try {
                await putFresh({ key, bytes })
            } catch (error) {
                if (error instanceof StoreVersionConflictError) {
                    throw new Store2OverwriteRefusedError(key)
                }
                throw backendErrorOf(error, true)
            }
            return unreported()
        },

        async removeBatch(keys, expectedCommit, expectedFence) {
            checkRemoveBatch(keys)
            const commitToken = revisionTokenOf(expectedCommit)
            const fenceToken = revisionTokenOf(expectedFence)
            if (keys.length === 0) {
                // Nothing to delete: the same two checks, read rather than sent.
                const commit = await readKey(COMMIT_KEY)
                if (commit.token.kind !== 'revision' || commit.token.revision !== commitToken.revision) {
                    throw new Store2CommitConflictError(commit)
                }
                const fence = await readKey(FENCE_KEY)
                if (fence.token.kind !== 'revision' || fence.token.revision !== fenceToken.revision) {
                    throw new Store2FenceConflictError(fence)
                }
                return unreported()
            }
            try {
                // The commit key is listed first: the server reports the first check that fails.
                await guarded.removeChecked(
                    keys.map((key) => ({ key, condition: 'unconditional' as const })),
                    [{ key: COMMIT_KEY, version: commitToken.revision }, { key: FENCE_KEY, version: fenceToken.revision }],
                )
            } catch (error) {
                if (error instanceof StoreVersionConflictError) {
                    if (error.key === COMMIT_KEY) {
                        throw new Store2CommitConflictError(await readKey(COMMIT_KEY))
                    }
                    if (error.key === FENCE_KEY) {
                        throw new Store2FenceConflictError(await readKey(FENCE_KEY))
                    }
                    if (keys.includes(error.key)) {
                        throw new Store2UnitConflictError(error.key)
                    }
                    throw new Store2BackendFailureError('The Node server named a key the request did not send.', { cause: error })
                }
                throw backendErrorOf(error, true)
            }
            return unreported()
        },
    }
}
