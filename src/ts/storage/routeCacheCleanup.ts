import { isNodeServer } from "../platform"
import { nodeAssetRouteViolation } from "./store/keyRules"

const SW_IMAGE_PATH_PREFIX = '/sw/img/'

/** The `localStorage` key that records the clean-up of route-served cache entries. */
export const ROUTE_CACHE_CLEANUP_FLAG = 'risu-route-cache-cleaned'

/** The part of `localStorage` the one-time clean-up uses. */
export interface CleanupFlags {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

/** The key a `/sw/img/<hex>` cache path stands for, or null when the path is no such entry. */
function swImageKeyOf(pathname: string): string | null {
    if (!pathname.startsWith(SW_IMAGE_PATH_PREFIX)) {
        return null
    }
    const hex = pathname.slice(SW_IMAGE_PATH_PREFIX.length)
    if (hex === '' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        return null
    }
    return Buffer.from(hex, 'hex').toString('utf-8')
}

/**
 * On a Node-hosted page, deletes the service-worker cache's `/sw/img/` entries
 * for keys the asset route serves, whose copies a page does not display from.
 * Entries for any other key (a location outside `assets/`, a key the route
 * refuses, which the worker still serves) and every other cache path (such as
 * `/sw/share/`) stay. Answers how many were deleted; 0 on any other page.
 */
export async function removeRouteServedCacheEntries(): Promise<number> {
    if (!isNodeServer || typeof caches === 'undefined') {
        return 0
    }
    const cache = await caches.open('risuCache')
    let removed = 0
    for (const request of await cache.keys()) {
        const key = swImageKeyOf(new URL(request.url).pathname)
        if (key !== null && nodeAssetRouteViolation(key) === null && await cache.delete(request)) {
            removed++
        }
    }
    return removed
}

/**
 * Runs `removeRouteServedCacheEntries` once per profile on a Node-hosted page,
 * and records that it finished. A failure is logged and leaves the record
 * unset, so the next start tries again. Never rejects.
 */
export async function cleanRouteServedCacheOnce(flags: CleanupFlags | null): Promise<number> {
    try {
        if (!isNodeServer || typeof caches === 'undefined' || flags?.getItem(ROUTE_CACHE_CLEANUP_FLAG) === '1') {
            return 0
        }
        const removed = await removeRouteServedCacheEntries()
        flags?.setItem(ROUTE_CACHE_CLEANUP_FLAG, '1')
        return removed
    } catch (error) {
        console.error('The clean-up of route-served cache entries failed:', error)
        return 0
    }
}
