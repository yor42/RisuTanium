import localforage from 'localforage'
import { type as osType } from '@tauri-apps/plugin-os'
import { acquireExclusiveStorageMigrationLock, forageStorage } from '../../globalApi.svelte'
import { isNodeServer, isTauri } from '../../platform'
import { NodeStorage } from '../nodeStorage'
import { isAppInitiatedReload } from '../../reloadGuard'
import { OpfsStorage } from '../opfsStorage'
import { resolveWebStore, runLeftoverCleanup, type CopyBackEnvironment, type FallbackNotice } from '../opfsCopyBack'
import type { ByteStore, ReadResult, StoreCondition } from './contract'
import { StoreError } from './errors'
import { createEntryProbe, createIndexedDbStore } from './indexedDbStore'
import type { FilePlatform } from './keyRules'
import { createNodeHttpStore } from './nodeHttpStore'
import { createOpfsTransitionalStore } from './opfsTransitionalStore'
import { createTauriFilesStore } from './tauriFilesStore'
import { beginMainFileWrite, confirmMainFileWrite, noteMainFileRead, resetMainFileOutcomeForTests } from '../mainFileOutcome'

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
 * The main file's version is the Node server's revision of `database/database.bin`
 * as this page last read or wrote it, and `null` on a store without conditional
 * writes. Every main-file write goes through `writeMainFile`, which presents
 * that version as the write's condition on a store that enforces one and never
 * falls back to an unconditional write there. A main-file read that must set the
 * version goes through `readMainFile`; a read that must leave it alone (the
 * manual clean-up's) uses the store's own `read` and must keep doing so, or the
 * next save would overwrite another device's newer save instead of being refused.
 * A refused write never moves the version: only a fresh `readMainFile` does, so
 * a stale writer keeps being refused.
 *
 * Both calls also report to `mainFileOutcome.ts`, synchronously and without any
 * I/O: a write is reported as begun just before the store's write and as
 * confirmed only when that write returns, and a read is reported when it
 * returns. A write that throws is therefore never a confirmed one. The report
 * adds no await, so a caller that checks the page is idle and then writes has
 * no new task boundary between the two.
 */

export const MAIN_FILE_KEY = 'database/database.bin'

/** The browser cannot store the app's data: IndexedDB is missing or could not be opened. */
export class AppStoreUnavailableError extends Error {
    constructor() {
        super('IndexedDB is not available in this browser.')
        this.name = 'AppStoreUnavailableError'
    }
}

let injected: ByteStore | null = null
let selection: Promise<ByteStore> | null = null
let mainFileVersion: number | null = null
/** Which store the last selection chose; `null` until a selection finished. */
let selectedKind: 'tauri' | 'node' | 'opfs-transitional' | 'indexeddb' | null = null
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
 * Reads the main file and takes the version it reports as the one the next
 * main-file write presents. `bytes` is `null` only for an absent file; a
 * zero-length file is a value.
 */
export async function readMainFile(): Promise<ReadResult> {
    const result = await (await getAppStore()).read(MAIN_FILE_KEY)
    mainFileVersion = result.version
    noteMainFileRead()
    return result
}

/**
 * Replaces the main file. On a store with conditional writes the write is
 * conditional on the version this page last read or wrote, and rejects when
 * there is none; on any other store it is unconditional. A rejected write
 * leaves the version as it was.
 */
export async function writeMainFile(bytes: Uint8Array): Promise<void> {
    const store = await getAppStore()
    let condition: StoreCondition = 'unconditional'
    if (store.capabilities.conditionalWrites) {
        if (mainFileVersion === null) {
            throw new StoreError('The main file was not read in this page load, so a conditional write has no version to present.')
        }
        condition = { ifVersion: mainFileVersion }
    }
    const attempt = beginMainFileWrite()
    const { version } = await store.write(MAIN_FILE_KEY, bytes, condition)
    mainFileVersion = version
    confirmMainFileWrite(attempt)
}

/** Test seam: makes `store` the page's store and forgets the main file's version and the outcome of earlier main-file writes. `null` restores the real selection. */
export function injectAppStore(store: ByteStore | null): void {
    injected = store
    selection = null
    mainFileVersion = null
    resetMainFileOutcomeForTests()
    selectedKind = null
    fallbackNotice = null
    copiedBackThisPage = false
}
