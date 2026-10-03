/**
 * Asset-deletion wiring extracted from bootstrap.ts's `cleanChunks`. CHORE-07
 * adds a "skip when the keep-set view is incomplete" gate: both sweeps below
 * accept an optional `complete` flag, and skip deleting anything when it is
 * explicitly `false`. `undefined` means no skip.
 *
 * Kept free of any import that reaches `stores.svelte` / `parser.svelte`
 * (in fact, free of any first-party import at all) so it can be unit
 * tested with no mocks: every dependency (listing, removal, basename
 * extraction, logging, the page's own writes, the live references) is
 * injected by the caller.
 *
 * A key is deleted only when it is in none of three sets: the keep-set built
 * before the listing (`uncleanable`), the keys this page load wrote
 * (`writtenThisPage`, asked at each delete), and the references live memory
 * holds now (`liveUncleanable`, asked once per batch of up to
 * `ASSET_SWEEP_BATCH_SIZE` candidates, a candidate being a key the keep-set
 * does not protect). The listing
 * and the keep-set are older than a save made while the sweep runs, so the
 * last two are what keep a just-saved asset that the database does not
 * reference yet.
 */

/** The subset of `@tauri-apps/plugin-fs`'s `DirEntry` this module needs. */
export interface AssetDirEntry {
    name: string
}

/** How many deletion candidates (keys the keep-set does not protect) share one `liveUncleanable` answer. */
export const ASSET_SWEEP_BATCH_SIZE = 100

/** The guards beyond the keep-set; each is optional so a caller can supply any subset. */
export interface AssetSweepGuards {
    /** Whether the page load wrote `key` (`assets/<name>`); asked at each delete, never against a snapshot. */
    writtenThisPage?: (key: string) => boolean
    /** The basenames live memory refers to now. The sweep asks it once per batch of `ASSET_SWEEP_BATCH_SIZE` candidates. */
    liveUncleanable?: () => ReadonlySet<string>
}

export interface TauriAssetSweepDeps extends AssetSweepGuards {
    /**
     * Every key the page load wrote. When given it replaces `writtenThisPage`,
     * so the comparison is case-insensitive like every other one in the Tauri
     * sweep; asked at each delete.
     */
    writtenKeysThisPage?: () => Iterable<string>
    /** The current keep-set: asset basenames that must not be deleted. */
    uncleanable: Set<string>
    /**
     * Whether the keep-set's view of cold-stored characters is complete.
     * Only an explicit `false` skips deletion; `undefined` means no skip.
     */
    complete?: boolean
    /**
     * Lists the asset keys without their `assets/` prefix. A name that holds a
     * `/` is a nested key and is never a candidate.
     */
    listAssets: () => Promise<AssetDirEntry[]>
    /** Deletes one asset, given its full relative path (e.g. 'assets/x.png'). */
    removeAsset: (relativePath: string) => Promise<void>
    /** Extracts the bare filename from a (possibly path-like) entry name. */
    getBasename: (name: string) => string
    /** Injected so tests can observe the exact log calls; defaults to console.log. */
    log?: (...args: unknown[]) => void
    logError?: (...args: unknown[]) => void
}

/**
 * Lists the asset keys and, for every top-level entry whose basename is in no
 * guard set, removes it. The desktop file systems compare names without regard
 * to case (Windows, and macOS by default), so a file whose name differs from a
 * reference only in case is the referenced file: the keep-set, the live
 * references and (through `writtenKeysThisPage`) the page's own writes are all
 * compared lowercased on both sides. A per-entry error is caught and logged. A throw from `listAssets`
 * itself is deliberately NOT caught here, so it propagates to the caller and
 * rejects `cleanChunks` before any remote-block cleanup runs.
 *
 * `listAssets()` is always called first, before the `complete` check, so
 * that a throwing listing still rejects. When `complete === false`, one line is
 * logged explaining why, and nothing is removed.
 */
export async function sweepTauriAssets(deps: TauriAssetSweepDeps): Promise<void> {
    const log = deps.log ?? console.log
    const logError = deps.logError ?? console.log
    const assets = await deps.listAssets()
    log(assets)
    if (deps.complete === false) {
        log('cleanChunks: cold-storage read was incomplete, skipping the Tauri asset sweep this run')
        return
    }
    const kept = new Set(Array.from(deps.uncleanable, (name) => name.toLowerCase()))
    const candidates = assets.filter((asset) => !asset.name.includes('/') && !kept.has(deps.getBasename(asset.name).toLowerCase()))
    // Asked at each delete: the page's own writes can grow while the sweep runs.
    const writtenThisPage = (key: string): boolean => {
        if (deps.writtenKeysThisPage) {
            const lower = key.toLowerCase()
            return Array.from(deps.writtenKeysThisPage()).some((written) => written.toLowerCase() === lower)
        }
        return deps.writtenThisPage?.(key) ?? false
    }
    for (let start = 0; start < candidates.length; start += ASSET_SWEEP_BATCH_SIZE) {
        const live = new Set(Array.from(deps.liveUncleanable?.() ?? [], (name) => name.toLowerCase()))
        for (const asset of candidates.slice(start, start + ASSET_SWEEP_BATCH_SIZE)) {
            try {
                if (writtenThisPage('assets/' + asset.name) || live.has(deps.getBasename(asset.name).toLowerCase())) {
                    continue
                }
                await deps.removeAsset('assets/' + asset.name)
            } catch (error) {
                logError('error', asset.name)
            }
        }
    }
}

export interface ForageAssetKeySweepDeps extends AssetSweepGuards {
    /** The current keep-set: asset basenames that must not be deleted. */
    uncleanable: Set<string>
    /**
     * Whether the keep-set's view of cold-stored characters is complete.
     * Only an explicit `false` skips deletion; `undefined` means no skip.
     */
    complete?: boolean
    /** Deletes one forage entry by its full key (e.g. 'assets/x.png'). */
    removeAsset: (key: string) => Promise<void>
    /** Extracts the bare filename from a (possibly path-like) key. */
    getBasename: (name: string) => string
}

/**
 * For one key already known to start with `assets/`, removes it unless its
 * basename is in a guard set. Names are compared exactly: the web and Node
 * stores keep names apart that differ in case. Deliberately has no try/catch
 * (unlike the Tauri sweep above, this branch never wrapped its removal in one).
 *
 * When `complete === false`, returns immediately without removing
 * anything. This function is called once per key, so it does NOT log --
 * the caller (`cleanChunks`) logs the one skip line for the whole sweep,
 * since logging per-key here would print once per key instead of once per run.
 * `liveUncleanable` is asked on every call, so a caller that sweeps in batches
 * hands each batch a function that answers the same set for all its keys.
 *
 * Called per key from the web/Node loop in bootstrap.ts, which owns the single
 * listing of `assets/`. The remote-block clean-up is a separate pass in
 * bootstrap.ts.
 */
export async function sweepForageAssetKey(key: string, deps: ForageAssetKeySweepDeps): Promise<void> {
    if (deps.complete === false) {
        return
    }
    const n = deps.getBasename(key)
    if (deps.uncleanable.has(n) || deps.writtenThisPage?.(key) || deps.liveUncleanable?.().has(n)) {
        return
    }
    await deps.removeAsset(key)
}
