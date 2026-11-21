import { resolveSecret } from 'src/ts/secretRef'
import { slotConnection, type ConnectionHolder, type ConnectionSlot } from 'src/ts/connections/connections'
import { connectionHasKey, connectionKey, connectionKeyForUi } from 'src/ts/connections/keyAccess'
import { getDatabase, type Database } from 'src/ts/storage/database.svelte'
import { isKeyLimitStatus, pickLine, type KeyRotation } from './keyRing'

/**
 * The credential to put in a request. A request preview keeps the value as typed, so a
 * `${NAME}` reference is shown as the reference and never resolved; a real request resolves
 * it, throwing `SecretRefError` when the variable cannot be read. A value that is not a
 * reference comes back unchanged either way.
 */
export async function resolveRequestKey(arg: { previewBody?: boolean }, value: string): Promise<string> {
    if (arg.previewBody) {
        return value
    }
    return await resolveSecret(value)
}

/** The database fields that hold API keys, one key per line. Custom and compatible models are keyed by model id. */
export type KeyFieldId =
    | 'openAIKey' | 'proxyKey' | 'claudeAPIKey' | 'openrouterKey' | 'nanogptKey' | 'mistralKey'
    | 'cohereAPIKey' | 'ollamaApiKey' | 'novellistAPI' | 'mancerHeader'
    | 'novelai.token' | 'hordeConfig.apiKey' | 'google.accessToken'
    | `OaiCompAPIKeys:${string}` | `customModels:${string}`

/** The stored value of a key field: the whole multi-line string, never split or resolved. A slot with no connection reads as empty. */
export async function readKeyField(db: ConnectionHolder, field: ConnectionSlot): Promise<string> {
    const conn = slotConnection(db, field)
    return conn === undefined ? '' : await connectionKey(conn)
}

/** Whether the slot resolves to a connection holding a non-blank key. */
export function slotHasKey(db: ConnectionHolder, field: ConnectionSlot): boolean {
    const conn = slotConnection(db, field)
    return conn !== undefined && connectionHasKey(conn)
}

/** What a request carries by key: the rotation (when it can rotate) and whether this is a preview. */
export type KeyLeaseArg = { previewBody?: boolean, keyRotation?: KeyRotation }

/**
 * The credential of one line of `field` for a request. A preview shows the current line as typed.
 * A real request leases a line through the rotation of its attempt and resolves a reference per line.
 */
export async function leaseRequestKey(arg: KeyLeaseArg, field: KeyFieldId): Promise<string> {
    const value = await readKeyField(getDatabase(), field)
    if (arg.previewBody) {
        return pickLine(undefined, field, value)
    }
    return await resolveSecret(pickLine(arg.keyRotation, field, value))
}

/**
 * The current line of `field`, unresolved, for readers that never rotate: utility runs, model lists,
 * tokenizers and image or speech calls.
 */
export async function currentKey(field: KeyFieldId, db: Database = getDatabase()): Promise<string> {
    return pickLine(undefined, field, await readKeyField(db, field))
}

/** The sync form of `currentKey` for editors and templates, which cannot await; the only raw read outside the async seam. */
export function currentKeyForUi(field: KeyFieldId, db: Database = getDatabase()): string {
    const conn = slotConnection(db, field)
    return pickLine(undefined, field, conn === undefined ? '' : connectionKeyForUi(conn))
}

/**
 * A request argument that carries a leased key between the site that leases it and the send point:
 * `keyField` names the field `key` was leased from, `sentKeyField` the field the request put on the wire.
 */
export type KeySendArg = KeyLeaseArg & { key?: string, keyField?: KeyFieldId, sentKeyField?: KeyFieldId }

/** Leases a line of `field` into `arg.key`. Nothing is sent yet, so nothing is recorded as sent. */
export async function leaseArgKey(arg: KeySendArg, field: KeyFieldId): Promise<string> {
    arg.key = await leaseRequestKey(arg, field)
    arg.keyField = field
    return arg.key
}

/** The credential of `field` for a request that sends it, recording that this field is the one sent. */
export async function sendKeyLine(arg: KeySendArg, field: KeyFieldId): Promise<string> {
    arg.sentKeyField = field
    return await leaseRequestKey(arg, field)
}

/**
 * The credential of the key a caller leased into `arg.key`, recording its field as the one sent.
 * A key the caller supplied has no field, so it never rotates.
 */
export async function sendArgKey(arg: KeySendArg & { previewBody?: boolean }): Promise<string> {
    arg.sentKeyField = arg.keyField
    return await resolveRequestKey(arg, arg.key)
}

/**
 * The field to rotate when a response status is a key limit: the field this request sent, and only
 * when this attempt leased a line of it. Anything else is an ordinary failure.
 */
export function limitedField(arg: KeySendArg, status: number | undefined): KeyFieldId | undefined {
    const field = arg.sentKeyField
    if (field === undefined || !isKeyLimitStatus(status) || !arg.keyRotation?.lease.has(field)) {
        return undefined
    }
    return field
}
