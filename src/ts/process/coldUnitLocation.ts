import { isNodeServer, isTauri } from '../platform'
import { indexedDbCreatableViolation, nodeCreatableViolation, tauriCreatableViolation } from '../storage/store/keyRules'

/**
 * Where a cold-storage unit lives, the one place the per-platform names are
 * decided. A unit is a value in the page's byte store under
 * `coldstorage/<key>`; the desktop keeps the files it has always kept at
 * `coldstorage/<key>.json`, so its store key carries the suffix. On the Node
 * server `coldstorage/<key>` is, hex-encoded, the file name the server already
 * uses.
 */

export const COLD_UNIT_STORE_PREFIX = 'coldstorage/'

const TAURI_SUFFIX = '.json'

/** The byte-store key of unit `key`. The key must already satisfy `isSafeColdStorageKey`. */
export function coldUnitStoreKey(key: string): string {
    return isTauri ? COLD_UNIT_STORE_PREFIX + key + TAURI_SUFFIX : COLD_UNIT_STORE_PREFIX + key
}

/**
 * Why the page's store would refuse to hold unit `key`, or `null` when it would
 * not. The store's rules are stricter than `isSafeColdStorageKey` (a name may
 * not start with `.` there, for one), so a key the cold-key rule accepts can
 * still be one no store can hold. Such a key is a damaged reference, not an
 * absent unit.
 */
export function coldUnitStoreRefusal(key: string): string | null {
    const storeKey = coldUnitStoreKey(key)
    if (isTauri) {
        return tauriCreatableViolation(storeKey)
    }
    return isNodeServer ? nodeCreatableViolation(storeKey) : indexedDbCreatableViolation(storeKey)
}

/**
 * The unit key a listed byte-store key stands for, or `null` when it is not a
 * unit directly under `coldstorage/` (a nested entry, or on the desktop a name
 * without the `.json` suffix). The result is not checked against
 * `isSafeColdStorageKey`.
 */
export function coldUnitKeyOfStoreKey(storeKey: string): string | null {
    if (!storeKey.startsWith(COLD_UNIT_STORE_PREFIX)) {
        return null
    }
    let name = storeKey.slice(COLD_UNIT_STORE_PREFIX.length)
    if (isTauri) {
        if (!name.endsWith(TAURI_SUFFIX)) {
            return null
        }
        name = name.slice(0, -TAURI_SUFFIX.length)
    }
    return name.includes('/') ? null : name
}
