import { BlockStoreOwner, createProcessCommitLock, createWebCommitLock, type CommitLock, type LockManagerLike } from './blockStore'
import { createMutexHeadSwap, createNodeHeadSwap, type HeadSwap } from './headSwap'
import { getAppStore, getAppStoreKind, type AppStoreKind } from './store/appStore'
import type { ByteStore } from './store/contract'
import { createIndexedDbHeadSwap } from './store/indexedDbStore'

/**
 * The page's one block-store owner.
 *
 * The owner is the only writer of `blocks/` keys in a page and keeps the
 * record of what the store acknowledged, so a second owner on the same page
 * would be a second record of one store: every site that needs the owner gets
 * it from here, and at most one is built per page load.
 *
 * Which head swap and which commit lock an owner gets depends on the store the
 * page runs on, and the pairing is fixed here, not chosen by callers:
 *
 * - Tauri: the in-process mutex swap and the in-process commit lock. The
 *   desktop app is a single process (the single-instance plugin is registered),
 *   which is the premise of both.
 * - Node server: the revision swap, and the Web Locks commit lock where the
 *   page has Web Locks. The Node store enforces versions on its own writes.
 * - IndexedDB: the swap that is one read-write transaction on the shared
 *   database, and the Web Locks commit lock where the page has Web Locks.
 * - The transitional OPFS page: no owner. That page is read-only for its
 *   session.
 *
 * Like the store selection, the outcome stands for the page, a failure
 * included.
 */

let owner: Promise<BlockStoreOwner | null> | null = null

function pageLocks(): LockManagerLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator.locks as LockManagerLike | undefined)
}

function dependenciesFor(kind: AppStoreKind, store: ByteStore): { headSwap: HeadSwap, commitLock: CommitLock } | null {
    switch (kind) {
        case 'tauri':
            return { headSwap: createMutexHeadSwap(store), commitLock: createProcessCommitLock(store) }
        case 'node':
            return { headSwap: createNodeHeadSwap(store), commitLock: createWebCommitLock(pageLocks()) }
        case 'indexeddb':
            return { headSwap: createIndexedDbHeadSwap(), commitLock: createWebCommitLock(pageLocks()) }
        case 'opfs-transitional':
            return null
    }
}

async function buildOwner(): Promise<BlockStoreOwner | null> {
    const store = await getAppStore()
    const dependencies = dependenciesFor(await getAppStoreKind(), store)
    return dependencies === null ? null : new BlockStoreOwner({ store, ...dependencies })
}

/** The page's block-store owner, or `null` on the transitional OPFS page, which has none. */
export function getPageBlockOwner(): Promise<BlockStoreOwner | null> {
    owner ??= buildOwner()
    return owner
}

/** Test seam: forgets the page's owner so the next call builds one again. */
export function resetPageBlockOwnerForTests(): void {
    owner = null
}
