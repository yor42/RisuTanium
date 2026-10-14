import type { Store2Read } from './types'

/**
 * What a backend step can report. A backend holds no protocol policy: these
 * errors say only what the atomic primitive saw.
 *
 *   conflict, refused overwrite, backend failure, not binary:
 *       definite. Nothing was written or deleted by the step.
 *   unknown outcome:
 *       the step may or may not have been applied. The caller reads back before
 *       it acts; it never treats this as success or as failure.
 */
export type Store2BackendErrorKind =
    | 'commit-conflict'
    | 'fence-conflict'
    | 'overwrite-refused'
    | 'unit-conflict'
    | 'unknown-outcome'
    | 'backend-failure'
    | 'not-binary'

export abstract class Store2BackendError extends Error {
    abstract readonly kind: Store2BackendErrorKind
}

/** The commit key is not what the caller expected. `current` is what is there now. */
export class Store2CommitConflictError extends Store2BackendError {
    readonly kind = 'commit-conflict'
    constructor(readonly current: Store2Read) {
        super('The commit key changed since it was read.')
        this.name = 'Store2CommitConflictError'
    }
}

/** The fence is not what the caller expected. `current` is what is there now. */
export class Store2FenceConflictError extends Store2BackendError {
    readonly kind = 'fence-conflict'
    constructor(readonly current: Store2Read) {
        super('The fence changed since it was read.')
        this.name = 'Store2FenceConflictError'
    }
}

/** A unit key that must be fresh already has an entry; the whole step wrote nothing. */
export class Store2OverwriteRefusedError extends Store2BackendError {
    readonly kind = 'overwrite-refused'
    constructor(readonly key: string) {
        super(`The unit ${key} already exists and is never overwritten.`)
        this.name = 'Store2OverwriteRefusedError'
    }
}

/**
 * A unit named by the step is not at the revision the step expected. The commit key (and, for a removal, the fence)
 * matched; nothing was deleted and the commit key was not written. Units that a Node commit had already uploaded under
 * fresh keys may remain as orphans that no commit names, so a caller may assume only that the commit did not happen.
 */
export class Store2UnitConflictError extends Store2BackendError {
    readonly kind = 'unit-conflict'
    constructor(readonly key: string) {
        super(`The unit ${key} changed since the step expected it.`)
        this.name = 'Store2UnitConflictError'
    }
}

/** The step may or may not have been applied (a transaction that neither completed nor failed, or a lost response). */
export class Store2UnknownOutcomeError extends Store2BackendError {
    readonly kind = 'unknown-outcome'
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'Store2UnknownOutcomeError'
    }
}

/** The backend could not perform the step (no database, a failed or aborted transaction); nothing was written. */
export class Store2BackendFailureError extends Store2BackendError {
    readonly kind = 'backend-failure'
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'Store2BackendFailureError'
    }
}

/** An entry under a store2 key is not binary data. */
export class Store2NotBinaryError extends Store2BackendError {
    readonly kind = 'not-binary'
    constructor(readonly key: string) {
        super(`The entry ${key} is not binary data.`)
        this.name = 'Store2NotBinaryError'
    }
}
