import { BaseDirectory, exists, remove } from "@tauri-apps/plugin-fs"
import { get } from "svelte/store"
import { language } from "src/lang"
import { alertClear, alertConfirm, alertError, alertNormal, alertWait } from "../alert"
import {
    acquireExclusiveStorageMigrationLock,
    forageStorage,
    getBasename,
    getUncleanablesSync,
    locksSupported,
    tabPresenceLockAcquired
} from "../globalApi.svelte"
import { isNodeServer, isTauri } from "../platform"
import { DBState, frozenSaveKeysStore, savingStoppedReason } from "../stores.svelte"
import { isWorkInProgress } from "../process/chatOrigin"
import { readColdStorageItem, type ColdStorageReadResult } from "../process/coldstorage.svelte"
import { isSafeColdStorageKey } from "../process/coldStorageKey"
import { listColdBackupRoots, listColdDataKeysFromDb, listInnerColdStorageKeys, listRecoverableErrorKeysFromDb } from "../process/coldstorageData"
import { isAppInitiatedReload } from "../reloadGuard"
import type { Database } from "./database.svelte"
import { getLoadTimeListing, takeStorageListing, type StorageListing } from "./loadTimeListing"
import { compareWithMainFileRecord } from "./mainFileRecord"
import type { NodeStorage } from "./nodeStorage"
import { decodeRisuSave } from "./risuSave"
import { getAppStore } from "./store/appStore"

/**
 * The manual cold-storage clean-up: one exclusive, strictly-read pass that
 * deletes stored units and assets nothing can reach any more.
 *
 * Both kinds must be present in this page's load-time listing AND in the
 * listing taken when the run starts, so anything written after this page
 * loaded is never deleted. What then keeps them differs:
 * - A unit is kept when live memory, the committed main file (freshly read
 *   from storage) or any retained snapshot reaches it: directly, through the
 *   cold-storage blob of a stub in that tree, or through any chain of archived
 *   chats, each naming the next by the pointer in, or the legacy load-error
 *   text as, its first message. Every archived chat so reached is read once,
 *   one at a time, before the start listing is taken and before the first
 *   deletion, and only the keys it names are retained. A plugin storage unit
 *   is a leaf whose content is never searched for references; a unit that a
 *   chat also names is read like any other archived chat.
 * - An asset is kept when live memory references it (read again before every
 *   batch), when the committed main file's tree references it, or when a
 *   character inside any blob read for any tree (live, committed main or
 *   snapshot) references it. A retained snapshot's own characters, modules and
 *   personas do not keep an asset.
 * Anything that cannot be read completely stops the run before a single
 * deletion. The one exception is an archived chat (never a blob): one that is
 * not stored, whose stored bytes do not decode, or whose key cannot be a
 * storage name is kept by name and followed no further, and the run carries
 * on. A chat whose read fails for any other reason stops the run.
 */

/** Keys per delete decision. */
const DELETE_BATCH_SIZE = 100
/** Budget for the hex-encoded keys of one Node delete request, well under the server's 16 KB header limit that the revision header shares. */
const NODE_REQUEST_KEY_BYTES = 8000
/** How long to wait for other tabs of this app to release the shared storage lock. */
const EXCLUSIVE_LOCK_TIMEOUT_MS = 2000
const MAIN_FILE = 'database/database.bin'
const SNAPSHOT_DIR = 'database'
const SNAPSHOT_PREFIX = 'dbbackup-'
const UNIT_KEY_PREFIX = 'coldstorage/'

/** A stop with a message that is meant to be shown to the user as it is. */
class CleanupStop extends Error {}

type KeepTree = Pick<Database, 'characters' | 'pluginCustomStorage'>

type BlobSummary =
    | { status: 'ok', chaId: string | undefined, units: string[], assets: string[] }
    | { status: 'unreadable' }

function characterDisplayName(cha: { name?: unknown, chaId?: unknown }): string {
    const name = typeof cha.name === 'string' ? cha.name.trim() : ''
    return name || (typeof cha.chaId === 'string' ? cha.chaId : '')
}

/** Where the chain that reached an archived chat began: the character it was reached from and the tree that holds that character. */
interface ChatOrigin {
    owner: string
    source: string
}

/**
 * The units and assets recorded as not to be deleted, built tree by tree and
 * then extended through the archived chats those trees reach. Each distinct
 * blob is read once; a blob's summary is what a stub needs from it, not the
 * blob itself. Each distinct archived chat is read at most once, and only the
 * keys it names are retained from it. The set only grows.
 */
class KeepSet {
    units = new Set<string>()
    /** Asset basenames, as `getUncleanablesSync` reports them. */
    assets = new Set<string>()
    private blobs = new Map<string, BlobSummary>()
    /**
     * Archived chats still to be read, in the order they were reached. Only
     * links that are not plugin slots are queued, so a plugin unit is read
     * only when a chat links it too.
     */
    private chatQueue: { key: string, origin: ChatOrigin }[] = []
    private chatQueued = new Set<string>()

    private queueChat(key: string, origin: ChatOrigin): void {
        if (!this.chatQueued.has(key)) {
            this.chatQueued.add(key)
            this.chatQueue.push({ key, origin })
        }
    }

    private async summarizeBlob(blobKey: string): Promise<BlobSummary> {
        const cached = this.blobs.get(blobKey)
        if (cached) {
            return cached
        }
        let summary: BlobSummary = { status: 'unreadable' }
        const read = await readColdStorageItem(blobKey)
        if (read.status === 'ok') {
            const character = read.value?.character
            if (character && typeof character === 'object') {
                const single: KeepTree = { characters: [character], pluginCustomStorage: {} }
                summary = {
                    status: 'ok',
                    chaId: character.chaId,
                    units: [...listColdDataKeysFromDb(single), ...listRecoverableErrorKeysFromDb(single)],
                    assets: getUncleanablesSync({} as Database, { chars: [character] }),
                }
            }
        }
        this.blobs.set(blobKey, summary)
        return summary
    }

    /**
     * Keeps the units `tree` reaches, directly and through the blob of each of
     * its stubs, and the assets of the characters in those blobs, and queues the
     * archived chats it reaches for `followArchivedChats`. The assets
     * `tree` references itself are kept only when `keepOwnAssets` is set. A stub
     * whose blob is missing, unreadable or belongs to another character stops
     * the run: what it holds cannot be known, so nothing can be deleted safely.
     */
    async addTree(tree: KeepTree, source: string, keepOwnAssets: boolean): Promise<void> {
        if (keepOwnAssets) {
            for (const asset of getUncleanablesSync(tree as Database, { chars: tree.characters ?? [] })) {
                this.assets.add(asset)
            }
        }
        for (const key of listColdDataKeysFromDb(tree)) {
            this.units.add(key)
        }
        for (const key of listRecoverableErrorKeysFromDb(tree)) {
            this.units.add(key)
        }
        for (const cha of tree.characters ?? []) {
            if (!cha) {
                continue
            }
            const origin: ChatOrigin = { owner: characterDisplayName(cha), source }
            for (const root of listColdBackupRoots({ characters: [cha], pluginCustomStorage: {} })) {
                if (root.kind !== 'plugin') {
                    this.queueChat(root.key, origin)
                }
            }
            if (!cha.coldstorage) {
                continue
            }
            const blob = await this.summarizeBlob(cha.coldstorage)
            if (blob.status !== 'ok' || blob.chaId !== cha.chaId) {
                console.error(`Cold storage cleanup stopped: the blob ${cha.coldstorage} of ${characterDisplayName(cha)} (${source}) is unusable`)
                throw new CleanupStop(language.errors.coldStorageCleanupBlobUnreadable(characterDisplayName(cha), source))
            }
            for (const key of blob.units) {
                this.units.add(key)
                this.queueChat(key, origin)
            }
            for (const asset of blob.assets) {
                this.assets.add(asset)
            }
        }
    }

    /**
     * Reads every queued archived chat, one at a time, and keeps the units each
     * names, by the pointer in or the legacy error text as the first message of
     * a chat it holds, queueing those in turn until none is new (a chain of any
     * depth, and a cycle, end here). A chat that is not stored (on Tauri that
     * includes a failed read when `loadListing` held no unit and the units
     * folder is reported absent), whose bytes do not decode or whose key cannot
     * be a storage name is kept by name and followed no further, as is one that
     * reads but holds nothing a chat unit holds. Any other read failure stops
     * the run: what the chat names cannot be known. A key that is the blob of a
     * stub was read as a blob and is not read again. Call it after every tree
     * has been added, so that every blob is known.
     */
    async followArchivedChats(loadListing: StorageListing): Promise<void> {
        for (let i = 0; i < this.chatQueue.length; i++) {
            const { key, origin } = this.chatQueue[i]
            if (this.blobs.has(key)) {
                continue
            }
            let read: ColdStorageReadResult
            try {
                read = await readColdStorageItem(key)
            } catch (error) {
                read = { status: 'error', error }
            }
            if (read.status === 'missing' || (read.status === 'error' && read.kind === 'damaged')) {
                continue
            }
            // With no unit listed at load, no unit is a deletion candidate, and archived chats add no assets to the keep set,
            // so skipping a chat here cannot lead to a deletion.
            if (read.status === 'error' && read.kind === undefined && loadListing.units.size === 0 && await isTauriUnitFolderAbsent()) {
                continue
            }
            if (read.status === 'error') {
                console.error(`Cold storage cleanup stopped: the archived chat ${key} reached from ${origin.owner} (${origin.source}) could not be read:`, read.error)
                throw new CleanupStop(language.errors.coldStorageCleanupChatUnreadable(origin.owner, origin.source))
            }
            for (const inner of listInnerColdStorageKeys(read.value)) {
                this.units.add(inner.key)
                this.queueChat(inner.key, origin)
            }
        }
        this.chatQueue = []
    }
}

//#region reading the stored saves

/**
 * True only when a failed Tauri read or removal of this file failed with "(os
 * error 2)" AND `exists()` says the file is not there. A missing file inside an
 * existing directory reports that code on every platform, and `exists()` alone
 * is false on any metadata error, so it could pass off a present file whose
 * metadata cannot be read as missing. Every other failure stays a failure.
 */
async function isMissingTauriFile(path: string, error: unknown): Promise<boolean> {
    const message = String((error as { message?: unknown })?.message ?? error)
    return /\(os error 2\)/.test(message) && !await exists(path, { baseDir: BaseDirectory.AppData })
}

/**
 * Reads a stored file, or null when it is not there. The read is the store's
 * plain `read`, never the main file's version-taking read: this tab's next save
 * of the main file must still present the version it last read or wrote, or it
 * would overwrite a save another device made in between instead of conflicting.
 */
async function readStoredFile(path: string): Promise<Uint8Array | null> {
    return (await (await getAppStore()).read(path)).bytes
}

/** File names of the retained snapshots, listed without touching them (listing them through `getDbBackups` would prune). */
async function listSnapshotNames(): Promise<string[]> {
    const keyPrefix = SNAPSHOT_DIR + '/' + SNAPSHOT_PREFIX
    return (await (await getAppStore()).list(keyPrefix))
        .filter((key) => key.endsWith('.bin'))
        .map((key) => key.slice(SNAPSHOT_DIR.length + 1))
}

/**
 * What `exists()` reports for the Tauri `coldstorage` folder: true only when it
 * resolves false, false when it resolves true or rejects. `exists()` is also
 * false when the folder's metadata cannot be read, so a false here does not
 * prove the folder is absent; the caller therefore also requires a load-time
 * listing with no unit in it. The first unit write creates the folder, so on a
 * profile that never archived a unit it is absent, and Windows then fails a
 * read of a file inside it with "(os error 3)", a path that was not found,
 * instead of the "(os error 2)" that classifies as missing. POSIX reports
 * "(os error 2)" there, which is already classified as missing.
 */
async function isTauriUnitFolderAbsent(): Promise<boolean> {
    if (!isTauri) {
        return false
    }
    try {
        return !await exists('coldstorage', { baseDir: BaseDirectory.AppData })
    } catch {
        return false
    }
}

/** Decodes a stored save strictly: anything the file promises but does not deliver stops the run. */
async function decodeStrictly(bytes: Uint8Array, source: string): Promise<KeepTree> {
    try {
        return await decodeRisuSave(bytes, { strict: true })
    } catch (error) {
        console.error(`Cold storage cleanup stopped: ${source} did not decode strictly:`, error)
        throw new CleanupStop(language.errors.coldStorageCleanupSaveUnreadable(source))
    }
}

/**
 * Reads the committed main file from storage, requires it to be exactly what
 * this tab last read or wrote, and adds what it reaches. Its bytes and its
 * decoded tree are released before the caller reads anything else.
 */
async function keepFromMainFile(keep: KeepSet): Promise<void> {
    const source = language.errors.coldStorageCleanupSourceMain
    const bytes = await readStoredFile(MAIN_FILE)
    if (!bytes) {
        throw new CleanupStop(language.errors.coldStorageCleanupSaveUnreadable(source))
    }
    const comparison = await compareWithMainFileRecord(bytes)
    if (comparison === 'no-record') {
        throw new CleanupStop(language.errors.coldStorageCleanupMainUnknown)
    }
    if (comparison === 'different') {
        throw new CleanupStop(language.errors.coldStorageCleanupMainChanged)
    }
    // Its own assets are kept too: until this tab's next save lands (saves are
    // parked for the whole run on web with Web Locks), this file is the one a
    // reload loads.
    await keep.addTree(await decodeStrictly(bytes, source), source, true)
}

/** Adds what one retained snapshot reaches. A snapshot pruned since it was listed is skipped. */
async function keepFromSnapshot(keep: KeepSet, name: string): Promise<void> {
    const bytes = await readStoredFile(SNAPSHOT_DIR + '/' + name)
    if (!bytes) {
        return
    }
    await keep.addTree(await decodeStrictly(bytes, name), name, false)
}

//#endregion

//#region refusals

function frozenGroups(): string {
    return get(frozenSaveKeysStore).map((k) => k.names.join(' and ')).join('; ')
}

/** Why the clean-up may not delete anything right now, worded for a run that has not deleted anything yet and for one that has. */
interface Refusal {
    atStart: string
    partway: string
}

function currentRefusal(): Refusal | null {
    if (get(frozenSaveKeysStore).length > 0) {
        const groups = frozenGroups()
        return {
            atStart: language.errors.coldStorageBlockedByDuplicateChaId(groups),
            partway: language.errors.coldStorageCleanupStoppedFrozen(groups),
        }
    }
    if (isWorkInProgress()) {
        return {
            atStart: language.errors.coldStorageCleanupBusy,
            partway: language.errors.coldStorageCleanupStoppedBusy,
        }
    }
    if (get(savingStoppedReason)) {
        return {
            atStart: language.errors.coldStorageCleanupSavingStopped,
            partway: language.errors.coldStorageCleanupStoppedSavingStopped,
        }
    }
    return null
}

//#endregion

//#region deleting

interface DeleteOutcome {
    deleted: number
    failed: number
    /** Set when the run stopped before every batch was handled. */
    stoppedBecause: Refusal | null
}

function showRemoving(done: number, total: number): void {
    alertWait(language.coldStorageCleanupRemoving(done, total))
}

/**
 * Handles `candidates` in batches. Before each batch, the refusals are checked
 * and `decide` picks which of that batch's keys may still go, in the same
 * synchronous step as the decision to delete them (it must not await), so
 * whatever live memory refers to by then is kept. `removeBatch` deletes the
 * decided keys, shows the wait indicator, and returns how many it could not
 * delete.
 */
async function deleteInBatches(
    candidates: string[],
    decide: (batch: string[]) => string[],
    removeBatch: (keys: string[], done: number, total: number) => Promise<number>,
): Promise<DeleteOutcome> {
    let deleted = 0
    let failed = 0
    for (let start = 0; start < candidates.length; start += DELETE_BATCH_SIZE) {
        const refusal = currentRefusal()
        if (refusal) {
            return { deleted, failed, stoppedBecause: refusal }
        }
        const batch = decide(candidates.slice(start, start + DELETE_BATCH_SIZE))
        if (batch.length === 0) {
            continue
        }
        const batchFailed = await removeBatch(batch, start, candidates.length)
        failed += batchFailed
        deleted += batch.length - batchFailed
    }
    return { deleted, failed, stoppedBecause: null }
}

/**
 * Deletes `keys` (full server keys) in requests that each carry a bounded
 * `file-path` header: every key travels hex-encoded, so the budget is counted
 * in encoded bytes, not in keys, and asset keys are longer than unit keys.
 */
async function removeNodeBatch(keys: string[], done: number, total: number): Promise<number> {
    const storage = forageStorage.realStorage as NodeStorage
    let failed = 0
    let handled = 0
    let start = 0
    while (start < keys.length) {
        let end = start
        let headerBytes = 0
        while (end < keys.length && (end === start || headerBytes + keys[end].length * 2 + 2 <= NODE_REQUEST_KEY_BYTES)) {
            headerBytes += keys[end].length * 2 + 2
            end++
        }
        const requestKeys = keys.slice(start, end)
        handled += requestKeys.length
        showRemoving(done + handled, total)
        try {
            await storage.removeItem(requestKeys)
        } catch (error) {
            console.error('Cold storage cleanup: a delete request failed:', error)
            failed += requestKeys.length
        }
        start = end
    }
    return failed
}

/**
 * Deletes the units named by `keys` and returns how many it could not delete. A
 * key that cannot be a storage name (`isSafeColdStorageKey`) is counted as not
 * deleted and never reaches a backend: no unit can be stored under it, so a
 * delete could only name some other path.
 */
export async function removeUnitBatch(keys: string[], done: number, total: number): Promise<number> {
    const removable = keys.filter((key) => isSafeColdStorageKey(key))
    const rejected = keys.length - removable.length
    if (removable.length === 0) {
        return rejected
    }
    return rejected + await removeSafeUnitBatch(removable, done, total)
}

async function removeSafeUnitBatch(keys: string[], done: number, total: number): Promise<number> {
    if (isNodeServer) {
        return await removeNodeBatch(keys.map((key) => UNIT_KEY_PREFIX + key), done, total)
    }
    let failed = 0
    if (isTauri) {
        for (let i = 0; i < keys.length; i++) {
            showRemoving(done + i + 1, total)
            const path = './coldstorage/' + keys[i] + '.json'
            try {
                await remove(path, { baseDir: BaseDirectory.AppData })
            } catch (error) {
                if (!await isMissingTauriFile(path, error)) {
                    console.error('Cold storage cleanup: could not delete a unit:', error)
                    failed++
                }
            }
        }
        return failed
    }
    let opfs: FileSystemDirectoryHandle
    try {
        opfs = await navigator.storage.getDirectory()
    } catch (error) {
        console.error('Cold storage cleanup: the storage directory is not available:', error)
        return keys.length
    }
    for (let i = 0; i < keys.length; i++) {
        showRemoving(done + i + 1, total)
        try {
            await opfs.removeEntry('coldstorage_' + keys[i] + '.json')
        } catch (error) {
            if ((error as { name?: unknown })?.name !== 'NotFoundError') {
                console.error('Cold storage cleanup: could not delete a unit:', error)
                failed++
            }
        }
    }
    return failed
}

async function removeAssetBatch(keys: string[], done: number, total: number): Promise<number> {
    if (isNodeServer) {
        return await removeNodeBatch(keys, done, total)
    }
    let failed = 0
    for (let i = 0; i < keys.length; i++) {
        showRemoving(done + i + 1, total)
        try {
            if (isTauri) {
                await remove(keys[i], { baseDir: BaseDirectory.AppData })
            } else {
                await forageStorage.removeItem(keys[i])
            }
        } catch (error) {
            console.error('Cold storage cleanup: could not delete an asset:', error)
            failed++
        }
    }
    return failed
}

/** Unit keys that live memory refers to right now. */
function liveUnitReferences(): Set<string> {
    return new Set([...listColdDataKeysFromDb(DBState.db), ...listRecoverableErrorKeysFromDb(DBState.db)])
}

//#endregion

async function cleanExclusively(): Promise<void> {
    const refusal = currentRefusal()
    if (refusal) {
        throw new CleanupStop(refusal.atStart)
    }
    const loadListing = getLoadTimeListing()
    if (!loadListing) {
        throw new CleanupStop(language.errors.coldStorageCleanupNoListing)
    }

    alertWait(language.coldStorageCleanupReading)
    const keep = new KeepSet()
    // The main file first: a main file that moved refuses the run before any
    // blob is read.
    await keepFromMainFile(keep)
    // The assets live memory references are read again before every batch
    // instead of being recorded here.
    await keep.addTree(DBState.db, language.errors.coldStorageCleanupSourceLive, false)
    for (const name of await listSnapshotNames()) {
        await keepFromSnapshot(keep, name)
    }
    // After every tree, so each blob is known, and before the start listing, so
    // that no read of an archived chat happens once a deletion is possible.
    await keep.followArchivedChats(loadListing)

    // Taken after the keep-set is built, so it names what exists now. The
    // load-time listing still bounds what may go: anything written since
    // this page loaded is in neither the candidates nor the deletions.
    const startListing = await takeStorageListing()
    // Only what the recorded keep-set does not already keep is a candidate, so
    // the progress counts deletions and a batch's live check only has to look
    // at keys that could go.
    const unitCandidates = [...loadListing.units].filter((key) => startListing.units.has(key) && !keep.units.has(key))
    const assetCandidates = [...loadListing.assets].filter((key) => startListing.assets.has(key) && !keep.assets.has(getBasename(key)))

    const units = await deleteInBatches(
        unitCandidates,
        (batch) => {
            const live = liveUnitReferences()
            return batch.filter((key) => !live.has(key))
        },
        removeUnitBatch,
    )
    let deleted = units.deleted
    let failed = units.failed
    let stoppedBecause = units.stoppedBecause
    if (!stoppedBecause) {
        const assets = await deleteInBatches(
            assetCandidates,
            (batch) => {
                const live = new Set(getUncleanablesSync(DBState.db))
                return batch.filter((key) => !live.has(getBasename(key)))
            },
            removeAssetBatch,
        )
        deleted += assets.deleted
        failed += assets.failed
        stoppedBecause = assets.stoppedBecause
    }

    alertClear()
    if (stoppedBecause) {
        alertError(deleted + failed === 0 ? stoppedBecause.atStart : language.errors.coldStorageCleanupStopped(stoppedBecause.partway, deleted, failed))
    } else if (failed > 0) {
        alertError(language.errors.coldStorageCleanupPartial(deleted, failed))
    } else {
        alertNormal(language.coldStorageCleanupDone(deleted))
    }
}

/**
 * Runs the clean-up. Confirms the extra hazards first (before taking any
 * lock, so a waiting prompt never parks this tab's saves), then holds the
 * exclusive storage lock for the whole run where the browser has one.
 * `locksSupported` only tests for `undefined`, so a falsy `navigator.locks`
 * is checked as well: it cannot hold a lock, so it counts as no Web Locks.
 */
export async function runManualCleanup(): Promise<void> {
    const refusal = currentRefusal()
    if (refusal) {
        alertError(refusal.atStart)
        return
    }
    if (!getLoadTimeListing()) {
        alertError(language.errors.coldStorageCleanupNoListing)
        return
    }
    const webLocks = !isTauri && locksSupported !== false && !!navigator.locks
    if (!isTauri && !webLocks) {
        if (!await alertConfirm(language.coldStorageCleanupNoLockConfirm)) {
            return
        }
    }
    if (isNodeServer) {
        if (!await alertConfirm(language.coldStorageCleanupNodeConfirm)) {
            return
        }
    }

    let releaseHold: ((keepWriteLock?: boolean) => Promise<void>) | null = null
    if (webLocks) {
        await tabPresenceLockAcquired
        alertWait(language.coldStorageCleanupCheckingTabs)
        releaseHold = await acquireExclusiveStorageMigrationLock(EXCLUSIVE_LOCK_TIMEOUT_MS)
        if (!releaseHold) {
            alertClear()
            // A reload already under way needs no message: this page is on its way out.
            if (!isAppInitiatedReload()) {
                alertError(language.errors.coldStorageCleanupOtherTab)
            }
            return
        }
    }

    try {
        await cleanExclusively()
    } catch (error) {
        alertClear()
        if (error instanceof CleanupStop) {
            alertError(error.message)
        } else {
            console.error('Cold storage cleanup failed:', error)
            alertError(language.errors.coldStorageCleanupFailed)
        }
    } finally {
        await releaseHold?.()
    }
}
