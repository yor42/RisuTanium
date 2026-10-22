import { alertError, alertNormal, alertNormalWait, alertStore, alertWait, alertMd, alertConfirm } from "../alert";
import { remove } from "@tauri-apps/plugin-fs";
import { takeExportWriteStats, type ExportByteWriter, type ExportWriteCall } from "../exportWriters";
import { localBackupFileName } from "./backupFileName";
import { LocalWriter, TauriWriter, requiresFullEncoderReload, dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported, noteAssetWrittenThisPage, describeBlockForPerson } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri, isNodeServer } from "src/ts/platform"
import { decodeRisuSave, encodeRisuSaveLegacy, isBlockFormatSave, salvageRisuSave, type SalvageOmittedBlock } from "../storage/risuSave";
import { writeRisuSaveV0 } from "../storage/risuSaveV0";
import { getAppStore, getAppStoreKind } from "../storage/store/appStore";
import type { ByteStore } from "../storage/store/contract";
import { StoreInvalidKeyError } from "../storage/store/errors";
import { assetBatchWriteMode, isAssetBatchAvailable, isAssetBatchReadAvailable, listAssetsSized, readAssetBatch, writeAssetBatch, writeAssetBatchB64, type AssetBatchWriteMode, type AssetPutEntry, type AssetPutResult, type SizedAssetKey } from "../storage/tauriAssetBatch";
import { CHUNK_MAX, createChunkedWriter, isDesktopTransport, readRangedPieces, takeRangeReadStats, transportKind, WRITE_CHUNK_BYTES, type RangedPiece } from "../storage/tauriByteTransport";
import { tauriAddressableViolation, tauriCreatableViolation } from "../storage/store/keyRules";
import { ASSET_BATCH_MAX_ENTRIES, ASSET_MAX_STREAMS, ExportAssetReader, RestoreAssetPipeline, parseCopyMeasureKnob, streamAssetEntry, type AssetBatchLimits, type StreamedAssetEntry } from "./assetBatchPipeline";
import { MEASURE } from "../process/memory/measureFlag";
import { NodeHttpError } from "../storage/store/nodeHttpStore";
import { NODE_BODY_LIMIT_BYTES } from "../storage/nodeBodyLimit";
import { createYieldBudget, yieldToEventLoop } from "../storage/saveYield";
import { getDatabase, setDatabase, type Database } from "../storage/database.svelte";
import { repairBotPresetsId } from "../storage/botPresetRepair";
import { describeOmitted } from "../storage/bootBlockLoad";
import { buildRestoreSet, completeRestoredTree, currentCharacterNames, leftOutQuestion, readArchivedUnitCharacter, repairRestoredCharacters, replaceWithRestoredSet } from "./restoreReplace";
import { repairCharacterTree } from "../storage/characterTreeRepair";
import { isCharacterEntry, isUsableCharacterId } from "../storage/characterIds";
import { repairDatabaseIds } from "../process/chatIds";
import { reloadAfterRestore } from "./restoreReload";
import { language } from "src/lang";
import { collectColdStorageBackupPayloads, confirmIncompleteColdStorageOperation, getColdStorageBackupKey, isColdStorageBackupData, listColdDataKeys, readColdStorageItem, setColdStorageItem, type ColdStorageBackupCollection, type ColdStorageBackupPayload } from "../process/coldstorage.svelte";
import { characterListNeedsRepair, collectBackupColdStorage, inlinedCharacter, inlinedFromMinted, lateSettledKeys, mergePluginStorage, pluginStorageForExport, stubEntriesInTree, stubWithMintedKey, leaveOutOversizePayloads, takeStubReadStats, UPSTREAM_HARD_LIMIT_BYTES, type BackupColdStorage, type ExportCollectionOptions, type MintedStubEntry, type OversizeItem } from "./exportInline";
import { isAcceptedColdStorageBackupEntry, listColdBackupRoots, listColdPluginStorageKeys } from "../process/coldstorageData";
import { convertPluginStorageIndex } from "../process/pluginStorageIndex";
import { v4 } from "uuid";
import { BACKUP_ENCRYPTION_MARKER_NAME, BACKUP_NAME_PREFIX_BYTES, MAX_MARKER_NAME_BYTES, backupCopyWindowBytes, createBlobWindowReader, decodeEntryName, indexBackupEntries, parseBackupEntryHeader, type BackupEntryHeader, type BackupIndexEntry } from "./backupContainer";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { refuseOnReadOnlyPage } from "../storage/readOnlyPage";
import { beginBusy, withBusy, type BusyHandle } from "../process/memory/busyActions";
import { inlayAttachmentLimit } from "../process/files/inlayStore";
import { parseInlayEntryName } from "./inlayBackupCodec";
import { writeInlaysToBackup } from "./inlayBackupExport";
import { InlayRestoreCollector, listOversizedInlays, restoreCollectedInlays, type InlaySkipped } from "./inlayBackupImport";
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from "./restoreLock";
import { reloadOntoRestoredState } from "./internalBackup";
import { saveFirst, SAVE_FIRST_BOUND_MS } from "./storeRestore";
import { getPageStorageMode } from "../storage/pageStorageMode";
import { BinFileChangedError, type ColdEntryIndex } from "../storage/store2/legacy/binReader";
import type { BootImportEnd, BootImportTarget } from "../storage/store2/legacy/bootImport";
import { emptyImportFacts, outcomeOfBootFinish, type ExportFile, type ExportOmitted, type ExportOutcome, type ImportFacts, type OperationCause, type OperationEnd, type OperationName, type OperationOutcome } from "./operationEnd";
import { announceStore2Import, binChangeText, checkStore2Import, commitBootImport, commitStore2Import, confirmImportScale, confirmLeftOut, createBinImportReader, IMPORT_COPY_PHASE_EVERY, noteImportPhase, readBinDatabaseOmitted, readBinDatabaseTree, scanBinForImport, UnsavedGuard, type Store2ImportTarget } from "./storeImport";

function getBasename(data:string){
    const baseNameRegex = /\\/g
    const splited = data.replace(baseNameRegex, '/').split('/')
    const lasts = splited[splited.length-1]
    return lasts
}

/**
 * Encodes the database entry and runs a second collection over the units it
 * refers to that the first collection did not settle: units first referenced
 * after it (for example a plugin storage key created while the assets were
 * copied), and error-text roots whose unit was absent then and may exist now.
 * The roots are listed from the very object that is encoded, with no await
 * between the listing and the encode, so every unit key the written database
 * holds is carried, reported, or an error-text root left out by rule (its
 * unit is absent, or its key is one a restore could not place). The caller writes the returned units before the
 * database entry. `stubPayloads` are the entries of the stubs that are in the encoded tree, in `stub` mode: an entry
 * exists exactly when a stub with its uuid is written, so a character loaded while the export ran leaves no orphan.
 */
async function encodeDatabaseWithLateColdStorage(db: Database, cold: BackupColdStorage){
    const { tree: exportCopy, notice: repairNotice } = await exportCopyOf(db, cold.inlined, cold.stubEntries)
    // Plugin values of a store2 page become units here; the exported copy carries no plain key for them.
    const plugin = pluginStorageForExport(exportCopy, cold.collected.settledKeys)
    const dbWithoutAccount = plugin.tree
    const lateRoots = listColdBackupRoots(dbWithoutAccount).filter((root) => !plugin.ids.has(root.key))
    // Upstream's SaveKV namespaces can only travel in upstream's block format. The field is deleted from the
    // export copy (a present key with no value would still be written), so a tree without namespaces encodes
    // to the same bytes as a tree without the field.
    const kvBlocks = db.upstreamKvBlocks
    delete dbWithoutAccount.upstreamKvBlocks
    const dbData = typeof kvBlocks === 'object' && kvBlocks !== null && Object.keys(kvBlocks).length > 0
        ? writeRisuSaveV0(dbWithoutAccount, kvBlocks)
        : encodeRisuSaveLegacy(dbWithoutAccount, 'compression')
    const stubPayloads = stubEntriesInTree(dbWithoutAccount.characters, cold.stubEntries)
    // An entity the first collection could not read stays a stub in the copy; the late collection does not read it again.
    // A minted uuid names an entry this export writes, never a unit of the page's store.
    const lateCollected = await collectColdStorageBackupPayloads(dbWithoutAccount, {
        roots: lateRoots,
        settledKeys: lateSettledKeys(cold.collected, cold.failedKeys, cold.stubEntries),
    })
    const late = mergePluginStorage(lateCollected, plugin)
    return { dbData, late, repairNotice, stubPayloads }
}

/**
 * Writes the stub unit entries `encodeDatabaseWithLateColdStorage` returned and lets go of each one once it is written.
 * It runs only after that call has returned: the encode reads `cold.stubEntries` to put the minted keys on the stubs,
 * and no later step reads them, so the map is replaced at once and the array is emptied one entry per write. Only
 * references are dropped, never the bytes: a writer may hold the very body until it closes. The total is taken first,
 * because the array shrinks while the loop runs. A write that fails leaves the unwritten entries in place.
 */
async function writeStubPayloadsAndRelease(
    writer: Pick<LocalWriter, 'writeBackup'>,
    cold: BackupColdStorage,
    stubPayloads: ColdStorageBackupPayload[],
    progressPrefix: string,
): Promise<void> {
    cold.stubEntries = new Map()
    const total = stubPayloads.length
    for (let i = 0; i < total; i++) {
        alertWait(`${progressPrefix} (${i + 1} / ${total})`)
        await writer.writeBackup(stubPayloads[0].backupName, stubPayloads[0].encoded)
        stubPayloads.shift()
    }
}

/** Measurement builds only: the stub read and `read_range` counts since the export began, as phase-note fields. */
function describeReadMeasure(): string {
    try {
        const stubs = takeStubReadStats()
        const ranges = takeRangeReadStats()
        const parts: string[] = []
        if (stubs) {
            parts.push(`stubChars=${stubs.characters} stubReadMs=${Math.round(stubs.readMs)} stubEncodeMs=${Math.round(stubs.encodeMs)} stubAhead=${stubs.ahead} stubHeldMax=${stubs.heldMax} stubRetries=${stubs.retries} stubFailed=${stubs.failed}`)
        }
        if (ranges) {
            parts.push(`rangeReads=${ranges.reads} rangeMs=${Math.round(ranges.ms)} rangeWallMs=${Math.round(ranges.wallMs)} store2Reads=${ranges.store2Reads} store2Ms=${Math.round(ranges.store2Ms)}`)
        }
        return parts.join(' ')
    } catch {
        return ''
    }
}

/** The most calls a phase note lists one by one; past it, only the cheapest and the dearest call are listed. */
const WRITE_CALLS_LISTED = 25

/** Measurement builds only: the `writeFile` calls since the last take, as phase-note fields. */
function describeWriteMeasure(): string {
    try {
        const stats = takeExportWriteStats()
        if (stats === null) {
            return ''
        }
        const round = (ms: number) => Math.round(ms * 10) / 10
        const label = (call: ExportWriteCall) => `${call.bytes}:${round(call.syncMs)}:${round(call.waitMs)}${call.append ? '' : ':new'}`
        let calls: string
        if (stats.records.length <= WRITE_CALLS_LISTED) {
            calls = `writeList=${stats.records.map(label).join(',')}`
        } else {
            const total = (call: ExportWriteCall) => call.syncMs + call.waitMs
            const cheapest = stats.records.reduce((low, call) => total(call) < total(low) ? call : low)
            const dearest = stats.records.reduce((high, call) => total(call) > total(high) ? call : high)
            calls = `writeLow=${label(cheapest)} writeHigh=${label(dearest)}`
        }
        const via = stats.calls === 0 ? 'none' : stats.appendCalls === 0 ? 'fs' : stats.appendCalls === stats.calls ? 'b64' : 'mixed'
        return `writeCalls=${stats.calls} writeVia=${via} writeBytes=${stats.bytes} writeSyncMs=${round(stats.syncMs)} writeWaitMs=${round(stats.waitMs)} writeCreates=${stats.creates} encodeMs=${round(stats.encodeMs)} closeMs=${round(stats.closeMs)} appendSynced=${stats.appendSynced === undefined ? 'none' : String(stats.appendSynced)} ${calls}`
    } catch {
        return ''
    }
}

/**
 * The database an export encodes: `db` without its account, with the character
 * list made one a reader can load. A list with nothing wrong is exported as it
 * is, byte for byte. Otherwise the export gets its own copy (the page's
 * characters are never changed): entries that are not characters are left out,
 * an id that cannot be saved is replaced with the lists that named it following,
 * and an archived character takes back the id its unit records, or, when the
 * unit cannot name one, a new id (its archived content then cannot be restored
 * from this export). A stub of a store2 entity is replaced by the whole character
 * read for it (`inlined`, `drive/exportInline.ts`), or, in `stub` mode, keeps its
 * place with the uuid minted for it (`stubEntries`); a minted stub that is trashed
 * when the tree is built, and every minted stub when the list then needs the id
 * repair, is inlined instead. The export is never refused;
 * `notice` says what was done.
 */
async function exportCopyOf(db: Database, inlined: ReadonlyMap<string, Database['characters'][number]>, stubEntries: ReadonlyMap<string, MintedStubEntry>): Promise<{ tree: Database, notice: string | null }> {
    const plain = { ...db, account: undefined }
    if ((inlined.size > 0 || stubEntries.size > 0) && Array.isArray(db.characters)) {
        plain.characters = db.characters.map((slot) => stubWithMintedKey(slot, stubEntries) ?? inlinedFromMinted(slot, stubEntries) ?? inlinedCharacter(slot, inlined))
        // A stub's unit body is written only when the export tree's ids are the ones the body holds. The repair below
        // rewrites ids in the tree only, so a list that needs it (it changed after collection decided) carries every
        // minted stub inline instead.
        if (stubEntries.size > 0 && characterListNeedsRepair(plain.characters)) {
            plain.characters = db.characters.map((slot) => inlinedFromMinted(slot, stubEntries) ?? inlinedCharacter(slot, inlined))
        }
    }
    const list: unknown = plain.characters
    if (!Array.isArray(list) || list.every((entry) => isCharacterEntry(entry) && isUsableCharacterId(entry.chaId))) {
        return { tree: plain, notice: null }
    }
    const repair = await repairCharacterTree(plain, 'export', { readUnitCharacter: readArchivedUnitCharacter })
    const count = (kind: string) => repair.notices.filter((notice) => notice.kind === kind).length
    const recovered = count('stub-id-recovered')
    const filled = count('id-filled')
    const replaced = count('id-replaced')
    const unrestorable = repair.notices.flatMap((notice) => notice.kind === 'stub-unrestorable' ? [`"${notice.name}"`] : [])
    return {
        tree: plain,
        notice: recovered + filled + replaced + unrestorable.length > 0
            ? language.exportIdsRepairedNotice(recovered, filled, replaced, unrestorable.join(', '))
            : null,
    }
}

/**
 * Whether an export's asset listing and reads may bypass the store's per-key
 * calls: the batched read and sized listing commands exist (the desktop and
 * Android apps) and the page's store is the files store they address.
 */
async function assetBatchReadUsable(): Promise<boolean> {
    if (!isAssetBatchReadAvailable()) {
        return false
    }
    try {
        return await getAppStoreKind() === 'tauri'
    } catch {
        return false
    }
}

/**
 * The asset keys of a full backup and, where the sized listing command
 * answers (the desktop and Android apps), their sizes in the same order. Any
 * failure of that command falls back to the store's own listing.
 */
async function listAssetsForBackup(store: ByteStore): Promise<{ keys: string[]; sized: SizedAssetKey[] | null }> {
    if (await assetBatchReadUsable()) {
        try {
            const sized = await listAssetsSized()
            return { keys: sized.map((item) => item.key), sized }
        } catch (e) {
            console.error(e)
        }
    }
    return { keys: await store.list('assets/'), sized: null }
}

/**
 * Whether this page is the desktop app on its own files store, where an asset
 * above `CHUNK_MAX` is written and read in pieces and never as one value.
 */
async function desktopStreamingUsable(): Promise<boolean> {
    if (!isDesktopTransport()) {
        return false
    }
    try {
        return await getAppStoreKind() === 'tauri'
    } catch {
        return false
    }
}

/** Large-entry streams at once on Android; the desktop stays at one, where the literal path runs. */
const ANDROID_ASSET_MAX_STREAMS = 2

/**
 * The Android pipeline's limits. A call carries at most one Android chunk of
 * entry bytes as base64 text through the JSON bridge, and four calls overlap
 * beside two streams. A stream reads slices of the writer's chunk size. What is
 * held at once is entry bytes within `budgetBytes` (four calls of one chunk
 * never reach it), plus per call its base64 body and the bridge copy, plus per
 * stream one slice, the chunk the writer holds back, its encoding and the bridge
 * copy.
 */
const ANDROID_ASSET_BATCH_LIMITS: AssetBatchLimits = {
    batchBytes: WRITE_CHUNK_BYTES,
    budgetBytes: 8 * 1024 * 1024,
    maxEntries: ASSET_BATCH_MAX_ENTRIES,
    maxFlights: 4,
    maxStreams: ANDROID_ASSET_MAX_STREAMS,
    streamSliceBytes: WRITE_CHUNK_BYTES,
}

/**
 * The Android export reader's limits, over the desktop defaults: a reply may
 * arrive through the bridge as a number array, so what is read ahead stays
 * within one 8 MiB piece of a ranged read, in two calls at most. The batch size
 * stays the desktop's.
 */
const ANDROID_EXPORT_READER_LIMITS: Partial<AssetBatchLimits> = {
    budgetBytes: 8 * 1024 * 1024,
    maxFlights: 2,
}

const COPY_MEASURE_KEY = 'risu-measure-copy'

/**
 * Measurement builds only (`MEASURE`): the limits the stored value under
 * `risu-measure-copy` asks for (`<streams>`, `<streams>,<flights>` or
 * `<streams>,<flights>,<sliceKiB>`), read for each restore. A normal build folds
 * the condition away and reads nothing; a malformed value changes nothing.
 */
function copyMeasureLimits(): Partial<AssetBatchLimits> {
    if (!MEASURE) {
        return {}
    }
    try {
        return parseCopyMeasureKnob(true, typeof localStorage === 'undefined' ? null : localStorage.getItem(COPY_MEASURE_KEY))
    } catch {
        return {}
    }
}

/** The restore's asset writer on the desktop and on Android, or `null` where every asset goes through the store one call at a time. */
async function createRestoreAssetPipeline(): Promise<RestoreAssetPipeline | null> {
    // The raw mode is `isAssetBatchAvailable()` (the desktop's raw-body write); the base64 mode is Android's alone. The
    // export's reads use `isAssetBatchReadAvailable()`, which both apps satisfy.
    const mode: AssetBatchWriteMode = isAssetBatchAvailable() ? 'raw' : assetBatchWriteMode() === 'b64' ? 'b64' : 'none'
    if (mode === 'none') {
        return null
    }
    try {
        if (await getAppStoreKind() !== 'tauri') {
            return null
        }
    } catch {
        return null
    }
    const store = await getAppStore()
    const writeEntry = async (entry: AssetPutEntry): Promise<AssetPutResult> => {
        try {
            await store.write(entry.key, entry.data, 'unconditional')
            return { k: 'ok' }
        } catch (error) {
            if (error instanceof StoreInvalidKeyError) {
                return { k: 'invalid', reason: error.message }
            }
            throw error
        }
    }
    if (mode === 'b64') {
        const limits = { ...ANDROID_ASSET_BATCH_LIMITS, ...copyMeasureLimits() }
        return new RestoreAssetPipeline({
            writeBatch: (entries) => writeAssetBatchB64(entries, limits.batchBytes),
            writeEntry,
            openStream: openAssetStream,
        }, limits)
    }
    return new RestoreAssetPipeline({
        writeBatch: (entries) => writeAssetBatch(entries, CHUNK_MAX),
        writeEntry,
        openStream: openAssetStream,
    }, { maxStreams: ASSET_MAX_STREAMS, streamSliceBytes: CHUNK_MAX, ...copyMeasureLimits() })
}

/**
 * A durable chunked write of an asset key. A name the store refuses throws
 * `StoreInvalidKeyError` before chunk 0: off Android the chunked writer applies
 * the key rule itself, and on Android (whose writer leaves the rule to the
 * native command) it is applied here, the rule `tauriFilesStore` uses for the
 * posix page store.
 */
function openAssetStream(key: string) {
    if (transportKind() === 'android') {
        const reason = tauriAddressableViolation(key, 'posix') ?? tauriCreatableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }
    return createChunkedWriter(key, { durable: true })
}

/**
 * An asset of a full or partial export could not be read to its end after its
 * entry header was written, so the entry cannot be completed and the file
 * being written is unusable.
 */
class BackupAssetChangedError extends Error {
    constructor(public readonly key: string, cause: unknown) {
        super(`The asset ${key} changed or could not be read while it was being saved`, { cause })
        this.name = 'BackupAssetChangedError'
    }
}

/**
 * An asset is larger than a backup entry can hold: the container stores an
 * entry's length in 32 bits, and a larger length would wrap into an entry no
 * reader can parse. Running the export again fails the same way.
 */
class BackupAssetTooLargeError extends Error {
    constructor(public readonly key: string, public readonly size: number) {
        super(`The asset ${key} is ${size} bytes, more than a backup entry can hold`)
        this.name = 'BackupAssetTooLargeError'
    }
}

/** The most bytes the 32-bit length field of a backup entry can state. */
const MAX_BACKUP_ENTRY_BYTES = 0xFFFFFFFF

/**
 * Writes one asset entry from the ranged reader, piece by piece: the entry
 * header carries the size the first piece reported, and the pieces follow in
 * order. Nothing of the asset is held beyond the piece being written.
 * Resolves `missing` when the first piece cannot be read (the key is absent or
 * unreadable), with nothing written. A size above `MAX_BACKUP_ENTRY_BYTES`
 * throws `BackupAssetTooLargeError` before anything of the entry is written.
 * Once the header is out, a read that fails, or a file that changed size or
 * identity, throws `BackupAssetChangedError`; a failing writer throws its own
 * error.
 */
async function writeAssetStreamed(writer: LocalWriter, key: string): Promise<'written' | 'missing'> {
    const pieces = readRangedPieces(key)
    try {
        let first: IteratorResult<RangedPiece, void>
        try {
            first = await pieces.next()
        } catch (error) {
            console.error(error)
            return 'missing'
        }
        if (first.done === true) {
            return 'missing'
        }
        const total = first.value.total
        if (total > MAX_BACKUP_ENTRY_BYTES) {
            throw new BackupAssetTooLargeError(key, total)
        }
        await writer.writeBackupHeader(key, total)
        await writer.write(first.value.bytes)
        let written = first.value.bytes.length
        for (;;) {
            let next: IteratorResult<RangedPiece, void>
            try {
                next = await pieces.next()
            } catch (error) {
                throw new BackupAssetChangedError(key, error)
            }
            if (next.done === true) {
                break
            }
            await writer.write(next.value.bytes)
            written += next.value.bytes.length
        }
        if (written !== total) {
            throw new BackupAssetChangedError(key, new Error(`${written} of ${total} bytes were read`))
        }
        return 'written'
    } finally {
        await pieces.return(undefined)
    }
}

/** What a failed export needs to say: the file being written, and a way to name an asset. */
interface ExportSession {
    writer: LocalWriter | null
    describeAsset: (key: string) => string
}

// The outcome types live in `operationEnd.ts` with their mapping to an `OperationEnd`; re-exported so importers keep working.
export type { ExportDeclinedCause, ExportOutcome } from './operationEnd'

/**
 * Options for a full or partial export. `ExportCollectionOptions` decides how stubs of a store2 page are carried;
 * `limitBytes` is the size at which an item is named and left out (`UPSTREAM_HARD_LIMIT_BYTES`), which a test lowers to
 * exercise the pre-flight without 4 GiB of data.
 */
export interface BackupExportOptions extends ExportCollectionOptions {
    limitBytes?: number
}

/** `bytes` as GiB with two decimals, for the prompt that names an item too large for the file. */
function formatGiB(bytes: number): string {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

const describeOversize = (name: string, size: number): string => `${name} (${formatGiB(size)})`

/**
 * Asks, before the writer opens, whether to create the backup without the items that are too large for it. `true` when
 * there are none or the person confirms. Declining writes nothing: the writer has not been opened.
 */
async function confirmLeaveOut(items: readonly string[]): Promise<boolean> {
    return items.length === 0 || await alertConfirm(language.backupOversizeConfirm([...items]))
}

/** The left-out items as the prompt and the final report name them. */
function oversizeNames(assets: ReadonlyMap<string, { charName: string, assetName: string }>, oversizeAssets: readonly SizedAssetKey[], payloads: readonly OversizeItem[]): string[] {
    return [
        ...oversizeAssets.map((item) => describeOversize(describeBackupAsset(assets, item.key), item.size)),
        ...payloads.map((item) => describeOversize(item.name, item.size)),
    ]
}

/**
 * Runs a full or partial export so that no failure of it ends unreported: the
 * person is told that the backup failed, whether the output file is gone, and
 * that it must not be used if it is not. The output file is removed only when
 * this export wrote to a desktop file; a desktop file this export did not
 * touch is left as it was. A web or Node stream is aborted, not removed.
 * Returns how the export ended; a caller that does not care may ignore it.
 */
async function runExport(body: (session: ExportSession) => Promise<ExportOutcome>): Promise<ExportOutcome> {
    const session: ExportSession = { writer: null, describeAsset: (key) => `'${key}'` }
    try {
        return await body(session)
    } catch (error) {
        console.error(error)
        const file = await reportFailedExport(session, error)
        return { status: 'failed', cause: error, file }
    }
}

/**
 * Gives up the file of a failed export and says what is left of it: `untouched`
 * when no file was produced (a desktop file the export never wrote to, or a web
 * writer that holds everything in memory), `deleted` when the incomplete desktop
 * file was removed, and `kept` when an incomplete file may remain: a desktop
 * file that could not be removed, or a download stream that may already have
 * reached the browser.
 */
async function discardFailedExportFile(target: ExportByteWriter | undefined, error: unknown): Promise<'untouched' | 'deleted' | 'kept'> {
    if (target === undefined) {
        return 'untouched'
    }
    if (target instanceof TauriWriter) {
        if (!target.touchedFile) {
            return 'untouched'
        }
        try {
            await remove(target.path)
        } catch (removeError) {
            console.error(removeError)
            return 'kept'
        }
        return 'deleted'
    }
    const heldInMemory = target.heldInMemory === true
    try {
        await target.abort?.(error)
    } catch (abortError) {
        console.error(abortError)
    }
    return heldInMemory ? 'untouched' : 'kept'
}

async function reportFailedExport(session: ExportSession, error: unknown): Promise<ExportFile> {
    const file = await discardFailedExportFile(session.writer?.writer, error)
    if (error instanceof BackupAssetTooLargeError) {
        alertError(language.backupFailedAssetTooLarge(session.describeAsset(error.key), file))
        return file
    }
    const asset = error instanceof BackupAssetChangedError ? session.describeAsset(error.key) : null
    if (file === 'untouched') {
        alertError(language.backupFailedNothingWritten())
    } else if (file === 'deleted') {
        alertError(language.backupFailedFileDeleted(asset))
    } else {
        alertError(language.backupFailedFileKept(asset))
    }
    return file
}

/** A person's name for an asset of a backup, as the skip report gives it. */
function describeBackupAsset(assetMap: ReadonlyMap<string, { charName: string, assetName: string }>, key: string): string {
    const assetInfo = assetMap.get(key)
    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`
}

function describeLateColdStorageKeys(late: ColdStorageBackupCollection): string {
    const keys = [...late.missingKeys, ...late.invalidKeys]
    if (keys.length === 0) {
        return ''
    }
    let message = 'The following cold storage units are not in the backup. They were first referenced while the backup ran, or they could not be read or were unusable when the backup reached them:\n\n'
    for (const key of keys) {
        message += `* **Cold storage unit**  \n  *Key: ${key}*\n`
    }
    return message
}

export function SaveLocalBackup(options: BackupExportOptions = {}): Promise<ExportOutcome>{
    return withBusy('backupSave', () => runExport((session) => writeLocalBackup(session, options)))
}

async function writeLocalBackup(session: ExportSession, options: BackupExportOptions): Promise<ExportOutcome>{
    alertWait("Saving local backup...")
    // The export notes share the import's measurement hook and ring (`noteImportPhase`), under an `export ` prefix.
    noteImportPhase('export start')
    if (MEASURE) {
        // The counts of the notes below cover this export only.
        takeRangeReadStats()
        takeExportWriteStats()
    }
    const db = getDatabase()
    let cold = await collectBackupColdStorage(db, options)
    noteImportPhase(MEASURE ? `export cold collected ${describeReadMeasure()}` : 'export cold collected')
    if(!await confirmIncompleteColdStorageOperation(db, cold.unavailableKeys, 'backup', cold.collected.owners)){
        return { status: 'declined', cause: 'incomplete-data-declined' }
    }

    const assetMap = new Map<string, { charName: string, assetName: string }>()
    session.describeAsset = (key) => describeBackupAsset(assetMap, key)
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'

            if (char.image) assetMap.set(char.image, { charName: charName, assetName: 'Main Image' })
            
            if (char.emotionImages) {
                for (const em of char.emotionImages) {
                    if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                }
            }
            if (char.type !== 'group') {
                if (char.additionalAssets) {
                    for (const em of char.additionalAssets) {
                        if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                    }
                }
                if (char.vits) {
                    const keys = Object.keys(char.vits.files)
                    for (const key of keys) {
                        const vit = char.vits.files[key]
                        if (vit) assetMap.set(vit, { charName: charName, assetName: key })
                    }
                }
                if (char.ccAssets) {
                    for (const asset of char.ccAssets) {
                        if (asset && asset.uri) assetMap.set(asset.uri, { charName: charName, assetName: asset.name })
                    }
                }
            }
        }
    }
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    const missingAssets: string[] = []

    // The store lists only keys that hold an entry. On the desktop and Android
    // that includes a symbolic link that resolves (a link to a directory is
    // listed too and is reported as missing when its read fails), and never the
    // temp file of an atomic write; a dangling link is not listed. A key that
    // reads as absent or fails to read is reported as missing and the backup goes on.
    const store = await getAppStore()
    let listing = await listAssetsForBackup(store)
    noteImportPhase(`export listed, ${listing.keys.length} assets`)

    // Before the writer opens, name everything a backup entry cannot hold and ask. Assets are sized only where the
    // sized listing answers (the desktop and Android apps); the units and stub entries are sized from the bytes already in memory. Declining
    // writes nothing. Continuing leaves the items out, and the asset keys and sizes are filtered in one step because the
    // batch reader below finds an asset by its index in the sized list.
    const limitBytes = options.limitBytes ?? UPSTREAM_HARD_LIMIT_BYTES
    const oversizeAssets = listing.sized?.filter((item) => item.size >= limitBytes) ?? []
    const oversizePayloads = leaveOutOversizePayloads(cold, limitBytes)
    const leftOut = oversizeNames(assetMap, oversizeAssets, oversizePayloads.items)
    if (!await confirmLeaveOut(leftOut)) {
        return { status: 'declined', cause: 'oversize-declined' }
    }
    cold = oversizePayloads.cold
    const coldStoragePayloads = cold.collected
    if (listing.sized !== null && oversizeAssets.length > 0) {
        const sized = listing.sized.filter((item) => item.size < limitBytes)
        listing = { keys: sized.map((item) => item.key), sized }
    }

    const writer = new LocalWriter()
    const r = await writer.init(undefined, undefined, localBackupFileName(new Date()))
    if(!r){
        alertError('Failed')
        return { status: 'declined', cause: 'save-dialog-cancelled' }
    }
    session.writer = writer
    noteImportPhase('export writer opened')

    const assetKeys = listing.keys
    // Where the listing is sized (the desktop and Android apps) the assets are read ahead of the writer in batches, and
    // any asset a batch did not deliver whole (or every asset, when there is no batch) is written from the ranged
    // reader. Every exit of the loop below, thrown or not, waits for the reads still outstanding.
    let numberArrayReplies = 0
    const noteReply = MEASURE ? (asNumberArray: boolean) => { if (asNumberArray) numberArrayReplies += 1 } : undefined
    const assetReader = listing.sized
        ? new ExportAssetReader(
            { readBatch: (keys) => readAssetBatch(keys, noteReply) },
            listing.sized,
            assetBatchWriteMode() === 'b64' ? ANDROID_EXPORT_READER_LIMITS : {},
        )
        : null
    const streamAssets = await desktopStreamingUsable()
    let batchedAssets = 0
    let fallbackAssets = 0
    try {
        for(let i=0;i<assetKeys.length;i++){
            const key = assetKeys[i]
            let message = `Saving local Backup... (${i + 1} / ${assetKeys.length})`
            if (missingAssets.length > 0) {
                const skippedItems = missingAssets.map(key => {
                    const assetInfo = assetMap.get(key);
                    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
                }).join(', ');
                message += `\n(Skipping... ${skippedItems})`;
            }
            alertWait(message)

            let outcome: 'written' | 'missing'
            const taken = assetReader ? await assetReader.take(i) : null
            if (taken?.kind !== 'bytes' && taken?.kind !== 'missing') {
                fallbackAssets += 1
            }
            if (taken?.kind === 'bytes') {
                batchedAssets += 1
                await writer.writeBackup(key, taken.bytes)
                outcome = 'written'
            } else if (taken?.kind === 'missing') {
                outcome = 'missing'
            } else if (streamAssets) {
                outcome = await writeAssetStreamed(writer, key)
            } else {
                let data: Uint8Array | null = null
                try {
                    data = (await store.read(key)).bytes
                } catch (e) {
                    console.error(e)
                }
                if (data) {
                    await writer.writeBackup(key, data)
                    outcome = 'written'
                } else {
                    outcome = 'missing'
                }
            }
            if (outcome === 'missing') {
                missingAssets.push(key)
            }
            if ((i + 1) % IMPORT_COPY_PHASE_EVERY === 0) {
                noteImportPhase(`export assets ${i + 1} of ${assetKeys.length}`)
            }
        }
    } finally {
        await assetReader?.close()
    }
    // Counts: keys a batch delivered, keys that went to the per-entry reader (a key it then failed to read is also
    // missing), keys reported missing, and batch replies that came as a number array.
    noteImportPhase(`export assets done, batched=${batchedAssets} fallback=${fallbackAssets} missing=${missingAssets.length} numberArrayReplies=${numberArrayReplies}`)

    // Inlays follow the assets and stay ahead of the database, which is last.
    const inlayResult = await writeInlaysToBackup(writer, store, {
        streaming: streamAssets,
        onProgress: (done, total) => alertWait(`Saving local Backup Inlays... (${done} / ${total})`),
    })
    noteImportPhase('export inlays done')

    for(let i=0;i<coldStoragePayloads.payloads.length;i++){
        const payload = coldStoragePayloads.payloads[i]
        let message = `Saving local Backup Cold data... (${i + 1} / ${coldStoragePayloads.payloads.length})`
        alertWait(message)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }
    noteImportPhase('export cold payloads done')

    if (MEASURE) {
        // The write counts of the notes below start here, so they hold the stub, late and database writes only.
        takeExportWriteStats()
    }
    const { dbData, late, repairNotice, stubPayloads } = await encodeDatabaseWithLateColdStorage(db, cold)
    noteImportPhase('export database encoded')
    await writeStubPayloadsAndRelease(writer, cold, stubPayloads, 'Saving local Backup Cold data...')
    for(let i=0;i<late.payloads.length;i++){
        const payload = late.payloads[i]
        alertWait(`Saving local Backup Cold data... (${i + 1} / ${late.payloads.length})`)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }
    noteImportPhase(MEASURE ? `export stub and late payloads done ${describeWriteMeasure()}` : 'export stub and late payloads done')

    alertWait(`Saving local Backup... (Saving database)`)

    await writer.writeBackup('database.risudat', dbData)
    noteImportPhase(MEASURE ? `export database written ${describeWriteMeasure()}` : 'export database written')
    await writer.close()
    noteImportPhase(MEASURE ? `export closed ${describeWriteMeasure()}` : 'export closed')

    const lateColdStorageReport = describeLateColdStorageKeys(late)
    const leftOutInlayNames = inlayResult.leftOut.map((left) => left.id)
    const omitted: ExportOmitted = {
        assets: [...missingAssets],
        oversize: [...leftOut],
        units: [...new Set([...cold.unavailableKeys, ...late.missingKeys, ...late.invalidKeys])],
        inlays: [...inlayResult.leftOut],
        oldStoreUnlisted: inlayResult.oldStoreUnlisted,
        repaired: repairNotice,
    }
    if (missingAssets.length > 0 || lateColdStorageReport || leftOutInlayNames.length > 0 || inlayResult.oldStoreUnlisted || repairNotice || leftOut.length > 0) {
        let message = missingAssets.length > 0
            ? 'Backup Successful, but the following assets were missing and skipped:\n\n'
            : (lateColdStorageReport || leftOutInlayNames.length > 0 || inlayResult.oldStoreUnlisted || leftOut.length > 0)
                ? 'Backup Successful, but some data could not be included:\n\n'
                : 'Backup Successful.\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        if (missingAssets.length > 0 && lateColdStorageReport) {
            message += '\n'
        }
        message += lateColdStorageReport
        if (leftOutInlayNames.length > 0) {
            if (missingAssets.length > 0 || lateColdStorageReport) {
                message += '\n\n'
            }
            message += language.backupInlaysLeftOut(leftOutInlayNames.length, shownSkippedNames(leftOutInlayNames))
        }
        if (inlayResult.oldStoreUnlisted) {
            if (missingAssets.length > 0 || lateColdStorageReport || leftOutInlayNames.length > 0) {
                message += '\n\n'
            }
            message += language.backupInlaysOldStoreUnlisted
        }
        if (repairNotice) {
            message += (message.endsWith('\n') ? '\n' : '\n\n') + repairNotice
        }
        if (leftOut.length > 0) {
            message += (message.endsWith('\n') ? '\n' : '\n\n') + language.backupOversizeLeftOut(leftOut)
        }
        alertMd(message)
        return { status: 'saved', notices: [message], omitted, inlays: inlayResult }
    }
    alertNormal('Success')
    return { status: 'saved', notices: [], omitted, inlays: inlayResult }
}

/**
 * Saves a partial local backup with only critical assets.
 * 
 * Differences from SaveLocalBackup:
 * - Only includes profile images for characters/groups (excludes emotion images, additional assets, VITS files, CC assets)
 * - Additionally includes: persona icons, folder images, bot preset images
 * - Processes only assets in assetMap (selective) instead of every file in the assets folder
 * - Faster and more efficient for quick backups
 * - Ideal for backing up core visual identity without bulk data
 */
export async function SavePartialLocalBackup(options: BackupExportOptions = {}): Promise<ExportOutcome>{
    // First confirmation: Explain the difference from regular backup
    const firstConfirm = await alertConfirm(language.partialBackupFirstConfirm)

    if (!firstConfirm) {
        return { status: 'declined', cause: 'partial-explanation-declined' }
    }

    // Second confirmation: Final warning about not saving assets
    const secondConfirm = await alertConfirm(language.partialBackupSecondConfirm)

    if (!secondConfirm) {
        return { status: 'declined', cause: 'partial-explanation-declined' }
    }

    return withBusy('backupSave', () => runExport((session) => writePartialLocalBackup(session, options)))
}

/**
 * The export a parked Node page offers before it reloads: the partial-backup shape (the database, the characters and
 * the profile images, no other assets and no inlays) without the two explanatory confirms, because the person already
 * chose this export. It holds the same busy entry as the other exports. It does not pin this tab's unit references: a
 * unit that is gone surfaces through the incomplete-data prompt, and declining it returns `declined`.
 */
export function exportThisTabBackup(options: BackupExportOptions = {}): Promise<ExportOutcome>{
    return withBusy('backupSave', () => runExport((session) => writePartialLocalBackup(session, options)))
}

async function writePartialLocalBackup(session: ExportSession, options: BackupExportOptions): Promise<ExportOutcome>{
    alertWait("Saving partial local backup...")
    const db = getDatabase()
    const collected = await collectBackupColdStorage(db, options)
    if(!await confirmIncompleteColdStorageOperation(db, collected.unavailableKeys, 'backup', collected.collected.owners)){
        return { status: 'declined', cause: 'incomplete-data-declined' }
    }

    // Before the writer opens, name the units and stub entries a backup entry cannot hold and ask. The partial backup
    // lists no asset sizes, so an asset of 4 GiB or more still fails the export when it is reached, as before.
    const oversizePayloads = leaveOutOversizePayloads(collected, options.limitBytes ?? UPSTREAM_HARD_LIMIT_BYTES)
    const leftOut = oversizeNames(new Map(), [], oversizePayloads.items)
    if (!await confirmLeaveOut(leftOut)) {
        return { status: 'declined', cause: 'oversize-declined' }
    }
    const cold = oversizePayloads.cold
    const coldStoragePayloads = cold.collected

    const writer = new LocalWriter()
    const r = await writer.init(undefined, undefined, localBackupFileName(new Date(), true))
    if(!r){
        alertError('Failed')
        return { status: 'declined', cause: 'save-dialog-cancelled' }
    }
    session.writer = writer

    const assetMap = new Map<string, { charName: string, assetName: string }>()
    session.describeAsset = (key) => describeBackupAsset(assetMap, key)

    // Only collect main profile images for both characters and groups
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'
            
            // Save the main profile image (supports both character and group types)
            // Note: emotionImages are intentionally excluded from partial backup
            if (char.image) {
                assetMap.set(char.image, { charName: charName, assetName: 'Profile Image' })
            }
        }
    }
    
    // User icon
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    
    // Persona icons
    if (db.personas) {
        for (const persona of db.personas) {
            if (persona && persona.icon) {
                assetMap.set(persona.icon, { charName: 'Persona', assetName: `${persona.name} Icon` })
            }
        }
    }
    
    // Custom background
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    
    // Folder images in characterOrder
    if (db.characterOrder) {
        for (const item of db.characterOrder) {
            if (typeof item !== 'string' && item.img) {
                assetMap.set(item.img, { charName: 'Folder', assetName: `${item.name} Folder Image` })
            }
            if (typeof item !== 'string' && item.imgFile) {
                assetMap.set(item.imgFile, { charName: 'Folder', assetName: `${item.name} Folder Image File` })
            }
        }
    }
    
    // Bot preset images
    if (db.botPresets) {
        for (const preset of db.botPresets) {
            if (preset && preset.image) {
                assetMap.set(preset.image, { charName: 'Preset', assetName: `${preset.name} Preset Image` })
            }
        }
    }
    
    const missingAssets: string[] = []

    const store = await getAppStore()
    const assetKeys = Array.from(assetMap.keys())
    const streamAssets = await desktopStreamingUsable()

    for(let i=0;i<assetKeys.length;i++){
        const key = assetKeys[i]
        let message = `Saving partial local backup... (${i + 1} / ${assetKeys.length})`
        if (missingAssets.length > 0) {
            const skippedItems = missingAssets.map(key => {
                const assetInfo = assetMap.get(key);
                return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
            }).join(', ');
            message += `\n(Skipping... ${skippedItems})`;
        }
        alertWait(message)

        // A referenced key outside assets/ is not an asset of this store.
        if(!key || !key.startsWith('assets/')){
            continue
        }

        // A referenced asset that is absent or cannot be read is reported
        // as missing on every platform, and the backup goes on.
        if (streamAssets) {
            if (await writeAssetStreamed(writer, key) === 'missing') {
                missingAssets.push(key)
            }
            continue
        }
        let data: Uint8Array | null = null
        try {
            data = (await store.read(key)).bytes
        } catch (e) {
            console.error(e)
        }
        if (data) {
            await writer.writeBackup(key, data)
        } else {
            missingAssets.push(key)
        }
    }

    for(let i=0;i<coldStoragePayloads.payloads.length;i++){
        const payload = coldStoragePayloads.payloads[i]
        let message = `Saving partial local Backup Cold data... (${i + 1} / ${coldStoragePayloads.payloads.length})`
        alertWait(message)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }

    const { dbData, late, repairNotice, stubPayloads } = await encodeDatabaseWithLateColdStorage(db, cold)
    await writeStubPayloadsAndRelease(writer, cold, stubPayloads, 'Saving partial local Backup Cold data...')
    for(let i=0;i<late.payloads.length;i++){
        const payload = late.payloads[i]
        alertWait(`Saving partial local Backup Cold data... (${i + 1} / ${late.payloads.length})`)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }

    alertWait(`Saving partial local backup... (Saving database)`)

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    const lateColdStorageReport = describeLateColdStorageKeys(late)
    // The partial export writes no inlays, so it has none to list as left out.
    const omitted: ExportOmitted = {
        assets: [...missingAssets],
        oversize: [...leftOut],
        units: [...new Set([...cold.unavailableKeys, ...late.missingKeys, ...late.invalidKeys])],
        inlays: [],
        oldStoreUnlisted: false,
        repaired: repairNotice,
    }
    if (missingAssets.length > 0 || lateColdStorageReport || repairNotice || leftOut.length > 0) {
        let message = missingAssets.length > 0
            ? 'Partial backup successful, but the following profile images were missing and skipped:\n\n'
            : (lateColdStorageReport || leftOut.length > 0)
                ? 'Partial backup successful, but some data could not be included:\n\n'
                : 'Partial backup successful.\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        if (missingAssets.length > 0 && lateColdStorageReport) {
            message += '\n'
        }
        message += lateColdStorageReport
        if (repairNotice) {
            message += `\n\n${repairNotice}`
        }
        if (leftOut.length > 0) {
            message += `\n\n${language.backupOversizeLeftOut(leftOut)}`
        }
        message += `\n\n${language.partialBackupInlaysNotIncluded}`
        alertMd(message)
        return { status: 'saved', notices: [message], omitted, inlays: null }
    }
    alertNormal(`Success\n\n${language.partialBackupInlaysNotIncluded}`)
    return { status: 'saved', notices: [], omitted, inlays: null }
}

/** Re-exported so every existing importer keeps working; the constant and its rationale live in `restoreLock.ts`. */
export { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS };

/** How many skipped asset names, and how many characters of each, the restore notice lists. */
const SKIPPED_ASSET_NAMES_SHOWN = 20;
const SKIPPED_ASSET_NAME_CHARS_SHOWN = 100;

/** The restore pass yields to the event loop once this much time has passed since its last yield. */
const RESTORE_YIELD_INTERVAL_MS = 50;

/** Entry names longer than this can be neither `database.risudat` nor a cold-storage unit, so the oversized-asset scan reads no more of them. */
const OVERSIZED_NAME_READ_BYTES = BACKUP_NAME_PREFIX_BYTES;

/** The bytes of the longest entry header whose name is the encryption marker: both length fields and the marker name with a byte-order mark. */
const MARKER_HEADER_BYTES = 4 + MAX_MARKER_NAME_BYTES + 4;

/** `bytes` itself when it is a whole buffer of its own, else a copy of it: what outlives a copy-pass iteration must not be a view into the window that held it. */
function ownedBytes(bytes: Uint8Array): Uint8Array {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/** Why a restore left an asset out: the store cannot hold its name, or the Node server cannot take a body that large. */
type SkippedAssetReason = 'invalidName' | 'tooLarge';
interface SkippedAsset { name: string; reason: SkippedAssetReason }

type IndexedEntryCheck =
    | { kind: 'ok'; header: BackupEntryHeader }
    | { kind: 'marker' }
    | { kind: 'changed' };

/**
 * Parses the bytes read for one indexed entry. A complete name that decodes to
 * the marker counts as the marker whether or not its data-length field or
 * body is present (the binding rule in backupContainer.ts), and is decided
 * before any comparison with the index. Otherwise the header must carry the
 * very lengths the walk indexed and `bytes` must be exactly `expectedLength`
 * long, or the file is not what the walk saw.
 */
function checkIndexedEntry(bytes: Uint8Array, entry: BackupIndexEntry, expectedLength: number): IndexedEntryCheck {
    const result = parseBackupEntryHeader(bytes);
    if (result.status !== 'ok') {
        if (result.stage === 'dataLength' && !result.nameSkipped
                && decodeEntryName(bytes, result.nameLength) === BACKUP_ENCRYPTION_MARKER_NAME) {
            return { kind: 'marker' };
        }
        return { kind: 'changed' };
    }
    const header = result.header;
    if (header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
        return { kind: 'marker' };
    }
    if (header.nameLength !== entry.nameLength
            || header.dataLength !== entry.dataLength
            || header.headerLength !== entry.headerLength
            || bytes.length !== expectedLength) {
        return { kind: 'changed' };
    }
    return { kind: 'ok', header };
}

/**
 * The asset entries whose body is over what the Node server takes in one
 * request, with their names. Judged from the walk's index alone: a cold-storage
 * unit is stored compressed, so its length in the backup says nothing about
 * what is written, and the database is not an asset. An inlay part is not an
 * asset either: it is judged by `listOversizedInlays`. The walk kept the name
 * (its first `OVERSIZED_NAME_READ_BYTES` bytes for a longer one) of every
 * entry over `NODE_BODY_LIMIT_BYTES` when it was asked to.
 */
function listOversizedAssets(entries: readonly BackupIndexEntry[], names: ReadonlyMap<number, string>): { entry: BackupIndexEntry; name: string }[] {
    const found: { entry: BackupIndexEntry; name: string }[] = [];
    for (const entry of entries) {
        if (entry.dataLength <= NODE_BODY_LIMIT_BYTES) {
            continue;
        }
        const name = names.get(entry.headerOffset);
        if (name === undefined) {
            throw new Error(`The walk kept no name for the oversized entry at ${entry.headerOffset}.`);
        }
        if (entry.nameLength <= OVERSIZED_NAME_READ_BYTES && (name === 'database.risudat' || getColdStorageBackupKey(name) || parseInlayEntryName(name) !== null)) {
            continue;
        }
        found.push({ entry, name });
    }
    return found;
}

function shownSkippedNames(names: readonly string[]): string[] {
    return names.slice(0, SKIPPED_ASSET_NAMES_SHOWN).map((name) => name.length > SKIPPED_ASSET_NAME_CHARS_SHOWN ? name.slice(0, SKIPPED_ASSET_NAME_CHARS_SHOWN) + '...' : name);
}

/**
 * What the restore of a `.bin` on a store2 page carries from its checks to its commit: the page's committer and
 * backend, where the cold-storage entries sit in the file, the database entry (read from the file and decoded again at
 * the commit, which may throw `BinFileChangedError`; no bytes or tree of it are kept here), and the guard that asks
 * about unsaved edits once.
 */
interface Store2BinImport {
    /** The page's committer and backend; null on a boot import, whose installer is `boot`. */
    target: Store2ImportTarget | null;
    boot: BootImportTarget | null;
    index: ColdEntryIndex;
    entry: BackupIndexEntry;
    guard: UnsavedGuard;
}

/** The notices of what a store2 import left out, in the order the block-era restore shows them; each is awaited before the reload takes the page away. */
function skippedNoticesOf(skippedAssets: readonly SkippedAsset[], skippedInlays: readonly InlaySkipped[]): string[] {
    const notices: string[] = [];
    const invalidNames = skippedAssets.filter((skipped) => skipped.reason === 'invalidName').map((skipped) => skipped.name);
    const tooLargeNames = skippedAssets.filter((skipped) => skipped.reason === 'tooLarge').map((skipped) => skipped.name);
    if (invalidNames.length > 0) {
        notices.push(language.restoreAssetsSkipped(invalidNames.length, shownSkippedNames(invalidNames)));
    }
    if (tooLargeNames.length > 0) {
        notices.push(language.restoreAssetsSkippedTooLarge(tooLargeNames.length, shownSkippedNames(tooLargeNames), NODE_BODY_LIMIT_BYTES));
    }
    const inlayNames = (reason: InlaySkipped['reason']) => skippedInlays.filter((skipped) => skipped.reason === reason).map((skipped) => skipped.label);
    const invalidInlays = inlayNames('invalid');
    const notStoredInlays = inlayNames('notStored');
    const tooLargeInlays = inlayNames('tooLarge');
    if (invalidInlays.length > 0) {
        notices.push(language.restoreInlaysInvalid(invalidInlays.length, shownSkippedNames(invalidInlays)));
    }
    if (notStoredInlays.length > 0) {
        notices.push(language.restoreInlaysNotStored(notStoredInlays.length, shownSkippedNames(notStoredInlays)));
    }
    if (tooLargeInlays.length > 0) {
        notices.push(language.restoreInlaysTooLarge(tooLargeInlays.length, shownSkippedNames(tooLargeInlays), inlayAttachmentLimit()));
    }
    return notices;
}

/** A `.bin` import at start-up: the boot's installer, and the callback that ends the flow with what it came to. */
interface BootBinRun {
    target: BootImportTarget;
    done: (end: BootImportEnd) => void;
}

/**
 * The start-up import of a `.bin`: the same file flow as the Settings restore, with the boot's installer as its target.
 * Resolves once the flow ends however it ends; `cancelled` means nothing was written and the boot may ask again.
 */
export function loadBackupAtBoot(target: BootImportTarget): Promise<BootImportEnd> {
    return new Promise<BootImportEnd>((resolve) => {
        void LoadLocalBackup({ target, done: resolve });
    });
}

/** How a `.bin` import ended, for the shell's caller. */
export type LocalBackupEnd = OperationEnd<ImportFacts>;

/**
 * The `.bin` import, from the picker to the reload. The returned promise never rejects and settles once, with how the
 * import ended; the shell's own alerts are unchanged and no caller needs the value. A successful import reloads the
 * page inside the shell, so in a real page the page is gone before a caller could read `committed`; it is settled
 * after the reload call returns, which is what a test with the reload replaced sees.
 *
 * The promise may stay pending: it settles on the picker's `change` or `cancel` event, and a browser that fires
 * neither on dismissal never settles it. No caller may hold a lock or a busy state across it.
 */
export function LoadLocalBackup(boot?: BootBinRun): Promise<LocalBackupEnd> {
    const operation: OperationName = boot === undefined ? 'import' : 'boot-import';
    // Created before anything can await, so the picker opens in this call's own turn.
    let resolveEnd: (end: LocalBackupEnd) => void = () => { };
    const pending = new Promise<LocalBackupEnd>((resolve) => { resolveEnd = resolve; });
    // Every exit ends here, however it ends; resolving twice is a no-op.
    const settle = (end: LocalBackupEnd): void => resolveEnd(end);
    const unfinished = (outcome: OperationOutcome, cause: OperationCause | null = null): LocalBackupEnd =>
        ({ operation, target: null, outcome, cause, detail: emptyImportFacts() });
    // A restore replaces the database under any work still writing into it.
    // It is refused before the picker opens, again when the picker returns,
    // and again immediately before the database write, since work can start
    // during any of the waits in between.
    if (refuseBackupLoadWhileBusy()) {
        boot?.done({ kind: 'cancelled' });
        settle(unfinished('nothing-replaced', 'busy'));
        return pending;
    }
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.bin';
        // What a boot import came to; `cancelled` until the boot's installer answers.
        let bootEnd: BootImportEnd = { kind: 'cancelled' };
        const restoreSelectedFile = async (busy: BusyHandle): Promise<LocalBackupEnd> => {
            const facts = emptyImportFacts();
            let target: string | null = null;
            // Set before the first asset, inlay or cold-storage write: from then on no exit is `canceled`.
            let writeMayHaveBegun = false;
            const ended = (outcome: OperationOutcome, cause: OperationCause | null = null): LocalBackupEnd =>
                ({ operation, target, outcome, cause, detail: facts });
            const refused = (cause: OperationCause | null = null): LocalBackupEnd => ended('nothing-replaced', cause);
            // The person declined a question: nothing was replaced, and nothing was written only while no write may have begun.
            const declined = (): LocalBackupEnd => ended(writeMayHaveBegun ? 'nothing-replaced' : 'canceled');
            if (!input.files || input.files.length === 0) {
                input.remove();
                return ended('canceled');
            }
            const file = input.files[0];
            input.remove();
            target = file.name;
            facts.source = { kind: 'file', name: file.name, size: file.size, lastModified: file.lastModified };

            // A page that runs from OPFS this time writes nothing, and a restore is refused before it reads or writes anything.
            if (await refuseOnReadOnlyPage()) {
                return refused();
            }

            if (refuseBackupLoadWhileBusy(busy)) {
                return refused('busy');
            }

            // A store2 page imports through `storeImport.ts` instead of the block
            // tail below. Every precondition that can be known now is checked
            // before the file is read: the session, the committer, a bulk marker
            // of another page, and this tab's unsaved edits are saved first.
            // The import target decides how cold-storage entries are handled, not the residency: a boot
            // import (`boot`) has no page mode yet and must still never write a legacy unit, because the
            // old upstream profile's units of the same ids are still the store's.
            let store2Target: Store2ImportTarget | null = null;
            if (boot === undefined && getPageStorageMode().kind === 'store2') {
                const checked = await checkStore2Import();
                if (checked.kind === 'refused') {
                    return refused(checked.cause);
                }
                store2Target = checked.target;
                await saveFirst(SAVE_FIRST_BOUND_MS);
            }

            // Every write below -- an asset, a cold-storage item, or the
            // database itself -- must wait until the whole file is known to
            // carry no encryption.risudat entry (MC-081). A walk exception
            // means the file could not be confirmed safe, so it is treated
            // the same as finding the marker: nothing is written. This scan
            // takes no lock and runs before the cross-tab guard below.
            let hasEncryptionMarker: boolean;
            let backupEntries: BackupIndexEntry[];
            let backupNames: ReadonlyMap<number, string>;
            try {
                let lastWalkProgressText: string | null = null;
                const walk = await indexBackupEntries(file, {
                    oversizeBodyBytes: isNodeServer ? NODE_BODY_LIMIT_BYTES : undefined,
                    onProgress: (scanned, total) => {
                        const progress = total > 0 ? ((scanned / total) * 100).toFixed(2) : '100.00'
                        const progressText = `Checking local backup... (${progress}%)`;
                        if (progressText !== lastWalkProgressText) {
                            lastWalkProgressText = progressText;
                            alertWait(progressText);
                        }
                    }
                });
                hasEncryptionMarker = walk.hasMarker;
                backupEntries = walk.entries;
                backupNames = walk.names;
                noteImportPhase(`walked, ${backupEntries.length} entries`);
            } catch (e) {
                console.error(e);
                alertError(language.backupFileUnreadable);
                return refused();
            }
            if (hasEncryptionMarker) {
                alertError(language.encryptedBackupRefused);
                return refused();
            }

            // A store2 page cannot store the cold-storage entries (it keeps no
            // legacy units), so they are indexed here and read from the file
            // when the imported tree names them. The database entry is located
            // now so that it is decoded, and a large one announced, before the
            // first asset is written.
            let store2Import: Store2BinImport | null = null;
            if (store2Target !== null || boot !== undefined) {
                const scan = scanBinForImport(backupEntries, backupNames);
                if (scan.database === null) {
                    alertError('Failed, Is file corrupted?');
                    return refused();
                }
                store2Import = { target: store2Target, boot: boot?.target ?? null, index: scan.index, entry: scan.database, guard: new UnsavedGuard() };
                noteImportPhase('scanned');
                if (!await confirmImportScale(file.size, backupEntries.length, store2Import.entry.dataLength, scan.index.estimatedUnitBytes)) {
                    return declined();
                }
            }

            // On a Node server a body over the server's request limit can never
            // be stored. Those assets are named before anything is written, and
            // the restore goes on without them only if the user agrees.
            const oversizedAssetNames = new Map<number, string>();
            const inlayCollector = new InlayRestoreCollector(inlayAttachmentLimit());
            if (isNodeServer) {
                let oversizedInlays: { hash: string, id: string }[];
                try {
                    for (const { entry, name } of listOversizedAssets(backupEntries, backupNames)) {
                        oversizedAssetNames.set(entry.headerOffset, name);
                    }
                    oversizedInlays = await listOversizedInlays(file, backupEntries, inlayAttachmentLimit());
                } catch (e) {
                    console.error(e);
                    alertError(language.backupFileUnreadable);
                    return refused();
                }
                if (oversizedAssetNames.size > 0 || oversizedInlays.length > 0) {
                    const names = Array.from(oversizedAssetNames.values());
                    const inlayNames = oversizedInlays.map((inlay) => inlay.id);
                    const question = oversizedInlays.length === 0
                        ? language.restoreOversizedAssetsConfirm(names.length, shownSkippedNames(names), NODE_BODY_LIMIT_BYTES)
                        : names.length === 0
                            ? language.restoreOversizedInlaysConfirm(inlayNames.length, shownSkippedNames(inlayNames), inlayAttachmentLimit())
                            : language.restoreOversizedWithInlaysConfirm(names.length, shownSkippedNames(names), inlayNames.length, shownSkippedNames(inlayNames), inlayAttachmentLimit());
                    if (!await alertConfirm(question)) {
                        return declined();
                    }
                    for (const inlay of oversizedInlays) {
                        inlayCollector.preSkip(inlay.hash, inlay.id);
                    }
                }
            }

            // The database is read and decoded before the tab lock is taken and
            // before the first asset is written: a file that cannot be decoded,
            // or whose left-out blocks the person declines, changes nothing.
            // No database bytes or tree are held across the copy that follows:
            // the commit reads the entry from the file again.
            if (store2Import !== null) {
                alertWait('Reading the database in the backup...');
                try {
                    const omitted = await readBinDatabaseOmitted(file, store2Import.entry);
                    noteImportPhase('database decoded');
                    if (!await confirmLeftOut(omitted)) {
                        return declined();
                    }
                    // The salvage map, kept after the person confirmed it; the decoded tree is never held here.
                    facts.omitted = omitted;
                } catch (e) {
                    console.error(e);
                    alertError(e instanceof BinFileChangedError ? binChangeText(e) : 'Failed, Is file corrupted?');
                    return refused();
                }
            }

            // Nothing else on this browser origin may write the database, or
            // start its own exclusive storage operation, while this restore
            // runs (MC-093). Tauri is single-instance and skips this check
            // and its warning entirely. Once granted, `releaseExclusiveHold`
            // already holds `dbWriteLock` internally for the rest of this
            // restore -- the write below must NOT acquire it a second time,
            // which would deadlock against this same hold.
            let releaseExclusiveHold: ((keepWriteLock?: boolean) => Promise<void>) | null = null;
            if (!isTauri) {
                if (locksSupported === false) {
                    if (!await alertConfirm(language.restoreNoLockWarningConfirm)) {
                        return declined();
                    }
                } else {
                    await tabPresenceLockAcquired;
                    alertWait(language.restoreCheckingOtherTabs);
                    releaseExclusiveHold = await acquireExclusiveStorageMigrationLock(RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS);
                    if (!releaseExclusiveHold) {
                        // A reload already in flight (this attempt was overtaken
                        // by another tab's own exclusive operation, MC-091) needs
                        // no message of its own -- this page is already on its
                        // way out. Otherwise this is an ordinary refusal: another
                        // tab is genuinely open.
                        if (!isAppInitiatedReload()) {
                            alertError(language.restoreOtherTabRefused);
                        }
                        return refused();
                    }
                }
            }

            // From here on, every exit that never lands the restored state
            // must show exactly one message, before releasing whatever hold
            // was taken above -- and every exit that DID land it, or could
            // not tell whether it landed, keeps that hold's write-lock
            // portion closed forever (a reload or restart is imminent),
            // reporting instead that the restore is saved if anything after
            // the replace fails.
            let releaseDbWriteLock: (() => void) | null = null;
            let replaceStarted = false;
            let restoreInstalled = false;
            let writeLockStaysClosed = false;
            try {
                // With the tab lock held, the edits this tab could not save are
                // asked about before the copy, not after hours of it.
                if (store2Import !== null && store2Import.boot === null && releaseExclusiveHold && !await store2Import.guard.check()) {
                    return declined();
                }
                let pendingDatabase: Uint8Array | null = null;
                const restoredColdStorageKeys = new Set<string>();
                const skippedAssets: SkippedAsset[] = [];
                const skippedInlays: InlaySkipped[] = [];
                const yieldBudget = createYieldBudget({ budgetMs: RESTORE_YIELD_INTERVAL_MS, yieldFn: yieldToEventLoop });
                let lastProgressText: string | null = null;

                // This pass reads the file in windows, header-first for an entry
                // the window does not hold. The walk above cleared the file, but
                // the file can still change under this pass, so every entry's
                // header is checked again before anything of it is written: a
                // marker stops the restore, and so does any header that differs
                // from the index or a body that cannot be read.
                //
                // On the desktop and on Android the assets go out in byte-budgeted batches that
                // overlap the reading of later entries. Every way out of the
                // pass -- a stop with a message, a throw, an error answered by a
                // batch, the end of the entries -- first waits for every batch
                // in flight to settle, so no message is shown, no database is
                // written and nothing returns while an asset is still being
                // written. After a batch fails no further entry is read.
                // The pass and the inlay restore below write assets, inlays and (on a block-era page) cold-storage items.
                writeMayHaveBegun = true;
                // Assets handed to the store; the written count is this less the names the pipeline refused, once it has drained.
                let assetsSubmitted = 0;
                const assetPipeline = await createRestoreAssetPipeline();
                const streamLargeAssets = assetPipeline !== null || await desktopStreamingUsable();
                let stopMessage: string | null = null;
                let passFailure: { error: unknown } | null = null;
                let visitedEntries = 0;
                // Pass 2 reads through a reader of its own, built only now: it
                // shares no window with the walk, so every header below is
                // compared with the file as it is after the walk finished.
                const copyWindowBytes = backupCopyWindowBytes();
                const copyReader = createBlobWindowReader(file, copyWindowBytes);
                try {
                    for (const entry of backupEntries) {
                        if (assetPipeline?.failure) {
                            break;
                        }
                        // A stream running beside this loop found its source changed: nothing read from here on can be written.
                        if (assetPipeline?.sourceChanged) {
                            stopMessage = language.backupFileChangedWhileReading;
                            break;
                        }
                        visitedEntries++;
                        if (visitedEntries % IMPORT_COPY_PHASE_EVERY === 0) {
                            noteImportPhase(`copy ${visitedEntries} of ${backupEntries.length} entries`);
                        }
                        const entryEnd = entry.headerOffset + entry.headerLength + entry.dataLength;
                        const progressText = `Loading local Backup... (${((entryEnd / file.size) * 100).toFixed(2)}%)`;
                        if (progressText !== lastProgressText) {
                            lastProgressText = progressText;
                            alertWait(progressText);
                        }

                        // The header is read and checked first; the data follows only
                        // for an entry that is not left out. For an asset left out for
                        // its size, only its header is read, padded to the first 29 bytes
                        // (MARKER_HEADER_BYTES) of the entry when the header is shorter,
                        // and never more than the entry holds: enough to
                        // see a whole marker header wherever the file now has one at
                        // this position, whatever header the index holds.
                        const isSkippedForSize = oversizedAssetNames.has(entry.headerOffset);
                        const dataStart = entry.headerOffset + entry.headerLength;
                        const headerReadLength = Math.min(entry.headerLength + entry.dataLength, Math.max(entry.headerLength, MARKER_HEADER_BYTES));
                        // An entry larger than a window is not worth a window of its own: its header is read exactly.
                        const fillsWindow = entry.headerLength + entry.dataLength <= copyWindowBytes;
                        let headerBytes: Uint8Array;
                        try {
                            headerBytes = await copyReader.view(entry.headerOffset, headerReadLength, fillsWindow);
                        } catch (error) {
                            console.error(error);
                            stopMessage = language.backupFileChangedWhileReading;
                            break;
                        }

                        const checked = checkIndexedEntry(headerBytes, entry, headerReadLength);
                        if (checked.kind === 'marker') {
                            stopMessage = language.encryptedBackupImportStopped;
                            break;
                        }
                        if (checked.kind === 'changed') {
                            stopMessage = language.backupFileChangedWhileReading;
                            break;
                        }
                        const name = checked.header.name;
                        if (name === undefined) {
                            // parseBackupEntryHeader is called with no name-length
                            // limit, so every entry name here is always decoded; this
                            // only narrows the type.
                            continue;
                        }
                        // An inlay part is routed here, ahead of the size rule and of
                        // every asset path, whatever its size: it is held as a slice
                        // of the file until all its parts are in, and is never an asset.
                        const inlayPart = parseInlayEntryName(name);
                        if (inlayPart !== null) {
                            const partData = file.slice(dataStart, dataStart + entry.dataLength);
                            const added = partData.size === entry.dataLength
                                ? await inlayCollector.add(name, inlayPart.hash, inlayPart.index, partData)
                                : 'unreadable';
                            if (added === 'unreadable') {
                                stopMessage = language.backupFileChangedWhileReading;
                                break;
                            }
                            await yieldBudget.maybeYield();
                            continue;
                        }
                        if (isSkippedForSize) {
                            skippedAssets.push({ name, reason: 'tooLarge' });
                            await yieldBudget.maybeYield();
                            continue;
                        }
                        // A store2 page decoded the database above and reads the
                        // cold-storage entries from the file on demand: neither is
                        // read or stored by this pass.
                        if (store2Import !== null && (name === 'database.risudat' || getColdStorageBackupKey(name))) {
                            await yieldBudget.maybeYield();
                            continue;
                        }
                        // Where streamLargeAssets holds (the desktop, and Android with
                        // a pipeline), an asset above the pipeline's batch size
                        // (CHUNK_MAX without a pipeline) is copied to the store in
                        // slices and is never read whole, and is never handed to
                        // `add`, which refuses it. The database and the
                        // cold-storage entries are decoded as a whole, and read whole.
                        if (streamLargeAssets && entry.dataLength > (assetPipeline?.batchBytes ?? CHUNK_MAX)
                                && name !== 'database.risudat' && !getColdStorageBackupKey(name)) {
                            const assetKey = 'assets/' + name;
                            noteAssetWrittenThisPage(assetKey);
                            const streamed: StreamedAssetEntry = {
                                key: assetKey,
                                name,
                                index: entry.headerOffset,
                                size: entry.dataLength,
                                readSlice: async (start, end) => new Uint8Array(await file.slice(dataStart + start, dataStart + end).arrayBuffer()),
                            };
                            if (assetPipeline) {
                                if (await assetPipeline.addStreamed(streamed)) {
                                    stopMessage = language.backupFileChangedWhileReading;
                                    break;
                                }
                                assetsSubmitted++;
                            } else {
                                const outcome = await streamAssetEntry(streamed, openAssetStream);
                                if (outcome.k === 'stopped') {
                                    // No stop condition is passed here, so this cannot happen; it must not count as written.
                                    throw new Error('a stream stopped without a stop condition');
                                }
                                if (outcome.k === 'source') {
                                    console.error(outcome.error);
                                    stopMessage = language.backupFileChangedWhileReading;
                                    break;
                                }
                                if (outcome.k === 'sink') {
                                    throw outcome.error;
                                }
                                if (outcome.k === 'invalid') {
                                    console.error(`asset ${assetKey} was refused: ${outcome.reason}`);
                                    skippedAssets.push({ name, reason: 'invalidName' });
                                } else {
                                    assetsSubmitted++;
                                }
                            }
                            await yieldBudget.maybeYield();
                            continue;
                        }

                        let data: Uint8Array;
                        try {
                            data = await copyReader.view(dataStart, entry.dataLength, fillsWindow);
                        } catch (error) {
                            console.error(error);
                            stopMessage = language.backupFileChangedWhileReading;
                            break;
                        }
                        if (data.length !== entry.dataLength) {
                            stopMessage = language.backupFileChangedWhileReading;
                            break;
                        }

                        if (name === 'database.risudat') {
                            // Kept past this iteration: owned bytes, not a view that would hold a whole window alive.
                            pendingDatabase = ownedBytes(data);
                        }

                        else {
                            const coldStorageKey = getColdStorageBackupKey(name)
                            let handledAsColdStorage = false

                            if (coldStorageKey) {
                                handledAsColdStorage = true
                                try {
                                    const text = new TextDecoder().decode(data)
                                    const jsonData = JSON.parse(text)

                                    if (isAcceptedColdStorageBackupEntry(name, jsonData)) {
                                        if(await setColdStorageItem(coldStorageKey, jsonData)){
                                            restoredColdStorageKeys.add(coldStorageKey)
                                        } else {
                                            console.error(`Failed to restore cold storage item ${coldStorageKey}`)
                                        }
                                    } else {
                                        console.warn(`Skipping invalid cold storage backup item ${name}`)
                                    }
                                } catch (e) {
                                    console.error(`Failed to parse cold storage item ${coldStorageKey}:`, e)
                                }
                            }

                            if (!handledAsColdStorage) {
                                // The entry name comes from the file. A name the store
                                // cannot hold (a leading dot, a character the desktop
                                // file system forbids, a reserved temp name) skips that
                                // entry and is reported after the database is written;
                                // a 413 for a body under the Node server's own limit
                                // means a proxy or the server refused the size, and the
                                // restore stops saying so; any other failure aborts the
                                // restore.
                                const assetKey = 'assets/' + name
                                noteAssetWrittenThisPage(assetKey)
                                if (assetPipeline) {
                                    // The header offset orders the skip report by position in the file.
                                    // The pipeline holds the entry until its batch is sent, and counts the entry's own bytes
                                    // against its budget, so it gets an owned copy, not a view of the window.
                                    await assetPipeline.add({ key: assetKey, name, index: entry.headerOffset, data: ownedBytes(data) })
                                    assetsSubmitted++
                                } else {
                                    try {
                                        await (await getAppStore()).write(assetKey, data, 'unconditional')
                                        assetsSubmitted++
                                    } catch (error) {
                                        if (error instanceof NodeHttpError && error.status === 413 && error.operation === 'write') {
                                            console.error(error)
                                            stopMessage = language.restoreAssetRefusedTooLarge(name.length > SKIPPED_ASSET_NAME_CHARS_SHOWN ? name.slice(0, SKIPPED_ASSET_NAME_CHARS_SHOWN) + '...' : name)
                                            break
                                        }
                                        if (!(error instanceof StoreInvalidKeyError)) {
                                            throw error
                                        }
                                        console.error(error)
                                        skippedAssets.push({ name, reason: 'invalidName' })
                                    }
                                }
                            }
                        }
                        await yieldBudget.maybeYield();
                    }
                } catch (error) {
                    passFailure = { error };
                }
                if (assetPipeline) {
                    if (stopMessage !== null || passFailure !== null) {
                        // The loop ended for its own reason: streams still writing stop at their next chunk instead of finishing whole entries.
                        assetPipeline.stopStreams();
                    }
                    if (stopMessage === null && passFailure === null && assetPipeline.failure === null
                            && !assetPipeline.sourceChanged && assetPipeline.outstanding) {
                        // Every entry has been read; the percentage stays at its last value until the copies end.
                        alertWait('Finishing copying files...');
                    }
                    await assetPipeline.drain();
                    if (assetPipeline.sourceChanged && stopMessage === null) {
                        stopMessage = language.backupFileChangedWhileReading;
                    }
                }
                if (passFailure) {
                    throw passFailure.error;
                }
                if (stopMessage !== null) {
                    alertError(stopMessage);
                    return refused();
                }
                if (assetPipeline) {
                    if (assetPipeline.failure) {
                        throw assetPipeline.failure.error;
                    }
                    for (const refusedAsset of assetPipeline.invalidAssets()) {
                        skippedAssets.push({ name: refusedAsset.name, reason: 'invalidName' });
                    }
                }
                // The pipeline has drained: what it was handed less what the store refused by name.
                facts.assets = { written: assetsSubmitted - (assetPipeline?.invalidAssets().length ?? 0), skipped: skippedAssets };

                // Written before the database is looked at, so a file cut short
                // after some complete inlays keeps them; a part that is missing
                // keeps its whole inlay out. Additive, like the assets.
                const inlayOutcome = await restoreCollectedInlays(inlayCollector);
                if (inlayOutcome.changed) {
                    alertError(language.backupFileChangedWhileReading);
                    return refused();
                }
                skippedInlays.push(...inlayOutcome.skipped);
                facts.inlays = inlayOutcome;

                // A store2 page ends here: the imported tree is the page's new
                // profile, committed under the write lock (the hold already
                // holds it where there is one; otherwise it is taken now,
                // before the unsaved-edits check, the commit-key read and the
                // build). The commit keeps the state it replaces as an earlier
                // saved version. The block-era tail below is not reached.
                if (store2Import !== null) {
                    noteImportPhase('assets copied');
                    const databaseEntry = store2Import.entry;
                    if (!releaseExclusiveHold) {
                        releaseDbWriteLock = await dbWriteLock.acquire();
                    }
                    if (store2Import.boot !== null) {
                        // A boot import has no earlier saved state and no page to reload: the dispatch opens what was installed.
                        alertWait('Loading backup...');
                        noteImportPhase('loading backup, boot');
                        bootEnd = await commitBootImport({
                            target: store2Import.boot,
                            decode: () => readBinDatabaseTree(file, databaseEntry),
                            reader: createBinImportReader(file, store2Import.index, store2Import.boot.readColdStorageItem),
                            onAccepted: (items) => { facts.incomplete = items; },
                        });
                        // Only an install that landed has anything left out to report; each notice is awaited so the dispatch
                        // does not open the profile (or reload onto it) over an unread notice.
                        if (bootEnd.kind === 'finished' && bootEnd.result.status === 'installed') {
                            for (const notice of skippedNoticesOf(skippedAssets, skippedInlays)) {
                                await alertNormalWait(notice);
                            }
                        }
                        alertStore.set({ type: 'none', msg: '' });
                        if (bootEnd.kind === 'cancelled') {
                            return declined();
                        }
                        if (bootEnd.result.status === 'installed') {
                            facts.flushed = bootEnd.result.flushed;
                            facts.repair = bootEnd.result.repair;
                        }
                        const mapped = outcomeOfBootFinish(bootEnd.result);
                        return ended(mapped.outcome, mapped.cause);
                    }
                    if (store2Import.target === null) {
                        alertError('Failed, Is file corrupted?');
                        return refused();
                    }
                    if (!await store2Import.guard.check()) {
                        return declined();
                    }
                    alertWait('Loading backup...');
                    noteImportPhase('loading backup');
                    const end = await commitStore2Import({
                        target: store2Import.target,
                        busy,
                        decode: () => readBinDatabaseTree(file, databaseEntry),
                        reader: createBinImportReader(file, store2Import.index),
                    });
                    switch (end.kind) {
                        case 'refused':
                            return refused(end.cause);
                        case 'unconfirmed':
                            // Which state is current is unknown: nothing may save from this page until a reload shows it.
                            writeLockStaysClosed = true;
                            if (releaseExclusiveHold) {
                                await releaseExclusiveHold(true);
                            }
                            return ended('unknown');
                        case 'landed':
                            restoreInstalled = true;
                            writeLockStaysClosed = true;
                            facts.flushed = end.flushed;
                            facts.repair = end.repair;
                            facts.incomplete = end.incomplete;
                            await announceStore2Import(end, skippedNoticesOf(skippedAssets, skippedInlays), () => reloadOntoRestoredState(releaseExclusiveHold));
                            return ended('committed');
                    }
                }

                // The block-era tail: the finishing message ends with the copies, and the decode and replace run under this one.
                alertWait('Loading backup...');
                if(!pendingDatabase){
                    alertError('Failed, Is file corrupted?')
                    return refused()
                }

                // A block-format database is read by `salvageRisuSave`, which
                // never consults the current profile's block cache: a block the
                // file lacks is left out and reported, never filled from
                // another save. Older msgpack formats have no blocks and no
                // cache.
                const db = pendingDatabase;
                let dbData: Database;
                let omitted: ReadonlyMap<string, SalvageOmittedBlock> = new Map();
                if (isBlockFormatSave(db)) {
                    const salvaged = await salvageRisuSave(db);
                    dbData = salvaged.db;
                    omitted = salvaged.omitted;
                } else {
                    dbData = await decodeRisuSave(db);
                }
                const leftOut = describeOmitted(omitted, currentCharacterNames());
                if (leftOut.length > 0 && !await alertConfirm(leftOutQuestion(leftOut))) {
                    return declined();
                }
                facts.omitted = omitted;
                const missingColdStorageKeys:string[] = []
                // An upstream plugin storage index becomes per-key `_coldplugin` units here, after every unit entry was
                // written and before the presence check below, so the installed tree never holds the pointer; whatever
                // the conversion could not place joins the keys the question below reports.
                const indexConversion = await convertPluginStorageIndex(dbData.pluginCustomStorage, {
                    read: readColdStorageItem,
                    write: setColdStorageItem,
                    mint: v4,
                })
                for(const key of indexConversion.minted){
                    restoredColdStorageKeys.add(key)
                }
                missingColdStorageKeys.push(...indexConversion.missing)
                // A plugin storage unit is present whatever value it holds;
                // chat and character units must also be chat or character shaped.
                const pluginColdStorageKeys = new Set(listColdPluginStorageKeys(dbData))
                for(const key of await listColdDataKeys(dbData)){
                    if(restoredColdStorageKeys.has(key)){
                        continue
                    }
                    const existingColdStorage = await readColdStorageItem(key)
                    const isPresent = existingColdStorage.status === 'ok'
                        && (pluginColdStorageKeys.has(key) || isColdStorageBackupData(existingColdStorage.value))
                    if(!isPresent){
                        missingColdStorageKeys.push(key)
                    }
                }
                if(!await confirmIncompleteColdStorageOperation(dbData, missingColdStorageKeys, 'restore')){
                    return declined()
                }

                // The character list is made one the save can hold first, with
                // the archived units in the store to read an archived
                // character's id back from: they were all written above.
                const characterRepair = await repairRestoredCharacters(dbData);
                if ('refusal' in characterRepair) {
                    alertError(characterRepair.refusal);
                    return refused();
                }
                // Repairs ids on the decoded backup before installing it,
                // matching every other backup-loading path -- never left
                // for boot's own repair after the reload below, which
                // would leave a duplicate or missing chat id live in this
                // page's own in-memory database for as long as this page
                // stays open before that reload actually happens.
                repairDatabaseIds(dbData)
                // The restored tree becomes a new block generation: its lists
                // are filled in first, then a database that names no preset
                // keeps its working settings as a new preset, over none.
                completeRestoredTree(dbData);
                repairBotPresetsId(dbData)
                const built = await buildRestoreSet(dbData);
                if ('refusal' in built) {
                    alertError(built.refusal);
                    return refused();
                }
                const restoredSet = built.set;

                // The exclusive hold taken above (when granted) already holds
                // dbWriteLock internally for the rest of this restore --
                // acquiring it again here would deadlock against that same
                // hold. Only the Tauri and Web-Locks-unsupported paths, which
                // never took it, still need it directly: the same write mutex
                // saveDb()'s autosave loop takes around its commit (see
                // globalApi.svelte.ts's AsyncMutex/dbWriteLock). It is held
                // across the whole replace, so no save iteration that took its
                // layout before this restore can commit into the restored
                // generation.
                if (!releaseExclusiveHold) {
                    releaseDbWriteLock = await dbWriteLock.acquire();
                }

                // The same busy check is asked again at the flip, inside the
                // replace, so work that began while the generation was being
                // written is seen: a refusal then leaves the live state as it
                // was and removes the restore's own generation. The assets and
                // cold-storage items already read from the file stay, as on
                // the other early exits. The finally releases what was taken
                // above.
                if (refuseBackupLoadWhileBusy(busy)) {
                    return refused('busy');
                }

                replaceStarted = true;
                const written = await replaceWithRestoredSet(restoredSet, () => !refuseBackupLoadWhileBusy(busy));
                if (written.kind === 'not-happened') {
                    // The busy guard has already said why when it was the one that refused.
                    if (!written.aborted) {
                        alertError(language.restoreNotHappenedNotice);
                    }
                    return refused(written.aborted ? 'busy' : null);
                }
                if (written.kind === 'too-large') {
                    alertError(language.restoreTooLargeBlock(describeBlockForPerson(written.blockName), written.limit));
                    return refused();
                }
                if (written.kind === 'unsavable') {
                    alertError(language.restoreRefusedUnsavable(describeBlockForPerson(written.blockName)));
                    return refused('unsavable');
                }
                if (written.kind === 'unconfirmed') {
                    // Which state is current is unknown: nothing may save from
                    // this page until a reload shows it.
                    writeLockStaysClosed = true;
                    alertStore.set({
                        type: "wait",
                        msg: language.saveDamagedUnconfirmed
                    });
                    if (releaseExclusiveHold) {
                        await releaseExclusiveHold(true);
                    }
                    return ended('unknown');
                }
                restoreInstalled = true;
                writeLockStaysClosed = true;

                // Installed only now that the restored state is the page's
                // head -- any other result above leaves this page on its
                // pre-restore database, so the message shown for it can
                // truthfully say the restore did not complete.
                setDatabase(dbData);
                requiresFullEncoderReload.state = true;

                // Awaited here, before the wait notice below and the reload that
                // would hide it. Plain text: the names come from the file.
                const skippedInvalidNames = skippedAssets.filter((skipped) => skipped.reason === 'invalidName').map((skipped) => skipped.name);
                const skippedTooLargeNames = skippedAssets.filter((skipped) => skipped.reason === 'tooLarge').map((skipped) => skipped.name);
                if (skippedInvalidNames.length > 0) {
                    await alertNormalWait(language.restoreAssetsSkipped(skippedInvalidNames.length, shownSkippedNames(skippedInvalidNames)));
                }
                if (skippedTooLargeNames.length > 0) {
                    await alertNormalWait(language.restoreAssetsSkippedTooLarge(skippedTooLargeNames.length, shownSkippedNames(skippedTooLargeNames), NODE_BODY_LIMIT_BYTES));
                }
                const skippedInlayNames = (reason: InlaySkipped['reason']) => skippedInlays.filter((skipped) => skipped.reason === reason).map((skipped) => skipped.label);
                const invalidInlays = skippedInlayNames('invalid');
                const notStoredInlays = skippedInlayNames('notStored');
                const tooLargeInlays = skippedInlayNames('tooLarge');
                if (invalidInlays.length > 0) {
                    await alertNormalWait(language.restoreInlaysInvalid(invalidInlays.length, shownSkippedNames(invalidInlays)));
                }
                if (notStoredInlays.length > 0) {
                    await alertNormalWait(language.restoreInlaysNotStored(notStoredInlays.length, shownSkippedNames(notStoredInlays)));
                }
                if (tooLargeInlays.length > 0) {
                    await alertNormalWait(language.restoreInlaysTooLarge(tooLargeInlays.length, shownSkippedNames(tooLargeInlays), inlayAttachmentLimit()));
                }
                // Awaited like the notices above, so it is read before the reload
                // takes the page away; only a restore that landed gets here.
                if (characterRepair.notice !== null) {
                    await alertNormalWait(characterRepair.notice);
                }

                alertStore.set({
                    type: "wait",
                    msg: "Success, Refreshing your app."
                });
                // The exclusive hold's Web Lock portion (if any) has nothing
                // further to protect once this page's own write has landed --
                // other tabs may now proceed. Its write-lock portion stays closed
                // forever (`keepWriteLock`): a save from this now-stale page,
                // encoded from the pre-restore database before setDatabase()
                // above installed the restored one, would otherwise commit
                // into the restored generation before the reload. Awaited before marking the
                // reload as app-initiated below: this release can itself
                // queue behind another tab's own pending exclusive request
                // for longer than the mark's own lifetime
                // (`APP_INITIATED_RELOAD_RESET_MS` in reloadGuard.ts), and a
                // mark that expired before the navigation would let the
                // "Leave site?" guard stop it.
                if (releaseExclusiveHold) {
                    await releaseExclusiveHold(true);
                }
                markAppInitiatedReload();
                await reloadAfterRestore();
                return ended('committed');
            } catch (error) {
                console.error(error);
                if (restoreInstalled) {
                    // The restored head already landed and the in-memory database is
                    // installed; a reload or restart is already in flight (or
                    // was attempted). Whatever failed after that must never be
                    // reported as "nothing happened" -- the write lock stays
                    // closed, since another write from this now-stale context
                    // must never follow a restore that already committed.
                    alertStore.set({
                        type: "wait",
                        msg: language.restoreSavedReloadOrRestart
                    });
                    return ended('committed');
                } else if (replaceStarted) {
                    alertError(language.restoreWriteFailed);
                } else {
                    alertError('Failed, Is file corrupted?');
                }
                if (bootEnd.kind === 'finished') {
                    // The dispatch is told this finished result, so the end names the same fact however the tail of the import threw.
                    const mapped = outcomeOfBootFinish(bootEnd.result);
                    return ended(mapped.outcome, mapped.cause);
                }
                return ended('failed');
            } finally {
                if (!writeLockStaysClosed) {
                    if (releaseDbWriteLock) {
                        releaseDbWriteLock();
                    }
                    if (releaseExclusiveHold) {
                        await releaseExclusiveHold();
                    }
                }
            }
        };
        // Registered on the picker's change event (never at picker open, which a cancelled pick never resolves), and ended however the restore leaves.
        input.onchange = async () => {
            const busy = beginBusy('backupLoad');
            // Stays `failed` only if the restore throws past its own handling, which then rejects this handler as before.
            let end: LocalBackupEnd = unfinished('failed');
            try {
                end = await restoreSelectedFile(busy);
            } finally {
                busy.end();
                boot?.done(bootEnd);
                settle(end);
            }
        };
        // A cancelled picker never fires `change`; the import ends so a boot can ask again and the returned promise settles.
        input.addEventListener('cancel', () => {
            boot?.done({ kind: 'cancelled' });
            settle(unfinished('canceled'));
        });

        input.click();
    } catch (error) {
        console.error(error);
        alertError('Failed, Is file corrupted?')
        boot?.done({ kind: 'cancelled' });
        settle(unfinished('failed'));
    }
    return pending;
}
