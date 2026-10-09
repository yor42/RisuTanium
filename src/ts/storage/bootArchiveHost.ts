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
import type { BootPassSeams } from './bootPassSeams'
import { NODE_BODY_LIMIT_BYTES } from './nodeBodyLimit'
import { getAppStore, pageStoreIsIndexedDb, readMainFile as readMainFileFromStore } from './store/appStore'

/**
 * The production binding of the boot archive pass's effects: the lock binding,
 * the cold-storage unit reader and writer, the commit and the re-read (which
 * follow the page's storage mode, `bootPassSeams.ts`), the progress text. Kept
 * apart from `bootArchivePass.ts`, which `bootstrap.ts` imports, so that
 * module takes every effect through `BootArchiveDeps` and does not itself
 * import them; it is loaded on demand when a session is opened without
 * injected deps.
 */

/**
 * A Tauri build on an operating system that may archive: desktop and Android,
 * never iOS. The native OS answers when it can, the user agent otherwise (a
 * missing OS plugin on a mobile user agent is not capable). The pass's
 * in-process commit lock relies on the premise that a Tauri app has exactly
 * one live page on its data directory. Desktop holds it with the
 * single-instance plugin. Android holds it with one `singleTask` activity,
 * with `MainActivity` retiring the WebView that a recreation supersedes, and
 * with the manifest declaring the common configuration changes. The
 * superseded page's IPC replies never reach it, so no chain of its IPC
 * requests continues to a later step, and its unsaved edits are lost.
 */
function isTauriDesktop(): boolean {
    if (!isTauri) {
        return false
    }
    try {
        const os = tauriOs.type()
        return os !== 'ios'
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
    // The page's one owner, found when the first commit or re-read needs it.
    // The block-store modules are loaded then too: a pass that archives nothing
    // never reaches them.
    let seams: Promise<BootPassSeams> | null = null
    const bootSeams = (): Promise<BootPassSeams> => {
        seams ??= (async () => {
            const [{ getPageBlockOwner }, { createBootPassSeams }] = await Promise.all([import('./pageBlockOwner'), import('./bootPassSeams')])
            const owner = await getPageBlockOwner()
            if (owner === null) {
                throw new Error('This page has no block-store owner, so there is nothing to commit to.')
            }
            return createBootPassSeams({
                owner,
                store: await getAppStore(),
                // The page's own main-file reader, the one boot reads the legacy file with.
                readMainFile: async () => (await readMainFileFromStore()).bytes,
            })
        })()
        return seams
    }
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
        commit: async (input) => (await bootSeams()).commit(input),
        reread: async () => (await bootSeams()).reread(),
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
