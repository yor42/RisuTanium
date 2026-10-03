/**
 * Asset-deletion wiring extracted from bootstrap.ts's `cleanChunks` (Tauri
 * branch :577-589, web/Node branch's `assets/` case :650-656, before the
 * step-1 extraction). CHORE-07 adds a "skip when the
 * keep-set view is incomplete" gate: both sweeps below accept an optional
 * `complete` flag, and skip deleting anything when it is explicitly `false`.
 * `undefined` means no skip.
 *
 * Kept free of any import that reaches `stores.svelte` / `parser.svelte`
 * (in fact, free of any first-party import at all) so it can be unit
 * tested with no mocks: every dependency (listing, removal, basename
 * extraction, logging) is injected by the caller.
 */

/** The subset of `@tauri-apps/plugin-fs`'s `DirEntry` this module needs. */
export interface AssetDirEntry {
    name: string
}

export interface TauriAssetSweepDeps {
    /** The current keep-set: asset basenames that must not be deleted. */
    uncleanable: Set<string>
    /**
     * Whether the keep-set's view of cold-stored characters is complete.
     * Only an explicit `false` skips deletion; `undefined` behaves as
     * before this flag existed.
     */
    complete?: boolean
    /** Lists the assets directory. Injected so tests can fake the fs. */
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
 * Verbatim behaviour of bootstrap.ts's Tauri asset-deletion loop
 * (`cleanChunks` :577-589 before the step-1 extraction): lists `assets/`,
 * and for every entry whose basename is not in `uncleanable`, removes it. A
 * per-entry error is caught and logged, matching the original. A throw
 * from `listAssets` itself (e.g. a failing `readDir`) is deliberately NOT
 * caught here, so it propagates to the caller -- this preserves that a
 * failing `readDir('assets')` still rejects `cleanChunks` before any
 * remote-block cleanup runs.
 *
 * `listAssets()` is always called first, before the `complete` check, so
 * that a throwing `readDir` still rejects exactly as it did before
 * `complete` existed. When `complete === false`, one line is logged
 * explaining why, and nothing is removed.
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
    for (const asset of assets) {
        try {
            const n = deps.getBasename(asset.name)
            if (!deps.uncleanable.has(n)) {
                await deps.removeAsset('assets/' + asset.name)
            }
        } catch (error) {
            logError('error', asset.name)
        }
    }
}

export interface ForageAssetKeySweepDeps {
    /** The current keep-set: asset basenames that must not be deleted. */
    uncleanable: Set<string>
    /**
     * Whether the keep-set's view of cold-stored characters is complete.
     * Only an explicit `false` skips deletion; `undefined` behaves as
     * before this flag existed.
     */
    complete?: boolean
    /** Deletes one forage entry by its full key (e.g. 'assets/x.png'). */
    removeAsset: (key: string) => Promise<void>
    /** Extracts the bare filename from a (possibly path-like) key. */
    getBasename: (name: string) => string
}

/**
 * Verbatim behaviour of the `assets/` branch inside bootstrap.ts's web/Node
 * loop (`cleanChunks` :650-656 before the step-1 extraction): for one
 * forage key already known to start with `assets/`, removes it unless its
 * basename is in `uncleanable`. Deliberately has no try/catch, matching the
 * original (unlike the Tauri sweep above, this branch never wrapped its
 * removal in one).
 *
 * When `complete === false`, returns immediately without removing
 * anything. This function is called once per key, so it does NOT log --
 * the caller (`cleanChunks`) logs the one skip line for the whole sweep,
 * since logging per-key here would print once per forage key instead of
 * once per run.
 *
 * Called per-key from the still-inline web/Node loop in bootstrap.ts, which
 * continues to own the single `forageStorage.keys()` call and the `assets/`
 * key filter -- none of that is touched by this file. The remote-block
 * clean-up is a separate pass in bootstrap.ts that lists through the byte
 * store.
 */
export async function sweepForageAssetKey(key: string, deps: ForageAssetKeySweepDeps): Promise<void> {
    if (deps.complete === false) {
        return
    }
    const n = deps.getBasename(key)
    if (!deps.uncleanable.has(n)) {
        await deps.removeAsset(key)
    }
}
