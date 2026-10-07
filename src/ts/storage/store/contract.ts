/**
 * The byte-store contract: whole binary values under string keys, one interface
 * over the desktop files, the self-hosted Node server and the browser's
 * IndexedDB. A key is a `/`-separated relative path (`database/database.bin`,
 * `assets/<name>`); the rules are in `keyRules.ts`.
 *
 * Invariants every adapter keeps (values are bytes, except under an inlay body
 * key on a store that offers `writeBlob`, where a value may be held as a Blob
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
     * Whether `key` holds a value. The value is never transferred to the caller.
     * The backend may still read it: the Node server reads the file to answer.
     * IndexedDB checks the key list and loads no value; the desktop store checks
     * the path only.
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
     * Stores a Blob as the value of `key` without reading it into memory. Only
     * the browser's IndexedDB offers it, and only for an inlay body key: any other
     * key is refused before anything is written, so every other key class keeps
     * holding bytes. The value reads back through `read` as the same bytes, and
     * `list`, `has` and `delete` treat the key like any other. A File is stored as
     * a Blob over the same bytes.
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
     * `key`. Refuses an unusable key like `write`. Only the desktop store
     * offers it; every other caller writes the whole value with `write`.
     */
    openWriter?(key: string): PieceWriter
}
