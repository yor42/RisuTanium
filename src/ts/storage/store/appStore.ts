import localforage from 'localforage'
import { type as osType } from '@tauri-apps/plugin-os'
import { forageStorage } from '../../globalApi.svelte'
import { isNodeServer, isTauri } from '../../platform'
import { NodeStorage } from '../nodeStorage'
import { OpfsStorage } from '../opfsStorage'
import type { ByteStore, ReadResult, StoreCondition } from './contract'
import { StoreError } from './errors'
import { createIndexedDbStore } from './indexedDbStore'
import type { FilePlatform } from './keyRules'
import { createNodeHttpStore } from './nodeHttpStore'
import { createOpfsTransitionalStore } from './opfsTransitionalStore'
import { createTauriFilesStore } from './tauriFilesStore'

/**
 * The one byte store the app's main file, numbered backups and snapshots go
 * through in a page load, and the one owner of the main file's version.
 *
 * Selection happens once per page load, on first use, after the platform's boot
 * setup (on the web, after `forageStorage.Init()` has chosen its backend):
 * - Tauri: the desktop files store.
 * - Node server: the Node HTTP store, authenticated through the same auth state
 *   as the `NodeStorage` that `AutoStorage` built.
 * - Web with the OPFS main store selected: a transitional store over that OPFS
 *   instance, because the IndexedDB copy of the same keys is stale.
 * - Web otherwise: the IndexedDB store, pinned to the IndexedDB driver. If
 *   IndexedDB cannot be opened the selection fails with
 *   `AppStoreUnavailableError` and nothing is read or written.
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
        return createTauriFilesStore({ platform: filePlatform() })
    }
    await forageStorage.Init()
    const backend = forageStorage.realStorage
    if (isNodeServer) {
        if (!(backend instanceof NodeStorage)) {
            throw new StoreError('The Node server is in use but the storage object is not the Node client.')
        }
        return createNodeHttpStore({ authHeader: () => backend.authHeader() })
    }
    if (backend instanceof OpfsStorage) {
        return createOpfsTransitionalStore(backend)
    }
    await requireIndexedDb()
    return createIndexedDbStore()
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
    const { version } = await store.write(MAIN_FILE_KEY, bytes, condition)
    mainFileVersion = version
}

/** Test seam: makes `store` the page's store and forgets the main file's version. `null` restores the real selection. */
export function injectAppStore(store: ByteStore | null): void {
    injected = store
    selection = null
    mainFileVersion = null
}
