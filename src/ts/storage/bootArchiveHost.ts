import * as tauriOs from '@tauri-apps/plugin-os'
import { acquireExclusiveStorageMigrationLock, forageStorage, locksSupported } from '../globalApi.svelte'
import { readColdStorageItem, setColdStorageItem } from '../process/coldstorage.svelte'
import { isAppInitiatedReload } from '../reloadGuard'
import { LoadingStatusState } from '../stores.svelte'
import { isIOS, isMobile, isNodeServer, isTauri } from '../platform'
import {
    clearStubEnrichStrikes,
    readArchiveMemo,
    readArchiveStrikes,
    readStubEnrichStrikes,
    recordArchiveStart,
    recordStubEnrichStart,
    resetArchiveStrikes,
} from './bootArchiveMemo'
import type { BootArchiveDeps, BootArchiveEnvironment, BootArchiveHost } from './bootArchivePass'
import { pageStoreIsIndexedDb, readMainFile as readMainFileFromStore, writeMainFile as writeMainFileToStore } from './store/appStore'

/**
 * The production binding of the boot archive pass's effects: the lock binding,
 * the cold-storage unit reader and writer, the main file's reader and writer,
 * the progress text. Kept apart from `bootArchivePass.ts`, which `bootstrap.ts` imports, so
 * that module takes every effect through `BootArchiveDeps` and does not itself
 * import them; it is loaded on demand when a session is opened without
 * injected deps.
 */

/**
 * The largest request body the self-hosted Node server accepts, in bytes. It
 * must equal `NODE_BODY_LIMIT_BYTES` in `server/node/bodyLimit.cjs`, which the
 * server's body parsers use; no endpoint reports it, so a test pins the two.
 */
const NODE_BODY_LIMIT_BYTES = 104857600

/** A Tauri desktop build: the native OS answers when it can, the user agent otherwise. No mobile build is supported, so a mobile OS never archives. */
function isTauriDesktop(): boolean {
    if (!isTauri) {
        return false
    }
    try {
        const os = tauriOs.type()
        return os !== 'android' && os !== 'ios'
    } catch (error) {
        return !isMobile && !isIOS()
    }
}

/**
 * Whether a web page's byte store is the IndexedDB store. A selection that
 * fails answers false: the boot reads the main file through the same store
 * right after and reports the failure itself.
 */
async function webPageStoreIsIndexedDb(host: BootArchiveHost): Promise<boolean> {
    if (host !== 'web' || isNodeServer) {
        return false
    }
    try {
        return await pageStoreIsIndexedDb()
    } catch (error) {
        console.error('The page store could not be selected for the boot archive pass:', error)
        return false
    }
}

export async function createProductionBootArchiveDeps(host: BootArchiveHost): Promise<BootArchiveDeps> {
    const indexedDbStore = await webPageStoreIsIndexedDb(host)
    return {
        env: (): BootArchiveEnvironment => ({
            host,
            isNodeServer,
            tauriDesktop: host === 'tauri' && isTauriDesktop(),
            locksSupported: locksSupported !== false && !!navigator.locks,
            indexedDbStore,
            staleAccountProfile: !!forageStorage.staleAccountProfile,
        }),
        acquireHold: (timeoutMs) => acquireExclusiveStorageMigrationLock(timeoutMs),
        isReloading: () => isAppInitiatedReload(),
        // Both go through the page's main-file reader and writer, so a read here
        // takes the version a write after it presents.
        readMainFile: async () => (await readMainFileFromStore()).bytes,
        writeMainFile: (bytes) => writeMainFileToStore(bytes),
        writeUnit: (key, value) => setColdStorageItem(key, value),
        readUnit: (key) => readColdStorageItem(key),
        readArchiveMemo,
        readArchiveStrikes,
        recordArchiveStart,
        resetArchiveStrikes,
        readStubEnrichStrikes,
        recordStubEnrichStart,
        clearStubEnrichStrikes,
        nodeBodyLimit: NODE_BODY_LIMIT_BYTES,
        setProgress: (text) => {
            LoadingStatusState.text = text
        },
    }
}
