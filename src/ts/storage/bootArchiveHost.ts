import * as tauriOs from '@tauri-apps/plugin-os'
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs'
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
import { writeFileAtomic } from './tauriAtomicWrite'

/**
 * The production binding of the boot archive pass's effects: the lock binding,
 * the cold-storage unit reader and writer, the storage object, the progress
 * text. Kept apart from `bootArchivePass.ts`, which `bootstrap.ts` imports, so
 * that module takes every effect through `BootArchiveDeps` and does not itself
 * import them; it is loaded on demand when a session is opened without
 * injected deps.
 */

const MAIN_FILE = 'database/database.bin'

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

function opfsWritable(): boolean {
    return !!navigator.storage?.getDirectory
        && typeof FileSystemFileHandle !== 'undefined'
        && !!FileSystemFileHandle.prototype?.createWritable
}

export async function createProductionBootArchiveDeps(host: BootArchiveHost): Promise<BootArchiveDeps> {
    return {
        env: (): BootArchiveEnvironment => ({
            host,
            isNodeServer,
            tauriDesktop: host === 'tauri' && isTauriDesktop(),
            locksSupported: locksSupported !== false && !!navigator.locks,
            opfsWritable: opfsWritable(),
            staleAccountProfile: !!forageStorage.staleAccountProfile,
        }),
        acquireHold: (timeoutMs) => acquireExclusiveStorageMigrationLock(timeoutMs),
        isReloading: () => isAppInitiatedReload(),
        // Web and Node read through the storage object the boot read through,
        // so the Node revision the commit carries is the one just adopted.
        readMainFile: async () => {
            if (host === 'tauri') {
                return await readFile(MAIN_FILE, { baseDir: BaseDirectory.AppData })
            }
            return await forageStorage.getItem(MAIN_FILE) as unknown as Uint8Array | null
        },
        writeMainFile: async (bytes) => {
            if (host === 'tauri') {
                await writeFileAtomic(MAIN_FILE, bytes)
                return
            }
            await forageStorage.setItem(MAIN_FILE, bytes)
        },
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
