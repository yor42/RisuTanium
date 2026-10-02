/**
 * The typed failures of a `ByteStore`. A failure that is not one of these (a
 * network error, a file system error, an IndexedDB error) rejects with the
 * backend's own error: a store never turns a backend failure into a result.
 */

export class StoreError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'StoreError'
    }
}

/** The key cannot be used for this operation on this backend. Raised before any backend call. */
export class StoreInvalidKeyError extends StoreError {
    constructor(public readonly key: string, public readonly reason: string) {
        super(`Invalid storage key ${JSON.stringify(key)}: ${reason}`)
        this.name = 'StoreInvalidKeyError'
    }
}

/** The condition is not `'unconditional'` and not `{ ifVersion }` with a usable version. Raised before any backend call. */
export class StoreInvalidConditionError extends StoreError {
    constructor(public readonly reason: string) {
        super(`Invalid storage condition: ${reason}`)
        this.name = 'StoreInvalidConditionError'
    }
}

/** An `ifVersion` reached a store whose `capabilities.conditionalWrites` is false. Nothing was changed. */
export class StoreUnsupportedConditionError extends StoreError {
    constructor() {
        super('This store cannot enforce ifVersion; pass \'unconditional\'.')
        this.name = 'StoreUnsupportedConditionError'
    }
}

/**
 * The version a conditional write or delete named is not the key's current
 * version, and nothing was changed for that key.
 *
 * `currentVersion` is diagnostic. It must never be passed as the next
 * `ifVersion` for the same bytes: that would let a stale writer overwrite
 * exactly what the conflict reported. Only a fresh `read` establishes a version
 * a caller may act on.
 */
export class StoreVersionConflictError extends StoreError {
    constructor(public readonly key: string, public readonly currentVersion: number | null) {
        super(`Storage version conflict on ${JSON.stringify(key)}.`)
        this.name = 'StoreVersionConflictError'
    }
}

/** The key holds an entry that is not bytes (only the shared browser store can hold one). */
export class StoreNotBinaryError extends StoreError {
    constructor(public readonly key: string) {
        super(`The entry under ${JSON.stringify(key)} is not binary data.`)
        this.name = 'StoreNotBinaryError'
    }
}

/**
 * What became of one key of a `deleteMany`:
 * - `removed`: the key holds no value now.
 * - `conflict`: its `ifVersion` was stale; nothing was changed for it.
 * - `failed`: removing it failed; `error` says why.
 * - `unchanged`: nothing was removed for it, either because the request that
 *   carried it was rejected as a whole or because an earlier request failed and
 *   it was never attempted.
 * - `unknown`: the request that carried it failed in a way that does not say
 *   whether it was removed.
 */
export type DeleteOutcome = 'removed' | 'conflict' | 'failed' | 'unchanged' | 'unknown'

export interface DeleteReportEntry {
    key: string
    outcome: DeleteOutcome
    /** The key's current version, for a `conflict`. */
    currentVersion?: number | null
    /** The backend error behind a `failed`, `unchanged` or `unknown` outcome. */
    error?: unknown
}

/** `deleteMany` is not atomic: this names, per key, what happened. It is thrown unless every key is `removed`. */
export class StoreDeleteManyError extends StoreError {
    constructor(public readonly report: readonly DeleteReportEntry[]) {
        super(`deleteMany did not remove every key: ${summarize(report)}`)
        this.name = 'StoreDeleteManyError'
    }
}

function summarize(report: readonly DeleteReportEntry[]): string {
    const counts = new Map<DeleteOutcome, number>()
    for (const entry of report) {
        counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1)
    }
    return Array.from(counts, ([outcome, count]) => `${count} ${outcome}`).join(', ')
}
