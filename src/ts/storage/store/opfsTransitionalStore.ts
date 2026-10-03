import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreDeleteManyError, StoreInvalidKeyError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, ownBytes } from './guards'
import { indexedDbAddressableViolation, indexedDbCreatableViolation } from './keyRules'
import type { OpfsStorage } from '../opfsStorage'

/**
 * A byte store over an `OpfsStorage`, for a page whose profile's main store is
 * still OPFS because the copy back into IndexedDB at startup could not run
 * (`opfsCopyBack.ts`). Such a profile keeps its main file, numbered backups,
 * snapshots and assets in OPFS, and the copy of those keys that IndexedDB still
 * holds is stale, so nothing here reads or writes IndexedDB. A page gets it only
 * when the copy could not run, with a notice; the next start tries the copy again.
 *
 * OPFS keeps no version, so `conditionalWrites` is false. A file is replaced
 * through a writable stream that commits on close, so a write that fails
 * before it closes leaves the previous file readable. That holds for an
 * existing file only: the file is created before the write starts, so a failed
 * create of a new key can leave a zero-length file, as `OpfsStorage` does.
 *
 * Keys follow the IndexedDB rules: the OPFS file name is the hex of the key, so
 * any non-empty string is addressable.
 */
export function createOpfsTransitionalStore(opfs: OpfsStorage): ByteStore {
    function checkAddressable(key: string): void {
        const reason = indexedDbAddressableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    return {
        capabilities: { conditionalWrites: false },

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            const stored = await opfs.getItem(key)
            if (stored === null || stored === undefined) {
                return { bytes: null, version: null }
            }
            return { bytes: ownBytes(new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength)), version: null }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = indexedDbAddressableViolation(key) ?? indexedDbCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, false)
            checkBytes(bytes)
            await opfs.setItem(key, bytes)
            return { version: null }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, false)
            await opfs.removeItem(key)
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                checkAddressable(entry.key)
                checkCondition(entry.condition, false)
            }
            checkNoDuplicateKeys(entries)
            const report: DeleteReportEntry[] = []
            for (const entry of entries) {
                try {
                    await opfs.removeItem(entry.key)
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
            checkAddressable(prefix)
            return (await opfs.keys()).filter((key) => key.startsWith(prefix))
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return (await opfs.keys()).includes(key)
        },
    }
}
