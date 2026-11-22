import type { Database } from 'src/ts/storage/database.svelte'
import { customModelName, isRecord, storedConnections, str, type Connection } from './connections'

export type ConnectionUser = { id: string, name: string }

/**
 * Who relies on a connection. Only a proxy (presets and the working reference) and a custom
 * connection (models) are countable; a global provider is `provider`, or `shadowed` when an earlier
 * connection of the same provider is the one requests use.
 */
export type ConnectionUsers =
    | { kind: 'presets', presets: ConnectionUser[], working: boolean }
    | { kind: 'models', models: ConnectionUser[] }
    | { kind: 'shadowed' }
    | { kind: 'provider' }

export function connectionUsers(db: Database, conn: Connection): ConnectionUsers {
    if (conn.provider === 'reverse_proxy') {
        const presets: ConnectionUser[] = []
        for (const preset of Array.isArray(db.botPresets) ? db.botPresets : []) {
            if (isRecord(preset) && preset.proxyConnectionId === conn.id) {
                presets.push({ id: str(preset.id), name: str(preset.name) })
            }
        }
        return { kind: 'presets', presets, working: db.proxyConnectionId === conn.id }
    }
    if (conn.provider === 'custom') {
        const models: ConnectionUser[] = []
        for (const model of Array.isArray(db.customModels) ? db.customModels : []) {
            if (isRecord(model) && model.connectionId === conn.id) {
                models.push({ id: str(model.id), name: customModelName(model) })
            }
        }
        return { kind: 'models', models }
    }
    const first = storedConnections(db).find((item) => item.provider === conn.provider)
    return first !== undefined && first.id !== conn.id ? { kind: 'shadowed' } : { kind: 'provider' }
}

/** True for a proxy or custom connection that nothing refers to. */
export function isOrphan(users: ConnectionUsers): boolean {
    if (users.kind === 'presets') {
        return users.presets.length === 0 && !users.working
    }
    if (users.kind === 'models') {
        return users.models.length === 0
    }
    return false
}
