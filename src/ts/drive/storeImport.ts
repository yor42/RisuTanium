import { alertConfirm, alertError, alertNormalWait, alertStore, alertWait } from '../alert'
import { getSaveMarkCount, isSaveClean } from '../globalApi.svelte'
import { language } from 'src/lang'
import type { Database } from '../storage/database.svelte'
import { describeOmitted } from '../storage/bootBlockLoad'
import { decodeRisuSave, isBlockFormatSave, salvageRisuSave, type SalvageOmittedBlock } from '../storage/risuSave'
import { Store2StalePageError } from '../storage/store2/backend/errors'
import type { Store2Backend, Store2Read } from '../storage/store2/backend/types'
import { getStore2BootSession } from '../storage/store2/bootActive'
import { Store2BulkAbortError, type Committer } from '../storage/store2/commit'
import { classifyCommitRead } from '../storage/store2/commitKey'
import { createListDerivation } from '../storage/store2/lists'
import { importLegacyTree, type ImportOutcome, type ImportSource, type RepairSummary } from '../storage/store2/legacy/importTree'
import type { IncompleteItem, LegacyEntryReader } from '../storage/store2/legacy/resolve'
import { BinFileChangedError, ColdEntryIndex, createBinEntryReader } from '../storage/store2/legacy/binReader'
import { createLegacyStoreReader, type ColdUnitRead } from '../storage/store2/legacy/storeReader'
import type { BootImportEnd, BootImportTarget } from '../storage/store2/legacy/bootImport'
import { getActiveStore2Save } from '../storage/store2/saveActive'
import { incompleteList } from '../storage/store2/ui/bootText'
import { readColdStorageItem } from '../process/coldstorage.svelte'
import { MEASURE } from '../process/memory/measureFlag'
import { pushImportPhase } from './importPhaseRing'
import { estimateImportSeconds, IMPORT_TIME_WARNING_BYTES, importAssetBytes, importFreeSpaceBytes, importGigabytesText, roundImportMinutes } from './importEstimate'
import { transportKind } from '../storage/tauriByteTransport'
import type { BusyHandle } from '../process/memory/busyActions'
import { parseBackupEntryHeader, BACKUP_ENCRYPTION_MARKER_NAME, BACKUP_INDEX_SHORT_NAME_BYTES, type BackupIndexEntry } from './backupContainer'
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

/** A database entry above this many bytes is announced before it is decoded: the decode needs several times its size. */
export const IMPORT_SIZE_WARNING_BYTES = 16 * 1024 * 1024

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

const IMPORT_MEASURE_KEY = 'risu-measure-import'

/** The copy loop notes a phase once per this many entries visited. */
export const IMPORT_COPY_PHASE_EVERY = 5000

/**
 * Measurement builds only (`MEASURE`), and only when `localStorage` says `on` under `risu-measure-import`: logs the
 * phase, the time since the page started and, where the engine reports it, the JS heap in use, and records the same in
 * the `__risuImportPhases` ring (importPhaseRing.ts), the only output on a built page. A normal build folds the
 * condition away and logs and records nothing; the hook decides nothing.
 */
export function noteImportPhase(phase: string): void {
    if (!MEASURE) {
        return
    }
    try {
        if (typeof localStorage === 'undefined' || localStorage.getItem(IMPORT_MEASURE_KEY) !== 'on') {
            return
        }
    } catch {
        return
    }
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    const t = Math.round(performance.now())
    console.info(`[import-measure] ${phase} t=${t}ms heap=${heap === undefined ? 'n/a' : `${Math.round(heap / (1024 * 1024))}MiB`}`)
    pushImportPhase(phase, t, heap === undefined ? null : Math.round(heap / (1024 * 1024)))
}

/**
 * The page's committer and backend, with every precondition knowable up front checked: a store2 session that can
 * write, a readable commit key that names a current manifest, and no bulk marker of another page standing. A marker of
 * this page load is not a refusal: the commit clears it the way the save loop does. A refusal has shown its message.
 */
export async function checkStore2Import(): Promise<Store2ImportCheck> {
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
                alertError(language.store2RestoreBulkMarker)
                return { kind: 'refused', cause: 'foreign-marker' }
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

async function readIndexedHeader(file: Blob, entry: BackupIndexEntry, where: string): Promise<{ name: string }> {
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

/** The database entry's bytes, with its header checked again against the walk. Throws `BinFileChangedError`. */
export async function readBinDatabase(file: Blob, entry: BackupIndexEntry): Promise<Uint8Array> {
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
export function createBinImportReader(file: Blob, index: ColdEntryIndex, readFallback: (key: string) => Promise<ColdUnitRead> = readColdStorageItem): LegacyEntryReader {
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

/** Announces a large database entry before it is decoded; false when the person declines. */
export async function confirmDatabaseSize(byteLength: number, threshold: number = IMPORT_SIZE_WARNING_BYTES): Promise<boolean> {
    if (byteLength <= threshold) {
        return true
    }
    return await alertConfirm(language.store2ImportSizeWarning(Math.ceil(byteLength / (1024 * 1024))))
}

/**
 * The one question before an import writes anything, asked once the file is walked and its database entry located. A
 * store2 page on an Android phone with more than `IMPORT_TIME_WARNING_BYTES` of assets gets the time and space notice,
 * which carries the database-size sentence when the database is over the size threshold too (one prompt, not two).
 * Everything else keeps `confirmDatabaseSize` and its text. The notice belongs to store2 pages only: the block and
 * legacy page modes are fork-local transitional storage modes with no commit tail to estimate, and keep their prompts
 * (block-mode helpers are removed in stage 8). False when the person declines; nothing has been written.
 */
export async function confirmImportScale(fileSize: number, entries: number, databaseBytes: number): Promise<boolean> {
    const assetBytes = importAssetBytes(fileSize, databaseBytes)
    if (transportKind() !== 'android' || assetBytes <= IMPORT_TIME_WARNING_BYTES) {
        return await confirmDatabaseSize(databaseBytes)
    }
    const minutes = roundImportMinutes(estimateImportSeconds(entries, assetBytes, databaseBytes))
    const databaseMegabytes = databaseBytes > IMPORT_SIZE_WARNING_BYTES ? Math.ceil(databaseBytes / (1024 * 1024)) : null
    return await alertConfirm(language.store2ImportTimeWarning(entries, minutes, importGigabytesText(importFreeSpaceBytes(assetBytes)), databaseMegabytes))
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
    /** A fresh decoded tree on each call: the import consumes its tree, and a retry needs another. */
    decode(): Promise<Database>
    reader: LegacyEntryReader
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

/** The attempts of one import: the first, and one rebuild after a conflict or after clearing this page's own stale marker. */
const IMPORT_ATTEMPTS = 2

/**
 * Imports the decoded tree `request.decode()` yields: resolve, plan and one forced commit over a fresh read of the
 * commit key (`importLegacyTree`). Run under `dbWriteLock`. A conflict, or a bulk marker this page load left, is
 * answered once by a rebuild from a fresh decode and a fresh read; a second one is unconfirmed. Any throw after the
 * library started is unconfirmed too, except the busy refusal at the flip, which wrote nothing.
 */
export async function commitStore2Import(request: Store2ImportRequest): Promise<Store2ImportEnd> {
    const answered = new Set<string>()
    // The items the person accepted being left incomplete; kept for the landed end.
    let accepted: readonly IncompleteItem[] = []
    const committer = guardedAtFlip(request.target.committer, request.busy)
    for (let attempt = 1; ; attempt++) {
        // The library releases the tree it is handed once the tree is resolved; nothing here may keep another reference.
        let source: ImportSource
        try {
            source = { tree: await request.decode() }
        } catch (error) {
            console.error(error)
            return refused('decode-failed', language.internalBackupUnreadable)
        }
        let outcome: ImportOutcome
        noteImportPhase(`decoded, attempt ${attempt}`)
        try {
            outcome = await importLegacyTree(
                { source, reader: request.reader, committer, backend: request.target.backend, lists: getActiveStore2Save()?.lists ?? createListDerivation() },
                {
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
                },
            )
        } catch (error) {
            if (isBusyAbort(error)) {
                return refused('busy', null)
            }
            console.error(error)
            return unconfirmed()
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
                    if (attempt < IMPORT_ATTEMPTS && await clearOwnMarker(request.target.committer)) {
                        continue
                    }
                    return refused('marker-standing', language.store2RestoreBulkMarker)
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
 * entry, with the same incomplete-items question as the page import. A decline or a refusal shows its message and ends
 * `cancelled` (nothing was written); everything the installer decided past the questions is passed to the dispatch.
 * No page, write lock or reload is involved: the dispatch opens the installed profile itself.
 */
export async function commitBootImport(request: {
    target: BootImportTarget
    decode(): Promise<Database>
    reader: LegacyEntryReader
    /** Told the items the person accepted being left incomplete, when the question was asked and answered yes. */
    onAccepted?(items: readonly IncompleteItem[]): void
}): Promise<BootImportEnd> {
    let source: ImportSource
    try {
        source = { tree: await request.decode() }
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupUnreadable)
        return { kind: 'cancelled' }
    }
    noteImportPhase('decoded, boot')
    const result = await request.target.install(source, request.reader, {
        onPhase: noteImportPhase,
        async confirmIncomplete(items) {
            if (!await alertConfirm(language.store2ImportIncompleteConfirm(incompleteLines(items)))) {
                return false
            }
            request.onAccepted?.(items)
            return true
        },
    })
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
