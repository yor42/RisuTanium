import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import {
    cloneConnection, isRecord, isWellFormedConnection, ownedConnection, presetProxyConnection, slotConnection,
    storedConnections, str,
} from './connections'
import type { ExportKeyReader } from './keyVaultStore.svelte'
import { GLOBAL_ROWS } from './slotTable'

function pickOwn(source: Record<string, unknown>, props: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const prop of props) {
        if (Object.hasOwn(source, prop)) {
            out[prop] = source[prop]
        }
    }
    return out
}

/**
 * A key-only projection of a database about to be exported: every slot-table legacy position, the
 * connections (each a copy), the working reference and pair, each preset's proxy fields and each
 * custom model's key fields, at the same indices. Nothing in it aliases a live object, so the
 * migration run over it and the writes that follow never reach the live database.
 */
export function keyStateOf(plain: StoredDatabase): StoredDatabase {
    const source = plain as unknown as Record<string, unknown>
    const state: Record<string, unknown> = {}
    for (const row of GLOBAL_ROWS) {
        if (Object.hasOwn(source, row.rootProp)) {
            const value = source[row.rootProp]
            state[row.rootProp] = isRecord(value) ? { ...value } : value
        }
    }
    Object.assign(state, pickOwn(source, ['forceReplaceUrl', 'proxyKey', 'proxyConnectionId']))
    if (Object.hasOwn(source, 'OaiCompAPIKeys')) {
        const keys = source.OaiCompAPIKeys
        state.OaiCompAPIKeys = isRecord(keys) ? { ...keys } : keys
    }
    if (Object.hasOwn(source, 'connections')) {
        const store = source.connections
        state.connections = Array.isArray(store)
            ? store.map((conn: unknown) => isWellFormedConnection(conn) ? cloneConnection(conn) : conn)
            : store
    }
    if (Array.isArray(source.botPresets)) {
        state.botPresets = source.botPresets.map((preset: unknown) =>
            isRecord(preset)
                ? pickOwn(preset, ['proxyKey', 'forceReplaceUrl', 'openAIKey', 'proxyConnectionId'])
                : preset)
    }
    if (Array.isArray(source.customModels)) {
        state.customModels = source.customModels.map((model: unknown) =>
            isRecord(model) ? pickOwn(model, ['id', 'name', 'key', 'url', 'connectionId']) : model)
    }
    return state as unknown as StoredDatabase
}

/**
 * Writes upstream's legacy fields into `plain` from the migrated projection and drops the store and
 * every reference, so a `.bin` is upstream-shaped. Keys are read from the projection's own
 * connection copies through `keys`, a synchronous reader keyed by envelope: the export's writer is
 * already open, so no vault call may happen here. `plain` receives new objects and arrays and no existing nested object is
 * assigned into. Where the projection has no resolvable connection (a skipped or failed store), its
 * legacy value is kept.
 */
export function writeLegacyFromConnections(state: StoredDatabase, plain: StoredDatabase, keys: ExportKeyReader): void {
    for (const row of GLOBAL_ROWS) {
        const conn = slotConnection(state, row.slot)
        const value = conn ? keys.keyOf(conn) : row.legacyGet(state)
        if (value === '' && row.legacyGet(plain) === '') {
            continue
        }
        row.legacySet(plain, value)
    }

    const oaiComp: Record<string, string> = isRecord(plain.OaiCompAPIKeys) ? { ...plain.OaiCompAPIKeys } : {}
    const seen = new Set<string>()
    for (const conn of storedConnections(state)) {
        if (conn.provider.startsWith('oaicomp:') && !seen.has(conn.provider)) {
            seen.add(conn.provider)
            oaiComp[conn.provider.slice('oaicomp:'.length)] = keys.keyOf(conn)
        }
    }
    if (seen.size > 0 || isRecord(plain.OaiCompAPIKeys)) {
        plain.OaiCompAPIKeys = oaiComp
    }

    const rootConn = ownedConnection(state, { slot: 'proxyKey' })
    const rootUrl = rootConn ? rootConn.url ?? '' : str(state.forceReplaceUrl)
    const rootKey = rootConn ? keys.keyOf(rootConn) : str(state.proxyKey)
    if (rootUrl !== '' || str(plain.forceReplaceUrl) !== '') {
        plain.forceReplaceUrl = rootUrl
    }
    if (rootKey !== '' || str(plain.proxyKey) !== '') {
        plain.proxyKey = rootKey
    }

    if (Array.isArray(plain.customModels)) {
        const stateModels: unknown = state.customModels
        const out: StoredDatabase['customModels'] = []
        for (const [index, model] of plain.customModels.entries()) {
            if (!isRecord(model)) {
                out.push(model)
                continue
            }
            const conn = ownedConnection(state, { modelIndex: index })
            const stateModel: unknown = Array.isArray(stateModels) ? stateModels[index] : undefined
            const legacy = isRecord(stateModel) ? stateModel : {}
            const copy = {
                ...model,
                key: conn ? keys.keyOf(conn) : str(legacy.key),
                url: conn ? conn.url ?? '' : str(legacy.url),
            }
            delete copy.connectionId
            out.push(copy)
        }
        plain.customModels = out
    }

    if (Array.isArray(plain.botPresets)) {
        const statePresets: unknown = state.botPresets
        const out: StoredDatabase['botPresets'] = []
        for (const [index, preset] of plain.botPresets.entries()) {
            if (!isRecord(preset)) {
                out.push(preset)
                continue
            }
            const statePreset: unknown = Array.isArray(statePresets) ? statePresets[index] : undefined
            const legacy = isRecord(statePreset) ? statePreset : {}
            const conn = presetProxyConnection(state, legacy)
            const copy = { ...preset }
            // Upstream copies a preset's pair with `?? db.proxyKey`: an absent field keeps the working value on a switch and
            // an empty one wipes it, so a field is written only when it carries a value or the preset already owned it.
            const computed = {
                forceReplaceUrl: conn ? conn.url ?? '' : str(legacy.forceReplaceUrl),
                proxyKey: conn ? keys.keyOf(conn) : str(legacy.proxyKey),
                openAIKey: '',
            }
            for (const field of ['forceReplaceUrl', 'proxyKey', 'openAIKey'] as const) {
                if (computed[field] !== '' || Object.hasOwn(preset, field)) {
                    copy[field] = computed[field]
                }
            }
            delete copy.proxyConnectionId
            out.push(copy)
        }
        plain.botPresets = out
    }

    delete plain.connections
    delete plain.proxyConnectionId
}
