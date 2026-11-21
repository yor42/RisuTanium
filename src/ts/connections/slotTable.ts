import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import { GLOBAL_SLOT_PROVIDERS, str, type ConnectionProvider, type GlobalSlot } from './connections'

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

/** The 13 global rows, in migration walk order. */
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
    {
        kind: 'global',
        slot: 'novelai.token',
        provider: GLOBAL_SLOT_PROVIDERS['novelai.token'],
        rootProp: 'novelai',
        legacyGet: (db) => str(db.novelai?.token),
        legacySet: (target, value) => { target.novelai = { ...target.novelai, token: value } },
        secretEntry: { scope: 'database', field: 'novelai', sub: '.token' },
    },
    {
        kind: 'global',
        slot: 'hordeConfig.apiKey',
        provider: GLOBAL_SLOT_PROVIDERS['hordeConfig.apiKey'],
        rootProp: 'hordeConfig',
        legacyGet: (db) => str(db.hordeConfig?.apiKey),
        legacySet: (target, value) => { target.hordeConfig = { ...target.hordeConfig, apiKey: value } },
        secretEntry: { scope: 'database', field: 'hordeConfig', sub: '.apiKey' },
    },
    {
        kind: 'global',
        slot: 'google.accessToken',
        provider: GLOBAL_SLOT_PROVIDERS['google.accessToken'],
        rootProp: 'google',
        legacyGet: (db) => str(db.google?.accessToken),
        legacySet: (target, value) => { target.google = { ...target.google, accessToken: value } },
        secretEntry: { scope: 'database', field: 'google', sub: '.accessToken' },
    },
    flat('vertexPrivateKey'),
]

/** `oaicomp`, `custom` (key and url) and `reverse_proxy` (root pair and preset pairs). */
export const FAMILY_ROWS: readonly FamilySlotRow[] = [
    { kind: 'oaicomp', secretEntry: { scope: 'database', field: 'OaiCompAPIKeys', sub: '[*]' } },
    { kind: 'custom', secretEntry: { scope: 'database', field: 'customModels', sub: '[].key' } },
    { kind: 'reverse_proxy', secretEntry: { scope: 'database', field: 'proxyKey' } },
]

export const SLOT_TABLE: readonly SlotRow[] = [...GLOBAL_ROWS, ...FAMILY_ROWS]
