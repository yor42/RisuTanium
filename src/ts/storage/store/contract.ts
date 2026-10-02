/**
 * The byte-store contract: whole binary values under string keys, one interface
 * over the desktop files, the self-hosted Node server and the browser's
 * IndexedDB. A key is a `/`-separated relative path (`database/database.bin`,
 * `assets/<name>`); the rules are in `keyRules.ts`.
 *
 * Invariants every adapter keeps:
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
}
