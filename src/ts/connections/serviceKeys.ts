import type { Database } from 'src/ts/storage/database.svelte'
import { SecretRefError } from 'src/ts/secretRef'
import { slotConnection, SERVICE_SLOTS, type ServiceSlot } from './connections'
import { connectionKey, connectionKeyForUi } from './keyAccess'
import { VaultKeyUnavailableError } from './keyVaultStore.svelte'
import { setSlotKey, slotEditorValue } from './slotEditor'

/*
 * The one seam for the keys of the non-chat services (speech, image, translation, memory and embedding).
 * Every reader and editor goes through the functions below and never touches a legacy field directly.
 * A slot is backed by its connection: the legacy database position only carries a key in an upstream
 * file, and the load migration moves it into the connection. The value is the whole stored string:
 * it is never split into lines and a `${NAME}` reference is left for the reader to resolve.
 */

export { SERVICE_SLOTS, type ServiceSlot }

/**
 * The stored value of a service key: the whole string, unresolved, never split into lines. A slot with
 * no connection reads as empty; a wrapped key that cannot be read yet rejects with `VaultKeyUnavailableError`.
 * The caller passes the database, so this module stays free of the storage layer.
 */
export async function serviceKey(slot: ServiceSlot, db: Database): Promise<string> {
    const conn = slotConnection(db, slot)
    return conn === undefined ? '' : await connectionKey(conn)
}

/** The sync form of `serviceKey` for templates and initial values, which cannot await. */
export function serviceKeyForUi(slot: ServiceSlot, db: Database): string {
    const conn = slotConnection(db, slot)
    return conn === undefined ? '' : connectionKeyForUi(conn)
}

/** The key text a settings field shows for a slot. */
export function serviceEditorValue(db: Database, slot: ServiceSlot): string {
    return slotEditorValue(db, slot)
}

/** Stores the key typed for a slot, creating its connection on the first non-empty value. */
export async function setServiceKey(db: Database, slot: ServiceSlot, value: string): Promise<void> {
    await setSlotKey(db, slot, value)
}

/**
 * Whether an error from reading or resolving a key must stop the request: a `${NAME}` reference that
 * cannot be resolved, or a wrapped key that cannot be read right now. A caller that catches it reports
 * the failure and sends nothing; it never carries on with an empty key.
 */
export function isKeyReadStop(error: unknown): error is SecretRefError | VaultKeyUnavailableError {
    return error instanceof SecretRefError || error instanceof VaultKeyUnavailableError
}
