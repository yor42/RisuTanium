import { alertConfirm, alertError, alertNormalWait, alertStore, alertWait, waitAlert } from '../alert'
import { getSaveMarkCount, isSaveClean } from '../globalApi.svelte'
import { language } from 'src/lang'
import { getDatabase, type Database } from '../storage/database.svelte'
import { describeOmitted } from './describeOmitted'
import { decodeRisuSave, isBlockFormatSave, salvageRisuSave, type SalvageOmittedBlock } from '../storage/risuSave'
import { Store2BackendError, Store2StalePageError } from '../storage/store2/backend/errors'
import type { Store2Backend, Store2Read } from '../storage/store2/backend/types'
import { getStore2BootSession } from '../storage/store2/bootActive'
import { Store2BulkAbortError, type AbandonResult, type Committer, type StreamContext, type StreamedCommitRequest } from '../storage/store2/commit'
import { clearAbandonedMarker } from '../storage/store2/abandonedMarker'
import { classifyCommitRead } from '../storage/store2/commitKey'
import { keyOfRef, readUnit, UNIT_TYPE, type Manifest, type Ref, type WorkspaceRecord } from '../storage/store2/format'
import type { Staging } from '../storage/store2/owner'
import { createListDerivation } from '../storage/store2/lists'
import type { BaseContentIndex } from '../storage/store2/baseContent'
import { importLegacyTree, indexOfCommitKey, type ImportHooks, type ImportOutcome, type ImportSource, type PrepareStop, type RepairSummary } from '../storage/store2/legacy/importTree'
import type { StreamPrepared, StreamSource } from '../storage/store2/legacy/importStream'
import { LegacyReadError, type IncompleteItem, type LegacyEntryReader } from '../storage/store2/legacy/resolve'
import { BinFileChangedError, ColdEntryIndex, createBinEntryReader } from '../storage/store2/legacy/binReader'
import { createLegacyStoreReader, type ColdUnitRead } from '../storage/store2/legacy/storeReader'
import type { BootImportEnd, BootImportResult, BootImportTarget } from '../storage/store2/legacy/bootImport'
import { getActiveStore2Save } from '../storage/store2/saveActive'
import { incompleteList } from '../storage/store2/ui/bootText'
import { readColdStorageItem } from '../process/coldstorage.svelte'
import { importableTaskPresets } from '../process/utility/taskPreset'
import { isJsonObject, toPlainJson } from '../storage/store2/codec/normalize'
import type { JsonObject, JsonValue } from '../storage/blockFrame'
import { usageCarryOf } from '../usage/usageLedger'
import { noteMeasurePhase } from './importPhaseRing'
import { yieldToEventLoop } from '../storage/saveYield'
import { estimateImportSeconds, IMPORT_TIME_WARNING_BYTES, importAssetBytes, importFreeGigabytesText, importFreeSpaceBytes, importGigabytesText, importSpaceVerdict, roundImportMinutes } from './importEstimate'
import { transportKind } from '../storage/tauriByteTransport'
import { readAppDataFreeBytes } from '../storage/appFreeSpace'
import type { BusyHandle } from '../process/memory/busyActions'
import { parseBackupEntryHeader, BACKUP_ENCRYPTION_MARKER_NAME, BACKUP_INDEX_SHORT_NAME_BYTES, type BackupIndexEntry, type BinFile } from './backupContainer'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { currentCharacterNames, leftOutQuestion } from './restoreReplace'

/**
 * The Settings imports of a store2 page: a `.bin` backup file and an old numbered backup (`database/dbbackup-<n>.bin`)
 * both become the page's profile through `importLegacyTree`. This module is the page side of that library core:
 * preconditions, the database entry's decode and its confirmations, the commit with its outcomes, and the landing.
 * Nothing here knows how the shell around it holds the tab lock or reloads; the shells (`LoadLocalBackup`,
 * `loadStoreRestorePoint`) own that and pass it in.
 *
 * Invariants:
 *  - Every refusal that can be known without writing (page mode, backend, committer, a bulk marker of another page,
 *    a database entry that is missing, too big to be accepted, damaged beyond salvage, or partly left out and declined)
 *    is decided before the first asset or unit is written.
 *  - A cold-storage entry of a `.bin` is never written: the entries are indexed and read on demand from the file.
 *  - The commit is the last write. After it, or after any outcome that cannot tell whether it landed, the shell keeps
 *    `dbWriteLock` closed for the life of the page: a save from the pre-import state must never follow it.
 */

/**
 * Saved data above this many bytes is announced before it is decoded: the decode needs several times its size. For a
 * `.bin` import the bytes are the database entry plus the estimated unit entries; for a numbered backup restore they
 * are the database bytes.
 */
export const IMPORT_SIZE_WARNING_BYTES = 16 * 1024 * 1024

/**
 * The share of the estimated unit-entry bytes that counts toward the size shown for a `.bin` import. Unit entries are
 * uncompressed JSON while the database entry is compressed, so a quarter brings a stub-form file's figure close to the
 * same content stored inline. Only the memory-size figure uses it; the commit-tail time estimate keeps full weight.
 */
export const UNIT_SIZE_WEIGHT = 0.25

/** The saved-data size of a `.bin` import: the database entry plus the weighted unit-entry bytes. */
export function importSavedDataSizeBytes(databaseBytes: number, unitBytes: number): number {
    return databaseBytes + unitBytes * UNIT_SIZE_WEIGHT
}

const DATABASE_ENTRY_NAME = 'database.risudat'

/** An entry name longer than this can be neither the database nor a cold-storage unit, so the scan skips it; the walk keeps exactly the names up to this length. */
const SCAN_NAME_MAX_BYTES = BACKUP_INDEX_SHORT_NAME_BYTES

export interface Store2ImportTarget {
    committer: Committer
    backend: Store2Backend
}

/**
 * Why an import ended without replacing the profile. Each name states only a fact its site has proven; the check and
 * the commit may reach the same name (`too-new`) only when both prove it. Several causes share a message. A refusal
 * never says whether a write began: that is the shell's to decide.
 * `foreign-marker` is the check's proof that the standing marker belongs to another page; `marker-standing` is the
 * commit's report that a marker stood and could not be cleared, whoever owns it.
 */
export type Store2ImportRefusal =
    | 'no-writable-session'
    | 'commit-read-failed'
    | 'too-new'
    | 'commit-key-unusable'
    | 'no-current-manifest'
    | 'foreign-marker'
    | 'marker-standing'
    | 'decode-failed'
    | 'busy'
    | 'declined'
    | 'read-failed'
    | 'archived-id'
    | 'unsavable'
    | 'base-unreadable'
    | 'stale-page'
    | 'write-failed'
    | 'abandoned'
    | 'library-refused'

/** The precondition check of a page import: the target to import into, or the refusal that has shown its message. */
export type Store2ImportCheck =
    | { kind: 'ready', target: Store2ImportTarget }
    | { kind: 'refused', cause: Store2ImportRefusal }

/** The copy loop notes a phase once per this many entries visited. */
export const IMPORT_COPY_PHASE_EVERY = 5000

/**
 * Measurement builds only (`MEASURE`), and only when `localStorage` says `on` under `risu-measure-import`: logs the
 * phase, the time since the page started and, where the engine reports it, the JS heap in use, and records the same in
 * the `__risuImportPhases` ring (importPhaseRing.ts), the only output on a built page. A normal build folds the
 * condition away and logs and records nothing; the hook decides nothing.
 */
export function noteImportPhase(phase: string): void {
    noteMeasurePhase(phase)
}

/** The question a person answers about a bulk marker of another operation: Wait leaves it, Clear consents to clearing exactly that marker. */
export type ForeignMarkerQuestion = (marker: Staging) => Promise<'wait' | 'clear'>

/** The real question, loaded when first asked: the peer UI's module graph is not needed by a page that never meets a foreign marker. */
export const askForeignMarker: ForeignMarkerQuestion = async (marker) => (await import('../storage/store2/ui/peerUi')).askForeignMarkerQuestion(marker)

/** Only these markers can be left by an import, a restore or a bulk save that a person can judge; the others belong to a boot step. */
function askableMarker(marker: Staging): boolean {
    return marker.label === 'import' || marker.label === 'restore' || marker.label === 'bulk'
}

/**
 * Asks about the standing foreign `marker` and, on Clear, clears exactly that marker: the clear is `abandonClear`,
 * which re-judges on a fresh read and refuses any other owner or prefix, so a marker that replaced the asked one in
 * the meantime stays. `cleared` and `nothing` (the marker had already gone) are the marker being gone; `waited` is the
 * person's answer, and `kept` is a Clear that left the marker standing (refused, failed or unknown) or a marker that
 * is not asked about at all (`convert`, `seed`, `recovery`).
 */
export async function askToClearForeignMarker(
    committer: Pick<Committer, 'owner' | 'abandonClear'>,
    read: Store2Read,
    marker: Staging,
    ask: ForeignMarkerQuestion,
): Promise<'cleared' | 'nothing' | 'waited' | 'kept'> {
    if (!askableMarker(marker)) {
        return 'kept'
    }
    if (await ask(marker) !== 'clear') {
        return 'waited'
    }
    const outcome = await clearAbandonedMarker(committer, read, async (standing) =>
        standing.owner === marker.owner && standing.prefix === marker.prefix ? 'gone' : 'unknown')
    const status = outcome.result?.status
    return status === 'cleared' || status === 'nothing' ? status : 'kept'
}

/**
 * The page's committer and backend, with every precondition knowable up front checked: a store2 session that can
 * write, a readable commit key that names a current manifest, and no bulk marker of another page standing. A marker of
 * this page load is not a refusal: the commit clears it the way the save loop does. A refusal has shown its message,
 * except after Wait, where the question was the message. On a Node page a foreign import, restore or bulk marker is
 * put to the person (`options.ask`) because no probe can prove its owner gone.
 */
export async function checkStore2Import(options: { ask?: ForeignMarkerQuestion } = {}): Promise<Store2ImportCheck> {
    const session = getStore2BootSession()
    const committer = session === null ? null : session.committer
    const backend = session === null ? null : session.backend
    if (committer === null || backend === null) {
        alertError(language.store2Boot.readOnlyRefusal)
        return { kind: 'refused', cause: 'no-writable-session' }
    }
    let read: Store2Read
    try {
        read = await committer.readCommit()
    } catch (error) {
        console.error(error)
        alertError(language.store2ImportReadFailed)
        return { kind: 'refused', cause: 'commit-read-failed' }
    }
    const classified = classifyCommitRead(read)
    switch (classified.status) {
        case 'too-new':
            alertError(language.store2ImportTooNew)
            return { kind: 'refused', cause: 'too-new' }
        case 'absent':
        case 'damaged':
            alertError(language.store2ImportRefused)
            return { kind: 'refused', cause: 'commit-key-unusable' }
        case 'parsed':
            if (classified.value.current === null) {
                alertError(language.store2ImportRefused)
                return { kind: 'refused', cause: 'no-current-manifest' }
            }
            if (classified.value.staging !== null && classified.value.staging.owner !== committer.owner) {
                // A marker whose owner the probe proves gone is cleared here; any other answer keeps the refusal.
                const outcome = await clearAbandonedMarker(committer, read, getActiveStore2Save()?.markerOwnerProbe ?? null)
                const status = outcome.result?.status
                if (status !== 'cleared' && status !== 'nothing') {
                    // A Node page can prove nothing about a peer, so the person is asked about an import, restore or bulk marker.
                    if (session !== null && session.kind === 'node') {
                        const answer = await askToClearForeignMarker(committer, read, classified.value.staging, options.ask ?? askForeignMarker)
                        if (answer === 'cleared' || answer === 'nothing') {
                            return { kind: 'ready', target: { committer, backend } }
                        }
                        if (answer === 'waited') {
                            // The question replaced the refusal text.
                            return { kind: 'refused', cause: 'foreign-marker' }
                        }
                    }
                    alertError(language.store2RestoreBulkMarker)
                    return { kind: 'refused', cause: 'foreign-marker' }
                }
            }
            return { kind: 'ready', target: { committer, backend } }
    }
}

/** A turn of the event loop: whatever a finished save still has to do after it released the write lock has been done. */
function nextTurn(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Whether this tab's edits are all saved, asked while the loop cannot commit. The one confirmation is asked when edits
 * are left, and not again unless the tab was marked dirty once more since the person accepted it: an edit made while
 * a long copy ran is a new loss, the same edit is not.
 */
export class UnsavedGuard {
    private acceptedAt: number | null = null

    async check(): Promise<boolean> {
        await nextTurn()
        if (isSaveClean()) {
            return true
        }
        if (this.acceptedAt !== null && getSaveMarkCount() === this.acceptedAt) {
            return true
        }
        if (!await alertConfirm(language.store2RestoreUnsavedConfirm)) {
            return false
        }
        this.acceptedAt = getSaveMarkCount()
        return true
    }
}

// ---- the .bin file ----

/** The text for a file that is not what the walk indexed: the encryption marker stops the import, anything else is a changed file. */
export function binChangeText(error: BinFileChangedError): string {
    return error.reason === 'marker' ? language.encryptedBackupImportStopped : language.backupFileChangedWhileReading
}

async function readIndexedHeader(file: BinFile, entry: BackupIndexEntry, where: string): Promise<{ name: string }> {
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await file.slice(entry.headerOffset, entry.headerOffset + entry.headerLength).arrayBuffer())
    } catch (error) {
        throw new BinFileChangedError('unreadable', where, { cause: error })
    }
    if (bytes.length !== entry.headerLength) {
        throw new BinFileChangedError('length', where)
    }
    const parsed = parseBackupEntryHeader(bytes)
    if (parsed.status !== 'ok' || parsed.header.name === undefined) {
        throw new BinFileChangedError('header', where)
    }
    const header = parsed.header
    if (header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
        throw new BinFileChangedError('marker', header.name)
    }
    if (header.nameLength !== entry.nameLength || header.dataLength !== entry.dataLength || header.headerLength !== entry.headerLength) {
        throw new BinFileChangedError('header', header.name)
    }
    if (header.name !== where) {
        throw new BinFileChangedError('header', header.name)
    }
    return { name: header.name }
}

/** Where a `.bin`'s database entry sits, and the index of its cold-storage entries. */
export interface BinScan {
    index: ColdEntryIndex
    /** The last entry named `database.risudat`, as the copy loop's overwrite would have kept; null when there is none. */
    database: BackupIndexEntry | null
}

/**
 * The entries that can name the database or a cold-storage unit, picked from the walk's index and the names it kept.
 * The copy loop skips both on a store2 page, so this is what lets the database be decoded before the first asset is
 * written. It reads no file: the copy pass checks every header again before it writes anything of it.
 */
export function scanBinForImport(entries: readonly BackupIndexEntry[], names: ReadonlyMap<number, string>): BinScan {
    const index = new ColdEntryIndex()
    let database: BackupIndexEntry | null = null
    for (const entry of entries) {
        if (entry.nameLength > SCAN_NAME_MAX_BYTES) {
            continue
        }
        const name = names.get(entry.headerOffset)
        if (name === undefined) {
            throw new Error(`The walk kept no name for the entry at ${entry.headerOffset}.`)
        }
        if (name === DATABASE_ENTRY_NAME) {
            database = entry
        } else {
            index.note(entry, name)
        }
    }
    return { index, database }
}

/**
 * Whether any complete entry is named `database.risudat`. Presence only: it never throws, and an entry the walk kept
 * no name for is skipped, so a refusal check can run on any walk result.
 */
export function hasDatabaseEntry(entries: readonly BackupIndexEntry[], names: ReadonlyMap<number, string>): boolean {
    for (const entry of entries) {
        if (entry.nameLength <= SCAN_NAME_MAX_BYTES && names.get(entry.headerOffset) === DATABASE_ENTRY_NAME) {
            return true
        }
    }
    return false
}

/** The database entry's bytes, with its header checked again against the walk. Throws `BinFileChangedError`. */
export async function readBinDatabase(file: BinFile, entry: BackupIndexEntry): Promise<Uint8Array> {
    await readIndexedHeader(file, entry, DATABASE_ENTRY_NAME)
    const start = entry.headerOffset + entry.headerLength
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await file.slice(start, start + entry.dataLength).arrayBuffer())
    } catch (error) {
        throw new BinFileChangedError('unreadable', DATABASE_ENTRY_NAME, { cause: error })
    }
    if (bytes.length !== entry.dataLength) {
        throw new BinFileChangedError('length', DATABASE_ENTRY_NAME)
    }
    return bytes
}

/** The cold-storage units of a `.bin`: the file's own entries first, the page's legacy unit for an id the file holds no accepted entry for. */
export function createBinImportReader(file: BinFile, index: ColdEntryIndex, readFallback: (key: string) => Promise<ColdUnitRead> = readColdStorageItem): LegacyEntryReader {
    return createBinEntryReader({ file, index, fallback: createLegacyStoreReader(readFallback) })
}

// ---- decode and its confirmations ----

/** A decoded database and the blocks of the file that were left out of it. */
export interface DecodedBackup {
    tree: Database
    omitted: ReadonlyMap<string, SalvageOmittedBlock>
}

function isDatabaseObject(value: unknown): value is Database {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A `.bin`'s database entry, decoded as `LoadLocalBackup` has always decoded it: a block-format save through
 * `salvageRisuSave`, which reads nothing from the current profile and reports what it left out, an older format whole.
 */
export async function decodeBinDatabase(bytes: Uint8Array): Promise<DecodedBackup> {
    if (isBlockFormatSave(bytes)) {
        const salvaged = await salvageRisuSave(bytes)
        return { tree: salvaged.db, omitted: salvaged.omitted }
    }
    return { tree: await decodeRisuSave(bytes), omitted: new Map() }
}

/**
 * What `decodeBinDatabase` left out, and nothing else: the decoded tree is never handed to the caller, so a long
 * async function that only needs the salvage map does not keep the tree reachable across its later awaits.
 */
export function decodeBinDatabaseOmitted(bytes: Uint8Array): Promise<ReadonlyMap<string, SalvageOmittedBlock>> {
    return decodeBinDatabase(bytes).then((decoded) => decoded.omitted)
}

/**
 * The database entry read from the file again and decoded; only the tree outlives the call (in the raw msgpack format its
 * binary values are views of the read bytes). `confirmed` is what the earlier decode left out and the person agreed to: a
 * block this decode leaves out that is not in it was never asked about, so the file counts as changed. Throws
 * `BinFileChangedError`.
 */
export async function readBinDatabaseTree(file: BinFile, entry: BackupIndexEntry, confirmed: ReadonlyMap<string, SalvageOmittedBlock>): Promise<Database> {
    const decoded = await decodeBinDatabase(await readBinDatabase(file, entry))
    for (const name of decoded.omitted.keys()) {
        if (!confirmed.has(name)) {
            throw new BinFileChangedError('omitted', DATABASE_ENTRY_NAME)
        }
    }
    return decoded.tree
}

/**
 * What the database entry read from the file leaves out, and nothing else. The entry is streamed in bounded chunks and
 * each character is dropped as it decodes, so neither the whole entry nor the tree is ever held; an entry the stream
 * declines (`streamBinDatabase`) is read and decoded whole, as it always was. `yieldToMain` defaults to the event-loop
 * yield, awaited per chunk and per character. Throws `BinFileChangedError`.
 */
export async function readBinDatabaseOmitted(
    file: BinFile, entry: BackupIndexEntry, options: { yieldToMain?: () => Promise<void> } = {},
): Promise<ReadonlyMap<string, SalvageOmittedBlock>> {
    const { streamBinDatabase } = await import('./binDatabaseStream')
    const seen: { omitted: ReadonlyMap<string, SalvageOmittedBlock> | null } = { omitted: null }
    const done = await streamBinDatabase(file, entry, {
        character() { },
        root() { },
        omitted(omitted) {
            seen.omitted = omitted
        },
    }, { yieldToMain: options.yieldToMain ?? yieldToEventLoop })
    if ('status' in done || seen.omitted === null) {
        return await decodeBinDatabaseOmitted(await readBinDatabase(file, entry))
    }
    return seen.omitted
}

/**
 * An old numbered backup: decoded strictly first, and only when that fails by `salvageRisuSave`, which still refuses a
 * file whose framing or root is damaged. Throws when the bytes hold no database.
 */
export async function decodeNumberedBackup(bytes: Uint8Array): Promise<DecodedBackup> {
    try {
        const decoded = await decodeRisuSave(bytes, { strict: true })
        if (isDatabaseObject(decoded)) {
            return { tree: decoded, omitted: new Map() }
        }
    } catch (strictError) {
        console.error(strictError)
    }
    const { db, omitted } = await salvageRisuSave(bytes)
    if (!isDatabaseObject(db)) {
        throw new Error('The backup does not hold a database.')
    }
    return { tree: db, omitted }
}

/**
 * Announces a large amount of saved data before it is decoded: for a `.bin` import the database entry plus the
 * estimated unit entries, for a numbered backup restore the database bytes. `copiesFiles` says the path copies the
 * backup's files into the store before its commit, as a `.bin` import does and a numbered backup restore does not.
 * False when the person declines.
 */
export async function confirmDatabaseSize(byteLength: number, copiesFiles: boolean, threshold: number = IMPORT_SIZE_WARNING_BYTES): Promise<boolean> {
    if (byteLength <= threshold) {
        return true
    }
    return await alertConfirm(language.store2ImportSizeWarning(Math.ceil(byteLength / 1_000_000), copiesFiles))
}

/**
 * The one question before an import writes anything, asked once the file is walked and its database entry located. A
 * store2 page on an Android phone with more than `IMPORT_TIME_WARNING_BYTES` of assets gets the time and space notice,
 * which carries the saved-data size sentence when the saved data is over the size threshold too (one prompt, not two).
 * On Android the free bytes under the app data directory are read once (`readAppDataFreeBytes`) and compared with the
 * import's need: the notice says how much is free, or that it is short and the import stops if the phone runs out. At or
 * below the threshold a short phone gets one space prompt (carrying the size sentence when due, not a second prompt); a
 * failed read, or enough space, changes nothing there, and the notice then keeps its "cannot check" sentence. Nothing
 * is refused for size: the person decides.
 * The saved data is the database entry plus `unitBytes`, the estimated bytes of the unit entries the resolve reads:
 * a stub-form file keeps most of its characters and chats there. The size sentence, its trigger and the notice's
 * database sentence key on `importSavedDataSizeBytes` (units weighted by `UNIT_SIZE_WEIGHT`, the memory-size figure);
 * the long commit tail keys on the full-weight sum, because resolving the units takes time for their whole length. The
 * asset bytes (copy time, free space, the notice threshold) are the file less the database entry, so they still
 * include the units, which are re-encoded into the page's store.
 * Everything else keeps `confirmDatabaseSize` and its text. The notice belongs to store2 pages only: the block and
 * legacy page modes are fork-local transitional storage modes with no commit tail to estimate, and keep their prompts
 * (block-mode helpers are removed in stage 8). False when the person declines; nothing has been written.
 */
export async function confirmImportScale(fileSize: number, entries: number, databaseBytes: number, unitBytes: number): Promise<boolean> {
    const assetBytes = importAssetBytes(fileSize, databaseBytes)
    const savedDataBytes = importSavedDataSizeBytes(databaseBytes, unitBytes)
    if (transportKind() !== 'android') {
        return await confirmDatabaseSize(savedDataBytes, true)
    }
    const neededBytes = importFreeSpaceBytes(assetBytes)
    const freeBytes = await readAppDataFreeBytes()
    const verdict = importSpaceVerdict(freeBytes, neededBytes)
    const freeGigabytes = freeBytes === null ? null : importFreeGigabytesText(freeBytes)
    const databaseMegabytes = savedDataBytes > IMPORT_SIZE_WARNING_BYTES ? Math.ceil(savedDataBytes / 1_000_000) : null
    if (assetBytes <= IMPORT_TIME_WARNING_BYTES) {
        if (verdict !== 'short' || freeGigabytes === null) {
            return await confirmDatabaseSize(savedDataBytes, true)
        }
        return await alertConfirm(language.store2ImportSpaceWarning(importGigabytesText(neededBytes), freeGigabytes, databaseMegabytes))
    }
    const minutes = roundImportMinutes(estimateImportSeconds(entries, assetBytes, databaseBytes + unitBytes))
    return await alertConfirm(language.store2ImportTimeWarning(entries, minutes, importGigabytesText(neededBytes), databaseMegabytes, freeGigabytes, verdict === 'short'))
}

/** The MC-183 question: names every block the file lacks. Nothing to ask when none was left out; false when the person declines. */
export async function confirmLeftOut(omitted: ReadonlyMap<string, SalvageOmittedBlock>): Promise<boolean> {
    const lines = describeOmitted(omitted, currentCharacterNames())
    return lines.length === 0 || await alertConfirm(leftOutQuestion(lines))
}

// ---- the commit and its outcomes ----

/** What the import came to for the shell around it. Every message of a refusal or an unconfirmed outcome has been shown. */
export type Store2ImportEnd =
    /** The import is the page's profile. `flushed === false` is a Tauri write the device did not confirm; the page reloads either way. */
    | { kind: 'landed', flushed: boolean | undefined, repairNotice: string | null, repair: RepairSummary, incomplete: readonly IncompleteItem[] }
    /** Nothing changed. */
    | { kind: 'refused', cause: Store2ImportRefusal }
    /** The import may or may not have landed: the write lock stays closed and the person is told to reload. */
    | { kind: 'unconfirmed' }

export interface Store2ImportRequest {
    target: Store2ImportTarget
    busy: BusyHandle
    /**
     * A fresh decoded tree on each call: the import consumes its tree, and a retry needs another. Each call reads the
     * database entry from the file again and may throw `BinFileChangedError`.
     */
    decode(): Promise<Database>
    reader: LegacyEntryReader
    /**
     * Where the database entry sits in the file. With it, a file that plans more units than one ordinary commit takes is
     * read in bounded chunks and uploaded as it is read (importStream.ts); every other file is imported through `decode`
     * as it always was, so `decode` stays required.
     */
    stream?: StreamSource
    /** Awaited per chunk and per character of a streamed import; defaults to the event-loop yield. Tests inject it. */
    yieldToMain?: () => Promise<void>
}

/** The busy check at the flip refused: nothing was written. */
class ImportBusyError extends Error {
    constructor() {
        super('Work started while the import was being prepared.')
        this.name = 'ImportBusyError'
    }
}

function isBusyAbort(error: unknown): boolean {
    return error instanceof ImportBusyError || (error instanceof Store2BulkAbortError && error.original instanceof ImportBusyError)
}

/**
 * The committer whose commits ask the busy guard once more at the flip: in the build, which runs after the last read and
 * before the first unit upload (after the marker of a bulk commit, which a refusal clears).
 */
function guardedAtFlip(committer: Committer, busy: BusyHandle): Committer {
    const streamed = committer.commitStreamed
    return {
        ...committer,
        commit: (read, request) => committer.commit(read, {
            ...request,
            build: (context) => {
                if (refuseBackupLoadWhileBusy(busy)) {
                    throw new ImportBusyError()
                }
                return request.build(context)
            },
        }),
        ...(streamed === undefined ? {} : {
            commitStreamed: (read: Store2Read, request: StreamedCommitRequest) => streamed.call(committer, read, {
                ...request,
                build: (context: StreamContext) => {
                    if (refuseBackupLoadWhileBusy(busy)) {
                        throw new ImportBusyError()
                    }
                    return request.build(context)
                },
            }),
        }),
    }
}

function incompleteLines(items: Parameters<typeof incompleteList>[0]): string {
    return incompleteList(items).items.map((line) => `- ${line}`).join('\n')
}

/** Clears the bulk marker on `read` when this page load set it, as the save loop does; a foreign marker stands. */
async function clearOwnMarker(committer: Committer): Promise<boolean> {
    try {
        const read = await committer.readCommit()
        const classified = classifyCommitRead(read)
        const staging = classified.status === 'parsed' ? classified.value.staging : null
        if (staging === null || staging.owner !== committer.owner) {
            return false
        }
        const cleared = await committer.abandonClear(read, staging.owner, staging.prefix)
        return cleared.status === 'cleared' || cleared.status === 'nothing'
    } catch (error) {
        console.error(error)
        return false
    }
}

/**
 * How a build that threw ends the page import. A streamed build that read a file which is no longer what the first pass
 * read (`BinFileChangedError`, or a `LegacyReadError` caused by one) aborted under the marker; when that marker is
 * cleared (or was never left) nothing changed and the person is told the file changed, or that a unit could not be read.
 * Every other throw, and a marker that could not be cleared, leaves the outcome unknown.
 */
function endOfAbortedBuild(error: unknown): Store2ImportEnd {
    if (error instanceof Store2BulkAbortError && (error.cleared?.status === 'cleared' || error.cleared?.status === 'nothing')) {
        const original = error.original
        if (original instanceof BinFileChangedError) {
            return refused('read-failed', binChangeText(original))
        }
        if (original instanceof LegacyReadError) {
            return refused('read-failed', original.cause instanceof BinFileChangedError ? binChangeText(original.cause) : language.store2ImportReadFailed)
        }
    }
    return unconfirmed()
}

function unconfirmed(): Store2ImportEnd {
    alertStore.set({ type: 'wait', msg: language.store2ImportUnconfirmed })
    return { kind: 'unconfirmed' }
}

function refused(cause: Store2ImportRefusal, message: string | null): Store2ImportEnd {
    if (message !== null) {
        alertError(message)
    }
    return { kind: 'refused', cause }
}

/**
 * The attempts of one import: the first, and one rebuild after a conflict, after clearing this page's own stale marker, or
 * after the commit key stopped naming the manifest the base content index was read from (`base-unnamed`).
 */
const IMPORT_ATTEMPTS = 2

/** A refusal's own-marker clear left no marker of this page standing: no clear was needed (absent), it cleared, or none stood. */
function markerGone(cleared: AbandonResult | null | undefined): boolean {
    return cleared === undefined || (cleared !== null && (cleared.status === 'cleared' || cleared.status === 'nothing'))
}

/**
 * The page's workspaces with the stored Ref set on every file that has no `text` (a file the boot flagged damaged), taken
 * from the same workspace and file id in the manifest `baseContent` names (the one the import's carry claims, so the refs and
 * the carry can never come from two reads of the commit key). The import plans with no previous
 * encoding, so the `ref` field is how the encoder keeps the damaged unit named by the imported tree instead of refusing
 * the import (data a build cannot read is kept). A file the base does not name stays without `ref` and the encoder then
 * refuses it; any read problem returns the workspaces unchanged. Nothing is read when every file has its text.
 */
async function withStoredFileRefs(target: Pick<Store2ImportRequest['target'], 'backend'>, workspaces: JsonObject[], baseContent: () => Promise<BaseContentIndex>): Promise<JsonObject[]> {
    const lacksText = (entry: JsonValue): boolean => isJsonObject(entry) && typeof entry.text !== 'string'
    if (!workspaces.some(workspace => Array.isArray(workspace.files) && workspace.files.some(lacksText))) {
        return workspaces
    }
    try {
        const manifestKey = (await baseContent()).from
        if (manifestKey === null) {
            return workspaces
        }
        const manifestBytes = (await target.backend.readUnits([manifestKey])).get(manifestKey)
        const manifestUnit = manifestBytes === undefined ? null : readUnit(manifestBytes, UNIT_TYPE.manifest)
        if (manifestUnit === null || (manifestUnit.status !== 'ok' && manifestUnit.status !== 'stale')) {
            return workspaces
        }
        const keys = ((manifestUnit.value.body as Manifest).fixed.workspaces ?? []).map(ref => keyOfRef(ref))
        const stored = keys.length === 0 ? new Map<string, Uint8Array>() : await target.backend.readUnits(keys)
        const refs = new Map<string, Ref>()
        for (const key of keys) {
            const bytes = stored.get(key)
            const unit = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.workspace)
            if (unit === null || (unit.status !== 'ok' && unit.status !== 'stale')) {
                continue
            }
            const record = unit.value.body as WorkspaceRecord
            for (const entry of record.files) {
                refs.set(`${String(record.ws.id)}:${entry.id}`, entry.ref)
            }
        }
        return workspaces.map(workspace => ({
            ...workspace,
            files: Array.isArray(workspace.files) ? workspace.files.map((entry) => {
                const held = lacksText(entry) && isJsonObject(entry) ? refs.get(`${String(workspace.id)}:${String(entry.id)}`) : undefined
                return held === undefined || !isJsonObject(entry) ? entry : { ...entry, ref: [...held] }
            }) : workspace.files,
        }))
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return workspaces
        }
        throw error
    }
}
/**
 * The page's installed theme packs and active pack id as the import keeps them: plain values read through the reactive
 * proxy (a copy that does not follow later edits, with every key kept), the list only when the page holds one and the id
 * only when it is a string. Each is independent of the other.
 */
function pageThemePacks(db: Database): { themePacks: readonly JsonValue[] | undefined, activeThemePack: string | undefined } {
    const plain = toPlainJson(db.themePacks)
    return {
        themePacks: Array.isArray(plain) ? plain : undefined,
        activeThemePack: typeof db.activeThemePack === 'string' ? db.activeThemePack : undefined,
    }
}

/**
 * The page's utility workspaces as the import keeps them: plain objects read through the reactive proxy (a copy that does
 * not follow later edits, every key and every file's text kept). A `.bin` carries none, so the profile keeps the page's own.
 * An absent or non-list value gives none, and an item that is not an object is left out.
 */
function pageWorkspaces(db: Database): JsonObject[] {
    const plain = toPlainJson(db.utilityWorkspaces)
    return Array.isArray(plain) ? plain.filter(isJsonObject) : []
}

/**
 * The page's usage ledger keys and price overrides as the import keeps them: plain values read through the reactive proxy
 * (a copy that does not follow later edits). Each is present only when the page holds some.
 */
function pageUsage(db: Database): { usageStatics?: JsonObject, usagePriceOverrides?: JsonObject } {
    return usageCarryOf(toPlainJson(db.statics), toPlainJson(db.usagePriceOverrides))
}

/**
 * The page's ChroMemory choice and settings as the import keeps them: the flag only when it is a boolean, the settings as a
 * plain copy through the reactive proxy, only when the page holds any.
 */
function pageChroMemory(db: Database): { ltmEngine?: boolean, ltmSettings?: JsonValue } {
    const carry: { ltmEngine?: boolean, ltmSettings?: JsonValue } = {}
    if (typeof db.ltmEngine === 'boolean') {
        carry.ltmEngine = db.ltmEngine
    }
    const settings = toPlainJson(db.ltmSettings)
    if (settings !== undefined) {
        carry.ltmSettings = settings
    }
    return carry
}

/**
 * Imports the file `request` describes, over one of two paths. A file under the unit threshold takes the whole decode:
 * the tree `request.decode()` yields is resolved, planned and committed once, forced, over a fresh read of the commit
 * key (`importLegacyTree`). A file over the threshold takes the streamed prepare and commit (`prepareImportStream`,
 * `commitImportStreamed`), which reads the units from the file instead of holding a decoded tree. Run under
 * `dbWriteLock`. Every whole-path attempt first reads a content index of the manifest the commit key names, so units the profile
 * already stores are named again under their keys and the commit carries that manifest (`base-unnamed` when it no
 * longer names it). A conflict, a bulk marker this page load left, or a `base-unnamed` refusal (after which no marker of
 * this page stands) is answered once, from one shared budget, by a rebuild from a fresh decode and a fresh read; a
 * second conflict is unconfirmed and a second `base-unnamed` shows the library refusal. A build that aborted under the bulk marker ends through
 * `endOfAbortedBuild`: when the marker was cleared (or never left) and the cause is a changed file or an unreadable
 * unit, nothing changed and the import is refused 'read-failed'. Any other throw after the library started is
 * unconfirmed too, as is an abort whose marker could not be cleared; the busy refusal at the flip wrote nothing and is
 * a refusal.
 */
export async function commitStore2Import(request: Store2ImportRequest): Promise<Store2ImportEnd> {
    const answered = new Set<string>()
    // The items the person accepted being left incomplete; kept for the landed end.
    let accepted: readonly IncompleteItem[] = []
    const committer = guardedAtFlip(request.target.committer, request.busy)
    // A `.bin` carries no task presets, so the profile keeps the page's own, by value and as they are now (an unsaved edit
    // included). Taken once: every attempt imports the same list.
    const taskPresets = importableTaskPresets(getDatabase().taskPresets)
    // The same for the utility workspaces: a `.bin` leaves them out, so the profile keeps the page's own, by value.
    const pageWorkspaceList = pageWorkspaces(getDatabase())
    // The same for the installed theme packs and the active pack id: neither is in a `.bin`, so the profile keeps the
    // page's own, by value (a copy that is structured-cloneable and does not follow later edits).
    const { themePacks, activeThemePack } = pageThemePacks(getDatabase())
    // And the usage statistics and price overrides: a `.bin` carries neither, so the profile keeps the page's own, by value.
    const { usageStatics, usagePriceOverrides } = pageUsage(getDatabase())
    // And the ChroMemory choice and settings: a `.bin` carries neither, so the profile keeps the page's own, by value, and the
    // imported legacy engine flags never outrank the page's choice.
    const { ltmEngine, ltmSettings } = pageChroMemory(getDatabase())
    // A committer without `commitStreamed` takes every file the whole way.
    const stream = committer.commitStreamed === undefined ? undefined : request.stream
    for (let attempt = 1; ; attempt++) {
        const lists = getActiveStore2Save()?.lists ?? createListDerivation()
        // One index per attempt, read when first asked: the streamed prepare asks before P1b, and a file it hands back to the
        // whole path reuses that same index.
        let index: Promise<BaseContentIndex> | null = null
        const baseContent = (): Promise<BaseContentIndex> => {
            index ??= indexOfCommitKey({ committer, backend: request.target.backend }, { yieldFn: request.yieldToMain ?? yieldToEventLoop })
            return index
        }
        // A file the boot flagged damaged has no text: its stored unit is named again from this attempt's base, never dropped.
        const utilityWorkspaces = await withStoredFileRefs({ backend: request.target.backend }, pageWorkspaceList, baseContent)
        const hooks: ImportHooks = {
            onPhase: (phase) => noteImportPhase(`${phase}, attempt ${attempt}`),
            async confirmIncomplete(items) {
                const signature = JSON.stringify(items)
                if (answered.has(signature)) {
                    return true
                }
                if (!await alertConfirm(language.store2ImportIncompleteConfirm(incompleteLines(items)))) {
                    return false
                }
                answered.add(signature)
                accepted = items
                return true
            },
        }
        const streamRequest = stream === undefined
            ? null
            : { stream, reader: request.reader, lists, taskPresets, utilityWorkspaces, themePacks, activeThemePack, usageStatics, usagePriceOverrides, ltmEngine, ltmSettings, yieldToMain: request.yieldToMain ?? yieldToEventLoop, baseContent }
        // The library releases the tree it is handed once the tree is resolved; nothing here may keep another reference.
        let source: ImportSource | null = null
        // What the streamed prepare decided when it did not hand the file back to the whole path.
        let streamed: StreamPrepared | PrepareStop | null = null
        try {
            if (streamRequest !== null) {
                const { prepareImportStream } = await import('../storage/store2/legacy/importStream')
                const verdict = await prepareImportStream(streamRequest, hooks)
                streamed = verdict === 'whole' ? null : verdict
            }
            if (streamed === null) {
                source = { tree: await request.decode() }
            }
        } catch (error) {
            console.error(error)
            if (error instanceof BinFileChangedError) {
                return refused('read-failed', binChangeText(error))
            }
            return refused('decode-failed', language.internalBackupUnreadable)
        }
        let outcome: ImportOutcome
        noteImportPhase(`decoded, attempt ${attempt}`)
        try {
            if (streamed !== null) {
                if (streamRequest === null) {
                    throw new TypeError('A streamed prepare ran without a stream request.')
                }
                if ('status' in streamed) {
                    outcome = streamed
                } else {
                    const { commitImportStreamed } = await import('../storage/store2/legacy/importStream')
                    outcome = await commitImportStreamed({ ...streamRequest, committer, backend: request.target.backend }, streamed, hooks)
                }
            } else {
                if (source === null) {
                    throw new TypeError('The decoded tree is missing.')
                }
                outcome = await importLegacyTree(
                    {
                        source, reader: request.reader, committer, backend: request.target.backend, lists, taskPresets, utilityWorkspaces, themePacks, activeThemePack, usageStatics, usagePriceOverrides, ltmEngine, ltmSettings,
                        baseContent,
                    },
                    hooks,
                )
            }
        } catch (error) {
            if (isBusyAbort(error)) {
                return refused('busy', null)
            }
            console.error(error)
            return endOfAbortedBuild(error)
        }
        noteImportPhase(`import ${outcome.status}, attempt ${attempt}`)
        switch (outcome.status) {
            case 'committed': {
                const { dropped, changed, recovered } = outcome.repair
                return {
                    kind: 'landed',
                    flushed: outcome.flushed,
                    repairNotice: dropped + changed + recovered > 0 ? language.restoreRepairedNotice(dropped, changed, recovered) : null,
                    repair: outcome.repair,
                    incomplete: accepted,
                }
            }
            case 'declined':
                return refused('declined', null)
            case 'read-failed': {
                console.error(outcome.error)
                const cause = outcome.error.cause
                return refused('read-failed', cause instanceof BinFileChangedError ? binChangeText(cause) : language.store2ImportReadFailed)
            }
            case 'repair-refused':
                return refused('archived-id', language.restoreRefusedArchivedId(outcome.refusals[0].name))
            case 'unsavable':
                return refused('unsavable', language.restoreRefusedUnsavable(outcome.detail))
            case 'base-unreadable':
                return refused('base-unreadable', language.store2ImportRefused)
            case 'conflict':
                if (attempt < IMPORT_ATTEMPTS) {
                    continue
                }
                return unconfirmed()
            case 'unknown':
                return unconfirmed()
            case 'failed':
                console.error(outcome.cause)
                return outcome.cause instanceof Store2StalePageError
                    ? refused('stale-page', language.restoreNotHappenedNotice)
                    : refused('write-failed', language.internalBackupWriteFailed)
            case 'abandoned':
                console.error(outcome.cause ?? outcome.reason)
                return refused('abandoned', language.store2ImportAbandoned)
            case 'refused':
                if (outcome.reason === 'marker-present') {
                    // The question is asked at the start of an import, not here: at commit time the import has already written
                    // its assets and units, and this loop's retry handles the page's own marker. A foreign one stays a refusal.
                    if (attempt < IMPORT_ATTEMPTS && await clearOwnMarker(request.target.committer)) {
                        continue
                    }
                    return refused('marker-standing', language.store2RestoreBulkMarker)
                }
                // Another writer dropped the manifest the content index was read from: one quiet rebuild over a fresh read, from
                // the same attempt budget as a conflict, and only when no marker of this page can still stand.
                if (outcome.reason === 'base-unnamed' && attempt < IMPORT_ATTEMPTS && markerGone(outcome.cleared)) {
                    continue
                }
                return outcome.reason === 'too-new'
                    ? refused('too-new', language.store2ImportTooNew)
                    : refused('library-refused', language.store2ImportRefused)
            default: {
                // A status added to the library later ends the import here instead of looping into another commit.
                const unhandled: never = outcome
                console.error(unhandled)
                return unconfirmed()
            }
        }
    }
}

/**
 * The boot-time commit of a decoded `.bin`: the boot's installer (`target.install`) over a decode of the database
 * entry (each call of `request.decode` reads the entry from the file again and may throw `BinFileChangedError`), with the
 * same incomplete-items question as the page import. When the file is over the unit threshold (`stream` with a target
 * that offers `prepareStream` and `installStream`), the streamed prepare decides first and either hands the file back
 * to the whole decode or installs unit by unit. A decline or a refusal before anything was written shows its message
 * and ends `cancelled`; everything the installer decided past the questions is passed to the dispatch. A streamed
 * install that aborted because the file changed or a unit could not be read has already begun writing: it shows the
 * error, waits for it to be dismissed and finishes with `reclassify`, with the bulk marker and the staged units left
 * standing so the next start classifies the marked import and offers the recovery screen. No page, write lock or
 * reload is involved: the dispatch opens the installed profile itself.
 */
export async function commitBootImport(request: {
    target: BootImportTarget
    decode(): Promise<Database>
    reader: LegacyEntryReader
    /** Told the items the person accepted being left incomplete, when the question was asked and answered yes. */
    onAccepted?(items: readonly IncompleteItem[]): void
    /** Where the database entry sits in the file; as `Store2ImportRequest.stream`. `decode` stays the whole path. */
    stream?: StreamSource
    /** Awaited per chunk and per character of a streamed import; defaults to the event-loop yield. */
    yieldToMain?: () => Promise<void>
}): Promise<BootImportEnd> {
    const hooks: ImportHooks = {
        onPhase: noteImportPhase,
        async confirmIncomplete(items) {
            if (!await alertConfirm(language.store2ImportIncompleteConfirm(incompleteLines(items)))) {
                return false
            }
            request.onAccepted?.(items)
            return true
        },
    }
    const { target, stream } = request
    const yieldToMain = request.yieldToMain ?? yieldToEventLoop
    let source: ImportSource | null = null
    // What the streamed prepare decided when it did not hand the file back to the whole path.
    let streamed: StreamPrepared | PrepareStop | null = null
    try {
        if (stream !== undefined && target.prepareStream !== undefined && target.installStream !== undefined) {
            const verdict = await target.prepareStream({ stream, yieldToMain }, request.reader, hooks)
            streamed = verdict === 'whole' ? null : verdict
        }
        if (streamed === null) {
            source = { tree: await request.decode() }
        }
    } catch (error) {
        console.error(error)
        alertError(error instanceof BinFileChangedError ? binChangeText(error) : language.internalBackupUnreadable)
        return { kind: 'cancelled' }
    }
    noteImportPhase('decoded, boot')
    let result: BootImportResult
    if (streamed === null) {
        if (source === null) {
            throw new TypeError('The decoded tree is missing.')
        }
        result = await target.install(source, request.reader, hooks)
    } else if ('status' in streamed) {
        result = streamed
    } else if (stream === undefined || target.installStream === undefined) {
        throw new TypeError('A streamed prepare ran without a stream request.')
    } else {
        try {
            result = await target.installStream({ stream, yieldToMain }, streamed, request.reader, hooks)
        } catch (error) {
            const { Store2InstallAbortError } = await import('../storage/store2/firstLife')
            if (!(error instanceof Store2InstallAbortError)) {
                throw error
            }
            const original = error.original
            let text: string
            if (original instanceof BinFileChangedError) {
                text = binChangeText(original)
            } else if (original instanceof LegacyReadError) {
                text = original.cause instanceof BinFileChangedError ? binChangeText(original.cause) : language.store2ImportReadFailed
            } else {
                throw original
            }
            // The marker and the staged units stand: the next start classifies a marked import and offers the recovery screen.
            console.error(error)
            alertError(text)
            await waitAlert()
            return { kind: 'finished', result: { status: 'reclassify' } }
        }
    }
    noteImportPhase(`boot import ${result.status}`)
    switch (result.status) {
        case 'declined':
            return { kind: 'cancelled' }
        case 'read-failed': {
            console.error(result.error)
            const cause = result.error.cause
            alertError(cause instanceof BinFileChangedError ? binChangeText(cause) : language.store2ImportReadFailed)
            return { kind: 'cancelled' }
        }
        case 'repair-refused':
            alertError(language.restoreRefusedArchivedId(result.refusals[0].name))
            return { kind: 'cancelled' }
        case 'unsavable':
            alertError(language.restoreRefusedUnsavable(result.detail))
            return { kind: 'cancelled' }
        case 'installed':
        case 'reclassify':
        case 'blocked':
        case 'exit':
            return { kind: 'finished', result }
    }
}

/**
 * Tells the person what landed and reloads onto it. `notices` are the shell's own (assets or inlays left out), shown
 * first and awaited, because the reload takes the page away. The write lock stays closed through the reload.
 */
export async function announceStore2Import(
    end: Extract<Store2ImportEnd, { kind: 'landed' }>,
    notices: readonly string[],
    reload: () => Promise<void>,
): Promise<void> {
    for (const notice of notices) {
        await alertNormalWait(notice)
    }
    if (end.repairNotice !== null) {
        await alertNormalWait(end.repairNotice)
    }
    if (end.flushed === false) {
        // The commit key is written but the device did not confirm it reached disk. The page reloads all the same:
        // the start-up re-flush writes the commit key again before anything else.
        await alertNormalWait(language.store2ImportNotFlushed)
    } else {
        alertWait(language.store2ImportDone)
    }
    await reload()
}
