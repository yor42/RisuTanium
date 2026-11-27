import type { Database } from 'src/ts/storage/database.svelte'
import { SecretRefError } from 'src/ts/secretRef'
import { VaultKeyUnavailableError } from './keyVaultStore.svelte'

/*
 * The one seam for the keys of the non-chat services (speech, image, translation, memory and embedding).
 * Every reader and editor goes through the functions below and never touches a legacy field directly,
 * so the place that backs a slot is decided in this file alone. The value is the whole stored string:
 * it is never split into lines and a `${NAME}` reference is left for the reader to resolve.
 */

/** The service key slots. Each is its own slot, so two features never share a stored value by accident. */
export type ServiceSlot =
    | 'elevenLabKey' | 'huggingfaceKey' | 'fishSpeechKey' | 'NAIApiKey' | 'stabilityKey' | 'falToken'
    | 'openaiCompatImage.key' | 'wavespeedImage.key' | 'deeplOptions.key' | 'deeplXOptions.token'
    | 'supaMemoryKey' | 'voyageApiKey' | 'hypaCustomSettings.key'

type Position = {
    get: (db: Database) => unknown
    set: (db: Database, value: string) => void
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A nested position: the container is kept and only the key changes; a missing container is created with just the key. */
function nested<Root extends 'openaiCompatImage' | 'wavespeedImage' | 'deeplOptions' | 'deeplXOptions' | 'hypaCustomSettings'>(
    root: Root, sub: string,
): Position {
    return {
        get: (db) => {
            const container: unknown = db[root]
            return isObject(container) ? container[sub] : undefined
        },
        set: (db, value) => {
            const container: unknown = db[root]
            if (isObject(container)) {
                container[sub] = value
                return
            }
            Object.assign(db, { [root]: { [sub]: value } })
        },
    }
}

function flat(field: 'elevenLabKey' | 'huggingfaceKey' | 'fishSpeechKey' | 'NAIApiKey' | 'stabilityKey' | 'falToken' | 'supaMemoryKey' | 'voyageApiKey'): Position {
    return {
        get: (db) => db[field],
        set: (db, value) => { db[field] = value },
    }
}

/** The legacy database position of each slot: where an upstream database keeps the key. */
const LEGACY_POSITIONS: Record<ServiceSlot, Position> = {
    elevenLabKey: flat('elevenLabKey'),
    huggingfaceKey: flat('huggingfaceKey'),
    fishSpeechKey: flat('fishSpeechKey'),
    NAIApiKey: flat('NAIApiKey'),
    stabilityKey: flat('stabilityKey'),
    falToken: flat('falToken'),
    'openaiCompatImage.key': nested('openaiCompatImage', 'key'),
    'wavespeedImage.key': nested('wavespeedImage', 'key'),
    'deeplOptions.key': nested('deeplOptions', 'key'),
    'deeplXOptions.token': nested('deeplXOptions', 'token'),
    supaMemoryKey: flat('supaMemoryKey'),
    voyageApiKey: flat('voyageApiKey'),
    'hypaCustomSettings.key': nested('hypaCustomSettings', 'key'),
}

/** Every service slot, in table order. */
export const SERVICE_SLOTS: readonly ServiceSlot[] = Object.keys(LEGACY_POSITIONS) as ServiceSlot[]

/** The value at the slot's legacy database position; anything that is not a string counts as empty. */
export function legacyServiceKey(db: Database, slot: ServiceSlot): string {
    const value = LEGACY_POSITIONS[slot].get(db)
    return typeof value === 'string' ? value : ''
}

/** The stored value of a service key: the whole string, unresolved, never split into lines. The caller passes the database, so this module stays free of the storage layer. */
export async function serviceKey(slot: ServiceSlot, db: Database): Promise<string> {
    return legacyServiceKey(db, slot)
}

/** The sync form of `serviceKey` for templates and initial values, which cannot await. */
export function serviceKeyForUi(slot: ServiceSlot, db: Database): string {
    return legacyServiceKey(db, slot)
}

/** The key text a settings field shows for a slot. */
export function serviceEditorValue(db: Database, slot: ServiceSlot): string {
    return legacyServiceKey(db, slot)
}

/** Stores the key typed for a slot. */
export async function setServiceKey(db: Database, slot: ServiceSlot, value: string): Promise<void> {
    LEGACY_POSITIONS[slot].set(db, value)
}

/**
 * Whether an error from reading or resolving a key must stop the request: a `${NAME}` reference that
 * cannot be resolved, or a wrapped key that cannot be read right now. A caller that catches it reports
 * the failure and sends nothing; it never carries on with an empty key.
 */
export function isKeyReadStop(error: unknown): error is SecretRefError | VaultKeyUnavailableError {
    return error instanceof SecretRefError || error instanceof VaultKeyUnavailableError
}
