import type { EntryProbe } from './store/indexedDbStore'

/**
 * A web profile whose main store was moved to OPFS (the `opfs_flag!` flag in
 * `localStorage`) is brought back to IndexedDB at startup, once, and the page
 * then runs on IndexedDB like every other web profile. This module decides
 * which store a web page gets and performs that copy; it is the only code that
 * reads or writes the flag.
 *
 * Authority, read before the page's store is chosen to decide whether a copy is
 * needed at all, and read again under the exclusive lock before any copy. OPFS inputs exist
 * only in a browser that can read and write OPFS files.
 * - flag unset: the profile is not OPFS-main; IndexedDB is current and nothing
 *   in OPFS is copied.
 * - flag set, IndexedDB holds the main file and no `migrated` marker: the move
 *   to OPFS never completed, so IndexedDB is current; the flag is cleared.
 * - flag set otherwise (no main file in IndexedDB, or the marker is present):
 *   OPFS is current, and it is copied back.
 *
 * The invariant behind every branch: a page never serves IndexedDB for a
 * profile whose current data is in OPFS until a verified copy has completed,
 * and nothing in OPFS is deleted unless IndexedDB holds the same key. The copy
 * runs only under the exclusive storage-migration lock. The flag is removed
 * only after every OPFS file is in IndexedDB and the main file's bytes read
 * back from IndexedDB hash the same as the OPFS file's, and the page uses
 * IndexedDB only if that removal worked. A copy that cannot finish for any
 * reason leaves the flag and the OPFS files as they were, removes what it
 * wrote to IndexedDB, and the page runs from OPFS with a notice; the next start
 * tries again.
 *
 * After a copy-back the OPFS copies stay in place for one start. At a later
 * start that loaded normally from IndexedDB, `runLeftoverCleanup` deletes the
 * hex-named OPFS files whose key IndexedDB holds.
 */

/** The `localStorage` flag that marks a profile as OPFS-main. */
export const OPFS_FLAG_KEY = 'opfs_flag!'
/** The `localStorage` marker that a copy-back finished and its OPFS leftovers are still to be deleted. */
export const COPYBACK_CLEANUP_KEY = 'opfs_copyback_cleanup!'
/** The IndexedDB entry the move to OPFS wrote when it completed. */
const MOVE_COMPLETE_KEY = 'migrated'
/** The main file's store key; the same value as `MAIN_FILE_KEY` in `store/appStore.ts`, which imports this module. */
const MAIN_FILE_KEY = 'database/database.bin'

export type FallbackReason = 'tab' | 'space' | 'noIndexedDb' | 'error'

/** Why a page runs from OPFS this time. `detail` is only set for `reason: 'error'`. */
export interface FallbackNotice {
    reason: FallbackReason
    detail?: string
}

export type WebStoreAuthority =
    /** IndexedDB is the page's store. `copiedBack` is true only in the page load that did the copy. */
    | { kind: 'indexeddb', copiedBack: boolean }
    /** The page runs from OPFS this time. */
    | { kind: 'opfs', notice: FallbackNotice }
    /** Another tab's exclusive operation is reloading this page: nothing may read or write. */
    | { kind: 'stopped' }

export interface FlagStore {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** The minimal IndexedDB handle the copy uses: the pinned LocalForage instance. */
export interface IndexedDbHandle {
    setItem(key: string, value: Uint8Array): Promise<unknown>
    getItem<T>(key: string): Promise<T | null>
    removeItem(key: string): Promise<void>
    keys(): Promise<string[]>
}

export type ReleaseLock = (keepWriteLock?: boolean) => Promise<void>

export interface CopyBackEnvironment {
    flags: FlagStore
    /** Whether this browser can read and write OPFS files at all. */
    opfsFilesUsable(): boolean
    getOpfsRoot(): Promise<FileSystemDirectoryHandle>
    /** Whether LocalForage supports IndexedDB here. When it does not, no IndexedDB data can exist. */
    indexedDbSupported(): boolean
    /** Opens the IndexedDB-pinned instance of the `risuai` database. Rejects when IndexedDB is supported but cannot be opened. */
    openIndexedDb(): Promise<IndexedDbHandle>
    createProbe(): EntryProbe
    /** The exclusive storage-migration lock; `null` when it was not granted. */
    acquireLock(): Promise<ReleaseLock | null>
    /** Whether a reload of this page is already under way. */
    reloadPending(): boolean
    estimate(): Promise<{ usage?: number, quota?: number } | undefined>
    showProgress(done: number, total: number): void | Promise<void>
    clearProgress(): void | Promise<void>
}

/** A copy that stopped for a known reason. */
class CopyBackFailure extends Error {
    constructor(readonly reason: FallbackReason, message: string) {
        super(message)
        this.name = 'CopyBackFailure'
    }
}

interface OpfsFileInfo {
    name: string
    key: string
    size: number
    lastModified: number
}

function hexName(key: string): string {
    return Buffer.from(key, 'utf-8').toString('hex')
}

/** The key an OPFS root entry name stands for, or `null` for a name that is not the hex of a key (such as a `coldstorage_<key>.json` unit file). */
function keyFromEntryName(name: string): string | null {
    const decoded = Buffer.from(name, 'hex').toString('utf-8')
    if (decoded === '' || hexName(decoded) !== name) {
        return null
    }
    return decoded
}

function isNotFound(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotFoundError'
}

function isQuotaExceeded(error: unknown): boolean {
    return error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || (error as { code?: number }).code === 22 || (error as { code?: number }).code === 1014)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Buffer.from(digest).toString('hex')
}

/** Every file entry of the OPFS root that is a hex-named key, with the size and modification time the copy compares. */
async function listOpfsFiles(root: FileSystemDirectoryHandle): Promise<OpfsFileInfo[]> {
    const files: OpfsFileInfo[] = []
    for await (const entry of root.values()) {
        if (entry.kind !== 'file') {
            continue
        }
        const key = keyFromEntryName(entry.name)
        if (key === null) {
            continue
        }
        const file = await (entry as FileSystemFileHandle).getFile()
        files.push({ name: entry.name, key, size: file.size, lastModified: file.lastModified })
    }
    return files
}

function sameSnapshot(before: OpfsFileInfo[], after: OpfsFileInfo[]): boolean {
    if (before.length !== after.length) {
        return false
    }
    const byName = new Map(before.map((info) => [info.name, info]))
    return after.every((info) => {
        const seen = byName.get(info.name)
        return seen !== undefined && seen.size === info.size && seen.lastModified === info.lastModified
    })
}

async function entryPresent(probe: EntryProbe, indexedDb: IndexedDbHandle, key: string): Promise<boolean> {
    return (await probe.exists(key)) ?? (await indexedDb.keys()).includes(key)
}

function clearFlag(env: CopyBackEnvironment): void {
    try {
        env.flags.removeItem(OPFS_FLAG_KEY)
    } catch (error) {
        console.error('The OPFS flag could not be cleared:', error)
    }
}

type Classification = 'indexeddb-current' | 'opfs-main'

/**
 * Reads the authority inputs. A read that throws is not caught: it must stay a
 * loud boot failure and never select a store.
 */
async function classify(env: CopyBackEnvironment, indexedDb: IndexedDbHandle, probe: EntryProbe): Promise<Classification> {
    if (env.flags.getItem(OPFS_FLAG_KEY) !== 'able') {
        return 'indexeddb-current'
    }
    const mainPresent = await entryPresent(probe, indexedDb, MAIN_FILE_KEY)
    const moveComplete = await entryPresent(probe, indexedDb, MOVE_COMPLETE_KEY)
    if (mainPresent && !moveComplete) {
        clearFlag(env)
        return 'indexeddb-current'
    }
    return 'opfs-main'
}

async function dropStaleMoveMarker(env: CopyBackEnvironment): Promise<void> {
    if (env.flags.getItem(COPYBACK_CLEANUP_KEY) !== 'pending' || !env.indexedDbSupported()) {
        return
    }
    try {
        await (await env.openIndexedDb()).removeItem(MOVE_COMPLETE_KEY)
    } catch (error) {
        console.error('The stale OPFS move marker could not be removed:', error)
    }
}

export async function resolveWebStore(env: CopyBackEnvironment): Promise<WebStoreAuthority> {
    if (env.flags.getItem(OPFS_FLAG_KEY) !== 'able') {
        await dropStaleMoveMarker(env)
        return { kind: 'indexeddb', copiedBack: false }
    }
    if (!env.opfsFilesUsable()) {
        // A browser that cannot write OPFS files was served IndexedDB while the
        // flag was set, so IndexedDB is current here.
        clearFlag(env)
        return { kind: 'indexeddb', copiedBack: false }
    }
    if (!env.indexedDbSupported()) {
        // No IndexedDB data can exist, so OPFS is the only copy.
        return { kind: 'opfs', notice: { reason: 'noIndexedDb' } }
    }
    const indexedDb = await env.openIndexedDb()
    const probe = env.createProbe()
    try {
        return await decide(env, indexedDb, probe)
    } finally {
        probe.close()
    }
}

async function decide(env: CopyBackEnvironment, indexedDb: IndexedDbHandle, probe: EntryProbe): Promise<WebStoreAuthority> {
    if (await classify(env, indexedDb, probe) !== 'opfs-main') {
        return { kind: 'indexeddb', copiedBack: false }
    }
    const release = await env.acquireLock()
    if (release === null) {
        if (env.reloadPending()) {
            return { kind: 'stopped' }
        }
        // Another tab may have finished the copy while this one waited; it
        // clears the flag last.
        if (env.flags.getItem(OPFS_FLAG_KEY) !== 'able') {
            return { kind: 'indexeddb', copiedBack: false }
        }
        return { kind: 'opfs', notice: { reason: 'tab' } }
    }
    try {
        // The inputs are read again under the lock: another tab may have
        // changed them while this one waited.
        if (await classify(env, indexedDb, probe) !== 'opfs-main') {
            return { kind: 'indexeddb', copiedBack: false }
        }
        return await copyBack(env, indexedDb)
    } finally {
        try {
            await release()
        } catch (error) {
            console.error('The storage migration lock could not be released:', error)
        }
    }
}

async function copyBack(env: CopyBackEnvironment, indexedDb: IndexedDbHandle): Promise<WebStoreAuthority> {
    const written: string[] = []
    let cleanupMarkerSet = false
    try {
        const root = await env.getOpfsRoot()
        try {
            await root.getFileHandle(hexName(MAIN_FILE_KEY))
        } catch (error) {
            if (!isNotFound(error)) {
                throw error
            }
            // The flag says OPFS is current but OPFS holds no main file: there
            // is nothing to copy, and IndexedDB is all this profile has.
            clearFlag(env)
            try {
                await indexedDb.removeItem(MOVE_COMPLETE_KEY)
            } catch (removeError) {
                console.error('The OPFS move marker could not be removed:', removeError)
            }
            return { kind: 'indexeddb', copiedBack: false }
        }

        const files = await listOpfsFiles(root)

        // IndexedDB entries under these keys are not authoritative while the flag
        // is set and the copy overwrites them; removing them first keeps an
        // interrupted earlier attempt's leftovers out of the space check.
        for (const info of files) {
            await indexedDb.removeItem(info.key)
        }

        const needed = files.reduce((sum, info) => sum + info.size, 0)
        let estimate: { usage?: number, quota?: number } | undefined
        try {
            estimate = await env.estimate()
        } catch {
            estimate = undefined
        }
        if (estimate !== undefined && typeof estimate.usage === 'number' && typeof estimate.quota === 'number' &&
            estimate.quota - estimate.usage < needed) {
            throw new CopyBackFailure('space', 'Not enough free storage space for the copy.')
        }

        let mainHash: string | null = null
        for (let i = 0; i < files.length; i++) {
            if (i % 25 === 0) {
                await env.showProgress(i, files.length)
            }
            const info = files[i]
            const file = await (await root.getFileHandle(info.name)).getFile()
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (info.key === MAIN_FILE_KEY) {
                mainHash = await sha256Hex(bytes)
            }
            written.push(info.key)
            await indexedDb.setItem(info.key, bytes)
        }

        // A tab that fell back to OPFS may have written during the copy.
        if (!sameSnapshot(files, await listOpfsFiles(root))) {
            throw new CopyBackFailure('tab', 'The OPFS files changed while they were being copied.')
        }

        const copiedMain = await indexedDb.getItem<Uint8Array>(MAIN_FILE_KEY)
        if (mainHash === null || copiedMain === null || await sha256Hex(copiedMain) !== mainHash) {
            throw new CopyBackFailure('error', 'The main file read back from IndexedDB differs from the OPFS file.')
        }

        env.flags.setItem(COPYBACK_CLEANUP_KEY, 'pending')
        cleanupMarkerSet = true
        // Nothing below may roll the copy back: once this removal returns, the
        // next start reads IndexedDB as current.
        env.flags.removeItem(OPFS_FLAG_KEY)
        try {
            await indexedDb.removeItem(MOVE_COMPLETE_KEY)
        } catch (error) {
            // The flag is already clear, so the marker is not read; the next
            // start removes it.
            console.error('The OPFS move marker could not be removed:', error)
        }
        return { kind: 'indexeddb', copiedBack: true }
    } catch (error) {
        for (const key of written) {
            try {
                await indexedDb.removeItem(key)
            } catch (removeError) {
                console.error('A partly copied IndexedDB entry could not be removed:', key, removeError)
            }
        }
        if (cleanupMarkerSet) {
            try {
                env.flags.removeItem(COPYBACK_CLEANUP_KEY)
            } catch (markerError) {
                console.error('The OPFS clean-up marker could not be removed:', markerError)
            }
        }
        console.error('The copy from OPFS to IndexedDB did not complete:', error)
        if (error instanceof CopyBackFailure) {
            return { kind: 'opfs', notice: { reason: error.reason, ...(error.reason === 'error' ? { detail: error.message } : {}) } }
        }
        if (isQuotaExceeded(error)) {
            return { kind: 'opfs', notice: { reason: 'space' } }
        }
        return { kind: 'opfs', notice: { reason: 'error', detail: error instanceof Error ? error.message : String(error) } }
    } finally {
        try {
            await env.clearProgress()
        } catch (error) {
            console.error('The progress message could not be cleared:', error)
        }
    }
}

/**
 * Deletes the OPFS files a copy-back left behind. Runs only when the flag is
 * unset and the clean-up marker is pending, and the caller guarantees this page
 * loaded its main file from IndexedDB in this page load and did not do the copy
 * itself. A file is deleted only when it is a file, its name is the hex of a key,
 * and IndexedDB holds that key; every other entry is left, and
 * `coldstorage_<key>.json` unit files are never touched. The marker is removed
 * only when no deletion failed and no presence check was inconclusive.
 */
export async function runLeftoverCleanup(env: CopyBackEnvironment): Promise<'skipped' | 'done' | 'pending'> {
    if (env.flags.getItem(OPFS_FLAG_KEY) === 'able' || env.flags.getItem(COPYBACK_CLEANUP_KEY) !== 'pending') {
        return 'skipped'
    }
    let root: FileSystemDirectoryHandle
    try {
        root = await env.getOpfsRoot()
    } catch (error) {
        console.error('The OPFS root could not be opened for the clean-up:', error)
        return 'pending'
    }
    const probe = env.createProbe()
    let unresolved = 0
    try {
        const names: { name: string, key: string }[] = []
        for await (const entry of root.values()) {
            if (entry.kind !== 'file') {
                continue
            }
            const key = keyFromEntryName(entry.name)
            if (key !== null) {
                names.push({ name: entry.name, key })
            }
        }
        for (const { name, key } of names) {
            const present = await probe.exists(key)
            if (present === null) {
                unresolved++
                continue
            }
            if (!present) {
                continue
            }
            try {
                await root.removeEntry(name)
            } catch (error) {
                if (!isNotFound(error)) {
                    unresolved++
                    console.error('An OPFS leftover could not be deleted:', name, error)
                }
            }
        }
    } catch (error) {
        console.error('The OPFS clean-up did not finish:', error)
        return 'pending'
    } finally {
        probe.close()
    }
    if (unresolved > 0) {
        return 'pending'
    }
    try {
        env.flags.removeItem(COPYBACK_CLEANUP_KEY)
    } catch (error) {
        console.error('The OPFS clean-up marker could not be removed:', error)
        return 'pending'
    }
    return 'done'
}
