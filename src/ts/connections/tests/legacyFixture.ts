import type { Database } from 'src/ts/storage/database.svelte'
import { migrateConnections } from '../migrate'

/**
 * Runs the connection migration on a mocked database in place, so a test that still builds a
 * legacy-shaped db sees the stored shape the readers expect. Idempotent, and sets no flag.
 */
export function absorbLegacyForTest<T extends object>(db: T): T {
    migrateConnections(db as unknown as Database)
    return db
}
