import { crc32 } from '../../blockFrame'

/**
 * Plugin storage: every key is its own unit (type 14), listed in one of a fixed
 * number of bucket units (type 19) chosen by a stable hash of the key, so a
 * write to one key rewrites one value unit, one bucket and the manifest.
 */

/** Writer parameter, not format: the manifest carries its own `pluginStorage.buckets`. */
export const PLUGIN_STORAGE_BUCKETS = 16

/** Bucket of a plugin-storage key: `crc32(utf8(key)) mod buckets`. */
export function bucketOfKey(key: string, buckets: number = PLUGIN_STORAGE_BUCKETS): number {
    return crc32(new TextEncoder().encode(key)) % buckets
}

/** The keys grouped by bucket, each group sorted by key; an empty bucket is an empty group. */
export function groupKeysIntoBuckets(keys: readonly string[], buckets: number = PLUGIN_STORAGE_BUCKETS): string[][] {
    const groups: string[][] = Array.from({ length: buckets }, () => [])
    for (const key of keys) {
        groups[bucketOfKey(key, buckets)].push(key)
    }
    for (const group of groups) {
        group.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    }
    return groups
}
