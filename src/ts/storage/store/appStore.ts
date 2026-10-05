import localforage from 'localforage'
import { type as osType } from '@tauri-apps/plugin-os'
import { acquireExclusiveStorageMigrationLock, forageStorage } from '../../globalApi.svelte'
import { isNodeServer, isTauri } from '../../platform'
import { NodeStorage } from '../nodeStorage'
import { isAppInitiatedReload } from '../../reloadGuard'
import { OpfsStorage } from '../opfsStorage'
import { resolveWebStore, runLeftoverCleanup, type CopyBackEnvironment, type FallbackNotice } from '../opfsCopyBack'
import type { ByteStore, ReadResult } from './contract'
import { StoreError } from './errors'
import { createEntryProbe, createIndexedDbStore } from './indexedDbStore'
import type { FilePlatform } from './keyRules'
import { createNodeHttpStore } from './nodeHttpStore'
import { createOpfsTransitionalStore } from './opfsTransitionalStore'
import { createTauriFilesStore } from './tauriFilesStore'
import { noteMainFileRead, resetMainFileOutcomeForTests } from '../mainFileOutcome'

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
 * - Web: `resolveWebStore` (opfsCopyBack.ts) decides. A profile whose main
 *   store is still OPFS is copied back into IndexedDB first, under the exclusive
 *   tab lock; the page then gets the IndexedDB store, pinned to the IndexedDB
 *   driver. If IndexedDB cannot be opened the selection fails with
 *   `AppStoreUnavailableError` (with the open failure itself for a profile that
 *   is still OPFS-main) and nothing is read or written. A copy that
 *   cannot finish leaves the page on a transitional store over OPFS, with a
 *   notice for the user and the next start trying again; that page must not
 *   write new data into OPFS beyond what it already keeps there, which the
 *   boot archive pass respects through `pageStoreIsIndexedDb`.
 *
 * A caller gets the store from `getAppStore`; none builds its own.
 *
 * The save of a profile is the block store, and the application's saves never
 * write `database/database.bin`. The one writer of that key is the copy-back in
 * `opfsCopyBack.ts`, which puts an OPFS main file into IndexedDB when the
 * `migrated` marker exists, whether or not the profile holds a block head. Everything else
 * only reads the main file (the boot of a profile with no head, and the
 * older-copy sources of the manual clean-up), moves it aside or deletes it. A
 * main-file read at boot goes through `readMainFile`, which reports to
 * `mainFileOutcome.ts` synchronously and without any I/O when it returns; the
 * manual clean-up uses the store's own `read`, which does not report.
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
export type AppStoreKind = 'tauri' | 'node' | 'opfs-transitional' | 'indexeddb'

let injected: ByteStore | null = null
let selection: Promise<ByteStore> | null = null
/** Which store the last selection chose; `null` until a selection finished. */
let selectedKind: AppStoreKind | null = null
/** Why the page runs from OPFS, until the boot shows it. */
let fallbackNotice: FallbackNotice | null = null
/** Whether this page load did the copy from OPFS into IndexedDB. */
let copiedBackThisPage = false

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
        return createNodeHttpStore({ authHeader: () => backend.authHeader() })
    }
    const authority = await resolveWebStore(browserCopyBackEnvironment())
    if (authority.kind === 'stopped') {
        // The page is being reloaded; nothing may read or write until it is gone.
        return new Promise<ByteStore>(() => { })
    }
    if (authority.kind === 'opfs') {
        fallbackNotice = authority.notice
        selectedKind = 'opfs-transitional'
        return createOpfsTransitionalStore(new OpfsStorage())
    }
    copiedBackThisPage = authority.copiedBack
    await requireIndexedDb()
    selectedKind = 'indexeddb'
    return createIndexedDbStore()
}

/** What `resolveWebStore` and `runLeftoverCleanup` use in a browser page. */
function browserCopyBackEnvironment(): CopyBackEnvironment {
    const noFlags = { getItem: () => null, setItem: () => { }, removeItem: () => { } }
    return {
        flags: typeof localStorage === 'undefined' ? noFlags : localStorage,
        opfsFilesUsable: () => !!(typeof navigator !== 'undefined' && navigator.storage?.getDirectory &&
            (globalThis as { FileSystemFileHandle?: { prototype?: { createWritable?: unknown } } }).FileSystemFileHandle?.prototype?.createWritable),
        getOpfsRoot: () => navigator.storage.getDirectory(),
        indexedDbSupported: () => localforage.supports(localforage.INDEXEDDB),
        openIndexedDb: async () => {
            const instance = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
            await instance.ready()
            return instance
        },
        createProbe: createEntryProbe,
        acquireLock: () => acquireExclusiveStorageMigrationLock(),
        reloadPending: isAppInitiatedReload,
        estimate: async () => navigator.storage?.estimate?.(),
        showProgress: async (done, total) => {
            const [{ alertStore }, { language }] = await Promise.all([import('../../alert'), import('src/lang')])
            alertStore.set({ type: 'wait', msg: language.opfsCopyBackProgress(done, total) })
        },
        clearProgress: async () => {
            const { alertStore } = await import('../../alert')
            alertStore.set({ type: 'none', msg: '' })
        },
    }
}

/**
 * Whether the page's store is the IndexedDB store. A page on the transitional
 * OPFS store (a profile whose copy back from OPFS could not run) is not: such a
 * page must not write new data into OPFS beyond what it already keeps there.
 * Rejects with the selection's own failure.
 */
export async function pageStoreIsIndexedDb(): Promise<boolean> {
    await getAppStore()
    return selectedKind === 'indexeddb'
}

/**
 * Whether the page runs from the transitional OPFS store: such a page is
 * read-only for its session. Unlike `getAppStoreKind` it answers `false`, not
 * an error, for a store injected without a kind. Rejects with the selection's
 * own failure.
 */
export async function pageStoreIsOpfsTransitional(): Promise<boolean> {
    await getAppStore()
    return selectedKind === 'opfs-transitional'
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

/** The reason the page runs from OPFS this load, once; `null` when it does not or the notice was already taken. */
export function takeStorageFallbackNotice(): FallbackNotice | null {
    const notice = fallbackNotice
    fallbackNotice = null
    return notice
}

/**
 * Deletes the OPFS files a completed copy back left behind, in a page that
 * loaded its main file from IndexedDB. Does nothing in the page load that did
 * the copy, on a page on any other store, or while no copy back is pending.
 * Never rejects.
 */
export async function cleanUpCopiedBackOpfs(): Promise<void> {
    if (selectedKind !== 'indexeddb' || copiedBackThisPage) {
        return
    }
    try {
        await runLeftoverCleanup(browserCopyBackEnvironment())
    } catch (error) {
        console.error('The OPFS clean-up failed:', error)
    }
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
    selection ??= selectStore()
    return selection
}

/**
 * Reads the main file. `bytes` is `null` only for an absent file; a zero-length
 * file is a value.
 */
export async function readMainFile(): Promise<ReadResult> {
    const result = await (await getAppStore()).read(MAIN_FILE_KEY)
    noteMainFileRead()
    return result
}

/**
 * Test seam: makes `store` the page's store (of the given `kind`, which
 * `getAppStoreKind` reports) and forgets the outcome of earlier main-file
 * reads. `null` restores the real selection.
 */
export function injectAppStore(store: ByteStore | null, kind: AppStoreKind | null = null): void {
    injected = store
    selection = null
    resetMainFileOutcomeForTests()
    selectedKind = store === null ? null : kind
    fallbackNotice = null
    copiedBackThisPage = false
}
