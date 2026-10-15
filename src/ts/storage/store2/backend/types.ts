import { isStore2Key } from '../../store/keyRules'

/**
 * The backend interface of the store2 protocol: atomic primitives only. A
 * backend decides nothing about the protocol (retention, pins, owner, fence
 * policy, recovery); it reads, compares and writes or deletes keys, each step
 * all-or-nothing, and reports what it saw through the errors in `errors.ts`.
 *
 * Keys are either one of the three top-level keys (`COMMIT_KEY`, `FENCE_KEY`,
 * reached only through the commit and fence methods) or a unit key under
 * `store2/`. Every unit method refuses a key that is not a store2 unit key with
 * a `RangeError` before touching storage.
 */

/**
 * The compare token a backend hands out with a read. It is opaque to callers:
 * every expectation passed to a writing method comes from a read the same
 * backend returned (an absent key included), never from a hand-built value.
 * Off Node a compare is of the full bytes: a sequence number alone can match
 * while the bytes differ, so the token carries the bytes themselves, and `null`
 * is an absent key. The Node backend compares a revision the server reports
 * with each read instead (`present` says whether the key held a value, the
 * revision of an absent key being the one its first create must present); it
 * accepts only revision tokens and the other backends only byte tokens, each
 * refusing the other kind with a `RangeError`.
 */
export type CompareToken =
    | { kind: 'bytes', bytes: Uint8Array | null }
    | { kind: 'revision', revision: number, present: boolean }

export type BytesToken = Extract<CompareToken, { kind: 'bytes' }>
export type RevisionToken = Extract<CompareToken, { kind: 'revision' }>

/**
 * What a writing method resolves to. `flushed` is whether the backend knows the
 * write reached stable storage: `true` or `false` when it reports, `undefined`
 * when it does not (IndexedDB, Node and the memory backend never report, and are
 * never read as `true`). The Tauri backend never resolves `undefined` from a write
 * that reaches the store: a missing report is `false`. The protocol layer must
 * treat `false` as "not durable"; what to do about it is the protocol's policy,
 * not the backend's.
 */
export interface Store2WriteResult {
    flushed: boolean | undefined
}

/** A read of the commit key or the fence: the bytes (null when absent) and the token to compare against later. */
export interface Store2Read {
    bytes: Uint8Array | null
    token: CompareToken
}

/** A unit key and its framed bytes. */
export interface UnitWrite {
    key: string
    bytes: Uint8Array
}

/** The most keys one `removeBatch` deletes. */
export const REMOVE_BATCH_MAX = 25

/**
 * More new units than this make a commit a bulk commit. The threshold belongs to
 * the protocol (plan 3.10); a backend does not enforce it, and `commitOrdinary`
 * writes however many units it is given in one atomic step.
 */
export const BULK_UNIT_THRESHOLD = 59

export interface Store2Backend {
    /** The commit key. Never throws for an absent key: the read says `bytes: null`. */
    readCommit(): Promise<Store2Read>

    /** The fence, read like the commit key. */
    readFence(): Promise<Store2Read>

    /**
     * One atomic compare-and-write of the commit key. `expected.bytes === null`
     * is the first-life create, which succeeds only while the key is absent and
     * never overwrites. Any other expectation succeeds only when the stored
     * bytes are byte-for-byte `expected.bytes`.
     *
     * @throws Store2CommitConflictError with what is there now; nothing written.
     * @throws Store2UnknownOutcomeError when the outcome is not known.
     */
    casCommit(expected: CompareToken, next: Uint8Array): Promise<Store2WriteResult>

    /**
     * One atomic compare-and-write of the fence, or compare-and-delete when
     * `next` is null. `expected.bytes === null` creates (first life) and never
     * overwrites; a delete expecting an absent fence is a no-op that succeeds
     * only while the fence is still absent.
     *
     * @throws Store2FenceConflictError with what is there now; nothing changed.
     * @throws Store2UnknownOutcomeError when the outcome is not known.
     */
    casFence(expected: CompareToken, next: Uint8Array | null): Promise<Store2WriteResult>

    /**
     * Reads units, eight at a time at most. Every requested key is in the
     * result: a key with no entry maps to null, never an error.
     *
     * @throws Store2NotBinaryError when an entry exists but is not binary data.
     */
    readUnits(keys: readonly string[]): Promise<Map<string, Uint8Array | null>>

    /** Every key under `store2/`, in ordinal order; the three top-level keys are outside it and never listed. */
    listStore2(): Promise<string[]>

    /** How many keys start with `prefix` (a ranged count; it loads no value). */
    countPrefix(prefix: string): Promise<number>

    /**
     * One atomic step that compares the commit key with `expectedCommit` and, only
     * when equal, creates every unit and writes `nextCommit`. Units are fresh keys
     * never written before: a unit key that already has an entry means the commit
     * key is not written. Duplicate keys in `units` are a `RangeError`.
     *
     * The commit key changes only when the step succeeds. Whether a failed step
     * also leaves the units unwritten depends on the backend: the memory and
     * IndexedDB backends are atomic across units, so a conflict or an existing unit
     * writes no unit at all; the Node backend uploads each unit as its own request
     * before the commit-key write, and the Tauri backend writes each unit before the commit key, so a failed step may leave fresh units behind.
     * Such a unit is named by no commit, and a retry uses new unit keys.
     *
     * @throws Store2CommitConflictError (mismatch checked first), then
     *   Store2OverwriteRefusedError naming the existing key; the commit key is unchanged.
     * @throws Store2UnitConflictError (Node) when a unit it uploaded changed before the commit-key write.
     * @throws Store2UnknownOutcomeError when the outcome is not known.
     */
    commitOrdinary(expectedCommit: CompareToken, units: readonly UnitWrite[], nextCommit: Uint8Array): Promise<Store2WriteResult>

    /**
     * Creates one unit outside a commit (the bulk path); never overwrites.
     *
     * @throws Store2OverwriteRefusedError when the key already has an entry.
     */
    putUnit(key: string, bytes: Uint8Array): Promise<Store2WriteResult>

    /**
     * Deletes at most `REMOVE_BATCH_MAX` unit keys in one atomic step that first
     * re-checks the commit key against `expectedCommit` and the fence against
     * `expectedFence` (absent, or the same bytes). Any mismatch, including a fence
     * that appeared, deletes nothing. A key with no entry is not an error. More
     * than `REMOVE_BATCH_MAX` keys is a `RangeError`.
     *
     * @throws Store2CommitConflictError when the commit key changed (checked first).
     * @throws Store2FenceConflictError when the fence changed.
     * @throws Store2UnknownOutcomeError when the outcome is not known.
     */
    removeBatch(keys: readonly string[], expectedCommit: CompareToken, expectedFence: CompareToken): Promise<Store2WriteResult>
}

/** Full-bytes equality: every byte, never a prefix or a length. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/** The token of a byte-comparing backend; a revision token is refused before anything is touched. */
export function bytesTokenOf(token: CompareToken): BytesToken {
    if (token.kind !== 'bytes') {
        throw new RangeError('This backend compares bytes and accepts no revision token.')
    }
    return token
}

/** The token of the revision-comparing Node backend; a byte token is refused before anything is touched. */
export function revisionTokenOf(token: CompareToken): RevisionToken {
    if (token.kind !== 'revision') {
        throw new RangeError('This backend compares revisions and accepts no byte token.')
    }
    return token
}

/** Whether the stored bytes (null when absent) are what the token expected. */
export function tokenMatches(expected: CompareToken, actual: Uint8Array | null): boolean {
    const wanted = bytesTokenOf(expected).bytes
    if (wanted === null || actual === null) {
        return wanted === actual
    }
    return sameBytes(wanted, actual)
}

export function checkUnitKey(key: string): void {
    if (!isStore2Key(key)) {
        throw new RangeError(`${key} is not a store2 unit key.`)
    }
}

export function checkUnitKeys(keys: readonly string[]): void {
    const seen = new Set<string>()
    for (const key of keys) {
        checkUnitKey(key)
        if (seen.has(key)) {
            throw new RangeError(`${key} appears twice in one step.`)
        }
        seen.add(key)
    }
}

export function checkRemoveBatch(keys: readonly string[]): void {
    if (keys.length > REMOVE_BATCH_MAX) {
        throw new RangeError(`A removal batch holds at most ${REMOVE_BATCH_MAX} keys.`)
    }
    checkUnitKeys(keys)
}
