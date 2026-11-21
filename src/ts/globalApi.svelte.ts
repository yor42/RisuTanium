import {
    exists,
    mkdir
} from "@tauri-apps/plugin-fs"
import { readUserFile } from "./storage/tauriUserFile"
import { assetDeletionSettled } from "./storage/assetDeleteHold"
import { changeFullscreen, checkNullish, sleep, sleepForever } from "./util"
import { openUrlOnWeb } from "./openUrlWeb"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { v4 as uuidv4, v4 } from 'uuid';
import { get } from "svelte/store";
import { flushSync } from "svelte";
import { TauriWriter, openWebExportWriter, writeBackupEntry, encodeBackupEntryHeader, isSplicingWriter, type ExportByteWriter } from "./exportWriters";
import { ExportCancelledError, type ExportCancelToken } from "./exportCancel";
import { type Database, defaultSdDataFunc, getDatabase, appVer, getCurrentCharacter, type character, type groupChat, type Chat, appSubVer } from "./storage/database.svelte";
import { collectPackAssetRefs } from "./themePack/packRefs";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { checkRisuUpdate } from "./update";
import { botMakerMode, DBState, LoadingStatusState, selIdState, selectedCharID, ReloadGUIPointer, bodyIntercepterStore, savingStoppedReason, peerWaitingStatus, frozenSaveKeysStore } from "./stores.svelte";
import { loadPlugins } from "./plugins/plugins.svelte";
import { alertConfirm, alertError, alertMd, alertStore, alertToast, waitAlert } from "./alert";
import { ASSET_PIECE_SAVE_MIN_BYTES, Sha256, sha256Hex } from "./assetHash";
import { characterURLImport } from "./characterCards";
import { defaultJailbreak, defaultMainPrompt, oldJailbreak, oldMainPrompt } from "./storage/defaultPrompts";
import { encodeRisuSaveLegacy, type toSaveType } from "./storage/risuSave";
import { registerDbChangeEffects } from "./storage/dbChangeEffects.svelte";
import { isModuleStub } from "./storage/moduleStub";
import { retainedNamesOf } from "./storage/store2/lists/assetList";
import { ASSET_RETAINED_KEY } from "./studio/assets/assetOwnerKeys";
import { appendIfAbsent, installCharacterSaveMarks, type SaveMarkKind } from "./storage/characterSaveMarks";
import { createSaveScheduler } from "./storage/saveScheduler";
import { getActiveStore2Save, parseStore2Broadcast, type Store2SaveContext } from "./storage/store2/saveActive";
import type { CharacterCommit, ModuleHold, Store2LoopPort } from "./storage/store2/saveLoop";
import { takeReplyOwnerWithNotice, type NativeReplyOwner } from "./nativeReply/grant";
import { armNativeReplyNotice } from "./android/replyNotifications.svelte";
import { createPumpProbe, isOrphanReplyEvent, parseReplyStamp, resolveOwnedFetch, type PumpProbe } from "./nativeReply/ownedBody";
import { noteInvoked, noteUnowned, requestReconcile } from "./nativeReply/pageState";
import { createReplyStore } from "./nativeReply/store";
import type { SkippedItem } from "./storage/store2/codec";
import { activeStreamOwners } from "./process/activeStreams";
import { takeResidentLoaded } from "./storage/store2/residentLoads";
import { saveFailureStore } from "./storage/store2/saveFailure";
import { createLiveCheckGate, type LiveCheckSignal } from "./storage/store2/liveCheckGate";
import { openBootWindow } from "./bootWindow";
import { AutoStorage } from "./storage/autoStorage";
import { createStorageTabLocks } from "./storage/storageTabLocks";
import { beginInFlight } from "./process/inFlightWork";
import { isUnitInProgressSignal, unitTargetOfSignal } from "./process/generationOwnership.svelte";
import { getAppStore } from "./storage/store/appStore";
import { nodeAssetRouteViolation } from "./storage/store/keyRules";
import type { ByteStore, PieceWriter } from "./storage/store/contract";
import { heldSaveStore, type HeldSaveInfo } from "./storage/saveHold";
import { isCharacterEntry, isMissingCharacterId, isUsableCharacterId } from "./storage/characterIds";
import { getPageStorageMode } from "./storage/pageStorageMode";
import { StoreBlobUnsupportedError, StoreInvalidKeyError } from "./storage/store/errors";
import { NODE_BODY_LIMIT_BYTES, WEB_ASSET_LIMIT_BYTES } from "./storage/nodeBodyLimit";
import { storeAssetLimitBytes } from "./storage/assetLimit";
import { assertBlobWithinAssetLimit } from "./storage/pickedAssetLimit";
import { updateAnimationSpeed } from "./gui/animation";
import { updateColorScheme, updateTextThemeAndCSS } from "./gui/colorscheme";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from '@tauri-apps/api/event'
import { language } from "src/lang";
import { startObserveDom } from "./observer.svelte";
import { updateGuisize } from "./gui/guisize";
import { updateLorebooks } from "./characters";
import { isHiddenSystemCharacter } from "./hiddenCharacters";
import { fetch as TauriHTTPFetch } from '@tauri-apps/plugin-http';
import { moduleUpdate } from "./process/modules";
import { isTauri, isNodeServer } from "./platform";
import { isLocalNetworkUrl } from "./network/localNetwork";
import { decodeProxyJobWsChunk, formatProxyStreamErrorMessage, parseProxyJobWsEvent } from "./network/proxyJobWs";
import { getNodeServerProxyAuth, NodeStorage } from "./storage/nodeStorage";
import { peerCommitWake, startNodePeerFeed, type NodePeerFeed } from "./storage/store2/nodePeerFeed";
import { assertNoSecretRef, redactResolved } from "./secretRef";
import { compileKnownSecrets, redactLogField, REVEAL_MIN_LENGTH, type FetchLogField, type KnownSecrets } from "./requestLogRedact";
import { secretFieldValues } from "./shareStrip";
import { splitKeys } from "./process/request/keyRing";
import { hasLocalDrafts } from "./localDrafts";
import { beginChokePoint, busyKinds } from "./process/memory/busyActions";
import { installNetHold } from "./storage/measureExportHold";
import { isAndroidTransport, shouldBypassFrozenPagePaths } from "./storage/tauriByteTransport";
import { decidePlainFetch } from "./network/androidHttp";
import { wholeUseUrlWithheld, forgetStoredAssetSizes, rememberWholeReadUrl, type AssetUse, type WholeReadBudget } from "./storage/assetUrlGate";
import { parseJsonBody } from "./network/frozenBody";
import { MEASURE } from "./process/memory/measureFlag";
import { noteChatSelect } from "./process/chatPhaseRing";
import { draftContentOrphanGate } from "./draftContentOrphanGate";

export const forageStorage = new AutoStorage()

const appWindow = isTauri ? getCurrentWebviewWindow() : null

interface fetchLog {
    body: string
    header: string
    response: string
    success: boolean,
    date: string
    url: string
    responseType?: string
    chatId?: string
    status?: number
}

let fetchLog: fetchLog[] = []
const FETCH_LOG_LIMIT = 20

const NO_KNOWN_SECRETS: KnownSecrets = compileKnownSecrets([])
let knownSecretsSignature: string | null = null
let knownSecretsMatcher: KnownSecrets = NO_KNOWN_SECRETS

/**
 * The matcher of the credentials configured in the database, rebuilt only when a key changes.
 * Any failure yields an empty matcher: logging must never throw. `additionalParams` values are
 * ordinary parameters and the Vertex PEM is never sent (it only signs the token request).
 */
function currentKnownSecrets(): KnownSecrets {
    try {
        const db = getDatabase()
        if (typeof db !== 'object' || db === null) {
            return NO_KNOWN_SECRETS
        }
        const values = new Set<string>()
        const fields = secretFieldValues(db, 'database', (entry) => entry.field !== 'additionalParams' && entry.field !== 'vertexPrivateKey')
        for (const field of fields) {
            for (const line of splitKeys(field)) {
                const trimmed = line.trim()
                if (trimmed.length >= REVEAL_MIN_LENGTH) {
                    values.add(trimmed)
                }
            }
        }
        const list = [...values]
        const signature = list.join('\n')
        if (signature !== knownSecretsSignature) {
            knownSecretsMatcher = compileKnownSecrets(list)
            knownSecretsSignature = signature
        }
        return knownSecretsMatcher
    } catch {
        return NO_KNOWN_SECRETS
    }
}

/**
 * A redactor for one log entry: resolved `${NAME}` labels first, then configured credential
 * values, then the name rules of the field. The configured-value matcher is fetched once per
 * entry. A non-string passes through, and an unexpected failure stores `[redacted]` rather than
 * throwing, so the log can never leak a value or break a request.
 */
export function fetchLogRedactor(): (field: FetchLogField, text: string) => string {
    const known = currentKnownSecrets()
    return (field, text) => {
        if (typeof text !== 'string') {
            return text
        }
        try {
            return redactLogField(field, redactResolved(text), known)
        } catch {
            return '[redacted]'
        }
    }
}

export { downloadFile } from "./downloadFile"

// The `data:image/png;base64,` wrapper every store-read fallback result of
// getFileSrc carries (Tauri and Node asset-route results are URLs without it);
// the function-level catch still returns '' on error, not this prefix.
const FILE_CACHE_SRC_PREFIX = 'data:image/png;base64,'

/**
 * Drops the stored-size records of the assets `keys` name. Call it after an
 * asset has been deleted from the store: a record left behind would keep
 * answering for a key the store no longer holds.
 */
export function releaseAssetObjectUrl(keys: Iterable<string>): void {
    forgetStoredAssetSizes([...keys])
}

let checkedPaths: string[] = []

/**
 * Asset keys that `saveAsset` or a restore wrote, or tried to write, in this
 * page load. A key is added before its I/O starts and stays whatever the
 * outcome, so a sweep that consults it never deletes an asset that a caller is
 * about to reference.
 */
const assetsWrittenThisPage = new Set<string>()

/**
 * Records `key` as written in this page load. Call it before the write starts. A writer of an `assets/` key uses
 * `noteAndSettleAssetWrite`, or awaits `assetDeletionSettled()` before its first asset write as the `.bin` restore does.
 */
export function noteAssetWrittenThisPage(key: string): void {
    assetsWrittenThisPage.add(key)
}

/**
 * Notes `key` as written this page and returns the promise of the asset deletion
 * pending at that moment. Contract: note, then await the result, before any
 * `has`, write or finish of an `assets/` key. Both happen in one synchronous run,
 * so a sweep either saw the note and skipped the key, or the caller waits for the
 * delete in flight and writes afterwards.
 */
export function noteAndSettleAssetWrite(key: string): Promise<void> {
    noteAssetWrittenThisPage(key)
    return assetDeletionSettled()
}

/** How many keys `listAssetsWrittenThisPage` holds; the set only grows, so a changed count means new entries. */
export function assetsWrittenThisPageCount(): number {
    return assetsWrittenThisPage.size
}

/** Every key `saveAsset` or a restore wrote, or tried to write, in this page load. */
export function listAssetsWrittenThisPage(): string[] {
    return Array.from(assetsWrittenThisPage)
}

/**
 * The bytes of `loc` for a URL built outside Tauri. A key the store cannot
 * address holds nothing, so it reads as absent; any other failure propagates.
 */
async function readBytesForUrl(loc: string): Promise<Uint8Array | null> {
    try {
        return (await (await getAppStore()).read(loc)).bytes
    } catch (error) {
        if (error instanceof StoreInvalidKeyError) {
            return null
        }
        throw error
    }
}

/**
 * Gets the source URL of a file.
 *
 * On Tauri an asset URL comes from the store's `urlFor`, from the key alone, so
 * no byte is read. On a Node-hosted page the same holds for an `assets/` key the
 * server's asset route serves; when the store cannot make that URL the call
 * takes the path below: one uncached read of the bytes from the store, encoded
 * into a data URL on every call.
 *
 * On Android and on the desktop a URL for a `'whole'` use is withheld (`''`)
 * when the stored size is above the platform's whole-read limit
 * (`ANDROID_WHOLE_READ_URL_LIMIT_BYTES`, `DESKTOP_WHOLE_READ_URL_LIMIT_BYTES`)
 * or cannot be read, because the asset protocol would read the file whole into
 * memory (the WebView's heap on Android, the host process on the desktop). A
 * caller that does not say
 * what the URL is for gets `'whole'`; only a media element passes `'media'`.
 *
 * A list passes the `budget` of its run for every `'whole'` row: the call joins
 * the budget synchronously, before its first await, so admissions follow call
 * (row) order, and a row the budget refuses gets `''` too.
 *
 * @param {string} loc - The location of the file.
 * @param {AssetUse} use - What the URL is for.
 * @param {WholeReadBudget} budget - The whole-read budget of the calling list; used for an `assets` file with a `'whole'` use only.
 * On Android a `'whole'` URL that is returned is also recorded with its asset
 * path (`rememberWholeReadUrl`), so the chat sanitizer can learn the stored size
 * of an image whose markup holds only the URL.
 *
 * @returns {Promise<string>} - A promise that resolves to the source URL of the file, or `''` when none can be made or it is withheld.
 */
export async function getFileSrc(loc: string, use: AssetUse = 'whole', budget?: WholeReadBudget) {
    if (isTauri) {
        if (loc.startsWith('assets')) {
            const admission = use === 'whole' && budget !== undefined ? budget.admit(loc) : undefined
            try {
                if (await wholeUseUrlWithheld(loc, use)) {
                    return ''
                }
                if (admission !== undefined && !(await admission)) {
                    return ''
                }
                const store = await getAppStore()
                if (store.urlFor === undefined) {
                    throw new Error('The desktop store offers no URL for a file.')
                }
                const url = await store.urlFor(loc)
                if (url && use === 'whole' && isAndroidTransport()) {
                    rememberWholeReadUrl(url, loc)
                }
                return url
            } catch (error) {
                console.error(error)
                return ''
            }
        }
        return convertFileSrc(loc)
    }
    if (isNodeServer && nodeAssetRouteViolation(loc) === null) {
        try {
            const store = await getAppStore()
            if (store.urlFor !== undefined) {
                return await store.urlFor(loc)
            }
        } catch (error) {
            console.error(error)
        }
    }
    // Each call reads the store afresh, so a rewritten key never shows stale
    // bytes, and nothing here holds on to a payload.
    try {
        const bytes = await readBytesForUrl(loc)
        return FILE_CACHE_SRC_PREFIX + Buffer.from(bytes ?? new Uint8Array()).toString('base64')
    } catch (error) {
        console.error(error)
        return ''
    }
}

/**
 * The bytes under `key` in the page's store. A key with no value rejects on
 * Tauri and resolves `null` elsewhere, and a key the store cannot address counts
 * as absent there; callers and plugins observe both. Off Tauri the result is a
 * `Buffer` over the stored bytes, without a copy.
 *
 * The `null` of the platforms that return one is typed away on purpose: the
 * callers were written against `Uint8Array`, and the ones that need the absent
 * case test for a falsy value.
 */
async function readAssetBytes(key: string): Promise<Uint8Array> {
    const store = await getAppStore()
    let bytes: Uint8Array | null
    try {
        bytes = (await store.read(key)).bytes
    } catch (error) {
        if (!isTauri && error instanceof StoreInvalidKeyError) {
            return null as unknown as Uint8Array
        }
        throw error
    }
    if (bytes === null) {
        if (isTauri) {
            throw new Error(`The asset ${JSON.stringify(key)} does not exist.`)
        }
        return null as unknown as Uint8Array
    }
    return isTauri ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Reads an image file and returns its data.
 *
 * @param {string} data - The path to the image file.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the image file.
 */
export async function readImage(data: string) {
    if (isTauri && !data.startsWith('assets')) {
        // A path the caller names, not an asset key: the store only holds keys.
        return await readUserFile(data)
    }
    return await readAssetBytes(data)
}

/**
 * Saves an asset file with the given data, custom ID, and file name.
 * 
 * @param {Uint8Array} data - The data of the asset file; an ArrayBuffer or another typed-array view is taken as it is. Any other value rejects with a TypeError.
 * @param {string} [customId=''] - The custom ID for the asset file.
 * @param {string} [fileName=''] - The name of the asset file. Its extension (the part after the last dot) is kept when it is 1 to 16 ASCII letters or digits, and is `png` otherwise.
 * @returns {Promise<string>} - A promise that resolves to the path of the saved asset file. On a store that keeps Blobs (the browser's IndexedDB) a value of `ASSET_PIECE_SAVE_MIN_BYTES` or more is stored as a Blob.
 */
export async function saveAsset(data: Uint8Array | ArrayBuffer | ArrayBufferView, customId: string = '', fileName: string = '') {
    return await saveAssetBytes(assetBytesOf(data), customId, fileName, assetDisplayName(null, fileName))
}

/**
 * `saveAsset` for bytes already taken as a `Uint8Array`; `displayName` is the name a storage-full message shows.
 * On a store that keeps Blobs (the browser's IndexedDB) a value of `ASSET_PIECE_SAVE_MIN_BYTES` or more is stored as a
 * Blob under its final key, unless `blobRefused` says the browser already refused a Blob for these bytes. Where a Blob
 * cannot be kept the bytes are stored; a quota or any other failure of the Blob put is not retried as bytes.
 */
async function saveAssetBytes(bytes: Uint8Array, customId: string, fileName: string, displayName: string, options: { blobRefused?: boolean } = {}): Promise<string> {
    const endInFlight = beginChokePoint('asset')
    try {
        let id = ''
        if (customId !== '') {
            id = customId
        }
        else {
            id = await sha256Hex(bytes)
        }
        let fileExtension: string = 'png'
        if (fileName) {
            const candidate = fileName.split('.').pop() ?? ''
            if (ASSET_EXTENSION.test(candidate)) {
                fileExtension = candidate
            }
        }
        const key = `assets/${id}.${fileExtension}`
        // Before any I/O, so a sweep that runs while this save is in flight, or
        // after it failed, still leaves the key alone.
        await noteAndSettleAssetWrite(key)
        const store = await getAppStore()
        // A name is a content hash or a caller's fixed id, and an existing value is kept.
        // On the Node server keeping it also moves its revision, so a sweep's delete at
        // an earlier revision fails; an absent key is written. Replacing a present file
        // would rename over a file the web view may hold open. Only the desktop store
        // and the Node server check a key without a scan or a read.
        if (isNodeServer) {
            if (store.touch !== undefined && (await store.touch(key)).kept) {
                return key
            }
        } else if (isTauri && await store.has(key)) {
            return key
        }
        try {
            // The bytes are whole and already hashed, so a large value goes straight to its final key: one put is one
            // transaction, and a failed put keeps the previous value, so no temporary key is needed.
            if (store.readBlob !== undefined && store.writeBlob !== undefined
                && bytes.byteLength >= ASSET_PIECE_SAVE_MIN_BYTES && options.blobRefused !== true) {
                try {
                    // The Blob is built from the view itself, never its backing buffer, and copies the bytes at construction.
                    await store.writeBlob(key, new Blob([bytes as Uint8Array<ArrayBuffer>]), 'unconditional')
                    return key
                } catch (error) {
                    if (!(error instanceof StoreBlobUnsupportedError)) {
                        throw error
                    }
                    // The browser keeps no Blob: every such save builds one copy and fails once before the bytes are stored below.
                }
            }
            await store.write(key, bytes, 'unconditional')
        } catch (error) {
            rethrowStorageFull(error, displayName)
        }
        return key
    } finally {
        endInFlight()
    }
}

/** What follows the last dot of an asset's file name: short and plain, so the key stays one path segment on every platform. */
const ASSET_EXTENSION = /^[A-Za-z0-9]{1,16}$/

/**
 * The source of an asset being saved piece by piece changed, vanished or failed
 * to read before the last piece was saved: a read error, a short read, a header
 * that does not match, or a size or modification time that moved. Nothing is
 * stored under the asset's key. The importer reports it as a changed file and
 * does not retry the save.
 */
export class AssetSourceChangedError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'AssetSourceChangedError'
    }
}

export interface AssetPieceSaveOptions {
    /** The file name whose extension the key keeps, as `saveAsset` takes it. */
    fileName?: string
    /** The most bytes the pieces can total (for base64 text, `floor(length * 3 / 4)`). A smaller asset than the threshold is saved by `saveAsset`. */
    sizeBound: number
    /**
     * Runs after the last piece and before the file takes its name: the importer
     * checks that its source still has the size and time it had. A rejection
     * ends the save as a changed source and leaves nothing under the key.
     */
    beforeFinish?: () => Promise<void>
    /** Test seam: the size at which the pieces stop being collected. */
    minPieceBytes?: number
}

/**
 * The browser store had no room for an asset. `message` is the translated text the user reads (an alert shows only the
 * message); `cause` keeps the browser's own error.
 */
export class AssetStorageFullError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'AssetStorageFullError'
    }
}

/**
 * The name a message about an asset save shows: the name of a picked File, else a file name that has an extension, else
 * "unnamed file". Several pickers pass only the extension as the file name, which would read as `"png" could not be saved`.
 */
function assetDisplayName(blob: Blob | null, fileName: string): string {
    if (blob !== null && typeof File !== 'undefined' && blob instanceof File && blob.name !== '') {
        return blob.name
    }
    return fileName.includes('.') ? fileName : 'unnamed file'
}

/**
 * Rethrows `error` for an asset save: a browser quota failure (the error itself, or the direct cause a store wraps it
 * in) becomes `AssetStorageFullError`, whose message is not empty; every other error is rethrown as it is. Errors the
 * importers match on pass first, so an `AssetSourceChangedError` whose cause is a quota error stays one, and an error
 * already converted is never wrapped twice.
 */
function rethrowStorageFull(error: unknown, displayName: string): never {
    if (error instanceof AssetStorageFullError || error instanceof AssetSourceChangedError || error instanceof StoreBlobUnsupportedError) {
        throw error
    }
    if (isQuotaExceededError(error) || (error instanceof Error && isQuotaExceededError(error.cause))) {
        throw new AssetStorageFullError(language.assetSaveStorageFull(displayName), { cause: error })
    }
    throw error
}

function asSourceChanged(error: unknown): AssetSourceChangedError {
    if (error instanceof AssetSourceChangedError) {
        return error
    }
    const text = String((error as { message?: unknown } | null | undefined)?.message ?? error)
    return new AssetSourceChangedError(`The source of the asset could not be read to the end: ${text}`, { cause: error })
}

function assetExtensionOf(fileName: string): string {
    if (fileName) {
        const candidate = fileName.split('.').pop() ?? ''
        if (ASSET_EXTENSION.test(candidate)) {
            return candidate
        }
    }
    return 'png'
}

/**
 * Saves an asset that arrives in pieces and returns its key, the same key
 * `saveAsset` gives the whole bytes: `assets/<SHA-256 of the bytes>.<ext>`.
 *
 * On a store that offers `openWriter` (the desktop and Android app, and the Node
 * server), for an asset that may be at least `ASSET_PIECE_SAVE_MIN_BYTES` large,
 * every piece is hashed and written once. The file is built in a temporary file
 * in `assets/`; the last chunk renames it to the key computed from the pieces, or
 * discards it when that key already holds a file. The whole asset is never held
 * when the store writes in pieces (a Node server that lacks the upload routes
 * collects the pieces inside its writer; the browser's IndexedDB accumulates them
 * in a Blob, writes nothing under the temporary name, and stores the bytes whole
 * within `WEB_ASSET_LIMIT_BYTES` if the browser cannot keep a Blob).
 * Anywhere else, and for a smaller asset,
 * the pieces are collected and `saveAsset` saves them.
 *
 * The pieces are read once and written as read: a piece is never modified or
 * reused after it is yielded, because the writer keeps the newest piece until
 * the next call. An error thrown by the source, or by `beforeFinish`, ends the
 * save with an `AssetSourceChangedError`; a quota failure of the store is rethrown as
 * `AssetStorageFullError` and any other error of the store as it is. In both cases the temporary file is removed and the key holds nothing
 * from this save.
 */
export async function saveAssetFromPieces(pieces: AsyncIterable<Uint8Array>, options: AssetPieceSaveOptions): Promise<string> {
    const fileName = options.fileName ?? ''
    const store = await getAppStore()
    const threshold = options.minPieceBytes ?? ASSET_PIECE_SAVE_MIN_BYTES
    const iterator = pieces[Symbol.asyncIterator]()

    async function next(): Promise<IteratorResult<Uint8Array>> {
        try {
            return await iterator.next()
        } catch (error) {
            throw asSourceChanged(error)
        }
    }

    async function runBeforeFinish(): Promise<void> {
        try {
            await options.beforeFinish?.()
        } catch (error) {
            throw asSourceChanged(error)
        }
    }

    if (store.openWriter === undefined || options.sizeBound < threshold) {
        const parts: Uint8Array[] = []
        let total = 0
        for (let step = await next(); step.done !== true; step = await next()) {
            parts.push(step.value)
            total += step.value.length
        }
        await runBeforeFinish()
        const whole = new Uint8Array(total)
        let at = 0
        for (const part of parts) {
            whole.set(part, at)
            at += part.length
        }
        return await saveAsset(whole, '', fileName)
    }

    const endInFlight = beginChokePoint('asset')
    let writer: PieceWriter | null = null
    try {
        writer = store.openWriter(`assets/incoming-${uuidv4()}`)
        const hash = new Sha256()
        for (let step = await next(); step.done !== true; step = await next()) {
            hash.update(step.value)
            await writer.write(step.value)
        }
        const key = `assets/${hash.digestHex()}.${assetExtensionOf(fileName)}`
        // After the digest is known and before the call that decides between the
        // rename and the discard, so a sweep never takes the key from under it.
        await noteAndSettleAssetWrite(key)
        await runBeforeFinish()
        await writer.finish(key)
        return key
    } catch (error) {
        await writer?.abort()
        try {
            await iterator.return?.()
        } catch {
            // The source is released best-effort; the error that ended the save is the one reported.
        }
        if (error instanceof StoreBlobUnsupportedError) {
            // The writer raises it only above the bound a whole value has on this store, so the user is told the limit.
            throw browserStorageTooLargeError(fileName, error)
        }
        rethrowStorageFull(error, assetDisplayName(null, fileName))
    } finally {
        endInFlight()
    }
}

/**
 * The app store when it writes in pieces, or `null` where every value goes through the store whole. The desktop and
 * Android store always qualify. The Node store qualifies when the capability it recorded says its server takes pieces;
 * when none has been recorded yet, one probe is made so a page whose boot never probed still streams. Callers ask once
 * per operation, never per asset.
 */
export async function pieceStoreOrNull(): Promise<ByteStore | null> {
    const store = await getAppStore()
    if (store.openWriter === undefined) {
        return null
    }
    if (store.piecesRecorded === undefined) {
        return store
    }
    if (!store.piecesRecorded() && store.guarded !== undefined) {
        try {
            await store.guarded.probe()
        } catch (error) {
            console.warn(error)
            return null
        }
    }
    return store.piecesRecorded() ? store : null
}

/**
 * The error shown when a browser that keeps no Blob is handed a file above the bound a whole value has on the plain web
 * store. The message names the file and that bound; `cause` keeps the store's own error.
 */
export function browserStorageTooLargeError(fileName: string, cause?: unknown): Error {
    const message = language.assetFileTooLargeForBrowserStorage(fileName !== '' ? fileName : 'unnamed file', Math.floor(WEB_ASSET_LIMIT_BYTES / (1024 * 1024)))
    return cause === undefined ? new Error(message) : new Error(message, { cause })
}

/**
 * The largest file a user may add as an asset, in bytes: the page store's asset limit. The piece capability is settled
 * first, because a Node page that has not yet recorded it would otherwise answer the smaller body limit and refuse
 * files that save fine in pieces.
 */
export async function pickedAssetLimitBytes(): Promise<number> {
    await pieceStoreOrNull()
    return storeAssetLimitBytes()
}

/** The bytes one slice of a Blob read by `saveAssetFromBlob` holds. */
const BLOB_PIECE_BYTES = 4 * 1024 * 1024

/**
 * Saves a picked file or other Blob as an asset and returns its key, the same
 * key `saveAsset` gives the same bytes and file name. On a store that offers
 * `openWriter`, a Blob that may reach `ASSET_PIECE_SAVE_MIN_BYTES` is read one
 * slice at a time (`saveAssetFromPieces`), so the page never holds the file
 * whole (a Node server without upload routes still collects the pieces into one
 * body in `openWriter`). On a store that keeps Blobs (`readBlob`, the browser's
 * IndexedDB) such a Blob is stored under a temporary name, the stored copy is
 * hashed by slices and named after that hash (`saveAssetBlobKept`); if
 * the browser cannot keep a Blob, a file within `WEB_ASSET_LIMIT_BYTES` is read
 * whole and saved by `saveAsset`, and a larger one is refused. Anywhere else, and
 * for a smaller Blob, it is read whole and `saveAsset` saves it.
 * On every store, a Blob above the store's asset limit (`pickedAssetLimitBytes`) is refused first with
 * `AssetTooLargeError`, before any byte is read.
 * An error thrown while a slice is read (the file changed or vanished) is
 * rethrown as it is, with nothing stored under the key.
 */
export async function saveAssetFromBlob(blob: Blob, fileName: string = '', options: { minPieceBytes?: number, pieceBytes?: number } = {}): Promise<string> {
    const store = await getAppStore()
    const threshold = options.minPieceBytes ?? ASSET_PIECE_SAVE_MIN_BYTES
    const pieceBytes = options.pieceBytes ?? BLOB_PIECE_BYTES
    const displayName = assetDisplayName(blob, fileName)
    assertBlobWithinAssetLimit(blob, displayName, await pickedAssetLimitBytes())
    if (store.readBlob !== undefined && store.writeBlob !== undefined && blob.size >= threshold) {
        // The browser's IndexedDB: the file is stored under a temporary name and the stored copy is named after its hash.
        const kept = await saveAssetBlobKept(store.writeBlob.bind(store), store, blob, fileName, displayName, pieceBytes)
        if (kept !== null) {
            return kept
        }
        // The browser keeps no Blob. The whole bytes are read and hashed once, so the key always names the bytes stored;
        // a file above the bound a whole value has on this store is refused.
        if (blob.size > WEB_ASSET_LIMIT_BYTES) {
            throw browserStorageTooLargeError(displayName === 'unnamed file' ? '' : displayName)
        }
        return await saveAssetBytes(new Uint8Array(await blob.arrayBuffer()), '', fileName, displayName, { blobRefused: true })
    }
    if (store.openWriter === undefined || blob.size < threshold) {
        return await saveAssetBytes(new Uint8Array(await blob.arrayBuffer()), '', fileName, displayName)
    }
    let sliceFailure: { error: unknown } | null = null
    async function* slices(): AsyncGenerator<Uint8Array, void, undefined> {
        for (let start = 0; start < blob.size; start += pieceBytes) {
            try {
                yield new Uint8Array(await blob.slice(start, start + pieceBytes).arrayBuffer())
            } catch (error) {
                sliceFailure = { error }
                throw error
            }
        }
    }
    try {
        return await saveAssetFromPieces(slices(), { fileName, sizeBound: blob.size, minPieceBytes: threshold })
    } catch (error) {
        const failed = sliceFailure as { error: unknown } | null
        if (error instanceof AssetSourceChangedError && failed !== null && error.cause === failed.error) {
            throw failed.error
        }
        throw error
    }
}

/**
 * Saves `blob` and returns the key its stored bytes name, `assets/<SHA-256 of the stored bytes>.<ext>`, without the page
 * ever holding the file whole. Returns `null` when the browser refused to keep a Blob on the first write
 * (`StoreBlobUnsupportedError`, nothing stored); every other failure is rethrown (a quota failure as
 * `AssetStorageFullError`). A failure leaves no wrong value under a content key; if reading the final value back fails,
 * the correct Blob this save wrote stays there.
 *
 * The file is written once under a temporary name, `assets/incoming-<uuid>`. The browser may copy a File into the
 * database after the app has read it, so hashing the File could name bytes other than the ones stored. The app therefore
 * hashes the copy the database holds (`readBlob`), slice by slice, and writes that same Blob under its hash, unless the
 * hash key already holds a value (a name is a content hash, so it holds these bytes; it is never touched). The only key
 * this function deletes is its own temporary key. If the File changed while it was copied, what the browser copied is
 * what is named and stored: neither the original nor the edited file is promised; a copy whose size differs from the
 * File's snapshot ends the save as `AssetSourceChangedError`, with nothing stored.
 *
 * Limits. Storage of up to twice the file is held for the duration of the save. A crash or a closed tab during the save
 * leaves the temporary key; on a `tauri` or `indexeddb` store2 page the asset sweep deletes it once two passes at least a
 * day apart found it, and until then a full backup exports it (a Node server keeps it; CHORE-836). An orphan of 100 MiB or more can appear by its raw key in the upstream-size prompt. After the final write, a value of
 * the right size, Blob or bytes, completes the save, so a concurrent same-content `saveAsset` that replaced the Blob with
 * bytes or a Blob leaves both saves with a valid key. Only a Blob of the wrong size is deleted; an absent key, or bytes of another
 * size, end the save with an error and nothing is deleted.
 */
async function saveAssetBlobKept(writeBlob: NonNullable<ByteStore['writeBlob']>, store: ByteStore, blob: Blob, fileName: string, displayName: string, pieceBytes: number): Promise<string | null> {
    const endInFlight = beginChokePoint('asset')
    const tempKey = `assets/incoming-${uuidv4()}`
    // Before any I/O, so a sweep of this page never takes the key from under the save.
    noteAssetWrittenThisPage(tempKey)
    try {
        try {
            await writeBlob(tempKey, blob, 'unconditional')
        } catch (error) {
            if (error instanceof StoreBlobUnsupportedError) {
                return null
            }
            throw error
        }
        const stored = await store.readBlob?.(tempKey) ?? null
        if (stored === null) {
            throw new Error(`"${displayName}" was not saved: its temporary copy was removed by another tab of this app. Try again.`)
        }
        if (stored.size !== blob.size) {
            throw new AssetSourceChangedError(`The source of the asset changed while it was stored: ${stored.size} of ${blob.size} bytes.`)
        }
        const finalKey = `assets/${await hashBlobBySlices(stored, pieceBytes)}.${assetExtensionOf(fileName)}`
        await noteAndSettleAssetWrite(finalKey)
        if (!await store.has(finalKey)) {
            // The second write must not fall back to a whole read: the browser has shown it keeps Blobs, so its failure is the answer.
            await writeBlob(finalKey, stored, 'unconditional')
            await verifyFinalKeyHolds(store, finalKey, stored.size)
        }
        await deleteKeyReportingFailure(store, tempKey)
        return finalKey
    } catch (error) {
        await deleteKeyReportingFailure(store, tempKey)
        rethrowStorageFull(error, displayName)
    } finally {
        endInFlight()
    }
}

/** The hex SHA-256 of `blob`, read one slice at a time. Ends as `AssetSourceChangedError` if the slices do not total the Blob's size. */
async function hashBlobBySlices(blob: Blob, pieceBytes: number): Promise<string> {
    const hash = new Sha256()
    let hashed = 0
    for (let start = 0; start < blob.size; start += pieceBytes) {
        const slice = new Uint8Array(await blob.slice(start, start + pieceBytes).arrayBuffer())
        hash.update(slice)
        hashed += slice.length
    }
    if (hashed !== blob.size) {
        throw new AssetSourceChangedError(`The stored asset ended after ${hashed} of ${blob.size} bytes.`)
    }
    return hash.digestHex()
}

type FinalKeyState = 'complete' | 'wrong-blob' | 'wrong-bytes' | 'absent'

/**
 * What `key` holds relative to `size`. A store writes one value per key, so a same-content `saveAsset` (no dedupe)
 * may have replaced the Blob with bytes or a Blob: that value counts when its size is right. The branch without `readValue` exists only for a
 * store that offers `readBlob` alone (the browser store offers both); a `null` there is judged by `has` and never
 * reported as a wrong value.
 */
async function finalKeyState(store: ByteStore, key: string, size: number): Promise<FinalKeyState> {
    if (store.readValue === undefined) {
        const held = await store.readBlob?.(key) ?? null
        if (held === null) {
            return await store.has(key) ? 'complete' : 'absent'
        }
        return held.size === size ? 'complete' : 'wrong-blob'
    }
    const value = await store.readValue(key)
    if (value === null) {
        return 'absent'
    }
    if (value instanceof Blob) {
        return value.size === size ? 'complete' : 'wrong-blob'
    }
    return value.byteLength === size ? 'complete' : 'wrong-bytes'
}

/**
 * Ends the Blob save once `key` holds `size` bytes, checking twice before it gives up. Only a Blob of the wrong size is
 * deleted; an absent key or bytes of another size belong to another writer, so the save throws and deletes nothing.
 */
async function verifyFinalKeyHolds(store: ByteStore, key: string, size: number): Promise<void> {
    let state = await finalKeyState(store, key, size)
    if (state !== 'complete') {
        state = await finalKeyState(store, key, size)
    }
    if (state === 'complete') {
        return
    }
    if (state === 'wrong-blob') {
        await deleteKeyReportingFailure(store, key)
        throw new AssetSourceChangedError(`The stored asset was not complete: it is not ${size} bytes.`)
    }
    throw new AssetSourceChangedError(state === 'absent'
        ? 'The stored asset was removed before the save finished.'
        : `The stored asset was replaced by a value of another size than ${size} bytes.`)
}

/** Deletes a key this save created; a failure is logged and does not change the outcome of the save. */
async function deleteKeyReportingFailure(store: ByteStore, key: string): Promise<void> {
    try {
        await store.delete(key, 'unconditional')
    } catch (error) {
        console.error(error)
    }
}

/**
 * The bytes of a value handed to `saveAsset`: a `Uint8Array`, an `ArrayBuffer`
 * or any other view over one, taken as they are without a copy. Anything else is
 * a programming error and is refused before a key is made.
 */
function assetBytesOf(data: unknown): Uint8Array {
    if (data instanceof Uint8Array) {
        return data
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    }
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
        return new Uint8Array(data as ArrayBuffer)
    }
    throw new TypeError(`An asset is saved from an ArrayBuffer or a typed array, not a value of type ${Object.prototype.toString.call(data).slice(8, -1)}.`)
}

/**
 * Loads an asset file with the given ID.
 * 
 * @param {string} id - The ID of the asset file to load.
 * @returns {Promise<Uint8Array>} - A promise that resolves to the data of the loaded asset file.
 */
export async function loadAsset(id: string) {
    return await readAssetBytes(id)
}

let lastSave = ''

export let saving = $state({
    state: false
})

function isQuotaExceededError(error: unknown): boolean {
    return error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || (error as any).code === 22 || (error as any).code === 1014)
}

/**
 * Saves the current state of the database.
 * 
 * @returns {Promise<void>} - A promise that resolves when the database has been saved.
 */
export let requiresFullEncoderReload = $state({
    state: false
})

/**
 * Observation seam over `saveDb()`'s loop; it changes nothing the loop does.
 * `saveMarkCount` counts every request for a save (each mark and each direct
 * `changed = true`), so a change followed by a change back is still a change
 * until a later iteration's snapshot covers it. `snapshotMarkCount` is the count
 * at the latest iteration's snapshot, and `lastIterationCommitted` is true only
 * after that iteration's commit landed or the iteration found the store
 * already holding the same blocks and wrote nothing. `saveLoopPending` reads the
 * loop's own closure state (a debounce running, `changed`, an unsaved
 * iteration) and is null until `saveDb()` starts.
 */
let saveMarkCount = 0
let snapshotMarkCount = 0
let lastIterationCommitted = false
let saveLoopPending: (() => boolean) | null = null
let saveLoopUnsaved: (() => boolean) | null = null
let requestSaveNowImpl: (() => void) | null = null
/** How many characters the store2 loop's passes cannot encode now; 0 on a page without a store2 loop. */
let unsavableCharacterCount = 0
/** Which characters those are, replaced whole at each store2 pass; empty on a page without a store2 loop. */
let unsavableCharacterIds: ReadonlySet<string> = new Set()
/** How many modules, preset lists, loadouts, statics, character order, settings fields and plugin-data keys the store2 loop's passes cannot encode now; 0 on a page without a store2 loop. */
let unsavableItemCount = 0

/** True while the store2 loop reports the character as unsavable; always false on a page without a store2 loop. */
export function isCharacterUnsavable(chaId: string): boolean {
    return unsavableCharacterIds.has(chaId)
}

/**
 * Asks the save loop to save what is marked without waiting out the debounce.
 * Does nothing in a read-only page and before the loop's real scheduler is
 * live; marks made then are saved by the ordinary debounce. The request counts
 * as a mark and marks the page dirty, so the hide path asks only while
 * `hasUnsavedSaveMarks()` is true or a chat is in flight. A loop parked or holding keeps its state
 * apart from that mark.
 */
export function requestSaveNow(): void {
    requestSaveNowImpl?.()
}

/** A hide or Back asked the store2 idle net to verdict every resident at its next turn; the loop takes it once. */
let netSweepPending = false

/** Ends the store2 loop's idle wait without a save request; null before the loop's real scheduler is live. */
let netSweepWakeImpl: (() => void) | null = null

/**
 * Asks for that sweep and wakes the loop out of an idle wait, so the sweep's module-scope tick starts at once instead
 * of at the next timer (a hidden page may not run one for a while). It marks nothing, never makes the page dirty,
 * counts no save request and cuts no running pass.
 */
export function requestNetSweep(): void {
    netSweepPending = true
    netSweepWakeImpl?.()
}

/**
 * True from an edit's mark until the snapshot of the pass that took it, and
 * false after a snapshot that took every edit. A debounce running or a change
 * flag with no edit behind them do not count. It reads loop state only, and is
 * false before `saveDb()` starts and in a read-only page.
 */
export function hasUnsavedSaveMarks(): boolean {
    return saveLoopUnsaved?.() ?? false
}

const nextCommitCallbacks = new Set<() => void>()

/**
 * The `snapshotMarkCount` of the latest commit: every character, chat and module mark counted at or below it was
 * covered by that commit's pass. A module mark counts as covered even when the pass carried the modules whole past a
 * module it could not encode: whether the module change is in the store is `moduleCommitVerdict`'s answer, not this
 * count's. It only grows, so a later iteration beginning never un-covers a mark. It counts a commit in which the mark's
 * character could not be saved as covering it.
 */
let committedMarkCount = 0

/**
 * The module hold the store2 loop reported with its latest saved notice. The loop's own literal is the clean state; a
 * page without a store2 loop never reports one, so the clean state stays truthful there.
 */
let lastModuleHold: ModuleHold = { carriedWhole: false, faultIds: [] }

/**
 * Whether the latest reported commit holds module `moduleId`'s change: `saved` when the module set is not carried whole
 * and the id is not named, `unsavable` when the id's own saved copy is kept, `blocked` when the set is carried whole
 * for another cause. It reflects the hold as of the last reported commit, so it is meaningful outside a callback too;
 * inside a next-commit callback it speaks for the commit that fired it.
 */
export function moduleCommitVerdict(moduleId: string): 'saved' | 'unsavable' | 'blocked' {
    if (lastModuleHold.faultIds.includes(moduleId)) {
        return 'unsavable'
    }
    return lastModuleHold.carriedWhole ? 'blocked' : 'saved'
}

/** The character statement of the latest reported commit; the clean one before any: nothing listed means nothing is known to be gone. */
let lastCommitCharacters: CharacterCommit = { listed: null, encoded: new Set(), skipped: new Set() }

/**
 * What the latest reported commit did with character `chaId` (compared as `String(chaId)`): `saved` when the pass wrote
 * it; `skipped` when the pass could not read it and kept its saved copy, or never had one; `gone` when the pass's copy
 * of the list did not hold it; `absent` otherwise (a stub or a character the pass did not name). The order is
 * load-bearing: a never-saved skipped slot is listed but in no tree, so `skipped` must be judged before `gone` can
 * matter. Like `moduleCommitVerdict`, inside a next-commit callback it speaks for the commit that fired it.
 */
export function characterCommitVerdict(chaId: string | number): 'saved' | 'skipped' | 'gone' | 'absent' {
    const id = String(chaId)
    if (lastCommitCharacters.encoded.has(id)) {
        return 'saved'
    }
    if (lastCommitCharacters.skipped.has(id)) {
        return 'skipped'
    }
    if (lastCommitCharacters.listed !== null && !lastCommitCharacters.listed.has(id)) {
        return 'gone'
    }
    return 'absent'
}

/** True when saving has stopped. The store's running value is the empty string, so test truthiness, never `!== null`. */
export function isSavingStopped(): boolean {
    return Boolean(get(savingStoppedReason))
}

/** Calls `callback` whenever saving is stopped (a store calls its subscriber at once, so only a truthy reason counts); the returned function unsubscribes. */
export function onSavingStopped(callback: () => void): () => void {
    return savingStoppedReason.subscribe((reason) => {
        if (reason) {
            callback()
        }
    })
}

/** The mark count the latest commit covered (see `committedMarkCount`); compare with `getSaveMarkCount()` taken after a mark. */
export function getCommittedSaveMarkCount(): number {
    return committedMarkCount
}

/** Calls and forgets every callback registered for the next commit; a throwing callback never stops the others. */
function fireNextCommitCallbacks(): void {
    // Set before the callbacks run: a callback asks whether its marks are covered.
    committedMarkCount = Math.max(committedMarkCount, snapshotMarkCount)
    for (const callback of [...nextCommitCallbacks]) {
        nextCommitCallbacks.delete(callback)
        try {
            callback()
        } catch (error) {
            console.error(error)
        }
    }
}

/** Calls `callback` once, when the next save iteration commits: its commit lands or it writes nothing because the store already holds the same blocks. */
export function afterNextSaveCommit(callback: () => void): void {
    nextCommitCallbacks.add(callback)
}

let peerSaveCount = 0

/** How many saves another tab has announced to this page; it only grows, so a peer save between two reads always shows. */
export function getPeerSaveCount(): number {
    return peerSaveCount
}

/** How many saves have been requested on this page; it only grows, so a change that is later undone still shows. */
export function getSaveMarkCount(): number {
    return saveMarkCount
}

/**
 * True only when everything marked so far is in the store: the last
 * iteration committed, no mark has arrived since its snapshot, and no save is
 * running, debounced, queued, stopped or held back by a frozen chaId, and no
 * character or other item is unsavable (its latest data is in memory only). `hasUnsavedSaveMarks`
 * does not count unsavable characters or items: a new save request cannot help them.
 */
export function isSaveClean(): boolean {
    if (!saveLoopPending || !lastIterationCommitted) {
        return false
    }
    return saveMarkCount === snapshotMarkCount
        && unsavableCharacterCount === 0
        && unsavableItemCount === 0
        && !saving.state
        && !requiresFullEncoderReload.state
        && !saveLoopPending()
        && !get(savingStoppedReason)
        && get(frozenSaveKeysStore).length === 0
}

/**
 * What a parked save loop names, besides its reason: the part of the data that
 * was too large to save. Read by the save indicator once the reason is set.
 */
let savingStoppedDetail = ''

/** Whether the waiting line is on; the store is touched only when the value changes, so the loop's clearing on every pass costs nothing. */
let peerWaitingShown = false

export function getSavingStoppedDetail(): string {
    return savingStoppedDetail
}

/**
 * A minimal async mutex serializing the save loop's commits and conversion
 * with any other whole-state writer (currently LoadLocalBackup()'s restore,
 * `loadInternalBackup` (drive/internalBackup.ts)'s snapshot load, and the
 * exclusive storage-migration lock's holders below,
 * such as the copy back from OPFS at startup). LoadLocalBackup()'s
 * restore write and the internal-backup load's write acquire this directly only
 * on Tauri or when Web Locks aren't supported; on an ordinary web build their
 * exclusive storage lock already holds this internally for the same reason (see
 * `acquireExclusiveStorageMigrationLock` below) and the write must NOT acquire
 * it a second time. A boolean "is someone
 * else writing" flag checked once before encoding is NOT sufficient — the flag
 * can flip true after the check but before the write actually lands, letting a
 * stale autosave clobber a just-completed restore. Acquiring this lock actually
 * blocks a second acquirer until the first releases, so ordering is always
 * correct regardless of the exact interleaving. Not releasing after a
 * successful acquire (as LoadLocalBackup()'s restore write and the
 * internal-backup load's write deliberately do not) permanently blocks every later acquirer — the desired behavior once a
 * restore has committed and a reload is imminent: nothing from this now-stale
 * JS context should ever write this key again.
 */
class AsyncMutex {
    private queue: Promise<void> = Promise.resolve()
    async acquire(): Promise<() => void> {
        let release: () => void
        const willRelease = new Promise<void>((resolve) => { release = resolve })
        const previous = this.queue
        this.queue = this.queue.then(() => willRelease)
        await previous
        return release
    }
}
export const dbWriteLock = new AsyncMutex()

/**
 * Production's single storage tab locks instance (see
 * `storageTabLocks.ts`'s single-instance rule) — built against
 * `navigator.locks` and `dbWriteLock` above, the same write mutex `saveDb()`
 * and `LoadLocalBackup()`'s restore write take. `AutoStorage` defaults to
 * this instance too.
 */
const storageTabLocks = createStorageTabLocks(
    typeof navigator === 'undefined' ? undefined : navigator.locks,
    dbWriteLock
)

/** Resolves once this tab's own shared presence lock has actually been granted. */
export const tabPresenceLockAcquired: Promise<void> = storageTabLocks.tabPresenceLockAcquired

/**
 * Whether this page's storage tab locks were built against a defined lock
 * manager, i.e. whether Web Locks are actually available in this browser.
 * See `storageTabLocks.ts`'s `locksSupported` for the full contract —
 * callers MUST compare this with `=== false`, never with a falsy check.
 */
export const locksSupported = storageTabLocks.locksSupported

/** Whether this tab holds its own shared presence lock right now; see `storageTabLocks.ts`'s `holdsOwnPresence`. */
export const holdsOwnTabPresence = storageTabLocks.holdsOwnPresence

/**
 * Attempts to acquire the storage tab lock in EXCLUSIVE mode, for a
 * storage-backend migration. See `storageTabLocks.ts`'s
 * `acquireExclusiveStorageMigrationLock` for the full contract and its
 * load-bearing ordering; internally also acquires `dbWriteLock` — callers
 * must NOT separately acquire it themselves.
 */
export const acquireExclusiveStorageMigrationLock = storageTabLocks.acquireExclusiveStorageMigrationLock

/**
 * Takes a fresh reading of this tab's storage epoch. See
 * `storageTabLocks.ts`'s `recordStorageEpoch` for the full contract.
 */
export const recordStorageEpoch = storageTabLocks.recordStorageEpoch

/**
 * Merges a snapshot of a tracker back into the live tracker, without discarding
 * whatever the live tracker has accumulated since the snapshot was taken (e.g.
 * from edits made while a write was in flight). Used whenever a save attempt
 * captured `toSave` but didn't end up persisting it, so nothing pending gets
 * silently dropped. Pure — takes the live tracker explicitly instead of closing
 * over saveDb()'s `changeTracker`, so it can be driven directly by tests
 * (S14).
 */
export function mergeUnsavedChanges(liveTracker: toSaveType, toSave: toSaveType): void {
    for (const chaId of toSave.character) {
        if (!liveTracker.character.includes(chaId)) {
            liveTracker.character.push(chaId)
        }
    }
    for (const pair of toSave.chat) {
        if (!liveTracker.chat.some(([c, ch]) => c === pair[0] && ch === pair[1])) {
            liveTracker.chat.push(pair)
        }
    }
    liveTracker.botPreset ||= toSave.botPreset
    liveTracker.modules ||= toSave.modules
    liveTracker.loadouts ||= toSave.loadouts
    liveTracker.plugins ||= toSave.plugins
    liveTracker.pluginCustomStorage ||= toSave.pluginCustomStorage
}

/**
 * True while the save loop waits on a character it cannot save under its id.
 * `checkCharOrder` removes nothing from the order while it is true, so the
 * paused character's folder entry under its saved id survives until saving
 * resumes.
 */
let loopHoldsSaving = false

// What `publishHeldSaves` last wrote to `heldSaveStore`, so a pass that changes
// nothing does not re-notify every subscriber.
let lastPublishedHeld = ''

function publishHeldSaves(held: HeldSaveInfo[]): void {
    const key = held.map((item) => `${item.kind}:${item.archived}:${item.name}`).join('\n')
    if (key !== lastPublishedHeld) {
        lastPublishedHeld = key
        heldSaveStore.set(held)
    }
}

function nameOfEntry(entry: Record<string, unknown>): string {
    return typeof entry.name === 'string' && entry.name !== '' ? entry.name : '(unnamed)'
}

/**
 * The save loop's check of the live character list, run on every pass in one
 * synchronous stretch before anything is prepared:
 *
 * - an entry that is not a character is dropped, the selection keeps its
 *   character, the order is repaired and the encoder is reloaded;
 * - an unarchived character with no id gets a new one;
 * - an archived character with no id, and any character whose id is present
 *   but cannot key a block, is returned as held: saving waits for it, because
 *   an archived character's id is never replaced and a present id is the
 *   plugin's or the person's to undo.
 *
 * Tells the person once per pass at most.
 *
 * `holds: false` (the store2 loop) still returns the held entries but does not
 * stop `checkCharOrder` from pruning: any string id is a legal store2 handle.
 */
export function liveCharacterCheck(options: { holds?: boolean } = {}): { held: HeldSaveInfo[], repaired: boolean } {
    const holds = options.holds ?? true
    const db = getDatabase()
    const list: unknown = db?.characters
    if (!Array.isArray(list)) {
        loopHoldsSaving = false
        return { held: [], repaired: false }
    }
    let needsWork = false
    for (const entry of list) {
        if (!isCharacterEntry(entry) || !isUsableCharacterId(entry.chaId)) {
            needsWork = true
            break
        }
    }
    if (!needsWork) {
        loopHoldsSaving = false
        return { held: [], repaired: false }
    }
    let dropped = 0
    let filled = 0
    if (list.some((entry) => !isCharacterEntry(entry))) {
        const selectedBefore = get(selectedCharID)
        const selectedRef: unknown = selectedBefore >= 0 ? list[selectedBefore] : undefined
        const kept = list.filter((entry) => isCharacterEntry(entry))
        dropped = list.length - kept.length
        db.characters = kept as unknown as Database['characters']
        if (selectedRef !== undefined) {
            selectedCharID.set(isCharacterEntry(selectedRef) ? db.characters.indexOf(selectedRef as unknown as Database['characters'][number]) : -1)
        }
    }
    const held: HeldSaveInfo[] = []
    for (const entry of db.characters) {
        const cha = entry as unknown as Record<string, unknown>
        if (isUsableCharacterId(cha.chaId)) {
            continue
        }
        const archived = !!cha.coldstorage
        if (isMissingCharacterId(cha.chaId) && !archived) {
            cha.chaId = uuidv4()
            filled++
            continue
        }
        held.push({ name: nameOfEntry(cha), kind: 'unusable-id', archived })
    }
    loopHoldsSaving = holds && held.length > 0
    const repaired = dropped > 0 || filled > 0
    if (repaired) {
        checkCharOrder(db)
        requiresFullEncoderReload.state = true
        alertToast(language.saveRepairedEntriesNotice(dropped, filled))
    }
    return { held, repaired }
}

/**
 * Releases any orphan draft-content registration whose cap has elapsed, by
 * forwarding to
 * `draftContentOrphanGate.sweepExpiredRegistrations`. `now` is injectable
 * (defaulting to `Date.now()`) so a test can pin this function's own body
 * without depending on real wall-clock time.
 *
 * The store2 save loop's port calls this once per pass, at a fixed point,
 * unconditionally, because the sweep must keep running on every idle pass
 * regardless of whether there is anything to save.
 */
export function sweepDraftRegistrations(now: number = Date.now()): void {
    draftContentOrphanGate.sweepExpiredRegistrations(now)
}

/**
 * What an unsavable character is called in its notice: its quoted name, else its quoted id. Total: a hostile name or id
 * getter must not reach the save loop.
 */
function unsavableCharacterLabel(chaId: string): string {
    try {
        const name = getDatabase()?.characters?.find((candidate) => String(candidate?.chaId ?? '') === chaId)?.name
        return typeof name === 'string' && name !== '' ? `"${name}"` : `"${chaId}"`
    } catch {
        return `"${chaId}"`
    }
}

/**
 * The notice of one item the store2 loop cannot save. The labels are the raw names, quoted (the item's `label` is the
 * quoted name; a setting or plugin-data key is its own key). Total: a hostile name must not reach the save loop.
 */
function unsavableItemNotice(item: SkippedItem): string {
    try {
        if (item.scope === 'presets') {
            return language.savePresetsHeldNotice(item.label)
        }
        if (item.scope === 'taskPresets') {
            return language.saveTaskPresetsHeldNotice(item.label)
        }
        if (item.scope === 'moduleSet') {
            return language.saveModulesHeldNotice(item.label)
        }
        if (item.scope === 'loadouts') {
            return language.saveLoadoutsHeldNotice(item.label)
        }
        const what = item.scope === 'module'
            ? language.saveItemModuleLabel(item.label.slice(1, -1))
            : item.scope === 'settings'
                ? language.saveItemSettingLabel(item.key)
                : item.scope === 'statics'
                    ? language.saveItemStaticsLabel
                    : item.scope === 'characterOrder'
                        ? language.saveItemCharacterOrderLabel
                        : language.saveItemPluginDataLabel(item.key)
        return item.saved ? language.saveItemUnsavedNotice(what) : language.saveItemNeverSavedNotice(what)
    } catch {
        return item.saved ? language.saveItemUnsavedNotice(`"${item.key}"`) : language.saveItemNeverSavedNotice(`"${item.key}"`)
    }
}

/**
 * The save loop of a page with an active store2 session: the same marks, debounce, boot window, hide path and
 * peer channel as `saveDb()`, with the loop's own passes in `store2/saveLoop`. The synchronous prefix (the marks
 * and the effects) runs before the first await, so no mark can race the install; the loop module is loaded after
 * it, so a page without a session never loads it.
 */
async function saveDbStore2(active: Store2SaveContext): Promise<never> {
    let changed = false
    let dirtySinceLastSave = false
    let peerHeard = false
    const sessionID = v4()
    let channel: BroadcastChannel | undefined
    if (window.BroadcastChannel) {
        channel = new BroadcastChannel('risu-db')
        channel.onmessage = (ev) => {
            const message = parseStore2Broadcast(ev.data)
            if (message === null || message.sessionID === sessionID) {
                return
            }
            peerHeard = true
            peerSaveCount += 1
        }
    }

    /** The loop-owned in-flight token held from a cut hidden tick until its redo ends; one token however many cuts in a row. */
    let redoHold: (() => void) | null = null
    const endRedoHold = (): void => {
        const end = redoHold
        redoHold = null
        end?.()
    }

    const changeTracker: toSaveType = {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false
    }
    const scheduler = createSaveScheduler({
        debounceMs: 500,
        sleep,
        hooks: {
            onMark: (markDirty) => {
                saveMarkCount += 1
                if (markDirty) {
                    dirtySinceLastSave = true
                }
            },
            onDue: () => {
                changed = true
            },
            onRequestNow: () => {
                saveMarkCount += 1
                dirtySinceLastSave = true
                changed = true
            },
        },
    })
    saveLoopPending = () => changed || scheduler.debouncePending() || dirtySinceLastSave
    saveLoopUnsaved = () => dirtySinceLastSave
    // Set by every dirty mark that no value verdict can judge (`content`), by the port's `markUnsaved`, `requestPass` and
    // the liveCheck repair, and cleared only when a pass takes its snapshot. A `judged` mark leaves it alone: the prompt
    // judges that change by value.
    let unsavedContent = false
    function saveTimeoutExecute(markDirty = true, kind: SaveMarkKind = 'content') {
        if (markDirty && kind === 'content') {
            unsavedContent = true
        }
        scheduler.schedule(markDirty)
    }

    // The Node server's commit-key feed only wakes the peer check, through the flag the broadcast path sets: it counts no
    // save mark, marks nothing dirty and takes no idle-net slot. A page without it loses promptness, nothing else.
    const nodeStorage = forageStorage.realStorage
    const peerFeed: NodePeerFeed | null = isNodeServer && nodeStorage instanceof NodeStorage
        ? startNodePeerFeed({
            authHeader: () => nodeStorage.authHeader(),
            onPeerCommit: peerCommitWake(() => { peerHeard = true }, () => scheduler.wakeIdle()),
        })
        : null

    // The boot window still counts what the effects below cannot see; with no encoder to initialise it is empty
    // unless a boot-time import wrote before it closed.
    const bootWindow = openBootWindow({
        getCharacters: () => getDatabase()?.characters,
        markUnsaved: () => saveTimeoutExecute(true)
    })
    installCharacterSaveMarks({ tracker: changeTracker, schedule: (kind) => saveTimeoutExecute(true, kind) })
    requestSaveNowImpl = () => scheduler.requestNow()
    netSweepWakeImpl = () => scheduler.wakeIdle()
    const bootWindowAnswer = bootWindow.close()
    $effect.root(() => {
        registerDbChangeEffects({
            tracker: changeTracker,
            markChanged: (markDirty) => saveTimeoutExecute(markDirty, 'judged'),
            markContentChanged: (markDirty) => saveTimeoutExecute(markDirty, 'content'),
        })
    })
    for (const chaId of bootWindowAnswer.selectedChaIds) {
        appendIfAbsent(changeTracker, chaId)
    }
    if (bootWindowAnswer.unsaved) {
        saveTimeoutExecute(true)
    }

    const { runStore2SaveLoop } = await import('./storage/store2/saveLoop')
    const { describeSaveFailure, saveFailureClassOf } = await import('./storage/store2/ui/peerUi')
    /** Shows what a failing save tells the person and answers how long the loop waits; records nothing. */
    const showSaveFailure = (error: unknown, attempts: number, storageFull: boolean): number => {
        const report = describeSaveFailure(error, attempts, storageFull)
        if (report.toast !== null) {
            alertToast(report.toast)
        }
        if (report.alert !== null) {
            console.error(error)
            alertStore.set({ type: 'error', msg: report.alert.msg, submsg: report.alert.submsg })
        } else if (report.showRaw) {
            alertError(error instanceof Error ? error : String(error))
        } else {
            console.error(error)
        }
        return report.waitMs
    }
    // The walk of the character list runs when a reading below moved, a pass failed, or the idle interval passed.
    const liveCheckGate = createLiveCheckGate()
    const port: Store2LoopPort = {
        tracker: changeTracker,
        reloadFlag: requiresFullEncoderReload,
        getDatabase,
        mergeBack: mergeUnsavedChanges,
        liveCheck() {
            const db = getDatabase()
            const list: unknown = db?.characters
            const signal: LiveCheckSignal = {
                db,
                characters: typeof list === 'object' ? list : undefined,
                length: Array.isArray(list) ? list.length : 0,
                marks: saveMarkCount,
                dirty: dirtySinceLastSave,
                due: changed,
                failed: get(saveFailureStore) !== null,
            }
            const now = Date.now()
            if (!liveCheckGate.due(signal, now)) {
                return
            }
            liveCheckGate.walked(signal, now)
            // Held ids are not a hold here: any string id is a legal store2 chaId, so they must not suspend order pruning. A repair sets the full-reload flag itself.
            if (liveCharacterCheck({ holds: false }).repaired) {
                saveMarkCount += 1
                dirtySinceLastSave = true
                unsavedContent = true
                changed = true
            }
        },
        sweep: () => sweepDraftRegistrations(),
        isDue: () => changed,
        isDirty: () => dirtySinceLastSave,
        contentState: () => ({ unsaved: unsavedContent, marks: saveMarkCount }),
        hasDrafts: () => hasLocalDrafts(),
        beginIteration() {
            saving.state = true
            changed = false
            lastIterationCommitted = false
        },
        endIteration() {
            saving.state = false
        },
        snapshotTaken() {
            dirtySinceLastSave = false
            unsavedContent = false
            snapshotMarkCount = saveMarkCount
        },
        // `content` is false only for the fold-back of a pass that took judged marks alone: the page is dirty and a pass is
        // due, but no content flag is raised.
        requestPass(content = true) {
            dirtySinceLastSave = true
            if (content) {
                unsavedContent = true
            }
            saveMarkCount += 1
            changed = true
        },
        // Dirty only: no pass becomes due and no mark is counted, so the loop's cadence and the idle net run on while
        // the held edits keep the page from reading clean.
        markUnsaved() {
            dirtySinceLastSave = true
            unsavedContent = true
        },
        unsavable(current, newly) {
            unsavableCharacterCount = current.length
            unsavableCharacterIds = new Set(current.map((entry) => entry.chaId))
            for (const entry of newly) {
                console.error(entry.cause)
                const label = unsavableCharacterLabel(entry.chaId)
                alertToast(entry.saved ? language.saveCharacterUnsavedNotice(label) : language.saveCharacterNeverSavedNotice(label))
            }
        },
        unsavableItems(current, newly) {
            unsavableItemCount = current.length
            for (const item of newly) {
                console.error(item.cause)
                alertToast(unsavableItemNotice(item))
            }
        },
        saved(hold, characters) {
            // First, before anything that can throw and before the callbacks: a callback reads the hold of its own commit.
            lastModuleHold = hold
            lastCommitCharacters = characters
            saveFailureStore.set(null)
            lastIterationCommitted = true
            fireNextCommitCallbacks()
        },
        broadcast(epoch) {
            try {
                channel?.postMessage({ sessionID, epoch })
            } catch (error) {
                // A failed notification must never fail a save that succeeded.
                console.error(error)
            }
        },
        peerHeard() {
            const heard = peerHeard
            peerHeard = false
            return heard
        },
        setStopped(reason, detail = '') {
            savingStoppedDetail = detail
            saving.state = false
            savingStoppedReason.set(reason)
            // Only a real stop ends the token: the empty reason clears a park and the owed redo still runs.
            if (reason) {
                endRedoHold()
            }
        },
        setPeerWaiting(waiting) {
            if (waiting !== peerWaitingShown) {
                peerWaitingShown = waiting
                peerWaitingStatus.set(waiting)
            }
        },
        notifyTooLarge(label) {
            alertToast(language.savingStoppedTooLargeBlockMessage(label, NODE_BODY_LIMIT_BYTES, storeAssetLimitBytes()))
        },
        reportFailure(error, attempts) {
            const storageFull = isQuotaExceededError(error) || isQuotaExceededError(error instanceof Error ? error.cause : undefined)
            saveFailureStore.set({ class: saveFailureClassOf(error, storageFull), attempts })
            return showSaveFailure(error, attempts, storageFull)
        },
        reportUncountedFailure(error, attempts) {
            const storageFull = isQuotaExceededError(error) || isQuotaExceededError(error instanceof Error ? error.cause : undefined)
            return showSaveFailure(error, attempts, storageFull)
        },
        async withWriteLock(run) {
            const release = await dbWriteLock.acquire()
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: (ms) => scheduler.wait(ms),
        // Chosen once by transport: a back-off begun visible can span the freeze, so the page's hidden state is no basis.
        rearmWait: isAndroidTransport() ? (ms) => scheduler.waitRearm(ms) : undefined,
        // Same transport choice: a hidden tick that yields can be parked across the freeze, and a save request ends that yield.
        onRequest: isAndroidTransport() ? (listener) => scheduler.onRequest(listener) : undefined,
        // Keeps the keep-alive service up while a cut hidden tick's work waits for its redo.
        tickRedoOwed(owed) {
            if (owed) {
                redoHold ??= beginInFlight('save')
            } else {
                endRedoHold()
            }
        },
        sleep,
        sleepForever,
        now: () => Date.now(),
        takeNetSweep() {
            const pending = netSweepPending
            netSweepPending = false
            return pending
        },
        takeResidentLoaded: takeResidentLoaded,
        pageHidden: () => document.visibilityState === 'hidden',
        yieldImmediately: shouldBypassFrozenPagePaths,
        peerFeedLive: peerFeed === null ? undefined : () => peerFeed.isPeerFeedLive(),
        replyOwners: activeStreamOwners,
    }
    if (MEASURE) {
        // A measurement build can hold the idle net while an export runs; dirty passes are not affected.
        installNetHold(busyKinds)
    }
    return await runStore2SaveLoop(active, port)
}

export async function saveDb() {
    // A page that runs from OPFS this time saves nothing. This check and the
    // dispatch below happen before the first await.
    if (getPageStorageMode().kind === 'read-only') {
        return
    }
    // The active store2 save decides, whatever the page mode says: the dispatch
    // and the live gate keep the two in agreement, so no mode test comes first.
    const store2Save = getActiveStore2Save()
    if (store2Save !== null) {
        return saveDbStore2(store2Save)
    }
    // No other save loop exists: a page with no active store2 save has nothing
    // to write with, and silence here would let edits pile up unsaved.
    throw new Error(`saveDb: no store2 save is active on a page in the "${getPageStorageMode().kind}" storage mode.`)
}

/**
 * Retrieves fetch data for a given chat ID.
 * 
 * @param {string} id - The chat ID to search for in the fetch log.
 * @returns {fetchLog | null} - The fetch log entry if found, otherwise null.
 */
export function getFetchData(id: string) {
    for (const log of fetchLog) {
        if (log.chatId === id) {
            return log;
        }
    }
    return null;
}

const knownHostes = ["localhost", "127.0.0.1", "0.0.0.0"];
const webLocalNetworkBlockedMessage = "웹에서는 사설망 직접 호출 불가. Tauri 또는 LAN Node self-host 사용";
const defaultProxyJobHeartbeatSec = 15;

// The page's own server answers the proxy routes; the upstream hub's proxy is never used (CHORE-557).
function getProxy2Url() {
    return `/proxy2`;
}

function buildTimeoutSignal(originalSignal?: AbortSignal, timeoutMs?: number) {
    if (!timeoutMs || timeoutMs <= 0) {
        return {
            signal: originalSignal,
            cleanup: () => { /* no-op */ }
        };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (originalSignal) {
        if (originalSignal.aborted) {
            controller.abort();
        }
        else {
            originalSignal.addEventListener('abort', onAbort, { once: true });
        }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
            originalSignal?.removeEventListener('abort', onAbort);
        }
    };
}

/**
 * Internal third parameter of `globalFetch` and `fetchNative`: the native destination policy of an
 * untrusted caller. Only `network/untrustedFetch` supplies it; it is not part of the options bag.
 */
export type NativeInternal = { nativePolicy: { allowPrivate: boolean } };

/**
 * Interface representing the arguments for the global fetch function.
 * 
 * @interface GlobalFetchArgs
 * @property {boolean} [plainFetchForce] - Whether to force plain fetch.
 * @property {any} [body] - The body of the request.
 * @property {{ [key: string]: string }} [headers] - The headers of the request.
 * @property {boolean} [rawResponse] - Whether to return the raw response.
 * @property {'POST' | 'GET'} [method] - The HTTP method to use.
 * @property {AbortSignal} [abortSignal] - The abort signal to cancel the request.
 * @property {string} [chatId] - The chat ID associated with the request.
 */
export interface GlobalFetchArgs {
    plainFetchForce?: boolean;
    plainFetchDeforce?: boolean;
    body?: any;
    headers?: { [key: string]: string };
    rawResponse?: boolean;
    method?: 'POST' | 'GET';
    abortSignal?: AbortSignal;
    chatId?: string;
    interceptor?: string;
    requestTimeoutMs?: number;
    networkRoute?: 'auto' | 'local_network';
    /**
     * Fork-specific: the reply must arrive and be parsed while the hidden Android page is frozen.
     * Android only: there, a non-streamed request through `fetchWithTauri` takes the native event
     * route (`fetchWithNativeEvents`) and has no native deadline. Elsewhere the flag changes nothing.
     * It is ignored for `rawResponse` and for plain-fetch and userscript routing, which never reach
     * that route. A caller's `requestTimeoutMs` still bounds the request through `globalFetch`.
     */
    deliverWhileFrozen?: boolean;
    /**
     * Fork-specific: the bound owner of this request's reply record (`bindGrant`). Only the native event route of
     * `fetchWithTauri` reads it; only an owner issued and bound by the page's own send is taken, so a caller's lookalike
     * object owns nothing.
     */
    nativeReply?: NativeReplyOwner | null;
}

/**
 * Interface representing the result of the global fetch function.
 *
 * @interface GlobalFetchResult
 * @property {boolean} ok - Whether the request was successful.
 * @property {any} data - The data returned from the request.
 * @property {{ [key: string]: string }} headers - The headers returned from the request.
 * @property {boolean} [nativeFinal] - The failure was announced to the person by the native side: the turn is over and no retry follows.
 */
interface GlobalFetchResult {
    ok: boolean;
    data: any;
    headers: { [key: string]: string };
    status: number;
    nativeFinal?: boolean;
}

/**
 * Adds a fetch log entry.
 * 
 * @param {Object} arg - The arguments for the fetch log entry.
 * @param {any} arg.body - The body of the request.
 * @param {{ [key: string]: string }} [arg.headers] - The headers of the request.
 * @param {any} arg.response - The response from the request.
 * @param {boolean} arg.success - Whether the request was successful.
 * @param {string} arg.url - The URL of the request.
 * @param {string} [arg.resType] - The response type.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {fetchLog} - The added fetch log entry; later writes to it go through this reference.
 */
export function addFetchLog(arg: {
    body: any,
    headers?: { [key: string]: string },
    response: any,
    success: boolean,
    url: string,
    resType?: string,
    chatId?: string,
    status?: number
}): fetchLog {
    const redact = fetchLogRedactor()
    const entry: fetchLog = {
        body: redact('body', typeof (arg.body) === 'string' ? arg.body : JSON.stringify(arg.body, null, 2)),
        header: redact('header', JSON.stringify(arg.headers ?? {}, null, 2)),
        response: redact('response', typeof (arg.response) === 'string' ? arg.response : JSON.stringify(arg.response, null, 2)),
        responseType: arg.resType ?? 'json',
        success: arg.success,
        date: (new Date()).toLocaleTimeString(),
        url: redact('url', arg.url),
        chatId: arg.chatId,
        status: arg.status
    }
    fetchLog.unshift(entry)
    // Callers hold the entry itself, so eviction never moves a held entry onto another request's row.
    while (fetchLog.length > FETCH_LOG_LIMIT) {
        fetchLog.pop()
    }
    return entry;
}

/**
 * Performs a global fetch request.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} [arg={}] - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
export async function globalFetch(url: string, arg: GlobalFetchArgs = {}, internal?: NativeInternal): Promise<GlobalFetchResult> {
    // Every fetchWith* reads the body before it returns, so the token covers
    // the whole transfer.
    const endInFlight = beginInFlight('request')
    try {
        assertNoSecretRef(arg.headers, url);
        const db = getDatabase();
        if (arg.abortSignal?.aborted) { return { ok: false, data: 'aborted', headers: {}, status: 400 }; }

        const parsedUrl = new URL(url)
        const urlHost = parsedUrl.hostname
        const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
        // On Android an http request never takes the WebView fetch: the release cleartext policy refuses it.
        const forcePlainFetch = decidePlainFetch({
            knownHost: knownHostes.includes(urlHost),
            isTauri,
            plainFetchForce: arg.plainFetchForce,
            plainFetchDeforce: arg.plainFetchDeforce,
            localNetworkRoute: useLocalNetworkRoute,
            android: isAndroidTransport(),
            protocol: parsedUrl.protocol,
        })

        if (useLocalNetworkRoute && !isTauri && !isNodeServer) {
            return { ok: false, headers: {}, status: 400, data: webLocalNetworkBlockedMessage };
        }

        if (knownHostes.includes(urlHost) && !isTauri && !isNodeServer) {
            return { ok: false, headers: {}, status: 400, data: 'You are trying local request on web version. This is not allowed due to browser security policy. Use the desktop version instead, or use a tunneling service like ngrok and set the CORS to allow all.' };
        }

        if(arg.interceptor){
            for (const interceptor of bodyIntercepterStore) {
                try {
                    arg.body = await interceptor.callback(arg.body, arg.interceptor) || arg.body
                }
                catch (e) {
                    console.error(e)
                }
            }
        }

        const timeoutSignal = buildTimeoutSignal(arg.abortSignal, arg.requestTimeoutMs)
        const requestArg = timeoutSignal.signal === arg.abortSignal
            ? arg
            : { ...arg, abortSignal: timeoutSignal.signal }

        try {
            // An untrusted request is decided by the native destination policy alone: the plain-fetch,
            // userscript and local-network routes would bypass it.
            if (internal && isTauri) {
                return await fetchWithNativeEvents(url, requestArg, internal);
            }
            if (useLocalNetworkRoute) {
                if (isTauri) {
                    return await fetchWithTauri(url, requestArg);
                }
                return await fetchWithProxy(url, requestArg);
            }
            if (forcePlainFetch) {
                return await fetchWithPlainFetch(url, requestArg);
            }
            //userScriptFetch is provided by userscript
            if (window.userScriptFetch) {
                return await fetchWithUSFetch(url, requestArg);
            }
            if (isTauri) {
                return await fetchWithTauri(url, requestArg);
            }
            return await fetchWithProxy(url, requestArg);
        } finally {
            timeoutSignal.cleanup();
        }

    } catch (error) {
        console.error(error);
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    } finally {
        endInFlight();
    }
}

/**
 * Adds a fetch log entry in the global fetch log.
 * 
 * @param {any} response - The response data.
 * @param {boolean} success - Indicates if the fetch was successful.
 * @param {string} url - The URL of the fetch request.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 */
function addFetchLogInGlobalFetch(response: any, success: boolean, url: string, arg: GlobalFetchArgs, status?: number) {
    const redact = fetchLogRedactor()
    try {
        fetchLog.unshift({
            body: redact('body', JSON.stringify(arg.body, null, 2)),
            header: redact('header', JSON.stringify(arg.headers ?? {}, null, 2)),
            response: redact('response', JSON.stringify(response, null, 2)),
            success: success,
            date: (new Date()).toLocaleTimeString(),
            url: redact('url', url),
            chatId: arg.chatId,
            status: status
        })
    }
    catch {
        fetchLog.unshift({
            body: redact('body', JSON.stringify(arg.body, null, 2)),
            header: redact('header', JSON.stringify(arg.headers ?? {}, null, 2)),
            response: redact('response', `${response}`),
            success: success,
            date: (new Date()).toLocaleTimeString(),
            url: redact('url', url),
            chatId: arg.chatId,
            status: status
        })
    }

    while (fetchLog.length > FETCH_LOG_LIMIT) {
        fetchLog.pop()
    }
}

/**
 * Performs a fetch request using plain fetch.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithPlainFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await fetch(new URL(url), { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.ok && response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using userscript provided fetch.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithUSFetch(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await userScriptFetch(url, { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.ok && response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using Tauri.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithTauri(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    // Decided when the request starts: it starts visible, and the page freezes later.
    if (arg.deliverWhileFrozen && !arg.rawResponse && isAndroidTransport()) {
        return await fetchWithNativeEvents(url, arg);
    }
    try {
        const headers = { 'Content-Type': 'application/json', ...arg.headers };
        const response = await TauriHTTPFetch(new URL(url), { body: JSON.stringify(arg.body), headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        const ok = response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Fork-specific: the User-Agent tauri-plugin-http 2.8.0 adds when a request names none. The native
 * event route sends the same value so that moving a request between the two routes is invisible to
 * providers. It must be re-checked whenever the plugin is updated. That providers do not validate
 * it is an assumption, not something verified.
 */
const pluginDefaultUserAgent = 'tauri-plugin-http/2.8.0';

/**
 * Fork-specific: performs a non-streamed JSON request over the native event route of `fetchNative`, so the reply
 * reaches the page and is parsed while a hidden Android page is frozen. The HTTP plugin cannot do
 * that: its body reads wait on tasks a frozen page never runs. Interceptors already ran in
 * `globalFetch`, and its timeout signal is already `arg.abortSignal`; the request has no native limit.
 *
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithNativeEvents(url: string, arg: GlobalFetchArgs, internal?: NativeInternal): Promise<GlobalFetchResult> {
    // An untrusted request and a raw read never own a reply; neither does a request without a bound owner.
    const owner = internal || arg.rawResponse ? null : (arg.nativeReply ?? null);
    if (owner === null) {
        return await fetchWithNativeEventsLive(url, arg, internal);
    }
    const probe = createPumpProbe();
    // The live branch never rejects: its failures are results, as for an unowned request.
    const live = fetchWithNativeEventsLive(url, arg, internal, owner, probe);
    return await resolveOwnedFetch(owner.key, live, {
        probe,
        signal: arg.abortSignal,
        isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
        onVisible: (callback) => {
            const listener = () => {
                if (document.visibilityState === 'visible') {
                    callback();
                }
            };
            document.addEventListener('visibilitychange', listener);
            return () => document.removeEventListener('visibilitychange', listener);
        },
        store: nativeReplyStore(),
    });
}

let nativeReplyStoreInstance: ReturnType<typeof createReplyStore> | null = null;

function nativeReplyStore(): ReturnType<typeof createReplyStore> {
    nativeReplyStoreInstance ??= createReplyStore();
    return nativeReplyStoreInstance;
}

/** The live branch of `fetchWithNativeEvents`: one native request, its body read from the events. */
async function fetchWithNativeEventsLive(url: string, arg: GlobalFetchArgs, internal?: NativeInternal, owner?: NativeReplyOwner, probe?: PumpProbe): Promise<GlobalFetchResult> {
    try {
        const headers: { [key: string]: string } = { 'Content-Type': 'application/json', ...arg.headers };
        if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
            headers['User-Agent'] = pluginDefaultUserAgent;
        }
        const method = arg.method ?? "POST";
        const response = await fetchNative(url, {
            body: method === 'GET' ? undefined : (JSON.stringify(arg.body) ?? ''),
            headers,
            method,
            signal: arg.abortSignal,
            chatId: arg.chatId,
            logFetch: false,
            noNativeTimeout: true,
            nativeReply: owner,
            pumpProbe: probe,
        }, internal);
        const data = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await parseJsonBody(response);
        // A stop after the head closes the stream cleanly, so a cut-off body must not pass as a reply.
        if (arg.abortSignal?.aborted) {
            return { ok: false, data: 'aborted', headers: {}, status: 400 };
        }
        const ok = response.status >= 200 && response.status < 300;
        addFetchLogInGlobalFetch(data, ok, url, arg, response.status);
        return { ok, data, headers: Object.fromEntries(response.headers), status: response.status };
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Performs a fetch request using a proxy.
 * 
 * @param {string} url - The URL to fetch.
 * @param {GlobalFetchArgs} arg - The arguments for the fetch request.
 * @returns {Promise<GlobalFetchResult>} - The result of the fetch request.
 */
async function fetchWithProxy(url: string, arg: GlobalFetchArgs): Promise<GlobalFetchResult> {
    try {
        const furl = getProxy2Url();
        arg.headers ??= {};
        arg.headers["Content-Type"] ??= arg.body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json";
        const nodeProxyAuth = isNodeServer ? await getNodeServerProxyAuth() : null;
        const headers = {
            "risu-header": encodeURIComponent(JSON.stringify(arg.headers)),
            "risu-url": encodeURIComponent(url),
            "Content-Type": arg.body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json",
            ...(arg.requestTimeoutMs && { "risu-timeout-ms": Math.max(1, Math.floor(arg.requestTimeoutMs)).toString() }),
            ...(nodeProxyAuth && { "risu-auth": nodeProxyAuth }),
        };

        const body = arg.body instanceof URLSearchParams ? arg.body.toString() : JSON.stringify(arg.body);

        const response = await fetch(furl, { body, headers, method: arg.method ?? "POST", signal: arg.abortSignal });
        const isSuccess = response.ok && response.status >= 200 && response.status < 300;

        if (arg.rawResponse) {
            const data = new Uint8Array(await response.arrayBuffer());
            addFetchLogInGlobalFetch("Uint8Array Response", isSuccess, url, arg, response.status);
            return { ok: isSuccess, data, headers: Object.fromEntries(response.headers), status: response.status };
        }

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            addFetchLogInGlobalFetch(data, isSuccess, url, arg, response.status);
            return { ok: isSuccess, data, headers: Object.fromEntries(response.headers), status: response.status };
        } catch (error) {
            const errorMsg = text.startsWith('<!DOCTYPE') ? "Responded HTML. Is your URL, API key, and password correct?" : text;
            addFetchLogInGlobalFetch(text, false, url, arg, response.status);
            return { ok: false, data: errorMsg, headers: Object.fromEntries(response.headers), status: response.status };
        }
    } catch (error) {
        return { ok: false, data: `${error}`, headers: {}, status: 400 };
    }
}

/**
 * Regular expression to match backslashes.
 * 
 * @constant {RegExp}
 */
const re = /\\/g;

/**
 * Gets the basename of a given path.
 * 
 * @param {string} data - The path to get the basename from.
 * @returns {string} - The basename of the path.
 */
export function getBasename(data: string) {
    const splited = data.replace(re, '/').split('/');
    const lasts = splited[splited.length - 1];
    return lasts;
}

/**
 * Retrieves uncleanable resources from the database, by basename.
 *
 * @param {Database} db - The database to retrieve uncleanable resources from.
 * @returns {Promise<string[]>} - An array of uncleanable resources.
 */
export function getUncleanablesSync(db: Database, options?:{
    chars: (character|groupChat)[],
}) {
    const uncleanable = new Set<string>();

    /**
     * Adds a resource to the uncleanable list if it is not already included.
     *
     * @param {string} data - The resource to add.
     */
    function addUncleanable(data: string) {
        if (!data) {
            return;
        }
        if (data === '') {
            return;
        }
        uncleanable.add(getBasename(data));
    }

    addUncleanable(db.customBackground);
    addUncleanable(db.userIcon);
    // These are asset-path fields (populated by saveAsset()), not the adjacent
    // base64 fields — see Agents/Roadmap.md Phase 1, item 1. NAIImgConfig's
    // `reference_image_multiple` is deliberately not included here: nothing
    // currently populates it via saveAsset(), so it holds no asset reference
    // to protect.
    addUncleanable(db.NAIImgConfig?.image);
    addUncleanable(db.NAIImgConfig?.character_image);
    addUncleanable(db.wavespeedImage?.reference_image);
    const chars = options?.chars ?? db.characters

    for (let cha of chars) {
        if (cha.image) {
            addUncleanable(cha.image);
        }
        if (cha.emotionImages) {
            for (const em of cha.emotionImages) {
                addUncleanable(em[1]);
            }
        }
        // additionalAssets/vits are declared on BOTH `character` and `groupChat`
        // (the latter's fields are unused by any current write path — see
        // Agents/Roadmap.md Phase 0.5 — but are still real fields on the type), so
        // they're protected here unconditionally rather than being skipped for
        // groups: if anything ever does populate them on a group chat, the boot-time
        // GC sweep below must not delete the referenced asset out from under it.
        if (cha.additionalAssets) {
            for (const em of cha.additionalAssets) {
                addUncleanable(em[1]);
            }
        }
        if (cha.vits) {
            const keys = Object.keys(cha.vits.files);
            for (const key of keys) {
                const vit = cha.vits.files[key];
                addUncleanable(vit);
            }
        }
        // TTS reads this asset back directly with no fallback (src/ts/process/tts.ts),
        // so its deletion is real functional data loss, not just a stale preview.
        // Present on both `character` and `groupChat` (the latter typed `any`, same
        // "lazy hack for typechecking" category as vits/additionalAssets above), so
        // protected unconditionally for the same reason those are.
        addUncleanable(cha.gptSoVitsConfig?.ref_audio_data?.assetId);
        // Outside the group branch: a group slot can hold the retained paths too, and a path an Undo may restore is kept.
        for (const retained of retainedNamesOf(Reflect.get(cha, ASSET_RETAINED_KEY))) {
            addUncleanable(retained);
        }
        if (cha.type !== 'group') {
            if (cha.ccAssets) {
                for (const asset of cha.ccAssets) {
                    addUncleanable(asset.uri);
                }
            }
        }
    }

    if (db.modules) {
        for (const module of db.modules) {
            // A stub yields only the icon it holds as an index field; no other key is read.
            if (isModuleStub(module)) {
                if (Object.hasOwn(module, 'icon') && module.icon) {
                    addUncleanable(module.icon)
                }
                continue
            }
            const assets = module.assets
            if (assets) {
                for (const asset of assets) {
                    addUncleanable(asset[1])
                }
            }
            if(module.icon){
                addUncleanable(module.icon)
            }
            for (const retained of retainedNamesOf(module[ASSET_RETAINED_KEY])) {
                addUncleanable(retained)
            }
        }
    }

    if (db.personas) {
        db.personas.map((v) => {
            addUncleanable(v.icon);

            if(v.embeddedModule){
                const assets = v.embeddedModule.assets
                if (assets) {
                    for (const asset of assets) {
                        addUncleanable(asset[1])
                    }
                }
                if(v.embeddedModule.icon){
                    addUncleanable(v.embeddedModule.icon)
                }
                for (const retained of retainedNamesOf(v.embeddedModule[ASSET_RETAINED_KEY])) {
                    addUncleanable(retained)
                }
            }
        });
    }

    if (db.characterOrder) {
        db.characterOrder.forEach((item) => {
            if (typeof item === 'object' && 'imgFile' in item) {
                addUncleanable(item.imgFile);
            }
        })
    }
    // An installed theme pack keeps its stored archive. Every entry is walked, whatever its version or shape, so an
    // entry this build cannot read still keeps its files.
    collectPackAssetRefs(db.themePacks, addUncleanable);
    return Array.from(uncleanable);
}


/**
 * Checks and updates the character order in the database.
 * Ensures that all characters are properly ordered and removes any invalid entries.
 */
export function checkCharOrder(db: Database = DBState.db) {
    db.characterOrder = db.characterOrder ?? []
    const order = db.characterOrder
    // While saving waits on a character, the order only gains entries: a held
    // character's folder entry under its saved id survives until saving
    // resumes. An entry that is neither an id nor a folder with a list is
    // skipped everywhere, and removed once nothing is held.
    const holding = loopHoldsSaving
    const ordered = new Set<string>()
    for (let i = 0; i < order.length; i++) {
        const folder = order[i]
        if (typeof (folder) === 'string') {
            ordered.add(folder)
        }
        else if (isCharacterEntry(folder) && Array.isArray(folder.data)) {
            for (const f of folder.data) {
                ordered.add(f)
            }
        }
    }

    const charIdSet = new Set<string>()

    for (let i = 0; i < db.characters.length; i++) {
        const char = db.characters[i]
        if (!isCharacterEntry(char)) {
            continue
        }
        const charId = char.chaId
        // A character whose id is text (even text that cannot key a block) keeps
        // its place in the order and its folder; only ids that are not text or a
        // number, which no entry of the order could name, are skipped.
        if (!isUsableCharacterId(charId) && (typeof charId !== 'string' || charId === '')) {
            continue
        }
        if (!char.trashTime) {
            charIdSet.add(charId)
        }
        if (!ordered.has(charId)) {
            if (!isHiddenSystemCharacter(char) && !char.trashTime) {
                order.push(charId)
            }
        }
    }

    if (holding) {
        return
    }

    for (let i = 0; i < order.length; i++) {
        const data = order[i]
        if (typeof (data) !== 'string') {
            if (!isCharacterEntry(data) || !Array.isArray(data.data) || data.data.length === 0) {
                order.splice(i, 1)
                i--;
                continue
            }
            for (let i2 = 0; i2 < data.data.length; i2++) {
                const data2 = data.data[i2]
                if (!charIdSet.has(data2)) {
                    data.data.splice(i2, 1)
                    i2--;
                }
            }
            if (data.data.length === 0) {
                order.splice(i, 1)
                i--;
                continue
            }
            order[i] = data
        }
        else {
            if (!charIdSet.has(data)) {
                order.splice(i, 1)
                i--;
            }
        }
    }
}

/**
 * Retrieves the request log as a formatted string.
 * 
 * @returns {string} The formatted request log.
 */
export function getRequestLog() {
    let logString = ''
    const b = '\n\`\`\`json\n'
    const bend = '\n\`\`\`\n'

    // Entries are redacted when captured; the pass here covers an entry that was not.
    const redact = fetchLogRedactor()
    for (const log of fetchLog) {
        logString += `## ${log.date}\n\n* Request URL\n\n${b}${redact('url', log.url)}${bend}\n\n* Request Body\n\n${b}${redact('body', log.body)}${bend}\n\n* Request Header\n\n${b}${redact('header', log.header)}${bend}\n\n`
            + `* Response Body\n\n${b}${redact('response', log.response)}${bend}\n\n* Response Success\n\n${b}${log.success}${bend}\n\n`
    }
    return logString
}

/**
 * Retrieves the fetch logs array.
 *
 * @returns {fetchLog[]} The fetch logs array.
 */
export function getFetchLogs() {
    return fetchLog
}

/**
 * Opens a URL in the appropriate environment: on Tauri, the opener plugin's
 * `open_url` command opens it and the capability's URL scope (http, https,
 * mailto, tel) decides what is actually launched; on the web,
 * `openUrlOnWeb` opens http(s) in a new, opener-less tab, hands mailto:/tel:
 * to the OS from the current tab, and refuses every other scheme.
 *
 * @param {string} url - The URL to open.
 */
export function openURL(url: string) {
    if (isTauri) {
        // The warning never includes the URL: OAuth URLs carry state and PKCE values,
        // and the plugin's refusal message repeats the URL.
        try {
            invoke('plugin:opener|open_url', { url }).catch(() => {
                console.warn('openURL: the system could not open the link')
            })
        }
        catch {
            console.warn('openURL: the system could not open the link')
        }
    }
    else {
        openUrlOnWeb(url, window)
    }
}

/**
 * Converts FormData to a URL-encoded string.
 * 
 * @param {FormData} formData - The FormData to convert.
 * @returns {string} The URL-encoded string.
 */
function formDataToString(formData: FormData): string {
    const params: string[] = [];

    for (const [name, value] of formData.entries()) {
        params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value.toString())}`);
    }

    return params.join('&');
}

export { TauriWriter }

/**
 * Class representing a local writer.
 */
export class LocalWriter {
    writer: ExportByteWriter
    /** The cancel switch of the export this writer serves, once `useCancel` or `init` was given one. */
    cancel: ExportCancelToken | undefined
    private abortRequested = false

    /**
     * Ties the writer to an export's cancel token. From a cancel on, `write`, `writeBackup`, `writeBackupHeader` and
     * `close` reject with `ExportCancelledError`, a call already pending included, and the opened writer is told to
     * abort without anyone waiting for that: an abort may stay pending behind a write the browser never takes.
     */
    useCancel(cancel: ExportCancelToken): void {
        this.cancel = cancel
        cancel.onCancel(() => this.abortInner())
    }

    /**
     * Tells the opened writer to give up after a failure, without awaiting it. A later cancel or a second abort does
     * nothing, and the file the writer already handed on stays as it is.
     */
    abort(reason: unknown): void {
        this.abortInner(reason)
    }

    private abortInner(reason: unknown = new ExportCancelledError()): void {
        if (this.abortRequested || this.writer === undefined) {
            return
        }
        this.abortRequested = true
        try {
            void this.writer.abort?.(reason)?.catch((error: unknown) => console.error(error))
        } catch (error) {
            console.error(error)
        }
    }

    private raced<T>(call: Promise<T>): Promise<T> {
        return this.cancel ? this.cancel.race(call) : call
    }

    /**
     * Initializes the writer.
     *
     * @param {string} [name='Binary'] - The name of the file.
     * @param {string[]} [ext=['bin']] - The file extensions.
     * @param {string} [suggestedFileName] - A complete file name (with extension) offered as the download name on web and as the save dialog's default path on Tauri. Without it, the web name is `name.ext[0]` and the dialog suggests none.
     * @param {ExportCancelToken} [cancel] - The export's cancel switch; a cancel seen while the web writer opens aborts the new writer, and the caller's next checkpoint ends the export.
     * @param {(fileName: string, cancel?: ExportCancelToken) => Promise<ExportByteWriter>} [openWriter] - Opens the writer of a non-desktop export in place of the browser download writer.
     * @returns {Promise<boolean>} - A promise that resolves to a boolean indicating success.
     */
    async init(name = 'Binary', ext = ['bin'], suggestedFileName?: string, cancel?: ExportCancelToken, openWriter?: (fileName: string, cancel?: ExportCancelToken) => Promise<ExportByteWriter>): Promise<boolean> {
        if (cancel) {
            this.useCancel(cancel)
        }
        if (isTauri) {
            const filePath = await save({
                ...(suggestedFileName ? { defaultPath: suggestedFileName } : {}),
                filters: [{
                    name: name,
                    extensions: ext
                }]
            });
            if (!filePath) {
                return false
            }
            this.writer = new TauriWriter(filePath)
            return true
        }
        const fileName = suggestedFileName ?? name + '.' + ext[0]
        const open = openWriter ?? openWebExportWriter
        this.writer = cancel ? await open(fileName, cancel) : await open(fileName)
        if (cancel?.cancelled) {
            // The cancel came while the writer opened, before there was a writer to abort.
            this.abortInner()
        }
        return true
    }

    /**
     * Writes backup data to the file.
     * 
     * @param {string} name - The name of the backup.
     * @param {Uint8Array} data - The data to write.
     * @throws {Error} When the name or the data does not fit the 32-bit length fields.
     */
    async writeBackup(name: string, data: Uint8Array): Promise<void> {
        const encodedName = new TextEncoder().encode(getBasename(name))
        // A length past u32 would wrap and yield an entry no reader can parse.
        if (encodedName.byteLength > 0xFFFFFFFF || data.byteLength > 0xFFFFFFFF) {
            throw new Error(`Backup entry "${name}" is too large to store (a single backup entry is limited to 4 GiB).`)
        }
        await writeBackupEntry({ write: (piece) => this.write(piece) }, encodedName, data)
    }

    /**
     * Writes the header of a backup entry whose `dataLength` bytes of body follow through `write`, with the entry name
     * and the 32-bit length rule of `writeBackup`. The caller must write exactly `dataLength` bytes next.
     *
     * @param {string} name - The name of the backup.
     * @param {number} dataLength - The size of the body that follows.
     * @throws {Error} When the name or the length does not fit the 32-bit length fields.
     */
    async writeBackupHeader(name: string, dataLength: number): Promise<void> {
        const encodedName = new TextEncoder().encode(getBasename(name))
        if (encodedName.byteLength > 0xFFFFFFFF || dataLength > 0xFFFFFFFF) {
            throw new Error(`Backup entry "${name}" is too large to store (a single backup entry is limited to 4 GiB).`)
        }
        await this.write(encodeBackupEntryHeader(encodedName, dataLength))
    }

    /**
     * Writes data to the file.
     * 
     * @param {Uint8Array} data - The data to write.
     */
    async write(data: Uint8Array): Promise<void> {
        this.cancel?.throwIfCancelled()
        await this.raced(this.writer.write(data))
    }

    /** Whether the opened writer can take an asset body by reference (`pinAsset`). */
    get splices(): boolean {
        return this.writer !== undefined && isSplicingWriter(this.writer)
    }

    /**
     * Pins an asset on the server side of a splicing writer: its size, or `missing` when the server holds no such
     * file. Call only where `splices` is true.
     */
    async pinAsset(key: string): Promise<{ size: number } | 'missing'> {
        this.cancel?.throwIfCancelled()
        if (!isSplicingWriter(this.writer)) {
            throw new Error('The export writer cannot pin an asset.')
        }
        return await this.raced(this.writer.pinAsset(key))
    }

    /** Marks the end of the bytes written so far as the point where the pinned body is inserted. */
    markSplice(): void {
        this.cancel?.throwIfCancelled()
        if (!isSplicingWriter(this.writer)) {
            throw new Error('The export writer cannot splice an asset.')
        }
        this.writer.markSplice()
    }

    /**
     * Closes the writer. After a cancel it does not close it, so no file is completed.
     */
    async close(): Promise<void> {
        this.cancel?.throwIfCancelled()
        await this.raced(this.writer.close())
    }
}

export { AppendableBuffer, VirtualWriter } from './byteBuffer'

/**
 * Index for fetch operations.
 * @type {number}
 */
let fetchIndex = 0

/**
 * Per page load, so an id left in the native registry by a reload cannot collide with a new request.
 * Not `crypto.randomUUID`, which a plain-HTTP origin lacks.
 */
const fetchIdPrefix = v4().slice(0, 8)

/**
 * Stores native fetch data.
 * @type {{ [key: string]: StreamedFetchChunk[] }}
 */
let nativeFetchData: { [key: string]: StreamedFetchChunk[] } = {}

/**
 * The resolver of the stream pump that is waiting for its next native event, by fetch id.
 * Events and exit conditions wake the pump instead of a timer, which a hidden page throttles.
 */
const nativeFetchWake: { [key: string]: (() => void) | undefined } = {}

const wakeNativeFetch = (id: string) => {
    const wake = nativeFetchWake[id]
    if (wake) {
        delete nativeFetchWake[id]
        wake()
    }
}

/**
 * Interface representing a streamed fetch chunk data.
 * @interface
 */
interface StreamedFetchChunkData {
    type: 'chunk',
    body: string,
    id: string
}

/**
 * Interface representing a streamed fetch header data.
 * @interface
 */
interface StreamedFetchHeaderData {
    type: 'headers',
    body: { [key: string]: string },
    id: string,
    status: number
}

/**
 * Interface representing a streamed fetch end data.
 * @interface
 */
interface StreamedFetchEndData {
    type: 'end',
    id: string,
    /** Present on the end of an owned request: what its record says. */
    reply?: unknown
}

/**
 * Interface representing a streamed fetch error data. It is the terminal event
 * of a request that failed after its response head was sent.
 * @interface
 */
interface StreamedFetchErrorData {
    type: 'error',
    body: string,
    id: string,
    reply?: unknown
}

/**
 * The first event of an owned request: whether the native side opened the reply's record.
 * @interface
 */
interface StreamedFetchOwnerData {
    type: 'owner',
    id: string,
    key: string,
    owned: boolean,
    reason?: string
}

/**
 * Type representing a streamed fetch chunk.
 * @typedef {StreamedFetchChunkData | StreamedFetchHeaderData | StreamedFetchEndData | StreamedFetchErrorData | StreamedFetchOwnerData} StreamedFetchChunk
 */
type StreamedFetchChunk = StreamedFetchChunkData | StreamedFetchHeaderData | StreamedFetchEndData | StreamedFetchErrorData | StreamedFetchOwnerData

/**
 * Interface representing a streamed fetch plugin.
 * @interface
 */
interface StreamedFetchPlugin {
    /**
     * Performs a streamed fetch operation.
     * @param {Object} options - The options for the fetch operation.
     * @param {string} options.id - The ID of the fetch operation.
     * @param {string} options.url - The URL to fetch.
     * @param {string} options.body - The body of the fetch request.
     * @param {{ [key: string]: string }} options.headers - The headers of the fetch request.
     * @returns {Promise<{ error: string, success: boolean }>} - The result of the fetch operation.
     */
    streamedFetch(options: { id: string, url: string, body: string, headers: { [key: string]: string } }): Promise<{ "error": string, "success": boolean }>;

    /**
     * Adds a listener for the specified event.
     * @param {string} eventName - The name of the event.
     * @param {(data: StreamedFetchChunk) => void} listenerFunc - The function to call when the event is triggered.
     */
    addListener(eventName: 'streamed_fetch', listenerFunc: (data: StreamedFetchChunk) => void): void;
}

/**
 * Indicates whether streamed fetch listening is active.
 * @type {boolean}
 */
let streamedFetchListening = false

/**
 * The streamed fetch plugin instance.
 * @type {StreamedFetchPlugin | undefined}
 */
let capStreamedFetch: StreamedFetchPlugin | undefined

if (isTauri) {
    listen('streamed_fetch', (event) => {
        try {
            const parsed = JSON.parse(event.payload as string)
            const id = parsed.id
            if (nativeFetchData[id] === undefined) {
                // An owned request whose pump is gone (Stop, a reload) still ends in its record: the event tells the
                // reconcile that the record may be ready.
                if (isOrphanReplyEvent(parsed)) {
                    requestReconcile()
                }
            } else {
                nativeFetchData[id].push(parsed)
            }
            wakeNativeFetch(id)
        } catch (error) {
            console.error(error)
        }
    }).then(async () => {
        try {
            // Earlier page loads' native requests have no reader; finish cancelling before this page sends one.
            await Promise.resolve(invoke('cancel_all_streamed_fetch')).catch(() => {})
        } catch (error) {
            console.error(error)
        } finally {
            streamedFetchListening = true
        }
    })
}

/**
 * Pipes the fetch log to a readable stream.
 * @param {fetchLog} entry - The fetch log entry that receives the streamed text.
 * @param {ReadableStream<Uint8Array>} readableStream - The readable stream to pipe.
 * @returns {ReadableStream<Uint8Array>} - The new readable stream.
 */
export const pipeFetchLog = (entry: fetchLog, readableStream: ReadableStream<Uint8Array>) => {
    
    const splited = readableStream.tee();
    
    (async () => {
        // A stream error already reaches the consumer through the other branch.
        const text = await (new Response(splited[0])).text().catch(() => null)
        // An entry evicted by the cap is detached; writing to it is harmless and never re-inserts it.
        if (text !== null) {
            entry.response = fetchLogRedactor()('response', text)
        }
    })()
    
    return splited[1]
}

async function fetchViaProxyJobWs(url: string, arg: {
    body: Uint8Array,
    headers?: { [key: string]: string },
    method: "POST" | "GET" | "PUT" | "DELETE",
    signal?: AbortSignal,
    requestTimeoutMs?: number,
    chatId?: string,
    fetchLogEntry?: fetchLog | null
}): Promise<Response> {
    const auth = await getNodeServerProxyAuth();

    const requestSignal = arg.signal;
    let jobId = '';
    const createRes = await fetch(`/proxy-stream-jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'risu-auth': auth
        },
        body: JSON.stringify({
            url,
            method: arg.method,
            headers: arg.headers ?? {},
            bodyBase64: Buffer.from(arg.body).toString('base64'),
            timeoutMs: arg.requestTimeoutMs,
            heartbeatSec: defaultProxyJobHeartbeatSec
        }),
        signal: requestSignal
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Proxy stream job creation failed: ${createRes.status} ${errText}`);
    }

    const created = await createRes.json() as { jobId?: string, wsTicket?: string };
    if (!created.jobId) {
        throw new Error('Proxy stream job creation returned no jobId');
    }
    if (!created.wsTicket) {
        throw new Error('Proxy stream job creation returned no WebSocket ticket');
    }
    jobId = created.jobId;

    // The job's own ticket opens its WebSocket; the general token stays out of the URL.
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/proxy-stream-jobs/${encodeURIComponent(jobId)}/ws?ticket=${encodeURIComponent(created.wsTicket)}`;

    let headersReady = false;
    let status = 200;
    let responseHeaders: HeadersInit = { 'content-type': 'text/event-stream' };
    let settled = false;
    let resolveHeaders: () => void = () => {};
    const waitHeaders = new Promise<void>((resolve) => {
        resolveHeaders = resolve;
    });
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();

    const ws = new WebSocket(wsUrl);
    const readable = new ReadableStream<Uint8Array>({
        start(controller) {
            streamController = controller;
        },
        cancel() {
            try {
                ws.close();
            } catch {
                // no-op
            }
        }
    });
    const pipedReadable = arg.fetchLogEntry != null ? pipeFetchLog(arg.fetchLogEntry, readable) : readable;

    const ensureHeadersReady = () => {
        if (!headersReady) {
            headersReady = true;
            resolveHeaders();
        }
    };

    const closeAndEnd = () => {
        if (settled) {
            return;
        }
        settled = true;
        if (streamController) {
            try {
                streamController.close();
            } catch {
                // no-op
            }
        }
        try {
            ws.close();
        } catch {
            // no-op
        }
    };

    ws.onmessage = (event) => {
        const parsed = parseProxyJobWsEvent(typeof event.data === 'string' ? event.data : '');
        if (!parsed || !streamController) {
            return;
        }
        switch (parsed.type) {
            case 'job_accepted':
            case 'ping':
                return;
            case 'upstream_headers':
                status = parsed.status;
                responseHeaders = parsed.headers ?? {};
                ensureHeadersReady();
                return;
            case 'chunk':
                ensureHeadersReady();
                streamController.enqueue(decodeProxyJobWsChunk(parsed.dataBase64));
                return;
            case 'error': {
                status = parsed.status ?? 502;
                responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
                ensureHeadersReady();
                const msg = formatProxyStreamErrorMessage(parsed.status, parsed.message);
                streamController.enqueue(encoder.encode(msg));
                closeAndEnd();
                return;
            }
            case 'done':
                ensureHeadersReady();
                closeAndEnd();
                return;
        }
    };

    ws.onerror = () => {
        if (!streamController) {
            return;
        }
        status = 502;
        responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
        ensureHeadersReady();
        streamController.enqueue(encoder.encode('Proxy WebSocket stream error'));
        closeAndEnd();
    };

    ws.onclose = () => {
        if (!headersReady) {
            status = 502;
            responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
            ensureHeadersReady();
        }
        closeAndEnd();
    };

    const abortHandler = () => {
        status = 499;
        responseHeaders = { 'content-type': 'text/plain; charset=utf-8' };
        ensureHeadersReady();
        if (streamController && !settled) {
            streamController.enqueue(encoder.encode('Aborted'));
        }
        void fetch(`/proxy-stream-jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            headers: {
                'risu-auth': auth
            }
        }).catch(() => {});
        closeAndEnd();
    };
    if (requestSignal?.aborted) {
        abortHandler();
    }
    else {
        requestSignal?.addEventListener('abort', abortHandler, { once: true });
    }

    await waitHeaders;
    requestSignal?.removeEventListener('abort', abortHandler);
    return new Response(pipedReadable, {
        status,
        headers: new Headers(responseHeaders)
    });
}

/**
 * Fetches data from a given URL using native fetch or through a proxy.
 * @param {string} url - The URL to fetch data from.
 * @param {Object} arg - The arguments for the fetch request.
 * @param {string} arg.body - The body of the request.
 * @param {Object} [arg.headers] - The headers of the request.
 * @param {string} [arg.method="POST"] - The HTTP method of the request.
 * @param {AbortSignal} [arg.signal] - The signal to abort the request.
 * @param {string} [arg.chatId] - The chat ID associated with the request.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the response body, headers, and status.
 * @returns {ReadableStream<Uint8Array>} body - The response body as a readable stream.
 * @returns {Headers} headers - The response headers.
 * @returns {number} status - The response status code.
 * @throws {Error} - Throws an error if the request is aborted or if there is an error in the response.
 */
export async function fetchNative(url: string, arg: {
    body?: string | Uint8Array | ArrayBuffer,
    headers?: { [key: string]: string },
    method?: "POST" | "GET" | "PUT" | "DELETE",
    signal?: AbortSignal,
    chatId?: string
    interceptor?: string
    logFetch?: boolean
    requestTimeoutMs?: number
    networkRoute?: 'auto' | 'local_network'
    /** Sends the native no-limit sentinel instead of the idle limit (no data for 600 s); a given `requestTimeoutMs` still wins. */
    noNativeTimeout?: boolean
    /** A bound reply owner (`bindGrant`): taken once, and never by an untrusted request. */
    nativeReply?: NativeReplyOwner | null
    /** Receives what the event pump learns of an owned request; a caller-supplied probe changes nothing else. */
    pumpProbe?: PumpProbe
}, internal?: NativeInternal): Promise<Response> {

    assertNoSecretRef(arg.headers, url)
    const useInterceptor = !!arg.interceptor
    if (arg.body === undefined && (arg.method === 'POST' || arg.method === 'PUT')) {
        throw new Error('Body is required for POST and PUT requests')
    }

    arg.method = arg.method ?? 'POST'

    let headers = arg.headers ?? {}
    let realBody: Uint8Array

    if (arg.method === 'GET' || arg.method === 'DELETE') {
        realBody = undefined
    }
    else if (typeof arg.body === 'string') {
        let body: string = arg.body
        if(useInterceptor) {
            for (const interceptor of bodyIntercepterStore) {
                try {
                    body = await interceptor.callback(body, arg.interceptor) || body
                }
                catch (e) {
                    console.error(e)
                }
            }
        }
        realBody = new TextEncoder().encode(body)
    }
    else if (arg.body instanceof Uint8Array) {
        realBody = arg.body
    }
    else if (arg.body instanceof ArrayBuffer) {
        realBody = new Uint8Array(arg.body)
    }
    else {
        throw new Error('Invalid body type')
    }

    const db = getDatabase()
    const useLocalNetworkRoute = arg.networkRoute === 'local_network' && isLocalNetworkUrl(url)
    if (useLocalNetworkRoute && !isTauri && !isNodeServer) {
        throw new Error(webLocalNetworkBlockedMessage)
    }
    let throughProxy = (!isTauri) && (!isNodeServer)
    if (useLocalNetworkRoute) {
        if (isNodeServer) {
            throughProxy = true
        }
        else if (isTauri) {
            throughProxy = false
        }
    }
    const timeoutSignal = buildTimeoutSignal(arg.signal, arg.requestTimeoutMs)
    const requestSignal = timeoutSignal.signal
    const shouldLogFetch = arg.logFetch ?? true
    let logEntry: fetchLog | undefined
    if (shouldLogFetch) {
        logEntry = addFetchLog({
            body: new TextDecoder().decode(realBody),
            headers: arg.headers,
            response: 'Streamed Fetch',
            success: true,
            url: url,
            resType: 'stream',
            chatId: arg.chatId,
        })
    }
    try {
        // The userscript hook has no destination policy, so an untrusted request on Tauri never takes it.
        if (window.userScriptFetch && !throughProxy && !(internal && isTauri)) {
            return await window.userScriptFetch(url, {
            body: realBody as any,
            headers: headers,
            method: arg.method,
            signal: requestSignal
        })
        }
        else if (isTauri) {
        while (!streamedFetchListening) {
            await sleep(100)
        }
        // Check after the wait so a Stop during listener setup sends no native request.
        fetchIndex++
        if (requestSignal && requestSignal.aborted) {
            throw new Error('aborted')
        }
        if (fetchIndex >= 100000) {
            fetchIndex = 0
        }
        let fetchId = fetchIdPrefix + '-' + fetchIndex.toString().padStart(5, '0')
        nativeFetchData[fetchId] = []
        // The owner is taken here, with the listeners set up and the abort check passed: a Stop during listener setup
        // threw above and took nothing, and an untrusted request never owns. A forged or already taken owner gives null.
        const takenOwner = isTauri && !internal ? takeReplyOwnerWithNotice(arg.nativeReply) : null
        const replyOwner = takenOwner?.arg ?? null
        const probe = replyOwner !== null ? arg.pumpProbe : undefined
        if (replyOwner !== null) {
            noteInvoked(replyOwner.key)
            // Armed before the request is invoked: the host holds the payload by the same token the invoke carries.
            if (takenOwner?.noticeJson != null && replyOwner.noticeToken !== undefined) {
                armNativeReplyNotice(replyOwner.noticeToken, takenOwner.noticeJson)
            }
        }
        // An owned request's stamp, from an event or from the command's own result; a source without one never clears it.
        const noteStamp = (value: unknown) => {
            const stamp = parseReplyStamp(value)
            if (probe && stamp !== null) {
                probe.stamp = stamp
            }
        }
        // True once a terminal signal (end, error event or failed command) arrived; the first one wins.
        let resolved = false
        // The native request was stopped or abandoned; the pump discards what is left.
        let cancelled = false
        let cancelSent = false
        let finished = false

        let error = ''
        // Settles when the response head is known, the stream ended or the request was aborted.
        let settleHeaders: () => void = () => {}
        const headersReady = new Promise<void>((resolve) => { settleHeaders = resolve })
        const failNative = (message: string) => {
            if (resolved) {
                return
            }
            resolved = true
            error = message || 'streamed_fetch failed'
            wakeNativeFetch(fetchId)
        }

        // Fire-and-forget; a cancel after the request finished would only leave a stale native tombstone.
        const sendCancel = () => {
            if (cancelSent || finished) {
                return
            }
            cancelSent = true
            try {
                Promise.resolve(invoke('cancel_streamed_fetch', { id: fetchId })).catch(() => {})
            } catch (e) {
                console.error(e)
            }
        }

        // Ends the native request and the pump without reporting an error.
        const abandonNative = () => {
            cancelled = true
            sendCancel()
            wakeNativeFetch(fetchId)
        }
        if (probe) {
            probe.abandon = abandonNative
        }

        // Stop is the caller's own signal, so the listener outlives the timeout relay that
        // fetchNative drops when it returns. Removed by finish().
        const onStop = () => {
            abandonNative()
            settleHeaders()
        }

        if (isTauri) {
            invoke('streamed_fetch', {
                id: fetchId,
                url: url,
                headers: JSON.stringify(headers),
                body: realBody ? Buffer.from(realBody).toString('base64') : '',
                method: arg.method,
                // Only `internal` carries a policy: it is never read from `arg`, so a plugin cannot set it.
                policy: internal?.nativePolicy ?? null,
                // Both marks are derived from the identity of `arg.signal`, never from caller-supplied fields, so a plugin cannot set them.
                // The chat's Stop may cancel a marked request natively while the page is frozen; the target is the notice's chat.
                chatStop: isUnitInProgressSignal(arg.signal),
                chatTarget: unitTargetOfSignal(arg.signal) ?? undefined,
                // Tauri names the Rust argument `timeout_secs` as `timeoutSecs`. The native limit covers the
                // whole request, body included; 0 is no limit and an absent value uses the idle limit (no data for 600 s).
                timeoutSecs: arg.requestTimeoutMs
                    ? Math.max(1, Math.ceil(arg.requestTimeoutMs / 1000))
                    : (arg.noNativeTimeout ? 0 : undefined),
                // The key, the blob's page version and the blob: Rust opens the reply's record before it sends.
                ...(replyOwner !== null ? { replyOwner } : {}),
            }).then((res) => {
                try {
                    const parsedRes = JSON.parse(res as string)
                    // A failure result carries the same stamp its event did; whichever arrives first sets it.
                    noteStamp(parsedRes.reply)
                    if (!parsedRes.success) {
                        failNative(parsedRes.body)
                    }
                } catch (e) {
                    // Error properties (message/name/stack) are non-enumerable, so
                    // JSON.stringify(e) returns "{}" and discards the real cause.
                    failNative(e instanceof Error
                        ? (e.message || e.name || 'streamed_fetch parse failed')
                        : String(e))
                }
            }, (e: unknown) => {
                failNative(e instanceof Error ? (e.message || e.name) : String(e))
            })
            if (arg.signal) {
                if (arg.signal.aborted) {
                    onStop()
                }
                else {
                    arg.signal.addEventListener('abort', onStop, { once: true })
                }
            }
        }
        else if (capStreamedFetch) {
            capStreamedFetch.streamedFetch({
                id: fetchId,
                url: url,
                headers: headers,
                body: realBody ? Buffer.from(realBody).toString('base64') : '',
            }).then((res) => {
                if (!res.success) {
                    error = res.error
                    resolved = true
                }
            })
        }

        let resHeaders: { [key: string]: string } = null
        let status = 400

        // The fetch log is captured in the pump itself, so no second branch of the
        // stream exists to be cancelled or to reject unobserved.
        const logDecoder = new TextDecoder()
        let logText = ''

        // Idempotent: every exit path ends here. Late native events find no queue and are dropped.
        const finish = () => {
            if (finished) {
                return
            }
            finished = true
            arg.signal?.removeEventListener('abort', onStop)
            delete nativeFetchData[fetchId]
            delete nativeFetchWake[fetchId]
            if (logEntry) {
                logEntry.response = fetchLogRedactor()('response', logText + logDecoder.decode())
            }
        }

        // Woken when the consumer has read down to an empty queue, or cancelled.
        let queueDrained: (() => void) | undefined
        const tauriReadableStream = new ReadableStream<Uint8Array>({
            start(controller) {
                // A second close or error on a settled stream throws, so every exit uses this one.
                let closed = false
                const closeStream = (failure?: Error) => {
                    if (closed) {
                        return
                    }
                    closed = true
                    try {
                        if (failure) {
                            controller.error(failure)
                        }
                        else {
                            controller.close()
                        }
                    } catch {
                        // The consumer already cancelled and settled the stream.
                    }
                }
                const pump = async () => {
                    try {
                        // Nothing is awaited between the final emptiness check and arming the
                        // wake, so an event pushed meanwhile cannot be missed.
                        while (!cancelled) {
                            const data = nativeFetchData[fetchId]?.shift()
                            if (data !== undefined) {
                                if (data.type === 'chunk') {
                                    const chunk = Buffer.from(data.body, 'base64')
                                    if (logEntry) {
                                        logText += logDecoder.decode(chunk, { stream: true })
                                    }
                                    try {
                                        controller.enqueue(chunk as unknown as Uint8Array)
                                    } catch {
                                        // The consumer cancelled the stream.
                                        cancelled = true
                                    }
                                }
                                if (data.type === 'owner' && replyOwner !== null) {
                                    if (probe) {
                                        probe.owned = data.owned === true
                                    }
                                    if (data.owned !== true) {
                                        noteUnowned(replyOwner.key)
                                    }
                                }
                                if (data.type === 'headers') {
                                    resHeaders = data.body
                                    status = data.status
                                    if (probe) {
                                        probe.head = { status: data.status, headers: data.body }
                                    }
                                    settleHeaders()
                                }
                                if (data.type === 'end') {
                                    noteStamp(data.reply)
                                    resolved = true
                                    settleHeaders()
                                }
                                if (data.type === 'error') {
                                    noteStamp(data.reply)
                                    failNative(data.body)
                                }
                                await Promise.resolve()
                                continue
                            }
                            if (resolved) {
                                break
                            }
                            await new Promise<void>((resolve) => { nativeFetchWake[fetchId] = resolve })
                        }
                    }
                    finally {
                        // Before the head is known fetchNative throws the failure itself.
                        settleHeaders()
                        const failed = !cancelled && error !== '' && resHeaders !== null
                        finish()
                        if (failed) {
                            // Erroring a stream discards what is still queued, so the
                            // consumer reads the partial reply first.
                            while (!cancelled && (controller.desiredSize ?? 1) < 1) {
                                await new Promise<void>((resolve) => { queueDrained = resolve })
                            }
                        }
                        closeStream(failed && !cancelled ? new Error(error) : undefined)
                    }
                }
                pump().catch((e) => console.error(e))
            },
            pull() {
                queueDrained?.()
            },
            cancel() {
                abandonNative()
                finish()
                queueDrained?.()
            }
        })

        // A stop before the first byte ends the wait here, while the timeout
        // relay is still live; once the Response is returned the caller's own
        // abort handling takes over.
        requestSignal?.addEventListener('abort', settleHeaders, { once: true })
        if (requestSignal?.aborted) {
            settleHeaders()
        }
        await headersReady
        requestSignal?.removeEventListener('abort', settleHeaders)

        if (resHeaders === null && requestSignal?.aborted) {
            // Stop is the caller's own signal; anything else is the request timeout.
            const stopped = arg.signal?.aborted === true
            abandonNative()
            finish()
            throw new Error(stopped ? 'aborted' : language.errors.requestTimedOut)
        }

        // A failure after the head belongs to the stream; before it, to this call.
        if (resHeaders === null) {
            if (error !== '') {
                throw new Error(error)
            }
            resHeaders = {}
        }

        return new Response(tauriReadableStream, {
            headers: new Headers(resHeaders),
            status: status
        })


    }
    else if (throughProxy) {
        const useProxyJobWs = isNodeServer
            && arg.interceptor === 'openai_streaming'
            && arg.method === 'POST'
            && useLocalNetworkRoute;
        const nodeProxyAuth = isNodeServer ? await getNodeServerProxyAuth() : null;

        if (useProxyJobWs) {
            try {
                return await fetchViaProxyJobWs(url, {
                    body: realBody,
                    headers,
                    method: arg.method,
                    signal: requestSignal,
                    requestTimeoutMs: arg.requestTimeoutMs,
                    chatId: arg.chatId,
                    fetchLogEntry: logEntry
                });
            } catch (wsErr) {
                console.warn('[ProxyJobWS] fallback to /proxy2 due to error:', wsErr);
            }
        }

        const r = await fetch(getProxy2Url(), {
            body: realBody as any,
            headers: {
                "risu-header": encodeURIComponent(JSON.stringify(headers)),
                "risu-url": encodeURIComponent(url),
                "Content-Type": "application/json",
                ...(arg.requestTimeoutMs && { "risu-timeout-ms": Math.max(1, Math.floor(arg.requestTimeoutMs)).toString() }),
                ...(nodeProxyAuth ? { "risu-auth": nodeProxyAuth } : {}),
            },
            method: arg.method,
            signal: requestSignal
        })

        return new Response(r.body, {
            headers: r.headers,
            status: r.status
        })
    }
    else {
        return await fetch(url, {
            body: realBody as any,
            headers: headers,
            method: arg.method,
            signal: requestSignal,
        })
    }
    } finally {
        timeoutSignal.cleanup()
    }
}

/**
 * Converts a ReadableStream of Uint8Array to a text string.
 * 
 * @param {ReadableStream<Uint8Array>} stream - The readable stream to convert.
 * @returns {Promise<string>} A promise that resolves to the text content of the stream.
 */
export function textifyReadableStream(stream: ReadableStream<Uint8Array>) {
    return new Response(stream).text()
}

/**
 * Toggles the fullscreen mode of the document.
 * If the document is currently in fullscreen mode, it exits fullscreen.
 * If the document is not in fullscreen mode, it requests fullscreen with navigation UI hidden.
 */
export function toggleFullscreen() {
    const fullscreenElement = document.fullscreenElement
    fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({
        navigationUI: "hide"
    })
}

/**
 * Removes non-Latin characters from a string, replaces multiple spaces with a single space, and trims the string.
 * 
 * @param {string} data - The input string to be processed.
 * @returns {string} The processed string with non-Latin characters removed, multiple spaces replaced by a single space, and trimmed.
 */
export function trimNonLatin(data: string) {
    return data.replace(/[^\x00-\x7F]/g, "")
        .replace(/ +/g, ' ')
        .trim()
}

/**
 * A class that provides a blank writer implementation.
 * 
 * This class is used to provide a no-op implementation of a writer, making it compatible with other writer interfaces.
 */
export class BlankWriter {
    constructor() {
    }

    /**
     * Initializes the writer.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     */
    async init() {
        //do nothing, just to make compatible with other writer
    }

    /**
     * Writes data to the writer.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     * 
     * @param {string} key - The key associated with the data.
     * @param {Uint8Array|string} data - The data to be written.
     */
    async write(key: string, data: Uint8Array | string) {
        //do nothing, just to make compatible with other writer
    }

    /**
     * Ends the writing process.
     * 
     * This method does nothing and is provided for compatibility with other writer interfaces.
     */
    async end() {
        //do nothing, just to make compatible with other writer
    }
}

/**
 * A debugging class for performance measurement.
*/

export class PerformanceDebugger {
    kv: { [key: string]: number[] } = {}
    startTime: number
    endTime: number

    /**
     * Starts the timing measurement.
    */
    start() {
        this.startTime = performance.now()
    }

    /**
     * Ends the timing measurement and records the time difference.
     * 
     * @param {string} key - The key to associate with the recorded time.
    */
    endAndRecord(key: string) {
        this.endTime = performance.now()
        if (!this.kv[key]) {
            this.kv[key] = []
        }
        this.kv[key].push(this.endTime - this.startTime)
    }

    /**
     * Ends the timing measurement, records the time difference, and starts a new timing measurement.
     * 
     * @param {string} key - The key to associate with the recorded time.
    */
    endAndRecordAndStart(key: string) {
        this.endAndRecord(key)
        this.start()
    }

    /**
     * Logs the average time for each key to the console.
    */
    log() {
        let table: { [key: string]: number } = {}

        for (const key in this.kv) {
            table[key] = this.kv[key].reduce((a, b) => a + b, 0) / this.kv[key].length
        }


        console.table(table)
    }

    combine(other: PerformanceDebugger) {
        for (const key in other.kv) {
            if (!this.kv[key]) {
                this.kv[key] = []
            }
            this.kv[key].push(...other.kv[key])
        }
    }
}

export function getLanguageCodes() {
    let languageCodes: {
        code: string
        name: string
    }[] = []

    for (let i = 0x41; i <= 0x5A; i++) {
        for (let j = 0x41; j <= 0x5A; j++) {
            languageCodes.push({
                code: String.fromCharCode(i) + String.fromCharCode(j),
                name: ''
            })
        }
    }

    languageCodes = languageCodes.map(v => {
        return {
            code: v.code.toLocaleLowerCase(),
            name: new Intl.DisplayNames([
                DBState.db.language === 'cn' ? 'zh' : DBState.db.language
            ], {
                type: 'language',
                fallback: 'none'
            }).of(v.code)
        }
    }).filter((a) => {
        return a.name
    }).sort((a, b) => a.name.localeCompare(b.name))

    return languageCodes
}

export function getVersionString(): string {
    let versionString = appVer
    if(appSubVer) {
        versionString += '-' + appSubVer
    }
    if (import.meta.env.VITE_RISU_NIGHTLY_BUILD === 'TRUE') {
        versionString = 'Nightly Build ' + import.meta.env.VITE_RISU_BUILD_TIME
    }
    return versionString
}

const countriesWithAiLaw = new Set<string>([

    // EU
    // AI Act
    // https://artificialintelligenceact.eu/
    
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "EL",
    "GR",
    "HU",
    "IE",
    "IT",
    "LV",
    "LT",
    "LU",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",

    //China 
    //Measures for Labeling of AI-Generated Synthetic Content
    // 关于印发《人工智能生成合成内容标识办法》的通知 
    // https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
    "CN",

    //Although CN Law doesn't apply, just in case
    "HK",
    "MO",

    //TW isn't under mainland china jurisdiction
    //de facto, de jure in TW law, unlike HK and MO,
    //So we don't include it for now
    //"TW", 

    // Republic of Korea
    // AI Basic Act
    // 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법
    // https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5%20%EB%B0%9C%EC%A0%84%EA%B3%BC%20%EC%8B%A0%EB%A2%B0%20%EA%B8%B0%EB%B0%98%20%EC%A1%B0%EC%84%B1%20%EB%93%B1%EC%97%90%20%EA%B4%80%ED%95%9C%20%EA%B8%B0%EB%B3%B8%EB%B2%95/(20676,20250121)
    "KR",

    // Vietnam
    // Digital Tech Law
    // Luật Công nghệ số
    "VN",

])

export function aiLawApplies(): boolean {

    //TODO: implement actual logic
    //lets now assume it always applies
    //so we don't have legal issues later

    return true
}

export function aiWatermarkingLawApplies(): boolean {

    //TODO: implement actual logic
    //lets now assume it is false for now,
    //becuase very few countries have it for now
    return false
}

export const chatFoldedState = $state<{
    data: null| {
        targetCharacterId: string,
        targetChatId: string,
        targetMessageId: string,
    }
}>({
    data: null
})

//Since its exported, we cannot use $derived here
export let chatFoldedStateMessageIndex = $state({
    index: -1
})

$effect.root(() => {
    $effect(() => {
        if(!chatFoldedState.data){
            return
        }
        const char = DBState.db.characters[selIdState.selId]
        const chat = char.chats[char.chatPage]
        if(chatFoldedState.data.targetCharacterId !== char.chaId){
            chatFoldedState.data = null
        }
        if(chatFoldedState.data.targetChatId !== chat.id){
            chatFoldedState.data = null
        }
    })

    $effect(() => {
        if(chatFoldedState.data === null){
            chatFoldedStateMessageIndex.index = -1
            return
        }
        const char = DBState.db.characters[selIdState.selId]
        const chat = char.chats[char.chatPage]
        const messageIndex = chat.message.findIndex((v) => {
            return chatFoldedState.data?.targetMessageId === v.chatId
        })
        if(messageIndex === -1){
            console.warn('Target message for folding id' + chatFoldedState.data?.targetMessageId + ' not found')
            chatFoldedStateMessageIndex.index = -1
            return
        }
        chatFoldedStateMessageIndex.index = messageIndex
    })
})

export function foldChatToMessage(targetMessageIdOrIndex: string | number) {
    let targetMessageId = ''
    if (typeof targetMessageIdOrIndex === 'number') {
        const char = getCurrentCharacter()
        const chat = char.chats[char.chatPage]
        const message = chat.message[targetMessageIdOrIndex]
        targetMessageId = message.chatId
    }
    else{
        targetMessageId = targetMessageIdOrIndex
    }
    const char = getCurrentCharacter()
    const chat = char.chats[char.chatPage]
    chatFoldedState.data = {
        targetCharacterId: char.chaId,
        targetChatId: chat.id,
        targetMessageId: targetMessageId,
    }
}

export function changeChatTo(IdOrIndex: string | number) {
    let index = -1
    if (typeof IdOrIndex === 'number') {
        index = IdOrIndex
    }

    if (typeof IdOrIndex === 'string') {
        const currentCharacter = getCurrentCharacter()
        index = currentCharacter.chats.findIndex((v) => {
            return v.id === IdOrIndex
        })
    }

    if(index === -1){
        return
    }

    if(MEASURE){
        noteChatSelect('start')
    }
    DBState.db.characters[selIdState.selId].chatPage = index
    // Flush before bumping so the bump fans its reparse out over the new
    // (usually much smaller) window instead of the outgoing one. This flush
    // only guarantees that a write the flush itself must
    // observe has already landed if it happened before this call; that is
    // why `reorderChatsKeepingCurrent` assigns `chara.chats` before calling
    // this function, not after. Writes that instead depend on the switch
    // having happened belong after this call, as they always did: e.g.
    // `foldChatToMessage(...)` must run after `changeChatTo(...)` at the
    // branch-link button, not before, or it would read the outgoing chat's
    // id and the fold would silently never happen.
    // `changeChatTo` is a shared helper with 17 call sites, and this
    // `flushSync()` is a global drain of all pending Svelte work, not just
    // this chat window. No current caller reaches it from inside an effect
    // or another flush -- that is what makes it safe today, and a future
    // caller must not break that property without rechecking that the flush
    // is still safe there.
    flushSync()
    if(MEASURE){
        noteChatSelect('flushed')
    }
    ReloadGUIPointer.set(Math.random())
    if(MEASURE){
        noteChatSelect('bumped')
    }
}

/**
 * Resolves where the currently-open chat ends up after a reorder. Returns
 * the index of the SAME chat object (by identity) in `newChats`, not
 * `currentPage` re-read against `newChats` -- the page index means a
 * different chat once the array has been permuted, but the object identity
 * survives the reorder and is what must be looked up. Returns -1 when the
 * chat is no longer present. That is not handled specially: `changeChatTo`'s
 * existing early return skips writing `chatPage`, so the user is left on
 * whatever chat now occupies the stale page index.
 */
export function resolveReorderedChatIndex(oldChats: Chat[], newChats: Chat[], currentPage: number): number {
    return newChats.indexOf(oldChats[currentPage])
}

/**
 * Reorders a character or group chat's chats while keeping the user on the
 * same chat, then switches to it. The order of the three steps is the entire
 * point: `chara.chats` must already be the reordered array before
 * `changeChatTo` runs, because `changeChatTo` flushes synchronously, and the
 * target index is only meaningful against the new array.
 */
export function reorderChatsKeepingCurrent(chara: character | groupChat, newChats: Chat[], currentPage: number): void {
    const target = resolveReorderedChatIndex(chara.chats, newChats, currentPage)
    chara.chats = newChats
    changeChatTo(target)
}

export function createChatCopyName(originalName: string,type:'Copy'|'Branch'): string {
    let name = originalName.replaceAll(/\(((Copy|Branch)( \d+)?)\)$/g, '').trim()
    let copyIndex = 1
    let newName = `${name} (${type})`
    const char = getCurrentCharacter()
    while (char.chats.find((v) => v.name === newName)) {
        copyIndex++
        newName = `${name} (${type} ${copyIndex})`
    }
    return newName
}
