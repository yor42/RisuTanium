import { alertError, alertNormal, alertNormalWait, alertStore, alertWait, alertMd, alertConfirm } from "../alert";
import { LocalWriter, requiresFullEncoderReload, dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported, noteAssetWrittenThisPage } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri, isNodeServer } from "src/ts/platform"
import { decodeRisuSave, encodeRisuSaveLegacy } from "../storage/risuSave";
import { noteMainFileBytes } from "../storage/mainFileRecord";
import { getAppStore, writeMainFile } from "../storage/store/appStore";
import { StoreInvalidKeyError } from "../storage/store/errors";
import { NodeHttpError } from "../storage/store/nodeHttpStore";
import { NODE_BODY_LIMIT_BYTES } from "../storage/nodeBodyLimit";
import { createYieldBudget, yieldToEventLoop } from "../storage/saveYield";
import { getDatabase, setDatabase, type Database } from "../storage/database.svelte";
import { repairDatabaseIds } from "../process/chatIds";
import { relaunch } from "@tauri-apps/plugin-process";
import { language } from "src/lang";
import { collectColdStorageBackupPayloads, confirmIncompleteColdStorageOperation, getColdStorageBackupKey, isColdStorageBackupData, listColdDataKeys, readColdStorageItem, setColdStorageItem, type ColdStorageBackupCollection } from "../process/coldstorage.svelte";
import { isAcceptedColdStorageBackupEntry, listColdBackupRoots, listColdPluginStorageKeys } from "../process/coldstorageData";
import { BACKUP_ENCRYPTION_MARKER_NAME, decodeEntryName, indexBackupEntries, parseBackupEntryHeader, type BackupEntryHeader, type BackupIndexEntry } from "./backupContainer";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { beginBusy, withBusy, type BusyHandle } from "../process/memory/busyActions";

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
    return withBusy('backupSave', writeLocalBackup)
}

async function writeLocalBackup(){
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

    const assetMap = new Map<string, { charName: string, assetName: string }>()
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
    const assetKeys = await store.list('assets/')
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
    if (missingAssets.length > 0 || lateColdStorageReport) {
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
    
    return withBusy('backupSave', writePartialLocalBackup)
}

async function writePartialLocalBackup(){
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

    const assetMap = new Map<string, { charName: string, assetName: string }>()
    
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
        alertMd(message)
    } else {
        alertNormal('Success')
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
 * what is written, and the database is not an asset.
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
        if (entry.nameLength <= OVERSIZED_NAME_READ_BYTES && (name === 'database.risudat' || getColdStorageBackupKey(name))) {
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
            if (isNodeServer) {
                try {
                    for (const { entry, name } of await listOversizedAssets(file, backupEntries)) {
                        oversizedAssetNames.set(entry.headerOffset, name);
                    }
                } catch (e) {
                    console.error(e);
                    alertError(language.backupFileUnreadable);
                    return;
                }
                if (oversizedAssetNames.size > 0) {
                    const names = Array.from(oversizedAssetNames.values());
                    if (!await alertConfirm(language.restoreOversizedAssetsConfirm(names.length, shownSkippedNames(names), NODE_BODY_LIMIT_BYTES))) {
                        return;
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

            // From here on, every exit that never lands the database write
            // must show exactly one message, before releasing whatever hold
            // was taken above -- and every exit that DID land it keeps that
            // hold's write-lock portion closed forever (a reload or restart
            // is imminent), reporting instead that the restore is saved if
            // anything after the write fails.
            let releaseDbWriteLock: (() => void) | null = null;
            let writeAttempted = false;
            let restoreWriteSucceeded = false;
            try {
                let pendingDatabase: Uint8Array | null = null;
                const restoredColdStorageKeys = new Set<string>();
                const skippedAssets: SkippedAsset[] = [];
                const yieldBudget = createYieldBudget({ budgetMs: RESTORE_YIELD_INTERVAL_MS, yieldFn: yieldToEventLoop });
                let lastProgressText: string | null = null;

                // One indexed entry per read. The walk above cleared the file, but
                // the file can still change under this pass, so every entry's
                // header is checked again before anything of it is written: a
                // marker stops the restore, and so does any header that differs
                // from the index or a body that cannot be read.
                for (const entry of backupEntries) {
                    const entryEnd = entry.headerOffset + entry.headerLength + entry.dataLength;
                    const progressText = `Loading local Backup... (${((entryEnd / file.size) * 100).toFixed(2)}%)`;
                    if (progressText !== lastProgressText) {
                        lastProgressText = progressText;
                        alertWait(progressText);
                    }

                    // An asset left out for its size is not read; its header still is.
                    const isSkippedForSize = oversizedAssetNames.has(entry.headerOffset);
                    const readEnd = isSkippedForSize ? entry.headerOffset + entry.headerLength : entryEnd;
                    let entryBytes: Uint8Array;
                    try {
                        entryBytes = new Uint8Array(await file.slice(entry.headerOffset, readEnd).arrayBuffer());
                    } catch (error) {
                        console.error(error);
                        alertError(language.backupFileChangedWhileReading);
                        return;
                    }

                    const checked = checkIndexedEntry(entryBytes, entry, readEnd - entry.headerOffset);
                    if (checked.kind === 'marker') {
                        alertError(language.encryptedBackupImportStopped);
                        return;
                    }
                    if (checked.kind === 'changed') {
                        alertError(language.backupFileChangedWhileReading);
                        return;
                    }
                    const name = checked.header.name;
                    if (name === undefined) {
                        // parseBackupEntryHeader is called with no name-length
                        // limit, so every entry name here is always decoded; this
                        // only narrows the type.
                        continue;
                    }
                    if (isSkippedForSize) {
                        skippedAssets.push({ name, reason: 'tooLarge' });
                        await yieldBudget.maybeYield();
                        continue;
                    }
                    // A view over the bytes just read: nothing of the entry is copied.
                    const data = entryBytes.subarray(checked.header.headerLength);

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
                            try {
                                await (await getAppStore()).write(assetKey, data, 'unconditional')
                            } catch (error) {
                                if (error instanceof NodeHttpError && error.status === 413 && error.operation === 'write') {
                                    console.error(error)
                                    alertError(language.restoreAssetRefusedTooLarge(name.length > SKIPPED_ASSET_NAME_CHARS_SHOWN ? name.slice(0, SKIPPED_ASSET_NAME_CHARS_SHOWN) + '...' : name))
                                    return
                                }
                                if (!(error instanceof StoreInvalidKeyError)) {
                                    throw error
                                }
                                console.error(error)
                                skippedAssets.push({ name, reason: 'invalidName' })
                            }
                        }
                    }
                    await yieldBudget.maybeYield();
                }

                if(!pendingDatabase){
                    alertError('Failed, Is file corrupted?')
                    return
                }

                const db = pendingDatabase;
                const dbData = await decodeRisuSave(db);
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

                // The exclusive hold taken above (when granted) already holds
                // dbWriteLock internally for the rest of this restore --
                // acquiring it again here would deadlock against that same
                // hold. Only the Tauri and Web-Locks-unsupported paths, which
                // never took it, still need it directly: the same write mutex
                // saveDb()'s autosave loop takes around this key (see
                // globalApi.svelte.ts's AsyncMutex/dbWriteLock).
                if (!releaseExclusiveHold) {
                    releaseDbWriteLock = await dbWriteLock.acquire();
                }

                // No await between this check and the write below: work that
                // began during any earlier wait is seen here, and a refusal
                // writes nothing further: the assets and cold-storage items
                // already read from the file stay, as on the other early exits.
                // The finally releases what was taken above.
                if (refuseBackupLoadWhileBusy(busy)) {
                    return;
                }

                writeAttempted = true;
                await writeMainFile(db);
                restoreWriteSucceeded = true;
                noteMainFileBytes(db);

                // Installed only now that the write has actually succeeded --
                // a failed write above leaves this page on its pre-restore
                // database, so the error shown for it can truthfully say the
                // restore did not complete.
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

                alertStore.set({
                    type: "wait",
                    msg: "Success, Refreshing your app."
                });
                // The exclusive hold's Web Lock portion (if any) has nothing
                // further to protect once this page's own write has landed --
                // other tabs may now proceed. Its write-lock portion stays closed
                // forever (`keepWriteLock`): no in-flight save cycle's bytes,
                // encoded from the pre-restore database before setDatabase()
                // above installed the restored one, must ever write this key
                // again from this now-stale page. Awaited before marking the
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
                if (restoreWriteSucceeded) {
                    // The write already landed and the in-memory database is
                    // installed; a reload or restart is already in flight (or
                    // was attempted). Whatever failed after that must never be
                    // reported as "nothing happened" -- the write lock stays
                    // closed, since another write from this now-stale context
                    // must never follow a restore that already committed.
                    alertStore.set({
                        type: "wait",
                        msg: language.restoreSavedReloadOrRestart
                    });
                } else if (writeAttempted) {
                    alertError(language.restoreWriteFailed);
                } else {
                    alertError('Failed, Is file corrupted?');
                }
            } finally {
                if (!restoreWriteSucceeded) {
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
