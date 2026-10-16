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

/**
 * A call through the byte store's page-generation gate (`ByteStore.pageGate`) named a
 * generation that is not the current one: a newer page registered since, or this
 * page never registered. The native side refused it before touching the disk, so
 * nothing was applied; like `StoreInvalidKeyError` it is a definite failure. A call
 * that was re-sent after a failed first attempt may still have been applied by the
 * earlier attempt, which is harmless because the refused page stops deciding.
 */
export class StoreStaleGenerationError extends StoreError {
    constructor(public readonly detail: string) {
        super(`The page's storage generation is not the current one: ${detail}`)
        this.name = 'StoreStaleGenerationError'
    }
}

/**
 * Registering the page with the gate found a decisive write of an earlier page still
 * holding it past the native deadline. No generation was issued and nothing was
 * applied.
 */
export class StoreRegistrationTimeoutError extends StoreError {
    constructor(public readonly detail: string) {
        super(`The page could not register with the storage gate: ${detail}`)
        this.name = 'StoreRegistrationTimeoutError'
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

/**
 * The Node server did not give the positive answer a guarded request needs: it
 * lacks the guarded routes (a server older than this client, a proxy that
 * answers for them), or its answer did not prove that the request's checks were
 * applied. The caller treats the page as unable to save or collect until the
 * server is updated or restarted.
 *
 * `mayHaveApplied` is true when the server answered 2xx and the answer was
 * refused (a missing marker or revision, a wrong echo): the request may have
 * run. The caller then handles it like `StoreOutcomeUnknownError`: re-read the
 * commit key before anything, and abandon a collection pass. It is false when
 * nothing was applied (404, 405, an HTML page, a redirect, a refused count).
 *
 * The false cases assume that the repository's own server and its service
 * worker never answer a guarded route with an HTML page or a bare 404, and that
 * no intermediary forwards the request and then substitutes a page for the
 * server's answer (for example an `error_page` that maps a 502 or 504 to a 200
 * HTML page). That case is outside what this check covers; the commit key's
 * compare-and-swap bounds the damage, because a retry with the old version
 * conflicts.
 */
export class ServerLacksCapabilityError extends StoreError {
    constructor(
        public readonly capability: 'check-only' | 'retire' | 'caps',
        public readonly observed: string,
        public readonly mayHaveApplied: boolean,
    ) {
        super(`The Node server cannot do this guarded request (${capability}: ${observed}). The server must be updated or restarted.`)
        this.name = 'ServerLacksCapabilityError'
    }
}

/**
 * A guarded request carried more check-only keys than a request can hold.
 * Never retry the same list; switch to the bulk path where one exists.
 * `sent` is false when the client refused before sending; `mayHaveApplied` is
 * false for a refusal by the client and for the server's 431, which Node sends
 * before any handler runs.
 */
export class StoreCheckListTooLongError extends StoreError {
    constructor(
        public readonly keyCount: number,
        public readonly sent: boolean,
        public readonly mayHaveApplied: boolean,
    ) {
        super(`A guarded request carried ${keyCount} keys, which is more than one request can carry.`)
        this.name = 'StoreCheckListTooLongError'
    }
}

/**
 * A guarded request was sent and the connection failed before any answer, so
 * it may or may not have been applied. Re-read the commit key before anything
 * else; a collection pass is abandoned; the request is never resent as it is.
 * A failure before the request left (for example no auth header could be
 * produced) is not this error. The Node adapter's `NodeHttpError` for a 5xx, or
 * for a status an intermediary produced after the request was sent, carries the
 * same uncertainty and is handled the same way; a 400, 401, 403 or 429 applied
 * nothing.
 */
export class StoreOutcomeUnknownError extends StoreError {
    constructor(public readonly operation: string, public readonly cause: unknown) {
        super(`The outcome of the ${operation} request is unknown: the connection failed after it was sent.`)
        this.name = 'StoreOutcomeUnknownError'
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
