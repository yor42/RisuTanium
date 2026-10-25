import type { ByteStore } from '../storage/store/contract'
import type { AppStoreKind } from '../storage/store/appStore'
import type { ExportCancelToken } from '../exportCancel'
import { assetOrInlayBodyKeyViolation } from '../storage/store/keyRules'

/**
 * The largest asset an upstream Node server takes in one request (MC-223, MC-532 2). A backup holding
 * anything strictly larger is warned about before the export starts, on every platform, because the file may be
 * restored on an upstream Node server later.
 */
export const UPSTREAM_NODE_ASSET_LIMIT_BYTES = 104857600

export interface SizedKey {
    key: string
    size: number
}

export function isOversizeForUpstream(size: number): boolean {
    return size > UPSTREAM_NODE_ASSET_LIMIT_BYTES
}

/**
 * The size of the value of `key`, or `null` when it cannot be read. The bytes are dropped before this returns. A store
 * that offers `readValue` loads the value once and a Blob answers by its size without being read into memory.
 */
async function storedSizeOf(store: ByteStore, key: string): Promise<number | null> {
    try {
        if (store.readValue !== undefined && assetOrInlayBodyKeyViolation(key) === null) {
            const value = await store.readValue(key)
            if (value === null) {
                return null
            }
            return value instanceof Blob ? value.size : value.length
        }
        const { bytes } = await store.read(key)
        return bytes === null ? null : bytes.length
    } catch (error) {
        console.error(error)
        return null
    }
}

export interface OversizeAssetQuery {
    kind: AppStoreKind
    store: ByteStore
    /** The sized listing of the desktop and Android apps, when it answered. */
    sized: readonly SizedKey[] | null
    /** Only these keys are judged (a partial backup); `null` judges every asset. */
    keys: readonly string[] | null
    /** The keys a full backup holds, which the browser pre-pass reads; unused elsewhere. */
    listedKeys: readonly string[]
    cancel: ExportCancelToken
    onProgress?: (done: number, total: number) => void
}

/**
 * The assets of a backup that are strictly larger than `UPSTREAM_NODE_ASSET_LIMIT_BYTES`, with their sizes, from the
 * cheapest source the page has before any writer opens:
 * - the desktop and Android apps: the sized listing the export already made;
 * - the Node page: one `min-size` listing. A server that cannot answer it (an older fork or an upstream server) cannot
 *   hold such an asset either, so nothing is oversize there;
 * - the browser stores (IndexedDB, transitional OPFS): each asset is read once, one at a time, and only its size is
 *   kept, so at most one asset's bytes are held and each is dropped before the next is read. A key that cannot be read
 *   is not named here; the export reports it as missing when it reaches it.
 * A desktop page whose sized listing failed has no source and names nothing.
 */
export async function findOversizeAssets(query: OversizeAssetQuery): Promise<SizedKey[]> {
    const wanted = query.keys === null ? null : new Set(query.keys)
    const judged = (key: string): boolean => wanted === null ? true : wanted.has(key)
    if (query.kind === 'tauri') {
        return (query.sized ?? []).filter((item) => judged(item.key) && isOversizeForUpstream(item.size)).map((item) => ({ key: item.key, size: item.size }))
    }
    if (query.kind === 'node') {
        const listed = await query.store.listSized?.('assets/', UPSTREAM_NODE_ASSET_LIMIT_BYTES) ?? null
        return (listed ?? []).filter((item) => judged(item.key))
    }
    const candidates = (query.keys ?? query.listedKeys).filter((key) => key.startsWith('assets/'))
    const oversize: SizedKey[] = []
    for (let i = 0; i < candidates.length; i++) {
        query.cancel.throwIfCancelled()
        query.onProgress?.(i + 1, candidates.length)
        const size = await storedSizeOf(query.store, candidates[i])
        if (size !== null && isOversizeForUpstream(size)) {
            oversize.push({ key: candidates[i], size })
        }
    }
    return oversize
}

/** `bytes` as MiB with one decimal, for the prompt that names an item over the upstream limit. */
export function formatMiB(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** How many names the keep-in prompt lists, and how long each may be; the rest is counted ("and N more"). */
export const UPSTREAM_PROMPT_NAMES_SHOWN = 20
export const UPSTREAM_PROMPT_NAME_CHARS = 100

/** The prompt's names: at most `UPSTREAM_PROMPT_NAMES_SHOWN`, each cut to `UPSTREAM_PROMPT_NAME_CHARS` characters. */
export function shownPromptNames(names: readonly string[]): string[] {
    return names.slice(0, UPSTREAM_PROMPT_NAMES_SHOWN).map((name) => name.length > UPSTREAM_PROMPT_NAME_CHARS ? name.slice(0, UPSTREAM_PROMPT_NAME_CHARS) + '...' : name)
}
