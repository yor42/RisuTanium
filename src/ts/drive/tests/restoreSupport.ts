/**
 * Test-only support for the suites that drive a restore (`LoadLocalBackup`,
 * `loadInternalBackup`) over an in-memory store: they write the restored
 * profile as a block generation through the page's one owner, so every test
 * starts from a fresh owner and page mode on the store it injects, and reads
 * back what the store committed by loading it as boot would.
 *
 * Nothing here says anything about a real store.
 */
import { validateLoadedBlocks } from 'src/ts/storage/blockProfileValidate'
import { HEAD_KEY } from 'src/ts/storage/blockKeys'
import { getPageBlockOwner, resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { injectAppStore, type AppStoreKind } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'

/** Makes `store` the page's store, of the given kind, with no owner and no page mode carried over from an earlier test. */
export function injectRestoreStore(store: ByteStore, kind: AppStoreKind = 'tauri'): void {
    injectAppStore(store, kind)
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}

/** The tree the block store's head names, strictly decoded as boot decodes it; `null` when there is no head or it does not load. */
export async function committedTree(): Promise<Record<string, unknown> | null> {
    const owner = await getPageBlockOwner()
    if (owner === null) {
        throw new Error('the page has no owner')
    }
    const result = await owner.readCommitted({ validate: validateLoadedBlocks })
    return result.kind === 'loaded' ? (result.tree as unknown as Record<string, unknown>) : null
}

/** Whether any key of `keys` is the block store's head. */
export function hasHead(keys: Iterable<string>): boolean {
    for (const key of keys) {
        if (key === HEAD_KEY) {
            return true
        }
    }
    return false
}
