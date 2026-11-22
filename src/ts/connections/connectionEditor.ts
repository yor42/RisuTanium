import { SvelteSet } from 'svelte/reactivity'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    isMalformedStore, isRecord, nextConnectionId, ownedConnection, storedConnections, str,
    type Connection, type ConnectionProvider,
} from './connections'
import { setConnectionKey } from './keyAccess'
import { catalogEntry } from './providerCatalog'
import { appendConnection } from './slotEditor'

/*
 * The writers behind the Connections page. Each refuses a malformed store, replaces the connections
 * array instead of editing it in place, and re-finds the stored element before writing to it. A key
 * is written only through the async `setConnectionKey` seam; a rejected write changes nothing else.
 * No function here puts a key into a return value, an error or a closure.
 */

const NAME_LIMIT = 60

/** Connections restored by undo that hold no key yet. In memory only, never persisted. */
export const needsKey = new SvelteSet<string>()

/** The part of a connection an undo may carry: never the key, never an unknown field. */
export type ConnectionSnapshot = { id: string, name: string, provider: ConnectionProvider, url?: string }

export type RemovedConnection = {
    snapshot: ConnectionSnapshot
    index: number
    refs: { presetIds: string[], working: boolean, modelIds: string[] }
}

export type AddConnectionInput = { provider: ConnectionProvider, name: string, key: string, url?: string }
export type AddResult =
    | { ok: true, id: string }
    | { ok: false, reason: 'taken' | 'blank' | 'malformed' | 'name' | 'keyWrite' }

export type KeyChangeResult =
    | { ok: true }
    | { ok: false, reason: 'malformed' | 'blank' | 'unknown' | 'keyWrite' }

export type KeyEffect = 'nanogpt' | 'vertex'

function cleanName(name: string): string {
    return name.trim().slice(0, NAME_LIMIT).trim()
}

function storedById(db: Database, id: string): Connection | undefined {
    return storedConnections(db).find((conn) => conn.id === id)
}

function snapshotOf(conn: Connection): ConnectionSnapshot {
    const snapshot: ConnectionSnapshot = { id: conn.id, name: conn.name, provider: conn.provider }
    if (typeof conn.url === 'string') {
        snapshot.url = conn.url
    }
    return snapshot
}

/** The side effects that follow an emptied key of this provider, for the confirm dialog. */
export function keyEffectsOf(provider: ConnectionProvider): KeyEffect[] {
    if (provider === 'nanogpt') {
        return ['nanogpt']
    }
    return provider === 'vertex' ? ['vertex'] : []
}

/** NanoGPT choices depend on its key, and a Vertex token belongs to its key; both reset with it. */
function applyKeyEffects(db: Database, provider: ConnectionProvider, plain: string): void {
    if (provider === 'nanogpt' && plain === '') {
        db.nanogptUseSubscriptionEndpoint = false
        db.nanogptSubscriptionState = ''
        db.nanogptRequestModel = ''
        db.nanogptRequestModelName = ''
        db.nanogptProvider = ''
    }
    if (provider === 'vertex') {
        db.vertexAccessToken = ''
        db.vertexAccessTokenExpires = 0
    }
}

async function writeKey(conn: Connection, plain: string): Promise<boolean> {
    try {
        await setConnectionKey(conn, plain)
        return true
    } catch {
        return false
    }
}

/**
 * Adds a connection with the typed name kept as typed. The element is stored before its key is
 * awaited; a rejected write removes it again, so no keyless connection and no reference remain.
 */
export async function addConnection(db: Database, input: AddConnectionInput): Promise<AddResult> {
    if (isMalformedStore(db)) {
        return { ok: false, reason: 'malformed' }
    }
    const name = cleanName(input.name)
    if (name === '') {
        return { ok: false, reason: 'name' }
    }
    const entry = catalogEntry(input.provider)
    if (entry === undefined || (entry.provider !== 'reverse_proxy'
        && storedConnections(db).some((conn) => conn.provider === input.provider))) {
        return { ok: false, reason: 'taken' }
    }
    const url = entry.takesUrl ? (input.url ?? '').trim() : undefined
    if (input.key.trim() === '' && (url === undefined || url === '')) {
        return { ok: false, reason: 'blank' }
    }
    const hadProxy = ownedConnection(db, { slot: 'proxyKey' }) !== undefined
    const record: Connection = { id: nextConnectionId(storedConnections(db)), name, provider: input.provider, key: '' }
    if (url !== undefined) {
        record.url = url
    }
    const stored = appendConnection(db, record)
    const id = stored.id
    if (!await writeKey(storedById(db, id) ?? stored, input.key)) {
        db.connections = storedConnections(db).filter((conn) => conn.id !== id)
        return { ok: false, reason: 'keyWrite' }
    }
    needsKey.delete(id)
    if (input.provider === 'reverse_proxy' && !hadProxy) {
        db.proxyConnectionId = id
    }
    return { ok: true, id }
}

/** Makes a stored reverse proxy the working proxy of the current settings. */
export function useProxyForCurrent(db: Database, id: string): boolean {
    if (isMalformedStore(db)) {
        return false
    }
    const conn = storedById(db, id)
    if (conn === undefined || conn.provider !== 'reverse_proxy') {
        return false
    }
    db.proxyConnectionId = id
    return true
}

export function renameConnection(db: Database, id: string, name: string): { ok: boolean, duplicate: boolean } {
    const next = cleanName(name)
    if (isMalformedStore(db) || next === '') {
        return { ok: false, duplicate: false }
    }
    const conn = storedById(db, id)
    if (conn === undefined) {
        return { ok: false, duplicate: false }
    }
    const duplicate = storedConnections(db).some((item) => item.id !== id && item.name === next)
    conn.name = next
    return { ok: true, duplicate }
}

async function changeKey(db: Database, id: string, plain: string): Promise<KeyChangeResult> {
    const conn = storedById(db, id)
    if (conn === undefined) {
        return { ok: false, reason: 'unknown' }
    }
    if (!await writeKey(conn, plain)) {
        return { ok: false, reason: 'keyWrite' }
    }
    applyKeyEffects(db, conn.provider, plain)
    needsKey.delete(id)
    return { ok: true }
}

/** Replaces the key; a blank value is refused, because removing is `clearKey`. */
export async function replaceKey(db: Database, id: string, plain: string): Promise<KeyChangeResult> {
    if (isMalformedStore(db)) {
        return { ok: false, reason: 'malformed' }
    }
    if (plain.trim() === '') {
        return { ok: false, reason: 'blank' }
    }
    return changeKey(db, id, plain)
}

export async function clearKey(db: Database, id: string): Promise<KeyChangeResult> {
    if (isMalformedStore(db)) {
        return { ok: false, reason: 'malformed' }
    }
    return changeKey(db, id, '')
}

/**
 * Removes a connection and blanks every reference to it (`''` reads as none everywhere). The
 * returned snapshot is rebuilt field by field, so a key or an unknown field never travels with it.
 * The sync body writes no key.
 */
export function deleteConnection(db: Database, id: string): RemovedConnection | null {
    if (isMalformedStore(db)) {
        return null
    }
    const conns = storedConnections(db)
    const index = conns.findIndex((conn) => conn.id === id)
    if (index < 0) {
        return null
    }
    const conn = conns[index]
    const snapshot = snapshotOf(conn)
    const refs: RemovedConnection['refs'] = { presetIds: [], working: false, modelIds: [] }
    db.connections = conns.filter((item) => item.id !== id)
    if (db.proxyConnectionId === id) {
        db.proxyConnectionId = ''
        refs.working = true
    }
    for (const preset of Array.isArray(db.botPresets) ? db.botPresets : []) {
        if (isRecord(preset) && preset.proxyConnectionId === id) {
            preset.proxyConnectionId = ''
            const presetId = str(preset.id)
            if (presetId !== '') {
                refs.presetIds.push(presetId)
            }
        }
    }
    for (const model of Array.isArray(db.customModels) ? db.customModels : []) {
        if (isRecord(model) && model.connectionId === id) {
            model.connectionId = ''
            const modelId = str(model.id)
            if (modelId !== '') {
                refs.modelIds.push(modelId)
            }
        }
    }
    // A reused id must not inherit the "enter the key again" state of an earlier connection.
    needsKey.delete(id)
    applyKeyEffects(db, snapshot.provider, '')
    return { snapshot, index, refs }
}

export type RestoreOutcome = 'restored' | 'taken' | 'provider' | 'malformed'

/**
 * Reinserts a deleted connection with an empty key, judged against the live store: refused when its
 * id is taken or another connection of a one-per-provider provider exists. A reference returns only
 * where it still reads `''`, so a choice made after the delete wins; gone presets and models are skipped.
 */
export function restoreConnection(db: Database, removed: RemovedConnection): RestoreOutcome {
    if (isMalformedStore(db)) {
        return 'malformed'
    }
    const { snapshot, index, refs } = removed
    const conns = storedConnections(db)
    if (conns.some((conn) => conn.id === snapshot.id)) {
        return 'taken'
    }
    const single = snapshot.provider !== 'reverse_proxy' && snapshot.provider !== 'custom'
    if (single && conns.some((conn) => conn.provider === snapshot.provider)) {
        return 'provider'
    }
    const record: Connection = { id: snapshot.id, name: snapshot.name, provider: snapshot.provider, key: '' }
    if (snapshot.url !== undefined) {
        record.url = snapshot.url
    }
    const next = [...conns]
    next.splice(Math.min(index, next.length), 0, record)
    db.connections = next
    if (refs.working && db.proxyConnectionId === '') {
        db.proxyConnectionId = snapshot.id
    }
    for (const preset of Array.isArray(db.botPresets) ? db.botPresets : []) {
        if (isRecord(preset) && refs.presetIds.includes(str(preset.id)) && preset.proxyConnectionId === '') {
            preset.proxyConnectionId = snapshot.id
        }
    }
    for (const model of Array.isArray(db.customModels) ? db.customModels : []) {
        if (isRecord(model) && refs.modelIds.includes(str(model.id)) && model.connectionId === '') {
            model.connectionId = snapshot.id
        }
    }
    needsKey.add(snapshot.id)
    return 'restored'
}
