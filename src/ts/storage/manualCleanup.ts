import { get } from "svelte/store"
import { language } from "src/lang"
import { alertClear, alertConfirm, alertError, alertNormal, alertWait } from "../alert"
import {
    acquireExclusiveStorageMigrationLock,
    getBasename,
    getUncleanablesSync,
    locksSupported,
    tabPresenceLockAcquired
} from "../globalApi.svelte"
import { isNodeServer, isTauri } from "../platform"
import { DBState, frozenSaveKeysStore, savingStoppedReason } from "../stores.svelte"
import { isWorkInProgress } from "../process/chatOrigin"
import { beginBusy, isBusy, type BusyHandle } from "../process/memory/busyActions"
import { deleteColdStorageUnits, readColdStorageItem, type ColdStorageReadResult } from "../process/coldstorage.svelte"
import { isSafeColdStorageKey } from "../process/coldStorageKey"
import { listColdBackupRoots, listColdDataKeysFromDb, listInnerColdStorageKeys, listRecoverableErrorKeysFromDb } from "../process/coldstorageData"
import { isAppInitiatedReload } from "../reloadGuard"
import { bytesEqual, crc32 } from "./blockFrame"
import { HEAD_KEY, LEGACY_MAIN_FILE_KEY, PRE_BLOCKS_PREFIX, generationPrefix, keptKey, ownBlockKey, rootKey, stubsKey } from "./blockKeys"
import { BlockStoreReadError, retireGeneration, type BlockStoreOwner, type CommittedStateView } from "./blockStore"
import { validateLoadedBlocks } from "./blockProfileValidate"
import type { Database } from "./database.svelte"
import { parseHead } from "./headSwap"
import { getLoadTimeListing, takeStorageListing } from "./loadTimeListing"
import { fingerprintMainFile, isPreBlocksKey } from "./mainFileFingerprint"
import { compareWithMainFileRecord } from "./mainFileRecord"
import { getPageBlockOwner } from "./pageBlockOwner"
import { decodeRisuSave } from "./risuSave"
import { refuseOnReadOnlyPage } from "./readOnlyPage"
import { getAppStore } from "./store/appStore"
import type { ByteStore } from "./store/contract"
import { StoreDeleteManyError, StoreVersionConflictError } from "./store/errors"

/**
 * The manual cold-storage clean-up: one exclusive, strictly-read pass that
 * deletes stored units and assets nothing can reach any more.
 *
 * Both kinds must be present in this page's load-time listing AND in the
 * listing taken when the run starts, so anything written after this page
 * loaded is never deleted. What then keeps them differs:
 * - A unit is kept when live memory, the committed save (freshly read from
 *   storage: the main file on a profile with no block head, the committed
 *   block generation on one with a head), any older copy of the main file a
 *   block profile still holds or any retained snapshot reaches it: directly, through the
 *   cold-storage blob of a stub in that tree, or through any chain of archived
 *   chats, each naming the next by the pointer in, or the legacy load-error
 *   text as, its first message. Every archived chat so reached is read once,
 *   one at a time, before the start listing is taken and before the first
 *   deletion, and only the keys it names are retained. A plugin storage unit
 *   is a leaf whose content is never searched for references; a unit that a
 *   chat also names is read like any other archived chat.
 * - An asset is kept when live memory references it (read again before every
 *   batch), when the committed save's tree references it, when an older copy of
 *   the main file that a block profile still holds references it, or when a
 *   character inside any blob read for any tree (live, committed, older copy or
 *   snapshot) references it. A retained snapshot's own characters, modules and
 *   personas do not keep an asset.
 * A block profile's committed save is read only while this page's record of it
 * still holds: the same generation, sequence number and acknowledged blocks.
 * Older saved copies that the user has not deleted (kept generations, older
 * main files) are never swept around: a kept generation stops the run unless
 * the user agrees to delete it, and an older main file is either confirmed for
 * deletion by the user or decoded and kept. What the user confirms is deleted
 * only after the keep set is complete and every stop check has passed, before
 * any unit or asset. The generation the head names is never deleted.
 * Anything that cannot be read completely stops the run with the store exactly
 * as it was. The one exception is an archived chat (never a blob): one that is
 * not stored, whose stored bytes do not decode, or whose key cannot be a
 * storage name is kept by name and followed no further, and the run carries
 * on. A chat whose read fails for any other reason stops the run.
 */

/** Keys per delete decision. */
const DELETE_BATCH_SIZE = 100
/** Asset keys per delete call on every platform, and unit keys per call on a Node server only (elsewhere a unit is its own call): small enough that a Node server takes a group in one request and the progress moves. */
const ASSET_DELETE_GROUP_SIZE = 20
/** How long to wait for other tabs of this app to release the shared storage lock. */
const EXCLUSIVE_LOCK_TIMEOUT_MS = 2000
const MAIN_FILE = 'database/database.bin'
const SNAPSHOT_DIR = 'database'
const SNAPSHOT_PREFIX = 'dbbackup-'
const ASSET_KEY_PREFIX = 'assets/'

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
     * depth, and a cycle, end here). A chat that is not stored, whose bytes do
     * not decode or whose key cannot be a storage name is kept by name and
     * followed no further, as is one that
     * reads but holds nothing a chat unit holds. Any other read failure stops
     * the run: what the chat names cannot be known. A key that is the blob of a
     * stub was read as a blob and is not read again. Call it after every tree
     * has been added, so that every blob is known.
     */
    async followArchivedChats(): Promise<void> {
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

/** Reads a stored file through the store's own `read`, or null when it is not there. */
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

//#region the block profile

/** The creation time an id carries (its first twelve hex digits), as a date for the user. */
function generationDate(generation: string): string {
    return new Date(Number.parseInt(generation.slice(0, 12), 16)).toLocaleString()
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((name, index) => name === b[index])
}

/**
 * The page's block-store owner when the store holds a block head, `null` for a
 * profile with no head (the legacy main file is the save). A head with no live
 * owner behind it (another tab or device converted since this page loaded)
 * stops the run: this page has no record to compare against.
 */
async function blockProfileOwner(store: ByteStore): Promise<BlockStoreOwner | null> {
    if (!(await store.has(HEAD_KEY))) {
        return null
    }
    const owner = await getPageBlockOwner()
    if (owner === null || owner.committedState() === null) {
        throw new CleanupStop(language.errors.coldStorageCleanupCommittedUnknown)
    }
    return owner
}

/**
 * Whether the store still holds exactly what this page's owner acknowledged:
 * the same generation and sequence number, the same directory, and the same
 * bytes under every block key (the stubs pack included). Anything else means
 * another writer saved, and the keep set built from what was read would not be
 * the save a reload loads.
 */
async function committedMatchesRecord(store: ByteStore, state: CommittedStateView, loaded: { generation: string, seq: number, directory: readonly string[], packed: readonly string[], blocks: ReadonlyMap<string, Uint8Array> }): Promise<boolean> {
    if (loaded.generation !== state.generation || loaded.seq !== state.seq
        || !sameNames(loaded.directory, state.directory) || !sameNames(loaded.packed, state.packed)) {
        return false
    }
    const packed = new Set(loaded.packed)
    for (const name of loaded.directory) {
        if (packed.has(name)) {
            continue
        }
        const acknowledged = state.bytesOf(ownBlockKey(loaded.generation, name))
        const stored = loaded.blocks.get(name)
        if (acknowledged === null || stored === undefined || !bytesEqual(acknowledged, stored)) {
            return false
        }
    }
    if (loaded.packed.length > 0) {
        const acknowledged = state.bytesOf(stubsKey(loaded.generation))
        const stored = (await store.read(stubsKey(loaded.generation))).bytes
        if (acknowledged === null || stored === null || !bytesEqual(acknowledged, stored)) {
            return false
        }
    }
    return true
}

/**
 * Reads the committed block generation from storage, strictly, requires it to
 * be exactly what this page's owner acknowledged, and adds what it reaches
 * (its own assets included: it is the save a reload loads). A damaged
 * generation, a read that keeps failing or any difference from the record stops
 * the run.
 */
async function keepFromCommittedBlocks(keep: KeepSet, store: ByteStore, owner: BlockStoreOwner): Promise<CommittedStateView> {
    const source = language.errors.coldStorageCleanupSourceCommitted
    const state = owner.committedState()
    if (state === null) {
        throw new CleanupStop(language.errors.coldStorageCleanupCommittedUnknown)
    }
    let tree: Database
    try {
        const read = await owner.readCommitted({ validate: validateLoadedBlocks })
        if (read.kind === 'no-head') {
            throw new CleanupStop(language.errors.coldStorageCleanupCommittedChanged)
        }
        if (read.kind === 'damaged') {
            console.error('Cold storage cleanup stopped: the committed save is damaged:', read.damage)
            throw new CleanupStop(language.errors.coldStorageCleanupSaveUnreadable(source))
        }
        if (!await committedMatchesRecord(store, state, read.loaded)) {
            throw new CleanupStop(language.errors.coldStorageCleanupCommittedChanged)
        }
        tree = read.tree as Database
    } catch (error) {
        if (error instanceof BlockStoreReadError) {
            console.error('Cold storage cleanup stopped: the committed save could not be read:', error)
            throw new CleanupStop(language.errors.coldStorageCleanupSaveUnreadable(source))
        }
        throw error
    }
    await keep.addTree(tree, source, true)
    return state
}

/**
 * Fails unless the head still names `live` and not `generation`: nothing under
 * the live generation, or one a replace has just made live, is ever deleted,
 * whatever markers it carries. `deletedBefore` is how many saved copies this
 * run has already deleted; the stop says so when it is not zero.
 */
async function requireGenerationNotLive(store: ByteStore, generation: string, live: string, deletedBefore: number): Promise<void> {
    let bytes: Uint8Array | null
    try {
        bytes = (await store.read(HEAD_KEY)).bytes
    } catch (error) {
        console.error('Cold storage cleanup stopped: the head could not be read:', error)
        throw new CleanupStop(language.errors.coldStorageCleanupDeleteFailed)
    }
    const head = bytes === null ? null : parseHead(bytes)
    if (head === null || head.status !== 'ok' || head.record.current !== live || head.record.current === generation) {
        throw new CleanupStop(deletedBefore === 0 ? language.errors.coldStorageCleanupCommittedChanged : language.errors.coldStorageCleanupDeleteFailed)
    }
}

/** Deletes a kept generation: its root first, so a half-deleted one never looks whole, and its marker last. */
async function deleteKeptGeneration(store: ByteStore, generation: string, live: string, deletedBefore: number): Promise<void> {
    await requireGenerationNotLive(store, generation, live, deletedBefore)
    try {
        const keys = await store.list(generationPrefix(generation))
        const root = rootKey(generation)
        const marker = keptKey(generation)
        if (keys.includes(root)) {
            await store.delete(root, 'unconditional')
        }
        const rest = keys.filter((key) => key !== root && key !== marker)
        if (rest.length > 0) {
            await store.deleteMany(rest.map((key) => ({ key, condition: 'unconditional' as const })))
        }
        if (keys.includes(marker)) {
            await store.delete(marker, 'unconditional')
        }
    } catch (error) {
        console.error('Cold storage cleanup stopped: a kept generation could not be deleted:', error)
        throw new CleanupStop(language.errors.coldStorageCleanupDeleteFailed)
    }
}

/** What the user confirmed deleting in this run; nothing in it is deleted until the keep set is complete. */
interface ConfirmedDeletes {
    keptGenerations: readonly string[]
    leftoverGenerations: readonly string[]
    copies: OlderCopyDelete[]
}

/** An older main-file copy the user confirmed deleting, and what proves it is still the file that was read. */
interface OlderCopyDelete {
    key: string
    /** The store's version of the read, when the store deletes against versions. */
    version: number | null
    /**
     * The byte length and whole-file CRC-32 of the read, recorded only when the
     * delete is checked against them instead of a version. The bytes themselves
     * are not held: a copy can be hundreds of MB and stays unreferenced here
     * while other prompts and decodes run.
     */
    content: { length: number, crc: number } | null
}

/**
 * The two kinds of generation that are not the live one, and what the user
 * decides about them. Kept ones (set aside when a damaged save was replaced)
 * may reference assets nothing else does, so the run goes on only after the
 * user agrees to delete them. Leftover ones (interrupted builds, a losing
 * replace) are deleted behind a confirm, which also says another device saving
 * to the same server can lose a save in progress; a declined confirm keeps them
 * and the run continues. Nothing is deleted here: the answers are returned for
 * `deleteConfirmed`.
 */
async function askAboutOtherGenerations(own: BusyHandle, owner: BlockStoreOwner): Promise<Pick<ConfirmedDeletes, 'keptGenerations' | 'leftoverGenerations'>> {
    const inventory = await owner.inventory()
    let keptGenerations: readonly string[] = []
    let leftoverGenerations: readonly string[] = []
    if (inventory.kept.length > 0) {
        const dates = inventory.kept.map(generationDate).join(', ')
        if (!await alertConfirm(language.coldStorageCleanupKeptConfirm(dates))) {
            throw new CleanupStop(language.errors.coldStorageCleanupKeptKept)
        }
        stopIfRefused(own)
        keptGenerations = inventory.kept
    }
    if (inventory.leftover.length > 0) {
        const dates = inventory.leftover.map(generationDate).join(', ')
        if (await alertConfirm(language.coldStorageCleanupLeftoverConfirm(inventory.leftover.length, dates))) {
            stopIfRefused(own)
            leftoverGenerations = inventory.leftover
        }
    }
    return { keptGenerations, leftoverGenerations }
}

/** Stops the run when a refusal arose while a prompt was open. */
function stopIfRefused(own: BusyHandle): void {
    const refusal = currentRefusal(own)
    if (refusal) {
        throw new CleanupStop(refusal.atStart)
    }
}

/**
 * Deletes a confirmed copy only while it is still the file that was read: a
 * store with versions deletes against the version of that read; any other
 * re-reads and compares the length and the whole-file CRC-32 recorded at the
 * confirm right before the delete. A change that keeps both is not detected;
 * that is the trade for not holding the copy's bytes.
 */
async function deleteOlderCopy(store: ByteStore, copy: OlderCopyDelete): Promise<void> {
    const { key, version, content } = copy
    try {
        if (store.capabilities.conditionalWrites && version !== null) {
            await store.delete(key, { ifVersion: version })
            return
        }
        const current = (await store.read(key)).bytes
        if (current === null) {
            return
        }
        if (content === null || current.length !== content.length || crc32(current) !== content.crc) {
            throw new CleanupStop(language.errors.coldStorageCleanupDeleteFailed)
        }
        await store.delete(key, 'unconditional')
    } catch (error) {
        if (error instanceof CleanupStop) {
            throw error
        }
        if (!(error instanceof StoreVersionConflictError)) {
            console.error('Cold storage cleanup stopped: an older copy could not be deleted:', error)
        }
        throw new CleanupStop(language.errors.coldStorageCleanupDeleteFailed)
    }
}

/**
 * Every older copy of the main file a block profile holds: each
 * `database.pre-blocks*.bin`, and any `database.bin` whatever it contains (the
 * pre-conversion copy, or a save another program or an earlier copy-back from
 * the OPFS store put there). Each is decoded strictly, once, and kept with its
 * own assets, unless the user confirms deleting it; the confirm names its date:
 * the head's conversion time for the copy whose fingerprint is the head's
 * `convertedFrom`, "date unknown" for any other. A `database.bin` that does not
 * match is not called the pre-conversion copy and not called older either: it
 * may be a newer save. A copy that does not decode stops the run unless the user
 * confirms deleting it, so the run is never blocked for good. A copy the user
 * confirms is not a keep source and is returned for `deleteConfirmed`; nothing
 * is deleted here.
 */
async function keepFromOlderCopies(keep: KeepSet, store: ByteStore, state: CommittedStateView, own: BusyHandle): Promise<OlderCopyDelete[]> {
    const confirmed: OlderCopyDelete[] = []
    const keys = (await store.list(PRE_BLOCKS_PREFIX)).filter(isPreBlocksKey).sort()
    if (await store.has(LEGACY_MAIN_FILE_KEY)) {
        keys.push(LEGACY_MAIN_FILE_KEY)
    }
    for (const key of keys) {
        const read = await store.read(key)
        if (read.bytes === null) {
            continue
        }
        const fingerprint = fingerprintMainFile(read.bytes)
        const isConverted = state.convertedFrom !== null && fingerprint === state.convertedFrom
        const name = key === LEGACY_MAIN_FILE_KEY && !isConverted
            ? language.errors.coldStorageCleanupSourceOlderMain
            : language.errors.coldStorageCleanupSourcePreConversion
        const date = isConverted && state.convertedAt !== null ? new Date(state.convertedAt).toLocaleString() : language.coldStorageCleanupDateUnknown
        let tree: KeepTree | null = null
        try {
            tree = await decodeRisuSave(read.bytes, { strict: true })
        } catch (error) {
            console.error(`Cold storage cleanup: ${key} did not decode strictly:`, error)
        }
        if (await alertConfirm(language.coldStorageCleanupCopyConfirm(name, date, tree !== null))) {
            stopIfRefused(own)
            const byVersion = store.capabilities.conditionalWrites && read.version !== null
            confirmed.push({ key, version: read.version, content: byVersion ? null : { length: read.bytes.length, crc: crc32(read.bytes) } })
            continue
        }
        if (tree === null) {
            throw new CleanupStop(language.errors.coldStorageCleanupCopyUnreadable(name))
        }
        await keep.addTree(tree, name, true)
    }
    return confirmed
}

/**
 * Deletes what the user confirmed, once the keep set is complete and every
 * check of the run has passed: kept generations, leftover generations, then
 * older copies. Each generation delete re-reads the head first (root first,
 * marker last), and each copy delete re-checks the file. Returns how many saved
 * copies it deleted. A refusal that arose since the last confirm, or any delete
 * that fails or is refused, stops before the first unit or asset delete.
 */
async function deleteConfirmed(own: BusyHandle, store: ByteStore, live: string, confirmed: ConfirmedDeletes): Promise<number> {
    if (confirmed.keptGenerations.length + confirmed.leftoverGenerations.length + confirmed.copies.length === 0) {
        return 0
    }
    stopIfRefused(own)
    let deleted = 0
    for (const generation of confirmed.keptGenerations) {
        await deleteKeptGeneration(store, generation, live, deleted)
        deleted++
    }
    for (const generation of confirmed.leftoverGenerations) {
        await requireGenerationNotLive(store, generation, live, deleted)
        if (await retireGeneration(store, generation, live) === 'failed') {
            throw new CleanupStop(language.errors.coldStorageCleanupDeleteFailed)
        }
        deleted++
    }
    for (const copy of confirmed.copies) {
        await deleteOlderCopy(store, copy)
        deleted++
    }
    return deleted
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

/** own is this run's own registry entry, which is not a reason to refuse. */
function currentRefusal(own?: BusyHandle): Refusal | null {
    if (get(frozenSaveKeysStore).length > 0) {
        const groups = frozenGroups()
        return {
            atStart: language.errors.coldStorageBlockedByDuplicateChaId(groups),
            partway: language.errors.coldStorageCleanupStoppedFrozen(groups),
        }
    }
    if (isWorkInProgress() || isBusy({ except: own })) {
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
    own: BusyHandle,
    candidates: string[],
    decide: (batch: string[]) => string[],
    removeBatch: (keys: string[], done: number, total: number) => Promise<number>,
): Promise<DeleteOutcome> {
    let deleted = 0
    let failed = 0
    for (let start = 0; start < candidates.length; start += DELETE_BATCH_SIZE) {
        const refusal = currentRefusal(own)
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
 * Deletes the units named by `keys` and returns how many it could not delete,
 * counted per key. A key that cannot be a storage name (`isSafeColdStorageKey`)
 * is counted as not deleted and never reaches a backend: no unit can be stored
 * under it, so a delete could only name some other path. On a Node server the
 * keys go in groups of `ASSET_DELETE_GROUP_SIZE`, one request each; elsewhere
 * each unit is its own call, so the progress moves with every removal. A call
 * that fails is counted and the next one is still attempted.
 */
export async function removeUnitBatch(keys: string[], done: number, total: number): Promise<number> {
    const removable = keys.filter((key) => isSafeColdStorageKey(key))
    let failed = keys.length - removable.length
    const groupSize = isNodeServer ? ASSET_DELETE_GROUP_SIZE : 1
    for (let start = 0; start < removable.length; start += groupSize) {
        const group = removable.slice(start, start + groupSize)
        showRemoving(done + start + group.length, total)
        const notDeleted = await deleteColdStorageUnits(group)
        if (notDeleted.length > 0) {
            console.error('Cold storage cleanup: could not delete a unit:', notDeleted[0].error)
        }
        failed += notDeleted.length
    }
    return failed
}

/**
 * Deletes the asset keys through the page's byte store and returns how many it
 * could not delete, counted per key. The keys go in groups of
 * `ASSET_DELETE_GROUP_SIZE`, each its own `deleteMany` call. The Node store
 * stops at the first failed request of a call and leaves the rest unattempted,
 * so a group must fit in one request (twenty keys of the longest name the
 * server accepts stay well under its request budget): a failed group is then
 * counted and the next group is still attempted.
 */
async function removeAssetBatch(keys: string[], done: number, total: number): Promise<number> {
    const store = await getAppStore()
    let failed = 0
    for (let start = 0; start < keys.length; start += ASSET_DELETE_GROUP_SIZE) {
        const group = keys.slice(start, start + ASSET_DELETE_GROUP_SIZE)
        showRemoving(done + start + group.length, total)
        try {
            await store.deleteMany(group.map((key) => ({ key, condition: 'unconditional' as const })))
        } catch (error) {
            if (error instanceof StoreDeleteManyError) {
                const notRemoved = error.report.filter((entry) => entry.outcome !== 'removed')
                console.error('Cold storage cleanup: could not delete an asset:', notRemoved[0]?.error ?? error)
                failed += notRemoved.length
            } else {
                console.error('Cold storage cleanup: could not delete assets:', error)
                failed += group.length
            }
        }
    }
    return failed
}

/**
 * The form an asset name is compared in. The desktop file systems (Windows, and
 * macOS by default) treat names that differ only in case as one file, so a
 * file is the referenced one whatever the case of the reference; elsewhere the
 * names are exact.
 */
function assetCompareName(name: string): string {
    return isTauri ? name.toLowerCase() : name
}

/** On the desktop only a file directly under `assets/` is a candidate; a nested key is never swept. */
function isAssetCandidateKey(key: string): boolean {
    return !isTauri || !key.slice(ASSET_KEY_PREFIX.length).includes('/')
}

/** Unit keys that live memory refers to right now. */
function liveUnitReferences(): Set<string> {
    return new Set([...listColdDataKeysFromDb(DBState.db), ...listRecoverableErrorKeysFromDb(DBState.db)])
}

//#endregion

async function cleanExclusively(own: BusyHandle): Promise<void> {
    const refusal = currentRefusal(own)
    if (refusal) {
        throw new CleanupStop(refusal.atStart)
    }
    const loadListing = getLoadTimeListing()
    if (!loadListing) {
        throw new CleanupStop(language.errors.coldStorageCleanupNoListing)
    }

    alertWait(language.coldStorageCleanupReading)
    const keep = new KeepSet()
    const store = await getAppStore()
    const owner = await blockProfileOwner(store)
    const confirmed: ConfirmedDeletes = { keptGenerations: [], leftoverGenerations: [], copies: [] }
    let liveGeneration = ''
    if (owner === null) {
        // The main file first: a main file that moved refuses the run before any
        // blob is read.
        await keepFromMainFile(keep)
    } else {
        // The committed save first, for the same reason. Then the generations
        // and older copies a block profile may hold: the user decides about
        // each before the run builds on it, and nothing they confirm is deleted
        // until every check below has passed.
        const state = await keepFromCommittedBlocks(keep, store, owner)
        liveGeneration = state.generation
        Object.assign(confirmed, await askAboutOtherGenerations(own, owner))
        confirmed.copies = await keepFromOlderCopies(keep, store, state, own)
        alertWait(language.coldStorageCleanupReading)
    }
    // The assets live memory references are read again before every batch
    // instead of being recorded here.
    await keep.addTree(DBState.db, language.errors.coldStorageCleanupSourceLive, false)
    for (const name of await listSnapshotNames()) {
        await keepFromSnapshot(keep, name)
    }
    // After every tree, so each blob is known, and before the start listing, so
    // that no read of an archived chat happens once a deletion is possible.
    await keep.followArchivedChats()

    // Taken after the keep-set is built, so it names what exists now. The
    // load-time listing still bounds what may go: anything written since
    // this page loaded is in neither the candidates nor the deletions.
    const startListing = await takeStorageListing()
    // Only what the recorded keep-set does not already keep is a candidate, so
    // the progress counts deletions and a batch's live check only has to look
    // at keys that could go.
    const unitCandidates = [...loadListing.units].filter((key) => startListing.units.has(key) && !keep.units.has(key))
    const keptAssetNames = new Set(Array.from(keep.assets, assetCompareName))
    const assetCandidates = [...loadListing.assets].filter((key) => startListing.assets.has(key) && isAssetCandidateKey(key) && !keptAssetNames.has(assetCompareName(getBasename(key))))

    // Every stop check has passed. The saved copies the user confirmed go
    // first; a failure or refusal there ends the run before any unit or asset
    // is touched.
    let deleted = owner === null ? 0 : await deleteConfirmed(own, store, liveGeneration, confirmed)

    const units = await deleteInBatches(
        own,
        unitCandidates,
        (batch) => {
            const live = liveUnitReferences()
            return batch.filter((key) => !live.has(key))
        },
        removeUnitBatch,
    )
    deleted += units.deleted
    let failed = units.failed
    let stoppedBecause = units.stoppedBecause
    if (!stoppedBecause) {
        const assets = await deleteInBatches(
            own,
            assetCandidates,
            (batch) => {
                const live = new Set(Array.from(getUncleanablesSync(DBState.db), assetCompareName))
                return batch.filter((key) => !live.has(assetCompareName(getBasename(key))))
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
 * Runs the clean-up. The platform confirms (no Web Locks, a Node server) come
 * first, before any lock is taken, so a waiting prompt never parks this tab's
 * saves. The exclusive storage lock is then held for the whole run where the
 * browser has one, and a block profile's confirms about its kept generations,
 * leftover generations and older main-file copies are shown inside it: while
 * one is open this tab's saves wait.
 * `locksSupported` only tests for `undefined`, so a falsy `navigator.locks`
 * is checked as well: it cannot hold a lock, so it counts as no Web Locks.
 */
export async function runManualCleanup(): Promise<void> {
    // A page that runs from OPFS this time writes nothing: the clean-up is refused before it reads or deletes anything.
    if (await refuseOnReadOnlyPage()) {
        return
    }
    const refusal = currentRefusal()
    if (refusal) {
        alertError(refusal.atStart)
        return
    }
    if (!getLoadTimeListing()) {
        alertError(language.errors.coldStorageCleanupNoListing)
        return
    }
    const own = beginBusy('cleanup')
    try {
        await runRegisteredCleanup(own)
    } finally {
        own.end()
    }
}

async function runRegisteredCleanup(own: BusyHandle): Promise<void> {
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
        await cleanExclusively(own)
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
