import { hasher } from "../parser/parser.svelte"
import { getBasename } from "../globalApi.svelte"
import { isNodeServer } from "../platform"
import { nodeAssetRouteViolation } from "./store/keyRules"

export type AssetVerifyResult =
    | { status: 'ok' }
    | { status: 'mismatch', expectedHash: string, actualHash: string }
    | { status: 'not-content-addressed' }
    | { status: 'not-cached' }
    | { status: 'unsupported' }

const CONTENT_HASH_BASENAME = /^[0-9a-f]{64}$/i

/**
 * Cheaply checks whether a service-worker-cached asset's bytes still match
 * their own filename — without ever touching the source-of-truth storage
 * backend (IndexedDB/OPFS/Node server), and without needing any new
 * persisted metadata.
 *
 * This works because saveAsset() (src/ts/globalApi.svelte.ts) names every
 * asset it creates after the SHA-256 hash of its own content (`sha256Hex()`,
 * src/ts/assetHash.ts, which hashes without `crypto.subtle` on a non-secure
 * origin such as a plain-HTTP LAN host), with one exception: an explicit
 * custom id. Assets saved piece by piece (`saveAssetFromPieces()`) are named
 * the same way. A custom id that is not 64 hex digits fails the 64-hex check
 * below and reports 'not-content-addressed'. A custom id is judged by its
 * shape alone: a 64-hex custom id is treated as a content hash and reports
 * 'mismatch' unless it is the SHA-256 of the bytes, so a caller must never
 * pass a 64-hex custom id that is not. uuid-named assets still arrive in
 * upstream data (upstream saves them on plain-HTTP hosts) and report
 * 'not-content-addressed'. So for the overwhelming majority of
 * real assets, the filename already IS the expected content hash — no
 * separate freshness marker needs to be stored "alongside" the cache entry,
 * since one is already encoded in its name. Re-hashing just the cached copy
 * and comparing it to that name is enough to catch drift/corruption
 * (Agents/Roadmap.md Phase 1 item 6), without the cost of also fetching a
 * comparison copy from local storage.
 *
 * A key the Node server's asset route serves is shown from the server, not
 * from the cache, so on a Node-hosted page such a key reports 'not-cached'
 * without the cache being read: a leftover copy there is not what a page shows.
 *
 * Read-only: reports a mismatch, does not attempt to repair one. Used both
 * by a small sampled boot-time check (see bootstrap.ts's cleanChunks()) and
 * by the explicit "verify assets" UI action (storageMaintenance.ts's
 * verifyAssetIntegrity()).
 */
export async function verifyAssetCacheEntry(loc: string): Promise<AssetVerifyResult> {
    if (typeof caches === 'undefined') {
        return { status: 'unsupported' }
    }
    if (isNodeServer && nodeAssetRouteViolation(loc) === null) {
        return { status: 'not-cached' }
    }
    const basename = getBasename(loc)
    const dot = basename.lastIndexOf('.')
    const hashPart = dot === -1 ? basename : basename.slice(0, dot)
    if (!CONTENT_HASH_BASENAME.test(hashPart)) {
        return { status: 'not-content-addressed' }
    }
    const encoded = Buffer.from(loc, 'utf-8').toString('hex')
    const cache = await caches.open('risuCache')
    const cached = await cache.match('/sw/img/' + encoded)
    if (!cached) {
        return { status: 'not-cached' }
    }
    const bytes = new Uint8Array(await cached.arrayBuffer())
    const actualHash = await hasher(bytes)
    const expectedHash = hashPart.toLowerCase()
    if (actualHash.toLowerCase() === expectedHash) {
        return { status: 'ok' }
    }
    return { status: 'mismatch', expectedHash, actualHash: actualHash.toLowerCase() }
}

export interface AssetIntegrityScanSummary {
    checked: number
    mismatches: { basename: string, expectedHash: string, actualHash: string }[]
    notCached: number
    notContentAddressed: number
    unsupported: boolean
}

/**
 * Runs verifyAssetCacheEntry() across every given asset basename (e.g. the
 * output of getUncleanablesSync() — every asset currently
 * referenced somewhere in the database) and summarizes the results. This is
 * the full, on-demand counterpart to bootstrap.ts's small boot-time sample —
 * checking everything is the whole point of an explicit "verify" action, so
 * unlike the boot-time sample this intentionally does not cap how much it
 * checks; callers driving a UI should report progress via `onProgress`
 * rather than expect this to be instant for a large asset library.
 */
export async function scanAssetCacheIntegrity(
    basenames: string[],
    onProgress?: (done: number, total: number) => void
): Promise<AssetIntegrityScanSummary> {
    const summary: AssetIntegrityScanSummary = {
        checked: 0,
        mismatches: [],
        notCached: 0,
        notContentAddressed: 0,
        unsupported: false
    }
    if (typeof caches === 'undefined') {
        summary.unsupported = true
        return summary
    }
    for (let i = 0; i < basenames.length; i++) {
        const basename = basenames[i]
        const result = await verifyAssetCacheEntry('assets/' + basename)
        switch (result.status) {
            case 'ok':
                summary.checked++
                break
            case 'mismatch':
                summary.checked++
                summary.mismatches.push({ basename, expectedHash: result.expectedHash, actualHash: result.actualHash })
                break
            case 'not-cached':
                summary.checked++
                summary.notCached++
                break
            case 'not-content-addressed':
                summary.checked++
                summary.notContentAddressed++
                break
            case 'unsupported':
                // Practically unreachable here given the guard above (caches
                // existing at call time won't disappear mid-loop), kept only
                // for switch exhaustiveness over AssetVerifyResult's variants.
                summary.unsupported = true
                break
        }
        onProgress?.(i + 1, basenames.length)
    }
    return summary
}

/**
 * Evicts the given assets' entries from the service-worker's cache only —
 * never touches the source-of-truth storage backend. Safe to call on any
 * asset, but meant for ones scanAssetCacheIntegrity() already found to be
 * corrupted: getFileSrc() (src/ts/globalApi.svelte.ts) already re-registers
 * a fresh copy from local storage automatically on a cache miss, so evicting
 * a known-bad entry is enough for it to self-heal — no separate "rebuild"
 * step needed — but only on a FRESH page load. A tab that already resolved
 * this asset this session has it memoized in its own in-memory `fileCache`
 * (status 'done') and won't re-check `/sw/check/` at all until reloaded, so
 * the caller should tell the user a reload is needed to see the fix.
 */
export async function evictAssetCacheEntries(basenames: string[]): Promise<number> {
    if (typeof caches === 'undefined') {
        return 0
    }
    const cache = await caches.open('risuCache')
    let evicted = 0
    for (const basename of basenames) {
        const encoded = Buffer.from('assets/' + basename, 'utf-8').toString('hex')
        if (await cache.delete('/sw/img/' + encoded)) {
            evicted++
        }
    }
    return evicted
}
