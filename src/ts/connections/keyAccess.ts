import { isSecretRef } from 'src/ts/secretRefPattern'
import type { Connection } from './connections'
import {
    connectionHasKey as storeHasKey,
    connectionKey as storeKey,
    connectionKeyForUi as storeKeyForUi,
    connectionKeyTemporarilyUnavailable as storeTemporarilyUnavailable,
    connectionNeedsReentry as storeNeedsReentry,
    isReferenceOnlyKey,
    writeConnectionKey,
} from './keyVaultStore.svelte'

/*
 * The read and write seam for a connection's key. A connection holds a plain `key` or, with
 * `key === ''`, a Keystore envelope in `keyWrapped`; the state lives in keyVaultStore, so every
 * caller reads and writes through these functions and never touches `key` directly.
 */

/**
 * The plaintext key of a connection: the whole multi-line string, never split or resolved. A key
 * that is temporarily unreadable rejects with `VaultKeyUnavailableError`.
 */
export async function connectionKey(conn: Connection): Promise<string> {
    return storeKey(conn)
}

/** Whether the connection holds a non-blank key that can be read here. Sync and reactive; no vault call. */
export function connectionHasKey(conn: Connection): boolean {
    return storeHasKey(conn)
}

/** Whether the connection holds an envelope this page can never read, so the key must be typed again. Sync and reactive. */
export function connectionNeedsReentry(conn: Connection): boolean {
    return storeNeedsReentry(conn)
}

/** Whether the connection's key is wrapped and not readable yet but will be (Android with a vault only). Sync and reactive. */
export function connectionKeyTemporarilyUnavailable(conn: Connection): boolean {
    return storeTemporarilyUnavailable(conn)
}

/**
 * Stores `plain` as the key. May be called without awaiting: the typed value is served at once by
 * the sync reader, and a `${NAME}` reference is stored as is and never wrapped.
 */
export function setConnectionKey(conn: Connection, plain: string): Promise<void> {
    return writeConnectionKey(conn, plain, isReferenceOnlyKey(plain, isSecretRef))
}

/** A sync, reactive read for editors and value sites; never starts a vault call. Empty while a wrapped key is not readable. */
export function connectionKeyForUi(conn: Connection): string {
    return storeKeyForUi(conn)
}
