import { alertError, alertNormal, alertNormalWait, alertStore, alertWait, alertMd, alertConfirm } from "../alert";
import { remove } from "@tauri-apps/plugin-fs";
import type { ExportByteWriter } from "../exportWriters";
import { LocalWriter, TauriWriter, requiresFullEncoderReload, dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported, noteAssetWrittenThisPage, describeBlockForPerson } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri, isNodeServer } from "src/ts/platform"
import { decodeRisuSave, encodeRisuSaveLegacy, isBlockFormatSave, salvageRisuSave, type SalvageOmittedBlock } from "../storage/risuSave";
import { getAppStore, getAppStoreKind } from "../storage/store/appStore";
import type { ByteStore } from "../storage/store/contract";
import { StoreInvalidKeyError } from "../storage/store/errors";
import { isAssetBatchAvailable, listAssetsSized, readAssetBatch, writeAssetBatch, type AssetPutEntry, type AssetPutResult, type SizedAssetKey } from "../storage/tauriAssetBatch";
import { CHUNK_MAX, createChunkedWriter, isDesktopTransport, readRangedPieces, type RangedPiece } from "../storage/tauriByteTransport";
import { ExportAssetReader, RestoreAssetPipeline, streamAssetEntry, type StreamedAssetEntry } from "./assetBatchPipeline";
import { NodeHttpError } from "../storage/store/nodeHttpStore";
import { NODE_BODY_LIMIT_BYTES } from "../storage/nodeBodyLimit";
import { createYieldBudget, yieldToEventLoop } from "../storage/saveYield";
import { getDatabase, setDatabase, type Database } from "../storage/database.svelte";
import { repairBotPresetsId } from "../storage/botPresetRepair";
import { describeOmitted } from "../storage/bootBlockLoad";
import { treeToBlockSet } from "../storage/treeToBlockSet";
import { completeRestoredTree, currentCharacterNames, leftOutQuestion, replaceWithRestoredSet } from "./restoreReplace";
import { repairDatabaseIds } from "../process/chatIds";
import { relaunch } from "@tauri-apps/plugin-process";
import { language } from "src/lang";
import { collectColdStorageBackupPayloads, confirmIncompleteColdStorageOperation, getColdStorageBackupKey, isColdStorageBackupData, listColdDataKeys, readColdStorageItem, setColdStorageItem, type ColdStorageBackupCollection } from "../process/coldstorage.svelte";
import { isAcceptedColdStorageBackupEntry, listColdBackupRoots, listColdPluginStorageKeys } from "../process/coldstorageData";
import { BACKUP_ENCRYPTION_MARKER_NAME, MAX_MARKER_NAME_BYTES, decodeEntryName, indexBackupEntries, parseBackupEntryHeader, type BackupEntryHeader, type BackupIndexEntry } from "./backupContainer";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { refuseOnReadOnlyPage } from "../storage/readOnlyPage";
import { beginBusy, withBusy, type BusyHandle } from "../process/memory/busyActions";
import { inlayAttachmentLimit } from "../process/files/inlayStore";
import { parseInlayEntryName } from "./inlayBackupCodec";
import { writeInlaysToBackup } from "./inlayBackupExport";
import { InlayRestoreCollector, listOversizedInlays, restoreCollectedInlays, type InlaySkipped } from "./inlayBackupImport";

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
 * database entry.
 */
async function encodeDatabaseWithLateColdStorage(db: Database, collected: ColdStorageBackupCollection){
    const dbWithoutAccount = { ...db, account: undefined }
    const lateRoots = listColdBackupRoots(dbWithoutAccount)
    const dbData = encodeRisuSaveLegacy(dbWithoutAccount, 'compression')
    const late = await collectColdStorageBackupPayloads(dbWithoutAccount, {
        roots: lateRoots,
        settledKeys: collected.settledKeys,
    })
    return { dbData, late }
}

/**
 * Whether asset writes and reads may bypass the store's per-key calls: the
 * desktop commands exist and the page's store is the desktop files store they
 * address.
 */
async function assetBatchUsable(): Promise<boolean> {
    if (!isAssetBatchAvailable()) {
        return false
    }
    try {
        return await getAppStoreKind() === 'tauri'
    } catch {
        return false
    }
}

/**
 * The asset keys of a full backup and, where the desktop listing command
 * answers, their sizes in the same order. Any failure of that command falls
 * back to the store's own listing.
 */
async function listAssetsForBackup(store: ByteStore): Promise<{ keys: string[]; sized: SizedAssetKey[] | null }> {
    if (await assetBatchUsable()) {
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

/** The restore's asset writer on the desktop, or `null` where every asset goes through the store one call at a time. */
async function createRestoreAssetPipeline(): Promise<RestoreAssetPipeline | null> {
    if (!await assetBatchUsable()) {
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
    return new RestoreAssetPipeline({
        writeBatch: (entries) => writeAssetBatch(entries, CHUNK_MAX),
        writeEntry,
        openStream: openAssetStream,
    })
}

/** A durable chunked write of an asset key; throws `StoreInvalidKeyError` for a name the store refuses. */
function openAssetStream(key: string) {
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

/**
 * Runs a full or partial export so that no failure of it ends unreported: the
 * person is told that the backup failed, whether the output file is gone, and
 * that it must not be used if it is not. The output file is removed only when
 * this export wrote to a desktop file; a desktop file this export did not
 * touch is left as it was. A web or Node stream is aborted, not removed.
 */
async function runExport(body: (session: ExportSession) => Promise<void>): Promise<void> {
    const session: ExportSession = { writer: null, describeAsset: (key) => `'${key}'` }
    try {
        await body(session)
    } catch (error) {
        console.error(error)
        await reportFailedExport(session, error)
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

async function reportFailedExport(session: ExportSession, error: unknown): Promise<void> {
    const file = await discardFailedExportFile(session.writer?.writer, error)
    if (error instanceof BackupAssetTooLargeError) {
        alertError(language.backupFailedAssetTooLarge(session.describeAsset(error.key), file))
        return
    }
    const asset = error instanceof BackupAssetChangedError ? session.describeAsset(error.key) : null
    if (file === 'untouched') {
        alertError(language.backupFailedNothingWritten())
    } else if (file === 'deleted') {
        alertError(language.backupFailedFileDeleted(asset))
    } else {
        alertError(language.backupFailedFileKept(asset))
    }
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

export function SaveLocalBackup(){
    return withBusy('backupSave', () => runExport(writeLocalBackup))
}

async function writeLocalBackup(session: ExportSession){
    alertWait("Saving local backup...")
    const db = getDatabase()
    const coldStoragePayloads = await collectColdStorageBackupPayloads(db)
    const unavailableColdStorageKeys = [...coldStoragePayloads.missingKeys, ...coldStoragePayloads.invalidKeys]
    if(!await confirmIncompleteColdStorageOperation(db, unavailableColdStorageKeys, 'backup', coldStoragePayloads.owners)){
        return
    }

    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
    }
    session.writer = writer

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

    // The store lists only keys that hold an entry. On the desktop that includes
    // a symbolic link that resolves (a link to a directory is listed too and is
    // reported as missing when its read fails), and never the temp file of an
    // atomic write; a dangling link is not listed. A key that reads as absent or
    // fails to read is reported as missing and the backup goes on.
    const store = await getAppStore()
    const listing = await listAssetsForBackup(store)
    const assetKeys = listing.keys
    // On the desktop the assets are read ahead of the writer in batches, and any
    // asset a batch did not deliver whole (or every asset, when there is no
    // batch) is written from the ranged reader. Every exit of the loop below,
    // thrown or not, waits for the reads still outstanding.
    const assetReader = listing.sized
        ? new ExportAssetReader({ readBatch: readAssetBatch }, listing.sized)
        : null
    const streamAssets = await desktopStreamingUsable()
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
            if (taken?.kind === 'bytes') {
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
        }
    } finally {
        await assetReader?.close()
    }

    // Inlays follow the assets and stay ahead of the database, which is last.
    const inlayResult = await writeInlaysToBackup(writer, store, {
        streaming: streamAssets,
        onProgress: (done, total) => alertWait(`Saving local Backup Inlays... (${done} / ${total})`),
    })

    for(let i=0;i<coldStoragePayloads.payloads.length;i++){
        const payload = coldStoragePayloads.payloads[i]
        let message = `Saving local Backup Cold data... (${i + 1} / ${coldStoragePayloads.payloads.length})`
        alertWait(message)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }

    const { dbData, late } = await encodeDatabaseWithLateColdStorage(db, coldStoragePayloads)
    for(let i=0;i<late.payloads.length;i++){
        const payload = late.payloads[i]
        alertWait(`Saving local Backup Cold data... (${i + 1} / ${late.payloads.length})`)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }

    alertWait(`Saving local Backup... (Saving database)`)

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    const lateColdStorageReport = describeLateColdStorageKeys(late)
    const leftOutInlayNames = inlayResult.leftOut.map((left) => left.id)
    if (missingAssets.length > 0 || lateColdStorageReport || leftOutInlayNames.length > 0 || inlayResult.oldStoreUnlisted) {
        let message = missingAssets.length > 0
            ? 'Backup Successful, but the following assets were missing and skipped:\n\n'
            : 'Backup Successful, but some data could not be included:\n\n'
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
        alertMd(message)
    } else {
        alertNormal('Success')
    }
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
export async function SavePartialLocalBackup(){
    // First confirmation: Explain the difference from regular backup
    const firstConfirm = await alertConfirm(language.partialBackupFirstConfirm)
    
    if (!firstConfirm) {
        return
    }
    
    // Second confirmation: Final warning about not saving assets
    const secondConfirm = await alertConfirm(language.partialBackupSecondConfirm)
    
    if (!secondConfirm) {
        return
    }
    
    return withBusy('backupSave', () => runExport(writePartialLocalBackup))
}

async function writePartialLocalBackup(session: ExportSession){
    alertWait("Saving partial local backup...")
    const db = getDatabase()
    const coldStoragePayloads = await collectColdStorageBackupPayloads(db)
    const unavailableColdStorageKeys = [...coldStoragePayloads.missingKeys, ...coldStoragePayloads.invalidKeys]
    if(!await confirmIncompleteColdStorageOperation(db, unavailableColdStorageKeys, 'backup', coldStoragePayloads.owners)){
        return
    }

    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
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

    const { dbData, late } = await encodeDatabaseWithLateColdStorage(db, coldStoragePayloads)
    for(let i=0;i<late.payloads.length;i++){
        const payload = late.payloads[i]
        alertWait(`Saving partial local Backup Cold data... (${i + 1} / ${late.payloads.length})`)
        await writer.writeBackup(payload.backupName, payload.encoded)
    }

    alertWait(`Saving partial local backup... (Saving database)`)

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    const lateColdStorageReport = describeLateColdStorageKeys(late)
    if (missingAssets.length > 0 || lateColdStorageReport) {
        let message = missingAssets.length > 0
            ? 'Partial backup successful, but the following profile images were missing and skipped:\n\n'
            : 'Partial backup successful, but some data could not be included:\n\n'
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
        message += `\n\n${language.partialBackupInlaysNotIncluded}`
        alertMd(message)
    } else {
        alertNormal(`Success\n\n${language.partialBackupInlaysNotIncluded}`)
    }
}

/**
 * How long the local restore and the internal-backup load
 * (`loadInternalBackup` in `internalBackup.ts`) wait for the exclusive storage
 * lock (MC-093) before refusing with "another tab is open". A tab that is simply open, with no
 * exclusive operation of its own in progress, never releases its presence
 * lock -- so this wait can never turn a genuinely open tab into a grant;
 * every value of this timeout refuses that case identically, only sooner or
 * later. What this wait actually bounds is how long this restore waits
 * behind another tab's own IN-PROGRESS exclusive operation (the copy back
 * from OPFS at startup, or another restore) before giving up on it and
 * refusing instead. Kept well under that copy back's own 5000ms default so a
 * restore doesn't make
 * its own user wait for however long an unrelated tab's operation takes to
 * finish, at the cost of occasionally refusing an in-progress operation of
 * similar length that would have finished moments later.
 */
export const RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS = 2000;

/** How many skipped asset names, and how many characters of each, the restore notice lists. */
const SKIPPED_ASSET_NAMES_SHOWN = 20;
const SKIPPED_ASSET_NAME_CHARS_SHOWN = 100;

/** The restore pass yields to the event loop once this much time has passed since its last yield. */
const RESTORE_YIELD_INTERVAL_MS = 50;

/** Entry names longer than this can be neither `database.risudat` nor a cold-storage unit, so the oversized-asset scan reads no more of them. */
const OVERSIZED_NAME_READ_BYTES = 1024;

/** The bytes of the longest entry header whose name is the encryption marker: both length fields and the marker name with a byte-order mark. */
const MARKER_HEADER_BYTES = 4 + MAX_MARKER_NAME_BYTES + 4;

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
 * asset either: it is judged by `listOversizedInlays`.
 */
async function listOversizedAssets(file: Blob, entries: readonly BackupIndexEntry[]): Promise<{ entry: BackupIndexEntry; name: string }[]> {
    const found: { entry: BackupIndexEntry; name: string }[] = [];
    for (const entry of entries) {
        if (entry.dataLength <= NODE_BODY_LIMIT_BYTES) {
            continue;
        }
        const nameStart = entry.headerOffset + 4;
        const nameBytes = new Uint8Array(await file.slice(nameStart, nameStart + Math.min(entry.nameLength, OVERSIZED_NAME_READ_BYTES)).arrayBuffer());
        const name = new TextDecoder().decode(nameBytes);
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

export function LoadLocalBackup(){
    // A restore replaces the database under any work still writing into it.
    // It is refused before the picker opens, again when the picker returns,
    // and again immediately before the database write, since work can start
    // during any of the waits in between.
    if (refuseBackupLoadWhileBusy()) {
        return;
    }
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.bin';
        const restoreSelectedFile = async (busy: BusyHandle) => {
            if (!input.files || input.files.length === 0) {
                input.remove();
                return;
            }
            const file = input.files[0];
            input.remove();

            // A page that runs from OPFS this time writes nothing, and a restore is refused before it reads or writes anything.
            if (await refuseOnReadOnlyPage()) {
                return;
            }

            if (refuseBackupLoadWhileBusy(busy)) {
                return;
            }

            // Every write below -- an asset, a cold-storage item, or the
            // database itself -- must wait until the whole file is known to
            // carry no encryption.risudat entry (MC-081). A walk exception
            // means the file could not be confirmed safe, so it is treated
            // the same as finding the marker: nothing is written. This scan
            // takes no lock and runs before the cross-tab guard below.
            let hasEncryptionMarker: boolean;
            let backupEntries: BackupIndexEntry[];
            try {
                let lastWalkProgressText: string | null = null;
                const walk = await indexBackupEntries(file, {
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
            } catch (e) {
                console.error(e);
                alertError(language.backupFileUnreadable);
                return;
            }
            if (hasEncryptionMarker) {
                alertError(language.encryptedBackupRefused);
                return;
            }

            // On a Node server a body over the server's request limit can never
            // be stored. Those assets are named before anything is written, and
            // the restore goes on without them only if the user agrees.
            const oversizedAssetNames = new Map<number, string>();
            const inlayCollector = new InlayRestoreCollector(inlayAttachmentLimit());
            if (isNodeServer) {
                let oversizedInlays: { hash: string, id: string }[];
                try {
                    for (const { entry, name } of await listOversizedAssets(file, backupEntries)) {
                        oversizedAssetNames.set(entry.headerOffset, name);
                    }
                    oversizedInlays = await listOversizedInlays(file, backupEntries, inlayAttachmentLimit());
                } catch (e) {
                    console.error(e);
                    alertError(language.backupFileUnreadable);
                    return;
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
                        return;
                    }
                    for (const inlay of oversizedInlays) {
                        inlayCollector.preSkip(inlay.hash, inlay.id);
                    }
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
                        return;
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
                        return;
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
                let pendingDatabase: Uint8Array | null = null;
                const restoredColdStorageKeys = new Set<string>();
                const skippedAssets: SkippedAsset[] = [];
                const skippedInlays: InlaySkipped[] = [];
                const yieldBudget = createYieldBudget({ budgetMs: RESTORE_YIELD_INTERVAL_MS, yieldFn: yieldToEventLoop });
                let lastProgressText: string | null = null;

                // One indexed entry per read. The walk above cleared the file, but
                // the file can still change under this pass, so every entry's
                // header is checked again before anything of it is written: a
                // marker stops the restore, and so does any header that differs
                // from the index or a body that cannot be read.
                //
                // On the desktop the assets go out in byte-budgeted batches that
                // overlap the reading of later entries. Every way out of the
                // pass -- a stop with a message, a throw, an error answered by a
                // batch, the end of the entries -- first waits for every batch
                // in flight to settle, so no message is shown, no database is
                // written and nothing returns while an asset is still being
                // written. After a batch fails no further entry is read.
                const assetPipeline = await createRestoreAssetPipeline();
                const streamLargeAssets = assetPipeline !== null || await desktopStreamingUsable();
                let stopMessage: string | null = null;
                let passFailure: { error: unknown } | null = null;
                try {
                    for (const entry of backupEntries) {
                        if (assetPipeline?.failure) {
                            break;
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
                        let headerBytes: Uint8Array;
                        try {
                            headerBytes = new Uint8Array(await file.slice(entry.headerOffset, entry.headerOffset + headerReadLength).arrayBuffer());
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
                        // Where streamLargeAssets holds (the desktop), an asset above
                        // CHUNK_MAX is copied to the store in slices of at most
                        // CHUNK_MAX and is never read whole. The database and the
                        // cold-storage entries are decoded as a whole, and read whole.
                        if (streamLargeAssets && entry.dataLength > CHUNK_MAX
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
                            } else {
                                const outcome = await streamAssetEntry(streamed, openAssetStream);
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
                                }
                            }
                            await yieldBudget.maybeYield();
                            continue;
                        }

                        let data: Uint8Array;
                        try {
                            data = new Uint8Array(await file.slice(dataStart, dataStart + entry.dataLength).arrayBuffer());
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
                            pendingDatabase = data;
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
                                    await assetPipeline.add({ key: assetKey, name, index: entry.headerOffset, data })
                                } else {
                                    try {
                                        await (await getAppStore()).write(assetKey, data, 'unconditional')
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
                    await assetPipeline.drain();
                }
                if (passFailure) {
                    throw passFailure.error;
                }
                if (stopMessage !== null) {
                    alertError(stopMessage);
                    return;
                }
                if (assetPipeline) {
                    if (assetPipeline.failure) {
                        throw assetPipeline.failure.error;
                    }
                    for (const refused of assetPipeline.invalidAssets()) {
                        skippedAssets.push({ name: refused.name, reason: 'invalidName' });
                    }
                }

                // Written before the database is looked at, so a file cut short
                // after some complete inlays keeps them; a part that is missing
                // keeps its whole inlay out. Additive, like the assets.
                const inlayOutcome = await restoreCollectedInlays(inlayCollector);
                if (inlayOutcome.changed) {
                    alertError(language.backupFileChangedWhileReading);
                    return;
                }
                skippedInlays.push(...inlayOutcome.skipped);

                if(!pendingDatabase){
                    alertError('Failed, Is file corrupted?')
                    return
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
                    return;
                }
                const missingColdStorageKeys:string[] = []
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
                    return
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
                const restoredSet = await treeToBlockSet(dbData);

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
                    return;
                }

                replaceStarted = true;
                const written = await replaceWithRestoredSet(restoredSet, () => !refuseBackupLoadWhileBusy(busy));
                if (written.kind === 'not-happened') {
                    // The busy guard has already said why when it was the one that refused.
                    if (!written.aborted) {
                        alertError(language.restoreNotHappenedNotice);
                    }
                    return;
                }
                if (written.kind === 'too-large') {
                    alertError(language.restoreTooLargeBlock(describeBlockForPerson(written.blockName), written.limit));
                    return;
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
                    return;
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
                if (isTauri) {
                    await relaunch();
                } else {
                    // history.replaceState drops any query string, keeping
                    // any fragment, and location.reload() always performs a
                    // full reload, whatever the current URL looks like.
                    history.replaceState(null, '', location.pathname + location.hash);
                    location.reload();
                }
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
                } else if (replaceStarted) {
                    alertError(language.restoreWriteFailed);
                } else {
                    alertError('Failed, Is file corrupted?');
                }
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
            try {
                await restoreSelectedFile(busy);
            } finally {
                busy.end();
            }
        };

        input.click();
    } catch (error) {
        console.error(error);
        alertError('Failed, Is file corrupted?')
    }
}
