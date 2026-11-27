import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import { GLOBAL_SLOT_PROVIDERS, isRecord, str, type ConnectionProvider, type GlobalSlot } from './connections'

/** The SECRET_FIELDS entry that covers a slot's stored key, matched on scope, field and sub. */
export type SecretEntryRef = { scope: 'database', field: keyof StoredDatabase, sub?: string }

/** A global provider slot: one legacy database position, absorbed into the provider's connection. */
export type GlobalSlotRow = {
    kind: 'global'
    slot: GlobalSlot
    provider: ConnectionProvider
    /** The root property the legacy value lives under; a nested slot replaces this whole container. */
    rootProp: keyof StoredDatabase
    legacyGet(db: StoredDatabase): string
    /** A nested slot builds a new container and never assigns into the existing one. */
    legacySet(target: StoredDatabase, value: string): void
    secretEntry: SecretEntryRef
}

/** A slot family that is not one legacy position: handled by the migration and translation directly. */
export type FamilySlotRow = {
    kind: 'oaicomp' | 'custom' | 'reverse_proxy'
    secretEntry: SecretEntryRef
}

export type SlotRow = GlobalSlotRow | FamilySlotRow

function flat(slot: GlobalSlot & keyof StoredDatabase): GlobalSlotRow {
    return {
        kind: 'global',
        slot,
        provider: GLOBAL_SLOT_PROVIDERS[slot],
        rootProp: slot,
        legacyGet: (db) => str(db[slot]),
        legacySet: (target, value) => { target[slot] = value },
        secretEntry: { scope: 'database', field: slot },
    }
}

/**
 * A slot stored under a nested container. The write builds a new container: a record keeps its
 * other fields, and anything else (missing, a string, an array) becomes `{ [sub]: value }`, so a
 * non-record is never spread into the result and the live container is never assigned into.
 */
function nestedRow(slot: GlobalSlot, rootProp: keyof StoredDatabase, sub: string): GlobalSlotRow {
    return {
        kind: 'global',
        slot,
        provider: GLOBAL_SLOT_PROVIDERS[slot],
        rootProp,
        legacyGet: (db) => {
            const container: unknown = db[rootProp]
            return isRecord(container) ? str(container[sub]) : ''
        },
        legacySet: (target, value) => {
            const container: unknown = target[rootProp]
            Object.assign(target, { [rootProp]: isRecord(container) ? { ...container, [sub]: value } : { [sub]: value } })
        },
        secretEntry: { scope: 'database', field: rootProp, sub: `.${sub}` },
    }
}

/**
 * The global rows, in migration walk order. The service rows come after `vertexPrivateKey` and are
 * never inserted earlier: the walk order fixes the ids a fresh import gets.
 */
export const GLOBAL_ROWS: readonly GlobalSlotRow[] = [
    flat('openAIKey'),
    flat('claudeAPIKey'),
    flat('openrouterKey'),
    flat('nanogptKey'),
    flat('mistralKey'),
    flat('cohereAPIKey'),
    flat('ollamaApiKey'),
    flat('novellistAPI'),
    flat('mancerHeader'),
    nestedRow('novelai.token', 'novelai', 'token'),
    nestedRow('hordeConfig.apiKey', 'hordeConfig', 'apiKey'),
    nestedRow('google.accessToken', 'google', 'accessToken'),
    flat('vertexPrivateKey'),
    flat('elevenLabKey'),
    flat('huggingfaceKey'),
    flat('fishSpeechKey'),
    flat('NAIApiKey'),
    flat('stabilityKey'),
    flat('falToken'),
    nestedRow('openaiCompatImage.key', 'openaiCompatImage', 'key'),
    nestedRow('wavespeedImage.key', 'wavespeedImage', 'key'),
    nestedRow('deeplOptions.key', 'deeplOptions', 'key'),
    nestedRow('deeplXOptions.token', 'deeplXOptions', 'token'),
    flat('supaMemoryKey'),
    flat('voyageApiKey'),
    nestedRow('hypaCustomSettings.key', 'hypaCustomSettings', 'key'),
]
/** `oaicomp`, `custom` (key and url) and `reverse_proxy` (root pair and preset pairs). */
export const FAMILY_ROWS: readonly FamilySlotRow[] = [
    { kind: 'oaicomp', secretEntry: { scope: 'database', field: 'OaiCompAPIKeys', sub: '[*]' } },
    { kind: 'custom', secretEntry: { scope: 'database', field: 'customModels', sub: '[].key' } },
    { kind: 'reverse_proxy', secretEntry: { scope: 'database', field: 'proxyKey' } },
]

export const SLOT_TABLE: readonly SlotRow[] = [...GLOBAL_ROWS, ...FAMILY_ROWS]
