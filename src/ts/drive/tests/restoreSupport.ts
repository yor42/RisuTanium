/**
 * Test-only support for the suites that drive a restore (`LoadLocalBackup`,
 * `loadInternalBackup`) over an in-memory store: they write the restored
 * profile through the page's one owner, so every test starts from a fresh
 * owner and page mode on the store it injects.
 *
 * Nothing here says anything about a real store.
 */
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { injectAppStore, type AppStoreKind } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'

/** Makes `store` the page's store, of the given kind, with no owner and no page mode carried over from an earlier test. */
export function injectRestoreStore(store: ByteStore, kind: AppStoreKind = 'tauri'): void {
    injectAppStore(store, kind)
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}
