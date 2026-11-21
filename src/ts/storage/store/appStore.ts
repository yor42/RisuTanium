import localforage from 'localforage'
import { type as osType } from '@tauri-apps/plugin-os'
import { forageStorage } from '../../globalApi.svelte'
import { isNodeServer, isTauri } from '../../platform'
import { NodeStorage } from '../nodeStorage'
import type { ByteStore, ReadResult } from './contract'
import { StoreError } from './errors'
import { createIndexedDbStore } from './indexedDbStore'
import type { FilePlatform } from './keyRules'
import { createNodeHttpStore } from './nodeHttpStore'
import { createTauriFilesStore } from './tauriFilesStore'
import { noteSelectedStore } from '../assetLimit'

/**
 * The one byte store the app's main file, numbered backups, snapshots and
 * cold-storage units go through in a page load, and the one owner of the main
 * file's version.
 *
 * Selection happens once per page load, on first use, after the platform's boot
 * setup (on the web, after `forageStorage.Init()` has run and this page holds
 * its shared tab-presence lock):
 * - Tauri: the desktop files store.
 * - Node server: the Node HTTP store, authenticated through the same auth state
 *   as the `NodeStorage` that `AutoStorage` built.
 * - Web: the IndexedDB store, pinned to the IndexedDB driver. If IndexedDB
 *   cannot be opened the selection fails with `AppStoreUnavailableError` and
 *   nothing is read or written. Data an older build left in OPFS is neither
 *   read nor deleted.
 *
 * A caller gets the store from `getAppStore`; none builds its own.
 *
 * A profile's saves go through store2 and never write `database/database.bin`.
 * Everything else only reads the main file (the boot import of old data, and
 * the older-copy sources of the manual clean-up), moves it aside or deletes it.
 * A main-file read at boot goes through `readMainFile`; the manual clean-up
 * uses the store's own `read`.
 */

export const MAIN_FILE_KEY = 'database/database.bin'

/** The browser cannot store the app's data: IndexedDB is missing or could not be opened. */
export class AppStoreUnavailableError extends Error {
    constructor() {
        super('IndexedDB is not available in this browser.')
        this.name = 'AppStoreUnavailableError'
    }
}

/** Which kind of store the page runs on. */
export type AppStoreKind = 'tauri' | 'node' | 'indexeddb'

let injected: ByteStore | null = null
let selection: Promise<ByteStore> | null = null
/** Which store the last selection chose; `null` until a selection finished. */
let selectedKind: AppStoreKind | null = null

function filePlatform(): FilePlatform {
    try {
        return osType() === 'windows' ? 'windows' : 'posix'
    } catch {
        return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent) ? 'windows' : 'posix'
    }
}

/**
 * IndexedDB is unusable when LocalForage does not support it or when the pinned
 * instance cannot open. A failed open is sticky for every instance of the
 * database name in this page, so the check matches what the store itself will
 * meet on its first operation.
 */
async function requireIndexedDb(): Promise<void> {
    if (!localforage.supports(localforage.INDEXEDDB)) {
        throw new AppStoreUnavailableError()
    }
    try {
        await localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB }).ready()
    } catch {
        throw new AppStoreUnavailableError()
    }
}

async function selectStore(): Promise<ByteStore> {
    if (isTauri) {
        selectedKind = 'tauri'
        return createTauriFilesStore({ platform: filePlatform() })
    }
    await forageStorage.Init()
    const backend = forageStorage.realStorage
    if (isNodeServer) {
        if (!(backend instanceof NodeStorage)) {
            throw new StoreError('The Node server is in use but the storage object is not the Node client.')
        }
        selectedKind = 'node'
        return createNodeHttpStore({
            authHeader: () => backend.authHeader(),
            assetToken: () => backend.assetReadToken(),
        })
    }
    await requireIndexedDb()
    selectedKind = 'indexeddb'
    return createIndexedDbStore()
}

/**
 * Whether the page's store is the IndexedDB store. Unlike `getAppStoreKind` it
 * answers `false`, not an error, for a store injected without a kind. Rejects
 * with the selection's own failure.
 */
export async function pageStoreIsIndexedDb(): Promise<boolean> {
    await getAppStore()
    return selectedKind === 'indexeddb'
}

/**
 * The kind of store the page's selection chose. Read-only: the kind is fixed
 * by the selection, which runs once per page load. Rejects with the
 * selection's own failure, and for a store injected without a kind.
 */
export async function getAppStoreKind(): Promise<AppStoreKind> {
    await getAppStore()
    if (selectedKind === null) {
        throw new StoreError('The page\'s store was injected without a kind.')
    }
    return selectedKind
}

/**
 * The page's byte store. The selection runs once per page load and its outcome
 * stands, a rejection included: a failed `forageStorage.Init()` is itself kept
 * for the life of the page, and an unusable IndexedDB stays unusable, so only a
 * reload can change either.
 */
export function getAppStore(): Promise<ByteStore> {
    if (injected !== null) {
        return Promise.resolve(injected)
    }
    selection ??= selectStore().then((store) => {
        noteSelectedStore(selectedKind, store)
        return store
    })
    return selection
}

/**
 * Reads the main file. `bytes` is `null` only for an absent file; a zero-length
 * file is a value.
 */
export async function readMainFile(): Promise<ReadResult> {
    return (await getAppStore()).read(MAIN_FILE_KEY)
}

/**
 * Test seam: makes `store` the page's store (of the given `kind`, which
 * `getAppStoreKind` reports). `null` restores the real selection.
 */
export function injectAppStore(store: ByteStore | null, kind: AppStoreKind | null = null): void {
    injected = store
    selection = null
    selectedKind = store === null ? null : kind
    noteSelectedStore(selectedKind, store)
}
