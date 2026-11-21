import type { ByteStore } from '../storage/store/contract'
import type { AppStoreKind } from '../storage/store/appStore'

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

export interface OversizeAssetQuery {
    kind: AppStoreKind
    store: ByteStore
    /** The sized listing of the desktop and Android apps, when it answered. */
    sized: readonly SizedKey[] | null
    /** Only these keys are judged (a partial backup); `null` judges every asset. */
    keys: readonly string[] | null
}

/**
 * The assets of a backup that are strictly larger than `UPSTREAM_NODE_ASSET_LIMIT_BYTES`, with their sizes, from the
 * cheapest source the page has before any writer opens:
 * - the desktop and Android apps: the sized listing the export already made;
 * - the Node page: one `min-size` listing. A server that cannot answer it (an older fork or an upstream server) cannot
 *   hold such an asset either, so nothing is oversize there;
 * A desktop page whose sized listing failed has no source and names nothing.
 */
export async function findOversizeAssets(query: OversizeAssetQuery): Promise<SizedKey[]> {
    const wanted = query.keys === null ? null : new Set(query.keys)
    const judged = (key: string): boolean => wanted === null ? true : wanted.has(key)
    if (query.kind === 'tauri') {
        return (query.sized ?? []).filter((item) => judged(item.key) && isOversizeForUpstream(item.size)).map((item) => ({ key: item.key, size: item.size }))
    }
    const listed = await query.store.listSized?.('assets/', UPSTREAM_NODE_ASSET_LIMIT_BYTES) ?? null
    return (listed ?? []).filter((item) => judged(item.key))
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
