import type { AppStoreKind } from './store/appStore'
import type { ByteStore } from './store/contract'
import { NODE_ASSET_LIMIT_BYTES, NODE_BODY_LIMIT_BYTES, WEB_ASSET_LIMIT_BYTES } from './nodeBodyLimit'

/**
 * The page's selected store and its kind, as `appStore.ts` last reported them. `appStore.ts` reports from its selection
 * and its test seam, so the limit below can be read where a caller cannot await. This module imports no store code, so
 * the size rules can be read without loading a store.
 */
let selected: { kind: AppStoreKind, store: ByteStore } | null = null

/** Reported by `appStore.ts` when the page's store is selected or injected; `null` for either clears the selection. */
export function noteSelectedStore(kind: AppStoreKind | null, store: ByteStore | null): void {
    selected = kind !== null && store !== null ? { kind, store } : null
}

/** Whether the page's selected store is the Node server's; `false` before a selection and for a store injected without a kind. */
export function selectedStoreIsNode(): boolean {
    return selected?.kind === 'node'
}

/**
 * The largest asset or inlay body the page's selected store takes, in bytes. It is decided by the store kind
 * `appStore.ts` chose, never by the platform: the desktop and Android store writes and reads in pieces, so it takes
 * the Node server's asset limit; the Node store takes it only while it has recorded that its server takes pieces
 * (it reads the record, it never probes) and otherwise one request, the body limit; the browser stores keep their own
 * limit until they hold large values in pieces. Before a store is selected, and for a store injected without a kind,
 * the smallest limit applies: nothing saves an asset before the selection, and a smaller bound is safe.
 */
export function storeAssetLimitBytes(): number {
    if (selected === null) {
        return NODE_BODY_LIMIT_BYTES
    }
    switch (selected.kind) {
        case 'tauri':
            return NODE_ASSET_LIMIT_BYTES
        case 'node':
            return selected.store.piecesRecorded?.() === true ? NODE_ASSET_LIMIT_BYTES : NODE_BODY_LIMIT_BYTES
        case 'indexeddb':
        case 'opfs-transitional':
            return WEB_ASSET_LIMIT_BYTES
    }
}
