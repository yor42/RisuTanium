import type { Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { SettingsSource } from './rtb/settingsPayload'

/**
 * A per-key view of the live database for a settings export or a restore plan: `get(key)` is a plain snapshot of
 * that one value, and only the requested keys can be read. The whole database is never snapshotted, so a settings
 * file cannot reach a character, a chat or a connection through it, and the cost is the carried values alone.
 */
export function settingsSource(keys: readonly (keyof Database)[]): SettingsSource {
    const allowed: ReadonlySet<keyof Database> = new Set(keys)
    return {
        get<K extends keyof Database>(key: K): Database[K] {
            if (!allowed.has(key)) {
                throw new Error(`the settings source was not asked for ${String(key)}`)
            }
            // The snapshot of one database value is that value as the database types it.
            return $state.snapshot(DBState.db[key]) as Database[K]
        },
    }
}
