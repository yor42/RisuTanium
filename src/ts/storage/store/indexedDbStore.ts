import localforage from 'localforage'
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreNotBinaryError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, ownBytes } from './guards'
import { indexedDbAddressableViolation, indexedDbCreatableViolation } from './keyRules'

/**
 * The byte store on the browser's IndexedDB, in the database upstream already
 * uses: LocalForage database `risuai`, object store `keyvaluepairs`, each value
 * a plain `Uint8Array` under its key. No object store is added and no database
 * version is forced, so data upstream wrote is read where it lies and data this
 * store writes is read by upstream's own LocalForage code.
 *
 * The driver is pinned to IndexedDB: where IndexedDB is missing every
 * operation rejects, instead of LocalForage silently falling back to WebSQL or
 * localStorage. The LocalForage instance is created on first use, so loading
 * this module opens nothing.
 *
 * An entry is absent, holds bytes (possibly none), or holds something that is
 * not bytes: the shared store also holds flags such as `migrated`. `read`
 * rejects with `StoreNotBinaryError` for the last; `has` and `list` report it
 * like any other entry, and `list` never loads a value.
 *
 * The browser store keeps no version, so `conditionalWrites` is false.
 */

const DATABASE_NAME = 'risuai'

/** The bytes of a stored value, or `null` when it is not binary data. Checks by tag so a value from another realm is still recognised. */
async function bytesOfStoredValue(value: unknown): Promise<Uint8Array | null> {
    if (value instanceof Uint8Array) {
        return ownBytes(value)
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    }
    const tag = Object.prototype.toString.call(value)
    if (tag === '[object ArrayBuffer]') {
        return new Uint8Array(new Uint8Array(value as ArrayBuffer))
    }
    if (tag === '[object Blob]') {
        return new Uint8Array(await (value as Blob).arrayBuffer())
    }
    return null
}

export function createIndexedDbStore(): ByteStore {
    let instance: LocalForage | undefined

    function forage(): LocalForage {
        instance ??= localforage.createInstance({ name: DATABASE_NAME, driver: localforage.INDEXEDDB })
        return instance
    }

    function checkAddressable(key: string): void {
        const reason = indexedDbAddressableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    async function removeKey(key: string): Promise<void> {
        await forage().removeItem(key)
    }

    return {
        capabilities: { conditionalWrites: false },

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            const store = forage()
            let value = await store.getItem<unknown>(key)
            if (value === null) {
                // `getItem` answers null both for an absent key and for an entry
                // stored as null or undefined, so absence is settled by the key
                // list, which loads no values. Another tab may write the key in
                // between, hence one more read before the entry is called
                // non-binary.
                if (!(await store.keys()).includes(key)) {
                    return { bytes: null, version: null }
                }
                value = await store.getItem<unknown>(key)
            }
            const bytes = value === null ? null : await bytesOfStoredValue(value)
            if (bytes === null) {
                throw new StoreNotBinaryError(key)
            }
            return { bytes, version: null }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = indexedDbAddressableViolation(key) ?? indexedDbCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, false)
            checkBytes(bytes)
            // Structured clone stores a view with the whole buffer behind it, so
            // the value handed over owns exactly its bytes.
            await forage().setItem(key, ownBytes(bytes))
            return { version: null }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, false)
            await removeKey(key)
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
                    await removeKey(entry.key)
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
            return (await forage().keys()).filter((key) => key.startsWith(prefix))
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return (await forage().keys()).includes(key)
        },
    }
}
