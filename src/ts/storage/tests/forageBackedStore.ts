/**
 * Test-only: a `ByteStore` over the four calls of a storage-object stand-in
 * (`getItem`, `setItem`, `keys`, `removeItem`), for tests whose world is an
 * in-memory model of that object. Every call is forwarded as it is made and
 * every failure propagates unchanged, so a test that models a failing read or a
 * recorded write keeps seeing it. A missing item (`null` or `undefined`) is an
 * absent key; anything else is the stored value.
 *
 * Nothing here says anything about the real stores: it only lets a suite whose
 * subject is not storage put its in-memory model behind the store seam.
 */
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'
import { StoreDeleteManyError, type DeleteReportEntry } from 'src/ts/storage/store/errors'

export interface ForageLike {
    getItem(key: string): Promise<unknown>
    setItem(key: string, value: Uint8Array): Promise<unknown>
    keys(): Promise<string[]>
    removeItem(key: string): Promise<unknown>
}

/**
 * A store that forwards every call to the store `pick` names at the time of the
 * call, for a suite that flips between platform models inside one module graph.
 */
export function createSwitchedStore(pick: () => ByteStore): ByteStore {
    return {
        get capabilities() { return pick().capabilities },
        read: (key) => pick().read(key),
        write: (key, bytes, condition) => pick().write(key, bytes, condition),
        delete: (key, condition) => pick().delete(key, condition),
        deleteMany: (entries) => pick().deleteMany(entries),
        list: (prefix) => pick().list(prefix),
        has: (key) => pick().has(key),
    }
}

/** The store never enforces a condition, so it reports no conditional writes and no versions. */
export function createForageBackedStore(forage: ForageLike): ByteStore {
    return {
        capabilities: { conditionalWrites: false },

        async read(key: string): Promise<ReadResult> {
            const value = await forage.getItem(key)
            if (value === null || value === undefined) {
                return { bytes: null, version: null }
            }
            return { bytes: value as Uint8Array, version: null }
        },

        async write(key: string, bytes: Uint8Array, _condition: StoreCondition): Promise<WriteResult> {
            await forage.setItem(key, bytes)
            return { version: null }
        },

        async delete(key: string, _condition: StoreCondition): Promise<void> {
            await forage.removeItem(key)
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            // Like the real stores: every key is attempted, and a failure is reported per key.
            const report: DeleteReportEntry[] = []
            for (const entry of entries) {
                try {
                    await forage.removeItem(entry.key)
                    report.push({ key: entry.key, outcome: 'removed' })
                } catch (error) {
                    report.push({ key: entry.key, outcome: 'failed', error })
                }
            }
            if (report.some((entry) => entry.outcome !== 'removed')) {
                throw new StoreDeleteManyError(report)
            }
        },

        async list(prefix: string): Promise<string[]> {
            return (await forage.keys()).filter((key) => key.startsWith(prefix))
        },

        async has(key: string): Promise<boolean> {
            const value = await forage.getItem(key)
            return value !== null && value !== undefined
        },
    }
}
