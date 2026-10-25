/**
 * The byte-store contract: whole binary values under string keys, one interface
 * over the desktop files, the self-hosted Node server and the browser's
 * IndexedDB. A key is a `/`-separated relative path (`database/database.bin`,
 * `assets/<name>`); the rules are in `keyRules.ts`.
 *
 * Invariants every adapter keeps (values are bytes, except under an inlay body
 * key on a store that offers `readBlob`, where a value may be held as a Blob
 * that `read` still returns as the same bytes):
 * - Byte identity: `read` returns, byte for byte, the last value written under
 *   the key, or the value upstream wrote there. A zero-length value is a value
 *   and is never confused with an absent key.
 * - No aliasing: changing the array handed to `write` after it resolved, or the
 *   array `read` returned, never changes what is stored.
 * - A failed or rejected write leaves the previous value readable and unchanged.
 * - A condition never degrades silently: an adapter that cannot enforce
 *   `ifVersion` rejects it and changes nothing.
 * - An unusable key is refused before any backend call.
 * - `list` returns only keys that hold an entry, each once, never a backend's
 *   internal names.
 *
 * Operations on the same key are not ordered against each other by the store;
 * callers serialize them.
 *
 * On the desktop file system a key cannot also be the directory prefix of
 * another key (`a/b` and `a/b/c` cannot both hold values); the Node server and
 * IndexedDB allow it. No key the app uses collides this way.
 */

/**
 * Identifies the state of a key for `ifVersion`. Callers treat it as opaque: it
 * comes from `read` or `write` and goes back as `ifVersion` unchanged. On the
 * Node server it is the server's revision, a non-negative integer.
 */
export type StoreVersion = number

/**
 * Every `write`, `delete` and `deleteMany` entry says whether it is guarded.
 * `{ ifVersion }` succeeds only while the key is still at that version.
 * `'unconditional'` replaces or removes whatever is there. There is no default:
 * leaving the choice out is a type error.
 */
export type StoreCondition = { readonly ifVersion: StoreVersion } | 'unconditional'

export interface StoreCapabilities {
    /** True only when the backend enforces `ifVersion` atomically. When false every `ifVersion` is rejected. */
    readonly conditionalWrites: boolean
}

export interface ReadResult {
    /**
     * The value, as an array that owns exactly its bytes, or `null` when the
     * key holds no value. A stored zero-length value is a zero-length array.
     */
    bytes: Uint8Array | null
    /**
     * The key's version, also when `bytes` is `null` (it is then the version a
     * create must present). `null` on a store without conditional writes.
     */
    version: StoreVersion | null
}

export interface WriteResult {
    /** The version the key has now; `null` on a store without conditional writes. */
    version: StoreVersion | null
    /**
     * Present only on stores that flush a write to disk. `false` means the bytes
     * are written but the directory entry may not survive power loss (a directory
     * flush failed, or none happened for an existing key kept as is). `true` means
     * every flush succeeded. Absent means the store does not report it.
     */
    flushed?: boolean
}

export interface DeleteEntry {
    key: string
    condition: StoreCondition
}

/**
 * A value written in pieces. Calls are awaited one at a time. The writer may
 * keep the newest piece until the next call, so a piece handed to `write` is
 * never changed afterwards. Nothing is visible under any key before `finish`
 * resolves.
 */
export interface PieceWriter {
    /** Queues the bytes. A rejection means the write is over and holds nothing. */
    write(data: Uint8Array): Promise<void>
    /**
     * Completes the write. With `finalKey` (a key in the same folder as the key
     * the writer was opened for) the value is stored under `finalKey` instead,
     * unless `finalKey` already holds a value: that value is kept, the pieces are
     * discarded and the call still resolves.
     */
    finish(finalKey?: string): Promise<void>
    /** Discards an unfinished write. Never rejects; a no-op after `finish` resolved. */
    abort(): Promise<void>
}

/** A stored value read in pieces; see `ByteStore.readPieces`. */
export interface PieceSource {
    /** The byte length of the whole value, as of the first piece. */
    readonly total: number
    /** The version of the value the pieces belong to; `null` on a store without versions. */
    readonly version: StoreVersion | null
    /** The pieces in order; their lengths add up to `total`. Iterated once. */
    readonly pieces: AsyncIterable<Uint8Array>
}

export interface ByteStore {
    readonly capabilities: StoreCapabilities

    /** Resolves the value and version of `key`; `bytes` is `null` when it holds none. */
    read(key: string): Promise<ReadResult>

    /** Replaces the whole value of `key`, creating it when absent. */
    write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult>

    /** Removes `key`. Resolves when the key holds no value afterwards, also when it held none. */
    delete(key: string, condition: StoreCondition): Promise<void>

    /**
     * Removes several keys. Not atomic. Resolves when every key is removed;
     * otherwise rejects with a `StoreDeleteManyError` that reports each key.
     * A key listed twice is an invalid input.
     */
    deleteMany(entries: readonly DeleteEntry[]): Promise<void>

    /**
     * The keys that hold an entry and start with `prefix`, each once, in no
     * promised order. `prefix` is non-empty, may end with `/` or in the middle
     * of a name (`database/dbbackup-`).
     */
    list(prefix: string): Promise<string[]>

    /**
     * How many keys start with `prefix` (empty allowed), without transferring
     * the names. `null` means the backend cannot count cheaply or did not give
     * a trustworthy number (an older server, an unrecognised answer). `null` is
     * never zero: a limit check treats it as over the limit, and a caller that
     * needs the answer lists. A count cannot be re-filtered the way a `list`
     * answer is, so a caller that acts on zero confirms it with `list` first.
     * Never falls back to listing.
     */
    countPrefix?(prefix: string): Promise<number | null>

    /**
     * Whether `key` holds a value. The value is never transferred to the caller.
     * The Node server answers from the file's size and revision, IndexedDB
     * looks the key up and loads no value, and the desktop store checks the
     * path only.
     */
    has(key: string): Promise<boolean>

    /**
     * A URL a web view can load `key` from, derived from the key alone: it never
     * reads, lists or checks the value, and a URL for an absent key is still a
     * URL. Only a backend whose files the web view can reach itself, or whose
     * server serves a value by URL, offers it; on every other backend the
     * caller reads the bytes instead. Refuses an unusable key like `read`. A
     * backend that serves only some keys by URL (the Node server serves keys
     * under `assets/` and inlay body keys) also refuses the others, and the
     * caller reads those.
     */
    urlFor?(key: string): Promise<string>

    /**
     * Stores a Blob as the value of `key` without reading the whole Blob into
     * memory. The browser's IndexedDB offers it for an inlay body key only and
     * keeps the Blob (`readBlob`); any other key is refused before anything is
     * written, so every other key class keeps holding bytes. The Node store
     * offers it for an inlay body key and a key under `assets/`: it reads the
     * Blob one slice at a time and uploads the slices, holds no Blob and offers
     * no `readBlob`; a server without the upload routes gets the whole value in
     * one request. The Tauri store offers it for the same two key classes: it
     * reads the Blob one slice at a time into its chunked writer (replacing the
     * key when the last chunk lands) and offers no `readBlob` either.
     * The value reads back through `read` as the same bytes, and
     * `list`, `has` and `delete` treat the key like any other. A File is stored as
     * a Blob over the same bytes. An error thrown while a slice of the Blob is
     * read reaches the caller as it is, and the write is abandoned and not re-sent.
     */
    writeBlob?(key: string, blob: Blob, condition: StoreCondition): Promise<WriteResult>

    /**
     * The Blob a `writeBlob` stored under `key`, still backed by the store and
     * not a copy in memory. `null` when the key holds no such Blob: it is absent,
     * holds bytes (a `write`, a copy from another store), or the browser kept the
     * value in an encoded form that cannot be handed back as a Blob. A caller that
     * gets `null` uses `read`. Refuses a key that is not an inlay body key like
     * `writeBlob`.
     */
    readBlob?(key: string): Promise<Blob | null>

    /**
     * Starts a write of one value that arrives in pieces, so the caller never
     * holds the whole value. `key` is only the folder and the name of the
     * temporary file: a caller that finishes with a `finalKey` never creates
     * `key`. Refuses an unusable key like `write`. The desktop store and the
     * Node store offer it; every other caller writes the whole value with `write`.
     * The Node store uploads in chunks when the server offers `pieces`, and
     * otherwise collects the pieces and writes the whole value in one request,
     * so the caller never sees a missing upload route. A write that fails
     * rejects: with the transport's own error when a re-sent append fails again,
     * with `NodeHttpError` when the server answers with its own failure, and with
     * a typed error when the upload is gone, the server holds too many staged
     * bytes or the commit's outcome is unknown (`UploadGoneError`,
     * `UploadCapacityError`, `StoreOutcomeUnknownError`).
     */
    openWriter?(key: string): PieceWriter

    /**
     * Reads the value of `key` as consecutive pieces without ever holding the
     * whole value, or resolves `null` when the key holds no value. `total` and
     * `version` are known from the first piece, which is already fetched. The
     * pieces never restart: when the value changes after the first piece the
     * iteration rejects with `StoreValueChangedError`, and any other failure
     * rejects with the transport's own error, which is never an absence. Only
     * the Node store offers it, and falls back to one whole read when its server
     * lacks ranged reads.
     */
    readPieces?(key: string): Promise<PieceSource | null>

    /**
     * Guarded operations. Optional and Node only: every other adapter leaves it
     * out. The self-hosted Node server alone can compare other keys' revisions
     * inside the same step as a write or a removal.
     */
    guarded?: GuardedOperations

    /**
     * The page-generation gate for the store2 decisive writes. Optional and
     * Tauri only: every other adapter leaves it out.
     */
    pageGate?: PageGateOperations
}

/**
 * What the Tauri shell's process-wide generation gate offers. A page registers once
 * and presents the generation it was issued on every decisive call; the native side
 * refuses a call whose generation is not the current one before it touches the disk,
 * so a write of a page that died cannot land after a newer page registered.
 *
 * `registerPage` issues the generation; `writeTop` and `removeTop` are the decisive calls: each resolves only after the target holds the new bytes (or
 * the keys are removed) under the native gate lock. Failures:
 * - `StoreStaleGenerationError`: refused, nothing applied.
 * - `StoreRegistrationTimeoutError` (`registerPage`): no generation was issued.
 * - `StoreInvalidKeyError`: the key is not one the gate may change; nothing applied.
 * - any other rejection may have been applied: the caller reads back.
 * Only `store2-commit` and `store2-fence` are written, and only `store2/` keys and
 * `store2-fence` are removed; the commit key is never removed.
 */
export interface PageGateOperations {
    /** Issues the next generation (always above 0). Waits, bounded, for a decisive write still in flight. */
    registerPage(): Promise<number>

    /** Replaces the whole value of `key` under `generation`; `flushed` reports the directory flush as `write` does. */
    writeTop(generation: number, key: string, bytes: Uint8Array): Promise<WriteResult>

    /**
     * Removes `keys` under one hold of the gate, an absent key counting as removed.
     * Resolves when every key is removed; otherwise rejects with a
     * `StoreDeleteManyError` that reports each key (`removed` or `failed`).
     */
    removeTop(generation: number, keys: readonly string[]): Promise<void>
}

/**
 * A key whose version is only compared. It is never written, removed or bumped
 * by the request that names it. A key that is absent, or was retired, compares
 * as version 0 and so fails for any version of 1 or more.
 */
export interface CheckOnlyEntry {
    key: string
    version: StoreVersion
}

/** What the server's guarded routes can do. `pieces` says the server takes chunked uploads and ranged reads of asset keys. */
export interface GuardedCapabilities {
    checkOnly: boolean
    retire: boolean
    pieces: boolean
}

/**
 * Every call is fail-closed on its own: the server must answer with its marker,
 * a numeric revision and an echo of exactly the checks the call sent, otherwise
 * the call rejects with `ServerLacksCapabilityError` (`mayHaveApplied` says
 * whether the request may have run). `probe` exists only so a page can park
 * with a clear message at boot and at the start of a clean-up pass; it is not
 * what makes a call safe.
 *
 * Failures:
 * - `StoreVersionConflictError` names the key that did not match (a written or
 *   removed key, or a check-only key) with its `currentVersion`; nothing was
 *   changed.
 * - `ServerLacksCapabilityError`: see above.
 * - `StoreCheckListTooLongError`: more check-only keys than a request holds. Never
 *   retried as it is.
 * - `NodeHttpError` (Node adapter): any other status. A 5xx, or a status from an
 *   intermediary, after the request was sent may have applied; handle it like
 *   `StoreOutcomeUnknownError`. A 400, 401, 403 or 429 applied nothing (a refused
 *   count list is a `ServerLacksCapabilityError`, not this).
 * - `StoreOutcomeUnknownError`: the connection failed after the request was
 *   sent. Re-read the commit key before anything; a collection pass is abandoned.
 * - `StoreInvalidKeyError` and `StoreInvalidConditionError`, before any request.
 */
export interface GuardedOperations {
    /** Asks the server for its capabilities. Not cached (the Node store records `pieces` from each answer); rejects with `ServerLacksCapabilityError` unless the answer has the marker and the three booleans. */
    probe(): Promise<GuardedCapabilities>

    /** `write`, with `checkOnly` compared in the same step. */
    writeChecked(key: string, bytes: Uint8Array, condition: StoreCondition, checkOnly: readonly CheckOnlyEntry[]): Promise<WriteResult>

    /** One request that removes `entries` when every `checkOnly` entry still matches. The caller sizes the batch. */
    removeChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void>

    /**
     * Like `removeChecked`, and the removed keys are also forgotten by the
     * server: afterwards each reads as version 0 and its name must never be
     * written again. For garbage collection only: every key must be under the
     * A-lite prefix and at least one check-only entry (the commit key) is
     * required; otherwise it rejects before any request.
     */
    retireChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void>
}
